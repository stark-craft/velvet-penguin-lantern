from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, Iterable, List, Mapping, Optional

from signalroom.ml.gatekeeper import Gatekeeper
from signalroom.ml.summarizer import SummarizationService
from signalroom.services.classification import enrich_editorial_fields


def _published_sort_value(article: Mapping[str, Any]) -> str:
    return str(article.get("published_at") or article.get("date") or "")


def _source_code(source: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", source)
    if not words:
        return "?"
    if len(words) == 1:
        return words[0][:2].upper()
    return "".join(word[0] for word in words[:3]).upper()


def _entities(article: Mapping[str, Any], limit: int = 8) -> List[str]:
    supplied = article.get("entities")
    if isinstance(supplied, list):
        return list(dict.fromkeys(str(item).strip() for item in supplied if str(item).strip()))[
            :limit
        ]
    title = str(article.get("title") or "")
    candidates = re.findall(r"\b(?:[A-Z][A-Za-z0-9+.-]*)(?:\s+[A-Z][A-Za-z0-9+.-]*){0,2}\b", title)
    ignored = {"The", "A", "An", "New", "This", "That"}
    return [item for item in dict.fromkeys(candidates) if item not in ignored][:limit]


def combined_cluster_text(articles: Iterable[Mapping[str, Any]], max_characters: int = 18000) -> str:
    sections = []
    total = 0
    for article in sorted(articles, key=_published_sort_value, reverse=True):
        source = str(article.get("source") or "Unknown")
        title = str(article.get("title") or "").strip()
        body = str(
            article.get("body_text")
            or article.get("full_contents")
            or article.get("excerpt")
            or article.get("snippet")
            or ""
        ).strip()
        section = f"Source: {source}\nHeadline: {title}\n{body}".strip()
        remaining = max_characters - total
        if remaining <= 0:
            break
        sections.append(section[:remaining])
        total += min(len(section), remaining)
    return "\n\n".join(sections)


def build_cluster_signal(
    cluster: Mapping[str, Any],
    *,
    profile: str,
    summarizer: SummarizationService,
    gatekeeper: Gatekeeper,
) -> Dict[str, Any]:
    articles = [dict(item) for item in cluster.get("articles") or []]
    representative = dict(cluster.get("representative") or (articles[0] if articles else {}))
    summary_result = summarizer.summarize(combined_cluster_text(articles))
    representative["summary"] = summary_result["summary"]
    representative["master_summary"] = summary_result["summary"]
    source_count = int(cluster.get("source_count") or len(articles) or 1)
    representative = enrich_editorial_fields(representative, source_count=source_count)
    decision = gatekeeper.decide(representative, profile=profile, stage="final")

    sources = []
    for member in sorted(
        articles,
        key=lambda item: (float(item.get("cluster_similarity") or 0), _published_sort_value(item)),
        reverse=True,
    ):
        source = str(member.get("source") or "Unknown")
        sources.append(
            {
                "article_id": member.get("id"),
                "source": source,
                "code": _source_code(source),
                "headline": member.get("title") or "Untitled signal",
                "published_at": member.get("published_at") or "",
                "summary": member.get("excerpt") or member.get("summary") or "",
                "similarity": round(float(member.get("cluster_similarity") or 0) * 100, 1),
                "url": member.get("canonical_url") or "",
            }
        )

    score = representative["importance_score"]
    status = "Rejected" if decision["decision"] == "drop" else "New"
    signal = representative.get("intent") or "market movement"
    if signal == "market movement":
        signal = "mixed"
    return {
        "id": cluster.get("cluster_id"),
        "profile": profile,
        "title": representative.get("title") or "Untitled signal",
        "summary": summary_result["summary"],
        "insight": representative.get("insight"),
        "representative_article_id": representative.get("id"),
        "source": representative.get("source") or "Unknown",
        "source_code": _source_code(str(representative.get("source") or "Unknown")),
        "author": representative.get("author") or "",
        "published_at": representative.get("published_at") or "",
        "image_url": representative.get("image_url") or "",
        "category": representative.get("category"),
        "team": representative.get("team"),
        "region": representative.get("region"),
        "keywords": representative.get("keywords") or [],
        "entities": _entities(representative),
        "technologies": [],
        "priority": representative.get("priority"),
        "relevance": score,
        "confidence": round(
            max(
                [float(item.get("cluster_similarity") or 0) for item in articles] or [0.5]
            )
            * 100
        ),
        "signal": signal,
        "status": status,
        "retained": bool(decision["keep"]),
        "source_count": source_count,
        "sources": sources,
        "gatekeeper": decision,
        "summary_metadata": summary_result["metadata"],
        "cluster_metadata": {
            "algorithm": "transitive_cosine_single_linkage",
            "threshold": cluster.get("threshold"),
            "size": len(articles),
        },
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
