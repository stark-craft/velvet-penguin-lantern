"""Build private, semantically coherent story threads from followed anchors."""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

from .candidates import article_id, collect_candidates
from .scoring import article_topics
from .semantic import semantic_similarity


def _text(item: dict[str, Any]) -> str:
    raw_keywords = item.get("keywords_found") or item.get("keywords") or []
    if isinstance(raw_keywords, str):
        raw_keywords = [raw_keywords]
    elif not isinstance(raw_keywords, (list, tuple, set)):
        raw_keywords = []
    return " ".join(str(value or "") for value in (
        item.get("title"), item.get("summary_lead"), item.get("summary"),
        item.get("why_it_matters"), " ".join(str(value) for value in raw_keywords),
    ))[:5000]


def _tokens(item: dict[str, Any]) -> set[str]:
    return {
        token for token in re.findall(r"[a-z0-9]{3,}", _text(item).casefold())
        if token not in {"the", "and", "for", "with", "from", "this", "that", "will", "news"}
    }


def _date(item: dict[str, Any]) -> dt.datetime | None:
    for key in ("date", "published_at", "published", "saved_at"):
        try:
            value = dt.datetime.fromisoformat(str(item.get(key) or "").replace("Z", "+00:00"))
            return value.replace(tzinfo=value.tzinfo or dt.timezone.utc)
        except (TypeError, ValueError):
            continue
    return None


def build_following_threads(
    saved_items: list[dict[str, Any]],
    articles: list[dict[str, Any]],
    *,
    max_threads: int = 20,
    updates_per_thread: int = 4,
) -> list[dict[str, Any]]:
    candidates = collect_candidates(articles, entitled_audiences={"all", "technology", "default", "broadcast"})
    now = dt.datetime.now(dt.timezone.utc)
    threads = []
    seen_anchors: set[str] = set()
    for anchor in saved_items:
        anchor_id = article_id(anchor)
        if not anchor_id or anchor_id in seen_anchors:
            continue
        seen_anchors.add(anchor_id)
        anchor_saved = _date(anchor)
        anchor_topics = set(article_topics(anchor)) - {"general"}
        anchor_tokens = _tokens(anchor)
        matches = []
        for item in candidates:
            if article_id(item) == anchor_id:
                continue
            published = _date(item)
            if published and (now - published).days > 30:
                continue
            if anchor_saved and published and published < anchor_saved - dt.timedelta(days=1):
                continue
            semantic = semantic_similarity(_text(anchor), _text(item))
            topic_overlap = len(anchor_topics & (set(article_topics(item)) - {"general"}))
            tokens = _tokens(item)
            lexical = len(anchor_tokens & tokens) / max(1, len(anchor_tokens | tokens))
            # MiniLM is authoritative when available. Topic/entity overlap is a
            # conservative fallback, never a broad single-keyword match.
            if semantic > 0:
                if semantic < 0.48 and not (semantic >= 0.38 and topic_overlap >= 1 and lexical >= 0.08):
                    continue
                score = semantic * 0.78 + min(1, topic_overlap) * 0.14 + min(0.08, lexical)
                method = "semantic"
            else:
                if topic_overlap < 1 or lexical < 0.16:
                    continue
                score = min(1.0, lexical * 1.9 + min(0.25, topic_overlap * 0.12))
                method = "topic_entity_fallback"
            enriched = dict(item)
            enriched["follow_match"] = {"score": round(score, 4), "method": method}
            matches.append(enriched)
        matches.sort(
            key=lambda value: (
                float((value.get("follow_match") or {}).get("score") or 0),
                _date(value) or dt.datetime.min.replace(tzinfo=dt.timezone.utc),
            ),
            reverse=True,
        )
        threads.append({
            "id": anchor_id,
            "anchor": dict(anchor),
            "updates": matches[:updates_per_thread],
            "update_count": len(matches),
        })
        if len(threads) >= max_threads:
            break
    return threads
