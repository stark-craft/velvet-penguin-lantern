"""OpenAlex scholarly-work provider.

OpenAlex is deliberately queried independently from arXiv.  The discovery
service later deduplicates and enriches papers by DOI, arXiv id, or normalized
title, so a temporary OpenAlex failure cannot erase the healthy arXiv cache.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

import requests


OPENALEX_WORKS_URL = "https://api.openalex.org/works"


def _clean(value: object, limit: int = 1200) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _abstract(index: object) -> str:
    if not isinstance(index, dict):
        return ""
    positioned: list[tuple[int, str]] = []
    for word, positions in index.items():
        for position in positions or []:
            if isinstance(position, int):
                positioned.append((position, str(word)))
    return _clean(" ".join(word for _position, word in sorted(positioned)), 1800)


def fetch_openalex_works(limit: int = 36) -> list[dict]:
    """Return recent, cited AI works in a bounded provider-native shape."""

    after = (datetime.now(timezone.utc) - timedelta(days=540)).date().isoformat()
    params = {
        "search": "artificial intelligence machine learning",
        "filter": f"from_publication_date:{after}",
        "sort": "cited_by_count:desc",
        "per-page": max(1, min(int(limit or 36), 50)),
    }
    api_key = os.environ.get("OPENALEX_API_KEY", "").strip()
    if api_key:
        params["api_key"] = api_key
    response = requests.get(
        OPENALEX_WORKS_URL,
        params=params,
        headers={"User-Agent": "Sense-AI-Venture-Lens/1.0"},
        timeout=30,
    )
    response.raise_for_status()

    works: list[dict] = []
    for raw in response.json().get("results") or []:
        ids = raw.get("ids") or {}
        authorships = raw.get("authorships") or []
        authors = [
            _clean((entry.get("author") or {}).get("display_name"), 120)
            for entry in authorships[:8]
        ]
        institutions = []
        for entry in authorships[:8]:
            for institution in entry.get("institutions") or []:
                label = _clean(institution.get("display_name"), 160)
                if label and label not in institutions:
                    institutions.append(label)
        topic = raw.get("primary_topic") or {}
        source = ((raw.get("primary_location") or {}).get("source") or {})
        work_id = _clean(raw.get("id"), 240).rsplit("/", 1)[-1]
        if not work_id or not _clean(raw.get("title"), 400):
            continue
        works.append({
            "id": work_id,
            "title": _clean(raw.get("title"), 400),
            "summary": _abstract(raw.get("abstract_inverted_index")),
            "url": _clean((raw.get("primary_location") or {}).get("landing_page_url") or raw.get("doi") or raw.get("id"), 700),
            "doi": _clean(raw.get("doi"), 240).lower(),
            "arxiv_id": _clean(ids.get("arxiv"), 160).rsplit("/", 1)[-1],
            "authors": [author for author in authors if author],
            "institutions": institutions[:8],
            "published_at": _clean(raw.get("publication_date"), 20),
            "updated_at": _clean(raw.get("updated_date"), 40),
            "category": _clean(topic.get("display_name") or "Artificial intelligence", 120),
            "topic_id": _clean(topic.get("id"), 180),
            "citations": int(raw.get("cited_by_count") or 0),
            "open_access": bool((raw.get("open_access") or {}).get("is_oa")),
            "venue": _clean(source.get("display_name"), 180),
            "starter_snapshot": False,
        })
    return works
