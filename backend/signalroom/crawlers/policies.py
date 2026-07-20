"""URL, domain, and response policies shared by crawler spiders."""

from __future__ import annotations

import posixpath
from typing import Iterable, Optional, Set
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

from scrapy.exceptions import IgnoreRequest


TRACKING_QUERY_KEYS = {
    "fbclid",
    "gclid",
    "dclid",
    "gbraid",
    "wbraid",
    "mc_cid",
    "mc_eid",
    "msclkid",
    "igshid",
    "vero_conv",
    "vero_id",
}

SOCIAL_DOMAINS = {
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "reddit.com",
    "tiktok.com",
    "twitter.com",
    "whatsapp.com",
    "x.com",
    "youtube.com",
}

NON_ARTICLE_PATH_SEGMENTS = {
    "about",
    "advertise",
    "author",
    "authors",
    "careers",
    "categories",
    "category",
    "contact",
    "feed",
    "jobs",
    "login",
    "newsletter",
    "privacy",
    "rss",
    "sign-in",
    "signin",
    "sitemap",
    "subscribe",
    "subscription",
    "tag",
    "tags",
    "terms",
    "topic",
    "topics",
    "wp-json",
    "xml",
}

BINARY_SUFFIXES = {
    ".7z",
    ".avi",
    ".css",
    ".csv",
    ".doc",
    ".docx",
    ".gif",
    ".gz",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".m4a",
    ".mov",
    ".mp3",
    ".mp4",
    ".mpeg",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".rar",
    ".svg",
    ".tar",
    ".tsv",
    ".wav",
    ".webm",
    ".webp",
    ".xls",
    ".xlsx",
    ".xml",
    ".zip",
}

HTML_CONTENT_TYPES = {
    "application/xhtml+xml",
    "text/html",
}

FEED_CONTENT_TYPES = {
    "application/atom+xml",
    "application/rdf+xml",
    "application/rss+xml",
    "application/xml",
    "text/xml",
}


def _host_matches(host: str, domain: str) -> bool:
    host = host.lower().rstrip(".")
    domain = domain.lower().lstrip(".").rstrip(".")
    return bool(host and domain) and (host == domain or host.endswith("." + domain))


