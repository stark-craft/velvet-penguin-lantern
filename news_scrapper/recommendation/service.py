"""Recommendation orchestration: candidates, score, diversify, explain, serve."""

from __future__ import annotations

import secrets
import datetime as dt
import re
from typing import Any

from .candidates import article_id, collect_candidates
from .diversity import diversify
from .hooks import ensure_article_hooks
from .preferences import ViewerRepository
from .scoring import score_candidates


CURSOR_VERSION = "fy1"
CURSOR_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{12,80}$")


def encode_cursor(snapshot_id: str, offset: int) -> str:
    return f"{CURSOR_VERSION}.{snapshot_id}.{max(0, int(offset))}"


def parse_cursor(value: str) -> tuple[str, int, bool]:
    """Return snapshot id, offset, and whether this is a legacy numeric cursor."""

    raw = str(value or "").strip()
    if not raw:
        return "", 0, False
    if len(raw) > 256:
        return "", 0, False
    if raw.isdigit():
        return "", min(10_000_000, max(0, int(raw))), True
    parts = raw.split(".")
    if (
        len(parts) == 3
        and parts[0] == CURSOR_VERSION
        and CURSOR_TOKEN_RE.fullmatch(parts[1])
        and parts[2].isdigit()
    ):
        return parts[1], min(10_000_000, max(0, int(parts[2]))), False
    return "", 0, False


