"""Atomic per-viewer preferences, events, and served-state persistence."""

from __future__ import annotations

import datetime as dt
import threading
from pathlib import Path
from typing import Any

from core.storage import JsonStore


TOPICS = {
    "ai_models": "AI Models and Agents",
    "devices_displays": "Devices, Displays and Smart Home",
    "semiconductors": "Semiconductors and Compute",
    "robotics": "Robotics and Automation",
    "cloud_security": "Cloud, Enterprise and Security",
    "policy_markets": "Policy, Markets and Regulation",
    "broadcast": "Broadcast, Media and Distribution",
    "samsung_competitors": "Samsung and Competitor Moves",
}
OUTCOMES = {
    "product_launches": "Product launches",
    "competitive_moves": "Competitive moves",
    "regulation": "Regulation",
    "research": "Research breakthroughs",
    "partnerships_investment": "Partnerships and investment",
    "market_shifts": "Market shifts",
    "risks_incidents": "Risks and incidents",
    "saved_followups": "Follow-ups to saved stories",
}
SOURCE_FAMILIES = {
    "primary": "Official and primary sources",
    "research": "Research and standards bodies",
    "tech_press": "Independent technology press",
    "business_press": "Business and financial press",
    "industry_trade": "Industry and trade press",
    "public_sector": "Regulatory and public-sector sources",
    "india_regional": "India and regional sources",
}
REGIONS = {
    "global": "Global",
    "local": "India / Local",
    "balanced": "Balanced",
}

ALLOWED_EVENTS = {
    "qualified_impression",
    "dossier_open",
    "dossier_dwell",
    "source_open",
    "save",
    "unsave",
    "select",
    "approve",
    "interested",
    "not_interested",
    "less_like_this",
    "hide",
    "why_this_story_open",
    "interest_edit",
    "feed_refresh",
}
MEANINGFUL_EVENTS = ALLOWED_EVENTS - {"qualified_impression", "feed_refresh"}


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def empty_state() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "preferences": {
            "topics": [],
            "outcomes": [],
            "source_families": [],
            "regions": ["balanced"],
            "surprise_me": True,
            "completed_at": "",
        },
        "events": [],
        "served": {},
        "feed_snapshots": {},
        "last_visit_at": "",
        "personalization_paused": False,
        "migration": {},
    }


def taxonomy() -> dict[str, list[dict[str, str]]]:
    def options(values: dict[str, str]) -> list[dict[str, str]]:
        return [{"id": key, "label": label} for key, label in values.items()]
    return {
        "topics": options(TOPICS),
        "outcomes": options(OUTCOMES),
        "source_families": options(SOURCE_FAMILIES),
        "regions": options(REGIONS),
    }


def sanitize_preferences(payload: dict[str, Any]) -> dict[str, Any]:
    def keep(values: Any, allowed: dict[str, str]) -> list[str]:
        if not isinstance(values, list):
            return []
        return list(dict.fromkeys(str(value) for value in values if str(value) in allowed))
    regions = keep(payload.get("regions"), REGIONS) or ["balanced"]
    return {
        "topics": keep(payload.get("topics"), TOPICS),
        "outcomes": keep(payload.get("outcomes"), OUTCOMES),
        "source_families": keep(payload.get("source_families"), SOURCE_FAMILIES),
        "regions": regions,
        "surprise_me": bool(payload.get("surprise_me", True)),
    }


