"""Persistent reactions and consensus gates for the For You surface.

Viewer reactions are cheap, reversible product signals.  They are stored as an
upsert per viewer/article so a browser cannot inflate a count by clicking more
than once.  Shared Bouncer training is deliberately separate: only a stable,
multi-viewer consensus is emitted by the four-hour batch processor.
"""

from __future__ import annotations

import datetime as dt
import hashlib
from pathlib import Path
from typing import Any

from core.storage import JsonStore


REACTIONS = {"like", "dislike"}


def _empty() -> dict[str, Any]:
    return {"schema_version": 1, "articles": {}}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _safe_article(item: dict[str, Any]) -> dict[str, Any]:
    raw_keywords = item.get("keywords_found") or item.get("keywords") or []
    if isinstance(raw_keywords, str):
        raw_keywords = [raw_keywords]
    if not isinstance(raw_keywords, (list, tuple, set)):
        raw_keywords = []
    return {
        "article_id": str(item.get("article_id") or "")[:128],
        "title": str(item.get("title") or "")[:500],
        "summary": str(
            item.get("master_summary")
            or item.get("summary_lead")
            or item.get("summary")
            or item.get("title")
            or ""
        )[:12000],
        "keywords": [
            str(value)[:160]
            for value in raw_keywords
            if str(value).strip()
        ][:80],
        "source": str(item.get("source") or item.get("src") or "")[:300],
        "link": str(item.get("canonical_link") or item.get("link") or item.get("url") or "")[:2000],
    }


class ReactionRepository:
    def __init__(self, path: Path):
        self.store = JsonStore(path, _empty)

    def set(self, viewer_key: str, article: dict[str, Any], reaction: str) -> dict[str, Any]:
        normalized = str(reaction or "").strip().lower()
        if normalized not in REACTIONS | {"neutral"}:
            raise ValueError("Reaction must be like, dislike, or neutral.")
        identifier = str(article.get("article_id") or "").strip()
        if not identifier:
            raise ValueError("A stable article id is required.")
        result: dict[str, Any] = {}

        def updater(payload: dict[str, Any]) -> dict[str, Any]:
            nonlocal result
            state = payload if isinstance(payload, dict) else _empty()
            articles = state.setdefault("articles", {})
            entry = articles.setdefault(identifier, {"article": _safe_article(article), "votes": {}})
            entry["article"] = _safe_article(article)
            votes = entry.setdefault("votes", {})
            previous = str((votes.get(viewer_key) or {}).get("reaction") or "neutral")
            if normalized == "neutral":
                votes.pop(viewer_key, None)
            else:
                votes[viewer_key] = {"reaction": normalized, "updated_at": _now()}
            entry["updated_at"] = _now()
            result = self._snapshot(entry, viewer_key)
            result["changed"] = previous != normalized
            return state

        self.store.update(updater)
        return result

    @staticmethod
    def _snapshot(entry: dict[str, Any], viewer_key: str) -> dict[str, Any]:
        votes = entry.get("votes") if isinstance(entry.get("votes"), dict) else {}
        like_count = sum((value or {}).get("reaction") == "like" for value in votes.values())
        dislike_count = sum((value or {}).get("reaction") == "dislike" for value in votes.values())
        return {
            "like_count": like_count,
            "dislike_count": dislike_count,
            "viewer_reaction": str((votes.get(viewer_key) or {}).get("reaction") or "neutral"),
        }

    def snapshots(self, viewer_key: str, article_ids: list[str]) -> dict[str, dict[str, Any]]:
        state = self.store.read()
        articles = state.get("articles") if isinstance(state, dict) else {}
        articles = articles if isinstance(articles, dict) else {}
        return {
            identifier: self._snapshot(articles.get(identifier) or {}, viewer_key)
            for identifier in article_ids
            if identifier
        }

    def consensus_candidates(self, minimum_votes: int, ratio: float) -> list[dict[str, Any]]:
        state = self.store.read()
        articles = state.get("articles") if isinstance(state, dict) else {}
        candidates: list[dict[str, Any]] = []
        for identifier, entry in (articles.items() if isinstance(articles, dict) else []):
            votes = entry.get("votes") if isinstance(entry, dict) else {}
            votes = votes if isinstance(votes, dict) else {}
            likes = sum((value or {}).get("reaction") == "like" for value in votes.values())
            dislikes = sum((value or {}).get("reaction") == "dislike" for value in votes.values())
            total = likes + dislikes
            if total < minimum_votes:
                continue
            winning = max(likes, dislikes)
            if not total or winning / total < ratio:
                continue
            fingerprint = hashlib.sha256(
                "|".join(
                    f"{key}:{(value or {}).get('reaction', '')}"
                    for key, value in sorted(votes.items())
                ).encode("utf-8")
            ).hexdigest()
            if str(entry.get("processed_consensus") or "") == fingerprint:
                continue
            candidates.append({
                "article_id": identifier,
                "article": dict(entry.get("article") or {}),
                "label": "interested" if likes > dislikes else "not_interested",
                "likes": likes,
                "dislikes": dislikes,
                "total": total,
                "ratio": round(winning / total, 4),
                "fingerprint": fingerprint,
            })
        return candidates

    def mark_processed(self, article_id: str, fingerprint: str) -> None:
        def updater(payload: dict[str, Any]) -> dict[str, Any]:
            state = payload if isinstance(payload, dict) else _empty()
            entry = (state.get("articles") or {}).get(article_id)
            if isinstance(entry, dict):
                entry["processed_consensus"] = fingerprint
                entry["processed_at"] = _now()
            return state
        self.store.update(updater)