def allocate_exclusive_sections(
    page: list[dict[str, Any]],
    fresh: list[dict[str, Any]],
    follow_ups: list[dict[str, Any]],
    exploration: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Build editorial sections without showing one story more than once.

    A story can legitimately qualify as fresh, important, a saved-story follow-up,
    and an exploration pick at the same time. The feed should explain the strongest
    placement once rather than render four duplicate cards. Allocation follows the
    order in which sections are presented to the reader.
    """

    used: set[str] = set()

    def take(candidates: list[dict[str, Any]], limit: int | None = None) -> list[dict[str, Any]]:
        selected: list[dict[str, Any]] = []
        for item in candidates:
            identifier = article_id(item)
            if not identifier or identifier in used:
                continue
            used.add(identifier)
            selected.append(item)
            if limit is not None and len(selected) >= limit:
                break
        return selected

    return {
        "since_last_visit": take(fresh, 4),
        "executive_scan": take(page, 5),
        "followed_updates": take(follow_ups),
        "exploration": take(exploration, 4),
        "more": take(page),
    }


class RecommendationService:
    def __init__(
        self,
        repository: ViewerRepository,
        *,
        exploration_percent: int = 15,
        hooks_enabled: bool = False,
        semantic_affinity_enabled: bool = False,
    ):
        self.repository = repository
        self.exploration_percent = max(0, min(50, int(exploration_percent)))
        self.hooks_enabled = bool(hooks_enabled)
        self.semantic_affinity_enabled = bool(semantic_affinity_enabled)

    def build_feed(
        self,
        viewer_key: str,
        articles: list[dict[str, Any]],
        saved_items: list[dict[str, Any]],
        *,
        cursor: str = "",
        limit: int = 20,
        viewer_name: str = "",
        entitled_audiences: set[str] | None = None,
    ) -> dict[str, Any]:
        state = self.repository.read(viewer_key)
        candidates = collect_candidates(
            articles,
            entitled_audiences=entitled_audiences,
        )
        for item in candidates[:2]:
            item.setdefault("institutional_priority", True)
        if self.hooks_enabled:
            candidates = [ensure_article_hooks(item) for item in candidates]
        scored, diagnostics = score_candidates(
            candidates,
            state,
            saved_items,
            semantic_affinity_enabled=self.semantic_affinity_enabled,
        )
        ranked = diversify(scored, exploration_percent=self.exploration_percent)
        page_limit = max(1, min(50, int(limit)))
        snapshot_id, offset, legacy_cursor = parse_cursor(cursor)
        snapshot = self.repository.read_feed_snapshot(viewer_key, snapshot_id) if snapshot_id else None
        cursor_reset = bool(cursor and not legacy_cursor and snapshot is None)
        if snapshot is None:
            # Invalid/expired cursors restart safely at the first page. Legacy
            # numeric cursors retain their offset while receiving a stable V1
            # cursor for every subsequent request.
            if cursor_reset:
                offset = 0
            snapshot_id = secrets.token_urlsafe(18)
            snapshot_ids = [article_id(item) for item in ranked if article_id(item)]
            snapshot = self.repository.save_feed_snapshot(
                viewer_key,
                snapshot_id,
                snapshot_ids,
                previous_visit_at=str(state.get("last_visit_at") or ""),
            )
        else:
            snapshot_ids = snapshot.get("article_ids") or []

        ranked_by_id = {article_id(item): item for item in ranked if article_id(item)}
        page: list[dict[str, Any]] = []
        position = min(max(0, offset), len(snapshot_ids))
        while position < len(snapshot_ids) and len(page) < page_limit:
            identifier = str(snapshot_ids[position])
            position += 1
            item = ranked_by_id.get(identifier)
            if item is not None:
                page.append(item)
        next_cursor = encode_cursor(snapshot_id, position) if position < len(snapshot_ids) else None
        preferences = state.get("preferences") or {}
        meaningful = int(diagnostics.get("meaningful_events") or 0)
        sessions = int(diagnostics.get("session_count") or 0)
        if state.get("personalization_paused"):
            mode = "paused"
        elif meaningful >= 5 and sessions >= 2:
            mode = "learned"
        elif preferences.get("completed_at"):
            mode = "configured"
        else:
            mode = "starter"
        feed_request_id = secrets.token_urlsafe(18)
        self.repository.mark_served(
            viewer_key,
            [article_id(item) for item in page],
            feed_request_id,
        )
        previous_visit = snapshot.get("previous_visit_at") or state.get("last_visit_at") or ""
        follow_ups = [item for item in page if "saved_follow_up" in (item.get("recommendation") or {}).get("reason_codes", [])]
        exploration = [
            item for item in page
            if (item.get("recommendation") or {}).get("exploration_slot")
        ]
        try:
            previous_time = dt.datetime.fromisoformat(str(previous_visit).replace("Z", "+00:00"))
            if previous_time.tzinfo is None:
                previous_time = previous_time.replace(tzinfo=dt.timezone.utc)
        except (TypeError, ValueError):
            previous_time = None
        fresh = []
        for item in page:
            try:
                published = dt.datetime.fromisoformat(
                    str(item.get("date") or item.get("published") or "").replace("Z", "+00:00")
                )
                if published.tzinfo is None:
                    published = published.replace(tzinfo=dt.timezone.utc)
            except (TypeError, ValueError):
                published = None
            recommendation = item.get("recommendation") or {}
            unseen = not recommendation.get("seen_before")
            if unseen and (
                (previous_time and published and published > previous_time)
                or item.get("is_fresh")
                or (not previous_time and "fresh" in recommendation.get("reason_codes", []))
            ):
                fresh.append(item)
        return {
            "status": "success",
            "ranking_version": "for-you-v1",
            "feed_request_id": feed_request_id,
            "mode": mode,
            "viewer_name": viewer_name,
            "confidence": diagnostics.get("behavior_confidence", 0.0),
            "personalization_paused": bool(state.get("personalization_paused")),
            "last_visit_at": previous_visit,
            "items": page,
            "cursor": next_cursor,
            "cursor_version": CURSOR_VERSION,
            "cursor_reset": cursor_reset,
            "total": len(snapshot_ids),
            "counts": {
                "new_since_last_visit": len(fresh),
                "follow_up": len(follow_ups),
                "exploration": len(exploration),
            },
            "sections": allocate_exclusive_sections(page, fresh, follow_ups, exploration),
            "diagnostics": diagnostics,
        }