class ViewerRepository:
    def __init__(self, root: Path, *, window_days: int = 30, max_events: int = 1200):
        self.root = Path(root)
        self.window_days = max(1, int(window_days))
        self.max_events = max(100, int(max_events))
        self._stores: dict[str, JsonStore] = {}
        self._stores_lock = threading.RLock()

    def _store(self, viewer_key: str) -> JsonStore:
        safe_key = "".join(char for char in str(viewer_key) if char.isalnum())[:128]
        with self._stores_lock:
            if safe_key not in self._stores:
                self._stores[safe_key] = JsonStore(
                    self.root / f"{safe_key}.json",
                    empty_state,
                )
            return self._stores[safe_key]

    def read(self, viewer_key: str) -> dict[str, Any]:
        state = self._store(viewer_key).read()
        baseline = empty_state()
        if not isinstance(state, dict):
            return baseline
        baseline.update(state)
        baseline["preferences"] = {**empty_state()["preferences"], **(state.get("preferences") or {})}
        return baseline

    def update_preferences(self, viewer_key: str, payload: dict[str, Any], *, complete: bool | None = None) -> dict[str, Any]:
        cleaned = sanitize_preferences(payload)
        now = utcnow().isoformat(timespec="seconds")
        def updater(state: dict[str, Any]) -> dict[str, Any]:
            current = {**empty_state(), **(state if isinstance(state, dict) else {})}
            previous = current.get("preferences") if isinstance(current.get("preferences"), dict) else {}
            current["preferences"] = {**previous, **cleaned, "updated_at": now}
            if complete is True:
                current["preferences"]["completed_at"] = now
            elif complete is False:
                current["preferences"]["completed_at"] = ""
            return current
        return self._store(viewer_key).update(updater)

    def pause(self, viewer_key: str, paused: bool) -> dict[str, Any]:
        def updater(state: dict[str, Any]) -> dict[str, Any]:
            state = {**empty_state(), **(state if isinstance(state, dict) else {})}
            state["personalization_paused"] = bool(paused)
            state["updated_at"] = utcnow().isoformat(timespec="seconds")
            return state
        return self._store(viewer_key).update(updater)

    def confirm_migration(self, viewer_key: str, legacy_key: str) -> dict[str, Any]:
        now = utcnow().isoformat(timespec="seconds")
        def updater(state: dict[str, Any]) -> dict[str, Any]:
            state = {**empty_state(), **(state if isinstance(state, dict) else {})}
            state["migration"] = {
                "migrated_from_legacy_key": str(legacy_key),
                "confirmed_at": now,
                "legacy_source_preserved": True,
            }
            return state
        return self._store(viewer_key).update(updater)

    def reset(self, viewer_key: str) -> int:
        previous = self.read(viewer_key)
        count = len(previous.get("events") or [])
        self._store(viewer_key).write(empty_state())
        return count

    def append_events(
        self,
        viewer_key: str,
        events: list[dict[str, Any]],
        *,
        authorized_article_ids: set[str] | None = None,
    ) -> tuple[int, int, int]:
        accepted = 0
        duplicates = 0
        rejected = 0
        cutoff = utcnow() - dt.timedelta(days=self.window_days)
        def updater(state: dict[str, Any]) -> dict[str, Any]:
            nonlocal accepted, duplicates, rejected
            state = {**empty_state(), **(state if isinstance(state, dict) else {})}
            existing = state.get("events") if isinstance(state.get("events"), list) else []
            retained = []
            ids = set()
            qualified_impressions = set()
            for event in existing:
                try:
                    occurred = dt.datetime.fromisoformat(str(event.get("occurred_at") or "").replace("Z", "+00:00"))
                    if occurred.tzinfo is None:
                        occurred = occurred.replace(tzinfo=dt.timezone.utc)
                except (TypeError, ValueError):
                    continue
                if occurred >= cutoff:
                    retained.append(event)
                    ids.add(str(event.get("event_id") or ""))
                    if event.get("action") == "qualified_impression":
                        qualified_impressions.add((
                            str(event.get("feed_request_id") or ""),
                            str(event.get("article_id") or ""),
                        ))
            for event in events:
                event_id = str(event.get("event_id") or "")
                action = str(event.get("action") or "")
                if not event_id or action not in ALLOWED_EVENTS:
                    rejected += 1
                    continue
                if event_id in ids:
                    duplicates += 1
                    continue
                impression_key = (
                    str(event.get("feed_request_id") or ""),
                    str(event.get("article_id") or ""),
                )
                if action == "qualified_impression" and impression_key in qualified_impressions:
                    duplicates += 1
                    continue
                article_id = str(event.get("article_id") or "")
                authorized = authorized_article_ids or set()
                if action not in {"interest_edit", "feed_refresh"} and (
                    not article_id
                    or (
                        article_id not in (state.get("served") or {})
                        and article_id not in authorized
                    )
                ):
                    rejected += 1
                    continue
                normalized = dict(event)
                normalized["occurred_at"] = str(event.get("occurred_at") or utcnow().isoformat(timespec="seconds"))
                normalized.pop("viewer_id", None)
                retained.append(normalized)
                ids.add(event_id)
                if action == "qualified_impression":
                    qualified_impressions.add(impression_key)
                accepted += 1
            state["events"] = retained[-self.max_events:]
            state["updated_at"] = utcnow().isoformat(timespec="seconds")
            return state
        self._store(viewer_key).update(updater)
        return accepted, duplicates, rejected

    def mark_seen_external(
        self,
        viewer_key: str,
        article_ids: list[str],
        *,
        surface: str = "shared_briefing",
    ) -> None:
        """Remember a validated non-For-You view without changing visit time."""

        now = utcnow().isoformat(timespec="seconds")

        def updater(state: dict[str, Any]) -> dict[str, Any]:
            state = {**empty_state(), **(state if isinstance(state, dict) else {})}
            served = state.get("served") if isinstance(state.get("served"), dict) else {}
            for article_id in article_ids:
                if article_id:
                    served[str(article_id)] = {
                        "at": now,
                        "feed_request_id": "",
                        "surface": str(surface or "shared_briefing"),
                    }
            state["served"] = dict(list(served.items())[-2000:])
            return state

        self._store(viewer_key).update(updater)

    def mark_served(self, viewer_key: str, article_ids: list[str], feed_request_id: str) -> None:
        now = utcnow().isoformat(timespec="seconds")
        def updater(state: dict[str, Any]) -> dict[str, Any]:
            state = {**empty_state(), **(state if isinstance(state, dict) else {})}
            served = state.get("served") if isinstance(state.get("served"), dict) else {}
            for article_id in article_ids:
                if article_id:
                    served[str(article_id)] = {"at": now, "feed_request_id": feed_request_id}
            state["served"] = dict(list(served.items())[-2000:])
            previous_visit = state.get("last_visit_at") or ""
            state["previous_visit_at"] = previous_visit
            state["last_visit_at"] = now
            return state
        self._store(viewer_key).update(updater)

    def save_feed_snapshot(
        self,
        viewer_key: str,
        snapshot_id: str,
        article_ids: list[str],
        *,
        previous_visit_at: str = "",
        max_snapshots: int = 8,
        ttl_minutes: int = 1440,
    ) -> dict[str, Any]:
        """Persist a compact ranking order for stable load-more pagination.

        Only server-derived article identifiers and timestamps are stored. The
        article payload remains in the shared briefing, keeping the per-viewer
        JSON small and portable across application restarts.
        """

        now = utcnow()
        created_at = now.isoformat(timespec="seconds")
        cutoff = now - dt.timedelta(minutes=max(1, int(ttl_minutes)))
        normalized_ids = list(dict.fromkeys(
            str(article_id).strip()
            for article_id in article_ids
            if str(article_id).strip()
        ))

        def updater(state: dict[str, Any]) -> dict[str, Any]:
            state = {**empty_state(), **(state if isinstance(state, dict) else {})}
            stored = state.get("feed_snapshots") if isinstance(state.get("feed_snapshots"), dict) else {}
            retained: dict[str, dict[str, Any]] = {}
            for key, value in stored.items():
                if not isinstance(value, dict):
                    continue
                try:
                    created = dt.datetime.fromisoformat(str(value.get("created_at") or "").replace("Z", "+00:00"))
                    if created.tzinfo is None:
                        created = created.replace(tzinfo=dt.timezone.utc)
                except (TypeError, ValueError):
                    continue
                if created >= cutoff:
                    retained[str(key)] = value
            retained[str(snapshot_id)] = {
                "created_at": created_at,
                "article_ids": normalized_ids,
                "previous_visit_at": str(previous_visit_at or ""),
            }
            state["feed_snapshots"] = dict(list(retained.items())[-max(1, int(max_snapshots)):])
            return state

        updated = self._store(viewer_key).update(updater)
        return dict((updated.get("feed_snapshots") or {}).get(str(snapshot_id)) or {})

    def read_feed_snapshot(
        self,
        viewer_key: str,
        snapshot_id: str,
        *,
        ttl_minutes: int = 1440,
    ) -> dict[str, Any] | None:
        snapshot = (self.read(viewer_key).get("feed_snapshots") or {}).get(str(snapshot_id))
        if not isinstance(snapshot, dict):
            return None
        try:
            created = dt.datetime.fromisoformat(str(snapshot.get("created_at") or "").replace("Z", "+00:00"))
            if created.tzinfo is None:
                created = created.replace(tzinfo=dt.timezone.utc)
        except (TypeError, ValueError):
            return None
        if created < utcnow() - dt.timedelta(minutes=max(1, int(ttl_minutes))):
            return None
        ids = snapshot.get("article_ids")
        if not isinstance(ids, list):
            return None
        return {
            "created_at": created.isoformat(timespec="seconds"),
            "article_ids": [str(value) for value in ids if str(value)],
            "previous_visit_at": str(snapshot.get("previous_visit_at") or ""),
        }
