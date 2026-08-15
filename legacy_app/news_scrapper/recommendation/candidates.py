"""Eligibility filtering and stable candidate identity."""

from __future__ import annotations

import hashlib
from typing import Any, Iterable


def article_id(article: dict[str, Any]) -> str:
    identity = str(
        article.get("article_key")
        or article.get("canonical_link")
        or article.get("link")
        or article.get("url")
        or article.get("id")
        or article.get("title")
        or ""
    ).strip()
    return hashlib.sha256(identity.casefold().encode("utf-8")).hexdigest()[:24] if identity else ""


def cluster_id(article: dict[str, Any]) -> str:
    return str(article.get("cluster_id") or article_id(article)).strip()


def collect_candidates(
    articles: Iterable[dict[str, Any]],
    *,
    entitled_audiences: set[str] | None = None,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen_articles: set[str] = set()
    seen_clusters: set[str] = set()
    for raw in articles:
        if not isinstance(raw, dict) or not str(raw.get("title") or "").strip():
            continue
        article = dict(raw)
        key = article_id(article)
        cluster = cluster_id(article)
        if not key or key in seen_articles or cluster in seen_clusters:
            continue
        if article.get("removed") or article.get("globally_removed"):
            continue
        audiences = article.get("audiences") or article.get("audience") or ["all"]
        if isinstance(audiences, str):
            audiences = [audiences]
        normalized_audiences = {
            str(value).strip().casefold()
            for value in audiences
            if str(value).strip()
        }
        entitlements = {
            str(value).strip().casefold()
            for value in (entitled_audiences or {"all"})
        }
        if "all" not in normalized_audiences and not (
            normalized_audiences & entitlements
        ):
            continue
        seen_articles.add(key)
        seen_clusters.add(cluster)
        article["article_id"] = key
        article["cluster_id"] = cluster
        result.append(article)
    return result
