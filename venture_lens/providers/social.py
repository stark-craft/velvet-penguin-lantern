"""Optional X recent-search momentum provider."""

from __future__ import annotations

import os
import re

import requests


X_RECENT_SEARCH_URL = "https://api.x.com/2/tweets/search/recent"


def configured() -> bool:
    return bool(os.environ.get("X_BEARER_TOKEN", "").strip())


def _clean(value: object, limit: int = 700) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def fetch_social_signals(limit: int = 20) -> list[dict]:
    token = os.environ.get("X_BEARER_TOKEN", "").strip()
    if not token:
        return []
    response = requests.get(
        X_RECENT_SEARCH_URL,
        params={
            "query": '(AI OR "machine learning" OR "open source model") -is:retweet lang:en',
            "max_results": max(10, min(int(limit or 20), 100)),
            "tweet.fields": "created_at,public_metrics,author_id",
        },
        headers={"Authorization": f"Bearer {token}", "User-Agent": "Sense-AI-Venture-Lens/1.0"},
        timeout=25,
    )
    response.raise_for_status()
    signals: list[dict] = []
    for raw in response.json().get("data") or []:
        identifier = _clean(raw.get("id"), 80)
        metrics = raw.get("public_metrics") or {}
        if not identifier:
            continue
        signals.append({
            "id": identifier,
            "title": _clean(raw.get("text"), 220),
            "summary": _clean(raw.get("text"), 700),
            "url": f"https://x.com/i/web/status/{identifier}",
            "source": "X public conversation",
            "published_at": _clean(raw.get("created_at"), 40),
            "updated_at": _clean(raw.get("created_at"), 40),
            "category": "AI conversation",
            "engagement": sum(int(metrics.get(key) or 0) for key in ("like_count", "repost_count", "reply_count", "quote_count")),
            "starter_snapshot": False,
        })
    return signals
