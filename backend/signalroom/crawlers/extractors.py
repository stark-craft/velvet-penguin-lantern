"""Deterministic feed, metadata, date, and article-body extraction helpers."""

from __future__ import annotations

import hashlib
import html
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple
from dateutil import parser as date_parser

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python 3.9 always supplies zoneinfo.
    ZoneInfo = None  # type: ignore[assignment]

from .policies import canonicalize_url, safe_metadata_url


XPATH_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
XPATH_LOWER = "abcdefghijklmnopqrstuvwxyz"

PUBLISHED_META_KEYS = (
    "article:published_time",
    "og:published_time",
    "datepublished",
    "datecreated",
    "date",
    "dc.date.issued",
    "dc.date",
    "dcterms.created",
    "dcterms.date",
    "pubdate",
    "publishdate",
    "publish-date",
    "published_time",
    "sailthru.date",
    "parsely-pub-date",
    "cxenseparse:recs:publishtime",
)

MODIFIED_META_KEYS = (
    "article:modified_time",
    "og:updated_time",
    "datemodified",
    "lastmod",
    "modified_time",
)

PUBLISHED_JSON_KEYS = ("datePublished", "dateCreated", "uploadDate")
MODIFIED_JSON_KEYS = ("dateModified",)

FEED_PUBLISHED_KEYS = ("pubdate", "published", "issued", "created", "date")
FEED_MODIFIED_KEYS = ("updated", "moddate", "modified")

TIMEZONE_ABBREVIATIONS = {
    "UTC": 0,
    "GMT": 0,
    "EST": -5 * 3600,
    "EDT": -4 * 3600,
    "CST": -6 * 3600,
    "CDT": -5 * 3600,
    "MST": -7 * 3600,
    "MDT": -6 * 3600,
    "PST": -8 * 3600,
    "PDT": -7 * 3600,
    "IST": 5 * 3600 + 30 * 60,
}

BODY_SELECTORS = (
    "article [itemprop='articleBody'] p",
    "[itemprop='articleBody'] p",
    "article .article-body p",
    "article .article-content p",
    "article .story-body p",
    "main article p",
    "article p",
    "main p",
    "body p",
)

