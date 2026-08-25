"""Build Samsung Internal channels from the unified briefing archive.

This module is intentionally independent from FastAPI and the scheduler.  The
scheduler continues to produce one authoritative briefing stream; this reader
only projects that retained stream into Samsung Global, Samsung Local, and
Sampark channels for the Samsung Internal destination.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Iterable


SAMSUNG_LOCAL_SOURCE = re.compile(r"\bsamsung[\s_-]+(?:local|india)\b", re.I)
SAMPARK_SOURCE = re.compile(r"\bsampark\b", re.I)
SAMSUNG_OUTLET = re.compile(
    r"sammobile|samsung\s+newsroom|samsung\.com|samsungmobilepress|sammyfans",
    re.I,
)
SAMSUNG_TOPIC = re.compile(
    r"\b(?:samsung|galaxy|smartthings|exynos|bixby|one\s+ui|samsung\s+knox|"
    r"samsung\s+display|samsung\s+electronics|samsung\s+semiconductor|"
    r"samsung\s+foundry|samsung\s+sdi|harman)\b",
    re.I,
)
NON_ARTICLE_TITLE = re.compile(
    r"^(?:see\s+all(?:\s+the)?\s+latest|latest|home|news|technology|articles)$",
    re.I,
)


def _text(value) -> str:
    return str(value or "").strip()


def source_names(article: dict) -> list[str]:
    """Return every useful source label without changing the stored record."""

    names: list[str] = []
    for key in ("source", "src", "publisher", "site_name", "source_name"):
        value = _text(article.get(key))
        if value:
            names.append(value)
    for source in article.get("sources") or article.get("source_list") or []:
        if isinstance(source, dict):
            value = _text(
                source.get("name")
                or source.get("title")
                or source.get("source")
                or source.get("publisher")
            )
        else:
            value = _text(source)
        if value:
            names.append(value)
    return list(dict.fromkeys(names))


def is_samsung_local_source(article: dict) -> bool:
    return any(SAMSUNG_LOCAL_SOURCE.search(name) for name in source_names(article))


def is_sampark_source(article: dict) -> bool:
    return any(SAMPARK_SOURCE.search(name) for name in source_names(article))


def is_samsung_related(article: dict) -> bool:
    title = _text(article.get("title"))
    if not title or NON_ARTICLE_TITLE.fullmatch(title):
        return False
    if is_samsung_local_source(article):
        return True
    names = source_names(article)
    if any(SAMSUNG_OUTLET.search(name) for name in names):
        return True
    # Crawler keyword matches alone are not a sufficient relevance signal: a
    # generic TV article can mention "Samsung Smart TVs" once in a compatibility
    # list and therefore inherit the Samsung keyword.  Restrict Global to the
    # editorial-facing headline/summary fields or a dedicated Samsung outlet.
    haystack = " ".join(
        [
            title,
            _text(article.get("master_summary")),
            _text(article.get("summary")),
            _text(article.get("snippet")),
        ]
    )
    return bool(SAMSUNG_TOPIC.search(haystack))


def article_date(article: dict, fallback: dt.date | None = None) -> dt.date | None:
    for key in ("date", "published_at", "publishedAt", "first_seen", "generated_at"):
        value = _text(article.get(key))
        if not value:
            continue
        try:
            return dt.date.fromisoformat(value[:10])
        except ValueError:
            continue
    return fallback


def archive_date(path: str | os.PathLike[str]) -> dt.date | None:
    match = re.search(r"briefing_(\d{4}-\d{2}-\d{2})_", Path(path).name)
    if not match:
        return None
    try:
        return dt.date.fromisoformat(match.group(1))
    except ValueError:
        return None


def _article_identity(article: dict) -> str:
    link = _text(article.get("link") or article.get("url")).casefold().rstrip("/")
    if link:
        return f"url:{link}"
    title = re.sub(r"\s+", " ", _text(article.get("title")).casefold())
    return f"title:{title}"


def _keyword_count(article: dict) -> int:
    values = article.get("keywords_found") or article.get("keywords") or []
    if not isinstance(values, list):
        values = [values]
    return len({_text(value).casefold() for value in values if _text(value)})


def _rank_key(article: dict) -> tuple:
    dated = article_date(article)
    date_ordinal = dated.toordinal() if dated else 0
    return (
        int(article.get("source_count") or len(source_names(article)) or 1),
        _keyword_count(article),
        float(article.get("importance_score") or 0),
        bool(_text(article.get("image_url") or article.get("top_image"))),
        date_ordinal,
    )


def _read_archives(paths: Iterable[str | os.PathLike[str]]) -> tuple[list[dict], dict]:
    records: list[dict] = []
    dates: list[dt.date] = []
    files_scanned = 0
    for path in sorted(paths, key=lambda value: (archive_date(value) or dt.date.min), reverse=True):
        fallback = archive_date(path)
        try:
            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, ValueError, TypeError):
            continue
        if not isinstance(payload, list):
            continue
        files_scanned += 1
        if fallback:
            dates.append(fallback)
        for raw in payload:
            if not isinstance(raw, dict):
                continue
            record = dict(raw)
            dated = article_date(record, fallback)
            if dated:
                record["samsung_internal_date"] = dated.isoformat()
                dates.append(dated)
            records.append(record)
    return records, {
        "files_scanned": files_scanned,
        "oldest_date": min(dates).isoformat() if dates else None,
        "newest_date": max(dates).isoformat() if dates else None,
    }


def _rank_deduplicate(records: Iterable[dict], limit: int) -> list[dict]:
    best: dict[str, dict] = {}
    for record in records:
        identity = _article_identity(record)
        if identity in {"url:", "title:"}:
            continue
        existing = best.get(identity)
        if existing is None or _rank_key(record) > _rank_key(existing):
            best[identity] = record
    return sorted(best.values(), key=_rank_key, reverse=True)[:limit]


def build_samsung_internal_feed(
    archive_files: Iterable[str | os.PathLike[str]],
    *,
    limit: int = 100,
) -> dict:
    """Project all retained archives into explicit Samsung Internal channels.

    The retained archive already obeys the configured 30-day history policy,
    so the reader scans every available briefing.  This lets a thin news day
    reach back one or two weeks (or farther within retention) to fill the top
    100 without launching a second crawl or scheduler.
    """

    safe_limit = max(1, min(int(limit), 100))
    records, metadata = _read_archives(archive_files)
    global_records: list[dict] = []
    local_records: list[dict] = []
    sampark_records: list[dict] = []

    for record in records:
        if is_sampark_source(record):
            record["samsung_internal_channel"] = "sampark"
            sampark_records.append(record)
        elif is_samsung_local_source(record):
            record["samsung_internal_channel"] = "local"
            local_records.append(record)
        elif is_samsung_related(record):
            record["samsung_internal_channel"] = "global"
            global_records.append(record)

    global_ranked = _rank_deduplicate(global_records, safe_limit)
    local_ranked = _rank_deduplicate(local_records, safe_limit)
    sampark_ranked = _rank_deduplicate(sampark_records, safe_limit)
    return {
        "status": "success",
        "source": "unified_retained_briefings",
        "limit_per_channel": safe_limit,
        "global": global_ranked,
        "local": local_ranked,
        "sampark": sampark_ranked,
        "counts": {
            "global": len(global_ranked),
            "local": len(local_ranked),
            "sampark": len(sampark_ranked),
        },
        "archive": metadata,
    }