def canonicalize_url(value: str, base_url: str = "") -> str:
    """Return a conservative canonical URL without corrupting case-sensitive parts.

    Only scheme and hostname are case-normalized. Known analytics parameters and
    the fragment are removed; path case, query order, and non-tracking values are
    preserved because publishers are allowed to treat them as significant.
    """

    raw = str(value or "").strip()
    if not raw:
        return ""
    absolute = urljoin(base_url, raw) if base_url else raw

    try:
        parsed = urlparse(absolute)
        scheme = parsed.scheme.lower()
        if scheme not in {"http", "https"} or not parsed.hostname:
            return ""
        if parsed.username is not None or parsed.password is not None:
            return ""

        hostname = parsed.hostname.encode("idna").decode("ascii").lower().rstrip(".")
        try:
            port = parsed.port
        except ValueError:
            return ""

        include_port = port is not None and not (
            (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
        )
        netloc = hostname + (f":{port}" if include_port else "")

        path = parsed.path or "/"
        # Collapse literal dot segments while preserving original case and escaping.
        if "/./" in path or "/../" in path or path.endswith("/.") or path.endswith("/.."):
            trailing = path.endswith("/")
            path = posixpath.normpath(path)
            if not path.startswith("/"):
                path = "/" + path
            if trailing and path != "/":
                path += "/"

        kept_query = []
        for key, item_value in parse_qsl(parsed.query, keep_blank_values=True):
            lowered = key.lower()
            if lowered.startswith("utm_") or lowered in TRACKING_QUERY_KEYS:
                continue
            kept_query.append((key, item_value))

        return urlunparse((scheme, netloc, path, "", urlencode(kept_query, doseq=True), ""))
    except (UnicodeError, ValueError):
        return ""


def publisher_domains(urls: Iterable[str], configured: Iterable[str] = ()) -> Set[str]:
    """Build an explicit publisher allowlist from config and entrypoint URLs."""

    domains: Set[str] = set()
    for value in configured:
        candidate = str(value or "").strip().lower().lstrip(".").rstrip(".")
        if candidate:
            domains.add(candidate[4:] if candidate.startswith("www.") else candidate)
    for value in urls:
        host = (urlparse(str(value or "")).hostname or "").lower().rstrip(".")
        if host:
            domains.add(host[4:] if host.startswith("www.") else host)
    return domains


def is_allowed_publisher_url(url: str, allowed_domains: Iterable[str]) -> bool:
    normalized = canonicalize_url(url)
    host = (urlparse(normalized).hostname or "").lower()
    return bool(host) and any(_host_matches(host, domain) for domain in allowed_domains)


def is_social_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(_host_matches(host, domain) for domain in SOCIAL_DOMAINS)


def should_skip_article_url(url: str) -> bool:
    normalized = canonicalize_url(url)
    if not normalized or is_social_url(normalized):
        return True

    parsed = urlparse(normalized)
    lowered_path = parsed.path.lower()
    suffix = posixpath.splitext(lowered_path.rstrip("/"))[1]
    if suffix in BINARY_SUFFIXES:
        return True

    segments = {segment for segment in lowered_path.split("/") if segment}
    return bool(segments & NON_ARTICLE_PATH_SEGMENTS)


def response_content_type(response: object) -> str:
    headers = getattr(response, "headers", {})
    raw = headers.get("Content-Type", b"") if headers is not None else b""
    if isinstance(raw, bytes):
        raw = raw.decode("latin-1", errors="ignore")
    return str(raw or "").split(";", 1)[0].strip().lower()


def is_html_response(response: object) -> bool:
    content_type = response_content_type(response)
    return not content_type or content_type in HTML_CONTENT_TYPES


def is_feed_response(response: object) -> bool:
    content_type = response_content_type(response)
    if content_type in FEED_CONTENT_TYPES:
        return True
    text = getattr(response, "text", "")
    prefix = str(text or "")[:500].lstrip().lower()
    return prefix.startswith("<?xml") or any(
        marker in prefix[:250] for marker in ("<rss", "<feed", "<rdf:rdf")
    )


def safe_metadata_url(
    candidate: str,
    base_url: str,
    allowed_domains: Iterable[str],
) -> Optional[str]:
    normalized = canonicalize_url(candidate, base_url)
    if normalized and is_allowed_publisher_url(normalized, allowed_domains):
        return normalized
    return None


class PublisherRedirectPolicyMiddleware:
    """Reject cross-publisher redirects before Scrapy schedules their target."""

    REDIRECT_STATUSES = {301, 302, 303, 307, 308}

    def process_response(self, request: object, response: object, spider: object):
        if getattr(response, "status", 0) not in self.REDIRECT_STATUSES:
            return response
        headers = getattr(response, "headers", {})
        raw_location = headers.get("Location", b"")
        if isinstance(raw_location, bytes):
            raw_location = raw_location.decode("latin-1", errors="ignore")
        if not raw_location:
            return response

        meta = getattr(request, "meta", {})
        allowed_domains = meta.get("signalroom_allowed_domains", [])
        target = canonicalize_url(str(raw_location), getattr(response, "url", ""))
        if not allowed_domains or is_allowed_publisher_url(target, allowed_domains):
            return response

        crawler = getattr(spider, "crawler", None)
        stats = getattr(crawler, "stats", None)
        if stats is not None:
            stats.inc_value("signalroom/dropped_cross_domain_redirect")
        logger = getattr(spider, "logger", None)
        if logger is not None:
            logger.warning(
                "crawler_cross_domain_redirect_rejected",
                extra={
                    "event": "crawler_cross_domain_redirect_rejected",
                    "run_id": getattr(spider, "run_id", ""),
                    "profile": getattr(spider, "profile", ""),
                    "source_url": getattr(response, "url", ""),
                    "target_url": target,
                },
            )
        raise IgnoreRequest(f"Cross-publisher redirect rejected: {target}")