BOILERPLATE_PATTERNS = (
    re.compile(r"^(advertisement|sponsored content)$", re.IGNORECASE),
    re.compile(r"^(sign up|subscribe)\b", re.IGNORECASE),
    re.compile(r"\b(cookie policy|accept cookies)\b", re.IGNORECASE),
    re.compile(r"^all rights reserved\.?$", re.IGNORECASE),
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def clean_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _timezone(name: str):
    if ZoneInfo is None:
        if name.upper() == "UTC":
            return timezone.utc
        raise ValueError("Named timezones require zoneinfo")
    try:
        return ZoneInfo(name)
    except Exception as exc:
        raise ValueError(f"Unknown timezone: {name}") from exc


def parse_datetime(value: str, default_timezone: str = "UTC") -> Tuple[Optional[str], str]:
    """Parse a publisher timestamp and return UTC ISO-8601 plus its precision.

    The parser is deliberately non-fuzzy: unrelated page text must not become a
    publication date. Naive values are interpreted in the source's configured
    timezone, never in the crawler machine's timezone.
    """

    raw = clean_text(value)
    if not raw:
        return None, "missing"

    date_only = bool(
        re.fullmatch(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", raw)
        or re.fullmatch(r"[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}", raw)
        or re.fullmatch(r"\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}", raw)
    )
    try:
        parsed = date_parser.parse(
            raw,
            fuzzy=False,
            default=datetime(1900, 1, 1),
            tzinfos=TIMEZONE_ABBREVIATIONS,
        )
    except (OverflowError, TypeError, ValueError):
        return None, "invalid"

    if parsed.year == 1900:
        return None, "invalid"
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_timezone(default_timezone))
    parsed = parsed.astimezone(timezone.utc)
    precision = "date" if date_only else "datetime"
    return parsed.isoformat().replace("+00:00", "Z"), precision


def _child_text_ci(selector: Any, names: Sequence[str]) -> str:
    for name in names:
        lowered = name.lower()
        xpath = (
            "string(./*["
            f"translate(local-name(), '{XPATH_UPPER}', '{XPATH_LOWER}')='{lowered}'"
            "][1])"
        )
        value = selector.xpath(xpath).get()
        if clean_text(value):
            return str(value)
    return ""


def extract_feed_entries(response: Any) -> List[Any]:
    return response.xpath(
        "//*["
        f"translate(local-name(), '{XPATH_UPPER}', '{XPATH_LOWER}')='item'"
        " or "
        f"translate(local-name(), '{XPATH_UPPER}', '{XPATH_LOWER}')='entry'"
        "]"
    )


def extract_feed_link(entry: Any, base_url: str) -> str:
    links = entry.xpath(
        "./*["
        f"translate(local-name(), '{XPATH_UPPER}', '{XPATH_LOWER}')='link'"
        "]"
    )

    # Atom's rel=alternate is the article. rel=self commonly points back to the feed.
    for link in links:
        rel = clean_text(link.attrib.get("rel", "")).lower()
        href = clean_text(link.attrib.get("href", ""))
        if href and rel == "alternate":
            return canonicalize_url(href, base_url)
    for link in links:
        rel = clean_text(link.attrib.get("rel", "")).lower()
        href = clean_text(link.attrib.get("href", ""))
        if href and not rel:
            return canonicalize_url(href, base_url)
    for link in links:
        rel = clean_text(link.attrib.get("rel", "")).lower()
        href = clean_text(link.attrib.get("href", ""))
        if href and rel != "self":
            return canonicalize_url(href, base_url)

    text_link = _child_text_ci(entry, ("link",))
    if text_link:
        return canonicalize_url(text_link, base_url)
    identity = _child_text_ci(entry, ("guid", "id"))
    return canonicalize_url(identity, base_url)


def extract_feed_title(entry: Any) -> str:
    return clean_text(_child_text_ci(entry, ("title",)))


def extract_feed_excerpt(entry: Any) -> str:
    value = _child_text_ci(entry, ("description", "summary", "content", "encoded", "subtitle"))
    return clean_text(value)[:1200]


def extract_feed_date(entry: Any, allow_modified: bool = False) -> Tuple[str, str, bool]:
    for key in FEED_PUBLISHED_KEYS:
        value = _child_text_ci(entry, (key,))
        if clean_text(value):
            return clean_text(value), f"feed_{key}", False
    if allow_modified:
        for key in FEED_MODIFIED_KEYS:
            value = _child_text_ci(entry, (key,))
            if clean_text(value):
                return clean_text(value), f"feed_{key}", True
    return "", "missing", False


def _meta_values(response: Any) -> Dict[str, List[str]]:
    output: Dict[str, List[str]] = {}
    for meta in response.xpath("//meta"):
        key = (
            meta.xpath("string(@property)").get()
            or meta.xpath("string(@name)").get()
            or meta.xpath("string(@itemprop)").get()
            or ""
        )
        key = clean_text(key).lower()
        content = clean_text(meta.xpath("string(@content)").get())
        if key and content:
            output.setdefault(key, []).append(content)
    return output


def _jsonld_documents(response: Any) -> Iterator[Any]:
    scripts = response.xpath(
        "//script[contains(translate(@type, "
        f"'{XPATH_UPPER}', '{XPATH_LOWER}'), 'ld+json')]/text()"
    ).getall()
    for raw in scripts:
        value = str(raw or "").strip().rstrip(";")
        if not value:
            continue
        try:
            yield json.loads(value)
        except (TypeError, ValueError):
            continue


def _walk_json(value: Any) -> Iterator[Dict[str, Any]]:
    queue: List[Any] = [value]
    while queue:
        current = queue.pop(0)
        if isinstance(current, dict):
            yield current
            queue.extend(current.values())
        elif isinstance(current, list):
            queue.extend(current)


def _jsonld_first(response: Any, keys: Sequence[str]) -> Any:
    lowered_keys = [key.lower() for key in keys]
    objects: List[Dict[str, Any]] = []
    for document in _jsonld_documents(response):
        objects.extend(_walk_json(document))
    for wanted in lowered_keys:
        for obj in objects:
            for key, value in obj.items():
                if str(key).lower() == wanted and value not in (None, "", [], {}):
                    return value
    return None


def extract_page_dates(
    response: Any,
    source_timezone: str,
    allow_modified: bool = False,
) -> Dict[str, Optional[str]]:
    meta = _meta_values(response)
    for key in PUBLISHED_META_KEYS:
        for raw in meta.get(key, []):
            parsed, precision = parse_datetime(raw, source_timezone)
            if parsed:
                return {
                    "published_at": parsed,
                    "modified_at": None,
                    "raw_date": raw,
                    "date_source": f"page_meta_{key}",
                    "date_precision": precision,
                }

    json_value = _jsonld_first(response, PUBLISHED_JSON_KEYS)
    if json_value:
        raw = clean_text(json_value)
        parsed, precision = parse_datetime(raw, source_timezone)
        if parsed:
            return {
                "published_at": parsed,
                "modified_at": None,
                "raw_date": raw,
                "date_source": "jsonld_published",
                "date_precision": precision,
            }

    article_time = response.xpath(
        "string((//article//time[@datetime] | "
        "//*[@itemprop='datePublished'][@datetime])[1]/@datetime)"
    ).get()
    if clean_text(article_time):
        raw = clean_text(article_time)
        parsed, precision = parse_datetime(raw, source_timezone)
        if parsed:
            return {
                "published_at": parsed,
                "modified_at": None,
                "raw_date": raw,
                "date_source": "page_article_time",
                "date_precision": precision,
            }

    if allow_modified:
        for key in MODIFIED_META_KEYS:
            for raw in meta.get(key, []):
                parsed, precision = parse_datetime(raw, source_timezone)
                if parsed:
                    return {
                        "published_at": None,
                        "modified_at": parsed,
                        "raw_date": raw,
                        "date_source": f"page_meta_{key}",
                        "date_precision": precision,
                    }
        json_value = _jsonld_first(response, MODIFIED_JSON_KEYS)
        if json_value:
            raw = clean_text(json_value)
            parsed, precision = parse_datetime(raw, source_timezone)
            if parsed:
                return {
                    "published_at": None,
                    "modified_at": parsed,
                    "raw_date": raw,
                    "date_source": "jsonld_modified",
                    "date_precision": precision,
                }

    return {
        "published_at": None,
        "modified_at": None,
        "raw_date": "",
        "date_source": "missing",
        "date_precision": "missing",
    }


def _first_meta(response: Any, keys: Sequence[str]) -> str:
    values = _meta_values(response)
    for key in keys:
        candidates = values.get(key.lower(), [])
        if candidates:
            return clean_text(candidates[0])
    return ""


def extract_title(response: Any) -> Tuple[str, str]:
    candidates = (
        (_first_meta(response, ("og:title",)), "page_meta_og:title"),
        (_first_meta(response, ("twitter:title",)), "page_meta_twitter:title"),
        (clean_text(_jsonld_first(response, ("headline",))), "jsonld_headline"),
        (clean_text(response.xpath("string((//article//h1)[1])").get()), "page_article_h1"),
        (clean_text(response.xpath("string((//h1)[1])").get()), "page_h1"),
        (clean_text(response.xpath("string((//title)[1])").get()), "page_title"),
    )
    for value, source in candidates:
        if value:
            return value, source
    return "", "missing"


def extract_body(response: Any) -> Tuple[str, Dict[str, Any]]:
    best: Tuple[int, int, List[str], str] = (0, 0, [], "")
    for index, css in enumerate(BODY_SELECTORS):
        paragraphs: List[str] = []
        seen = set()
        for node in response.css(css):
            value = clean_text(node.xpath("string(.)").get())
            if len(value) < 20 or any(pattern.search(value) for pattern in BOILERPLATE_PATTERNS):
                continue
            if value in seen:
                continue
            seen.add(value)
            paragraphs.append(value)
        body = "\n\n".join(paragraphs)
        score = len(body)
        if score > best[0]:
            best = (score, index, paragraphs, css)
        if score >= 1200:
            break

    paragraphs = best[2]
    body = "\n\n".join(paragraphs)
    words = len(re.findall(r"\b\w+\b", body, flags=re.UNICODE))
    if len(body) >= 600 and words >= 80:
        status = "good"
    elif len(body) >= 160 and words >= 25:
        status = "partial"
    else:
        status = "insufficient"
    return body, {
        "status": status,
        "extractor": "deterministic_css_v1",
        "selector": best[3],
        "character_count": len(body),
        "word_count": words,
        "paragraph_count": len(paragraphs),
    }


def extract_excerpt(response: Any, body_text: str = "") -> str:
    meta = _first_meta(response, ("og:description", "description", "twitter:description"))
    if meta:
        return meta[:1200]
    return clean_text(body_text)[:1200]


def extract_canonical_url(
    response: Any,
    allowed_domains: Iterable[str],
) -> str:
    candidate = response.xpath(
        "string((//link[contains(concat(' ', "
        f"translate(normalize-space(@rel), '{XPATH_UPPER}', '{XPATH_LOWER}'), "
        "' '), ' canonical ')])[1]/@href)"
    ).get()
    safe = safe_metadata_url(clean_text(candidate), response.url, allowed_domains)
    return safe or canonicalize_url(response.url)


def _image_value(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return str(value.get("url") or value.get("contentUrl") or "")
    if isinstance(value, list):
        for item in value:
            candidate = _image_value(item)
            if candidate:
                return candidate
    return ""


def extract_lead_image(response: Any) -> Optional[str]:
    candidates = [
        _first_meta(response, ("og:image:secure_url", "og:image", "twitter:image")),
        _image_value(_jsonld_first(response, ("image", "thumbnailUrl"))),
        clean_text(response.xpath("string((//article//img[@src])[1]/@src)").get()),
    ]
    for value in candidates:
        normalized = canonicalize_url(value, response.url)
        if normalized:
            return normalized
    return None


def _author_names(value: Any) -> List[str]:
    if isinstance(value, str):
        return [clean_text(value)] if clean_text(value) else []
    if isinstance(value, dict):
        return _author_names(value.get("name", ""))
    if isinstance(value, list):
        output: List[str] = []
        for item in value:
            output.extend(_author_names(item))
        return output
    return []


def extract_authors(response: Any) -> List[str]:
    candidates: List[str] = []
    meta_author = _first_meta(response, ("author", "article:author", "byl"))
    if meta_author:
        candidates.extend(re.split(r"\s*(?:,|\band\b)\s*", meta_author))
    candidates.extend(_author_names(_jsonld_first(response, ("author",))))
    for value in response.xpath(
        "//*[contains(concat(' ', normalize-space(@class), ' '), ' byline ') "
        "or contains(concat(' ', normalize-space(@class), ' '), ' author ')]"
        "[self::a or self::span]"
    ):
        candidates.append(clean_text(value.xpath("string(.)").get()))

    output: List[str] = []
    seen = set()
    for candidate in candidates:
        name = re.sub(r"^by\s+", "", clean_text(candidate), flags=re.IGNORECASE)
        key = name.casefold()
        if name and key not in seen:
            seen.add(key)
            output.append(name)
    return output[:20]


def content_hash(body_text: str) -> Optional[str]:
    normalized = clean_text(body_text).casefold()
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def redirect_chain(response: Any) -> List[str]:
    request = getattr(response, "request", None)
    meta = getattr(request, "meta", {}) if request is not None else {}
    values = list(meta.get("redirect_urls", []) or []) + [getattr(response, "url", "")]
    output: List[str] = []
    for value in values:
        normalized = canonicalize_url(value)
        if normalized and (not output or output[-1] != normalized):
            output.append(normalized)
    return output
