"""Hugging Face Hub discovery provider using the public HTTP API."""

from __future__ import annotations

import os
import re

import requests


HUGGINGFACE_API_ROOT = "https://huggingface.co/api"


def _clean(value: object, limit: int = 800) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _headers() -> dict[str, str]:
    headers = {"User-Agent": "Sense-AI-Venture-Lens/1.0"}
    token = os.environ.get("HUGGINGFACE_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _fetch(kind: str, limit: int) -> list[dict]:
    response = requests.get(
        f"{HUGGINGFACE_API_ROOT}/{kind}",
        params={
            "sort": "trendingScore",
            "direction": "-1",
            "limit": max(1, min(int(limit or 24), 50)),
            "full": "true",
        },
        headers=_headers(),
        timeout=30,
    )
    response.raise_for_status()
    return list(response.json() or [])


def _normalize(raw: dict, kind: str) -> dict:
    identifier = _clean(raw.get("id") or raw.get("modelId"), 240)
    tags = [_clean(tag, 80) for tag in (raw.get("tags") or []) if _clean(tag, 80)]
    card = raw.get("cardData") if isinstance(raw.get("cardData"), dict) else {}
    summary = _clean(
        card.get("description")
        or raw.get("description")
        or f"{kind.title()} repository on the Hugging Face Hub.",
        900,
    )
    return {
        "id": identifier,
        "title": identifier or f"Untitled {kind}",
        "summary": summary,
        "url": f"https://huggingface.co/{'datasets/' if kind == 'dataset' else ''}{identifier}",
        "source": "Hugging Face Hub",
        "published_at": _clean(raw.get("createdAt"), 40),
        "updated_at": _clean(raw.get("lastModified"), 40),
        "category": _clean(raw.get("pipeline_tag") or next(iter(tags), "AI"), 120),
        "downloads": int(raw.get("downloads") or 0),
        "likes": int(raw.get("likes") or 0),
        "tags": tags[:10],
        "author": identifier.split("/", 1)[0] if "/" in identifier else "",
        "starter_snapshot": False,
    }


def fetch_models(limit: int = 24) -> list[dict]:
    return [item for item in (_normalize(raw, "model") for raw in _fetch("models", limit)) if item["id"]]


def fetch_datasets(limit: int = 24) -> list[dict]:
    return [item for item in (_normalize(raw, "dataset") for raw in _fetch("datasets", limit)) if item["id"]]
