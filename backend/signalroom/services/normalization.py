from __future__ import annotations

import hashlib
import html
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from dateutil import parser as date_parser


TRACKING_QUERY_KEYS = {
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "referrer",
    "source",
}


def clean_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def canonicalize_url(value: Any) -> str:
    raw = str(value or "").strip().replace("\\", "")
    if not raw:
        return ""
    try:
        parsed = urlparse(raw)
    except ValueError:
        return ""
    scheme = parsed.scheme.lower()
    host = (parsed.hostname or "").lower().rstrip(".")
    if scheme not in {"http", "https"} or not host:
        return ""
    port = parsed.port
    netloc = host
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        netloc = f"{host}:{port}"
    query = []
    for key, item in parse_qsl(parsed.query, keep_blank_values=True):
        lowered = key.lower()
        if lowered.startswith("utm_") or lowered in TRACKING_QUERY_KEYS:
            continue
        query.append((key, item))
    query.sort(key=lambda pair: (pair[0], pair[1]))
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if path != "/":
        path = path.rstrip("/")
    return urlunparse((scheme, netloc, path, "", urlencode(query, doseq=True), ""))


def parse_timestamp(value: Any) -> str:
    text = clean_text(value)
    if not text:
        return ""
    try:
        parsed = date_parser.parse(text)
    except (ValueError, TypeError, OverflowError):
        return ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def content_hash(title: str, body: str) -> str:
    normalized = clean_text(f"{title}\n{body}").casefold()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def stable_article_id(profile: str, canonical_url: str, title: str) -> str:
    # Canonical articles are global. Profile membership and editorial state live
    # in join/action tables, so one URL can safely appear in both desks.
    identity = canonical_url or clean_text(title).casefold()
    return f"article:{hashlib.sha256(identity.encode('utf-8')).hexdigest()}"


def normalize_article(item: Mapping[str, Any], profile: str, run_id: str) -> Dict[str, Any]:
    title = clean_text(item.get("title"))
    url = canonicalize_url(
        item.get("canonical_url")
        or item.get("canonical_link")
        or item.get("final_url")
        or item.get("link")
        or item.get("url")
    )
    body = clean_text(
        item.get("body_text")
        or item.get("full_contents")
        or item.get("content")
        or item.get("description")
        or item.get("snippet")
        or item.get("rss_snippet")
    )
    excerpt = clean_text(
        item.get("excerpt")
        or item.get("snippet")
        or item.get("rss_snippet")
        or item.get("description")
    )
    published_at = parse_timestamp(
        item.get("published_at") or item.get("published_at_utc") or item.get("date")
    )
    keywords = item.get("keywords_found") or item.get("keywords") or []
    if isinstance(keywords, str):
        keywords = [part.strip() for part in re.split(r"[,;]", keywords) if part.strip()]
    keywords = list(dict.fromkeys(clean_text(word) for word in keywords if clean_text(word)))
    source = clean_text(item.get("source") or item.get("site_name") or "Unknown") or "Unknown"
    image = canonicalize_url(item.get("lead_image_url") or item.get("top_image") or "")
    normalized = {
        "id": stable_article_id(profile, url, title),
        "profile": profile,
        "run_id": run_id,
        "source": source,
        "source_id": clean_text(item.get("source_id") or source.casefold().replace(" ", "-")),
        "title": title,
        "canonical_url": url,
        "requested_url": canonicalize_url(item.get("requested_url") or item.get("link") or url),
        "published_at": published_at,
        "discovered_at": parse_timestamp(item.get("discovered_at"))
        or datetime.now(timezone.utc).isoformat(),
        "author": clean_text(item.get("author") or item.get("authors")),
        "excerpt": excerpt[:1600],
        "body_text": body,
        "content_hash": clean_text(item.get("content_hash")) or content_hash(title, body),
        "image_url": image,
        "keywords": keywords,
        "discovery_method": clean_text(item.get("discovery_method") or item.get("method")),
        "date_source": clean_text(item.get("date_source")),
        "extraction_quality": clean_text(item.get("extraction_quality") or "unknown"),
        "metadata": {
            "schema_version": int(item.get("schema_version") or 1),
            "language": clean_text(item.get("language")),
            "source_category": clean_text(item.get("source_category")),
            "raw_date": clean_text(item.get("raw_date")),
            "redirect_chain": item.get("redirect_chain") or [],
            "crawler": clean_text(item.get("crawler") or item.get("discovered_by")),
        },
    }
    return normalized


def deduplicate_articles(items: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    by_identity: Dict[str, Dict[str, Any]] = {}
    for item in items:
        value = dict(item)
        key = value.get("canonical_url") or value.get("content_hash") or value.get("id")
        if not key:
            continue
        existing = by_identity.get(str(key))
        if existing is None:
            by_identity[str(key)] = value
            continue
        if len(str(value.get("body_text") or "")) > len(str(existing.get("body_text") or "")):
            primary, secondary = value, existing
        else:
            primary, secondary = existing, value
        primary["keywords"] = list(
            dict.fromkeys(list(primary.get("keywords") or []) + list(secondary.get("keywords") or []))
        )
        sources = list(primary.get("source_provenance") or [])
        for candidate in (primary, secondary):
            record = {
                "source": candidate.get("source"),
                "source_id": candidate.get("source_id"),
                "url": candidate.get("canonical_url"),
            }
            if record not in sources:
                sources.append(record)
        primary["source_provenance"] = sources
        by_identity[str(key)] = primary
    return list(by_identity.values())
