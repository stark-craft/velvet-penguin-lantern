"""GitHub public search provider with optional authenticated rate limits."""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

import requests


GITHUB_SEARCH_URL = "https://api.github.com/search/repositories"


def _clean(value: object, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def fetch_repositories(query: str, category: str, limit: int = 10) -> list[dict]:
    since = (datetime.now(timezone.utc) - timedelta(days=365 * 2)).date().isoformat()
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Sense-AI-Venture-Lens",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    requested = max(1, min(limit, 10))

    def search(search_query: str) -> list[dict]:
        response = requests.get(
            GITHUB_SEARCH_URL,
            params={
                "q": search_query,
                "sort": "stars",
                "order": "desc",
                "per_page": requested,
            },
            headers=headers,
            timeout=15,
        )
        response.raise_for_status()
        return list(response.json().get("items", []))

    raw_items = search(f"{query} pushed:>={since}")
    if len(raw_items) < requested:
        older_items = search(query)
        known = {str(item.get("full_name") or item.get("id")) for item in raw_items}
        raw_items.extend(
            item
            for item in older_items
            if str(item.get("full_name") or item.get("id")) not in known
        )

    repositories = []
    for item in raw_items[:requested]:
        repositories.append(
            {
                "id": str(item.get("full_name") or item.get("id")),
                "name": _clean(item.get("name"), 100) or "Untitled repository",
                "full_name": _clean(
                    item.get("full_name") or item.get("name"), 180
                ),
                "description": _clean(
                    item.get("description") or "No description provided.", 420
                ),
                "url": item.get("html_url") or "",
                "owner": _clean(
                    (item.get("owner") or {}).get("login") or "Unknown", 100
                ),
                "owner_avatar": (item.get("owner") or {}).get("avatar_url") or "",
                "language": _clean(item.get("language") or "Mixed", 50),
                "stars": int(item.get("stargazers_count") or 0),
                "forks": int(item.get("forks_count") or 0),
                "open_issues": int(item.get("open_issues_count") or 0),
                "topics": [
                    _clean(topic, 50)
                    for topic in list(item.get("topics") or [])[:6]
                    if _clean(topic, 50)
                ],
                "category": category,
                "updated_at": item.get("updated_at") or "",
                "starter_snapshot": False,
            }
        )
    return repositories
