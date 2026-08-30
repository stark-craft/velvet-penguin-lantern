"""Samsung Web Search enrichment using the original environment contract."""

from __future__ import annotations

import os
import re
import time
from urllib.parse import urljoin, urlparse, urlsplit, urlunsplit

import requests
from newspaper import Article

from core.rate_limit import PacedRateLimiter
from core.secure_http import tls_verify
from core.network_safety import assert_public_http_url


ENDPOINT = (
    os.environ.get("SAMSUNG_WEB_SEARCH_URL")
    or os.environ.get("SAMSUNG_WEB_SEARCH_ENDPOINT")
    or ""
).strip()
TIMEOUT = int(os.environ.get("SAMSUNG_WEB_SEARCH_TIMEOUT", "90"))
ARTICLE_FETCH_TIMEOUT = int(
    os.environ.get("SAMSUNG_WEB_SEARCH_ARTICLE_FETCH_TIMEOUT", "30")
)
ARTICLE_FETCH_MAX_BYTES = max(
    250_000,
    int(os.environ.get("SAMSUNG_WEB_SEARCH_ARTICLE_FETCH_MAX_BYTES", "5000000")),
)
DEBUG = os.environ.get("SAMSUNG_WEB_SEARCH_DEBUG", "false").lower() in {"1", "true", "yes"}
REQUESTS_PER_MINUTE = min(
    3,
    max(1, int(os.environ.get("SAMSUNG_WEB_SEARCH_REQUESTS_PER_MINUTE", "3"))),
)
RATE_LIMITER = PacedRateLimiter(REQUESTS_PER_MINUTE)


def clean_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return ""
    if isinstance(value, dict):
        return clean_join(value.values())
    if isinstance(value, (list, tuple)):
        return clean_join(value)
    return re.sub(r"\s+", " ", str(value)).strip()


def clean_join(values) -> str:
    output, seen = [], set()
    for value in values:
        text = clean_text(value)
        key = text.casefold()
        if text and key not in seen:
            seen.add(key)
            output.append(text)
    return " ".join(output)


def normalize_url(value) -> str:
    try:
        parsed = urlsplit(clean_text(value))
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return ""
        return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower().removeprefix("www."), parsed.path.rstrip("/") or "/", "", ""))
    except ValueError:
        return ""


def domain(value) -> str:
    return urlparse(clean_text(value)).netloc.lower().removeprefix("www.")


def title_tokens(value) -> set[str]:
    stop = {"the", "and", "for", "with", "from", "this", "that", "into", "new", "news"}
    return {token for token in re.findall(r"[a-z0-9]+", clean_text(value).lower()) if len(token) >= 3 and token not in stop}


def extract_references(data) -> list[dict]:
    references = []
    if not isinstance(data, dict):
        return references
    for block in data.get("content_references", []) or []:
        if isinstance(block, dict):
            references.extend(ref for ref in block.get("references", []) or [] if isinstance(ref, dict))
    references.extend(ref for ref in data.get("references", []) or [] if isinstance(ref, dict))
    result, seen = [], set()
    for ref in references:
        key = (normalize_url(ref.get("link") or ref.get("url")), clean_text(ref.get("title")).casefold())
        if key not in seen:
            seen.add(key)
            result.append(ref)
    return result


def choose_best_reference(item: dict, references: list[dict]):
    item_url = normalize_url(item.get("link") or item.get("url"))
    item_domain = domain(item_url)
    item_tokens = title_tokens(item.get("title"))
    best, best_score = None, -1
    for ref in references:
        ref_url = normalize_url(ref.get("link") or ref.get("url"))
        # Scrapy has already supplied the authoritative article URL. Web
        # Search may ignore prompt-level site restrictions, so never replace
        # it with a different URL merely because the domain/title is similar.
        if item_url and ref_url != item_url:
            continue
        score = 0
        if item_url and ref_url == item_url:
            score += 100
        if item_domain and domain(ref_url) == item_domain:
            score += 35
        ref_tokens = title_tokens(ref.get("title"))
        if item_tokens and ref_tokens:
            score += int(50 * len(item_tokens & ref_tokens) / len(item_tokens))
        if clean_text(ref.get("content") or ref.get("scraping")):
            score += 15
        if score > best_score:
            best, best_score = ref, score
    return best, best_score


def safe_error_excerpt(response, limit: int = 1200) -> str:
    text = clean_text(getattr(response, "text", ""))
    text = re.sub(
        r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+",
        "Bearer [REDACTED]",
        text,
    )
    text = re.sub(
        r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}"
        r"(?:\.[A-Za-z0-9_-]{20,})?\b",
        "[REDACTED_TOKEN]",
        text,
    )
    return text[:limit]


def fetch_exact_article_content(url: str) -> dict:
    """Complete a snippet-only reference by fetching only its exact URL."""

    current_url = assert_public_http_url(url)
    response = None
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/124 Safari/537.36"
        )
    }
    for _ in range(5):
        response = requests.get(
            current_url,
            headers=headers,
            timeout=ARTICLE_FETCH_TIMEOUT,
            verify=tls_verify("SAMSUNG_WEB_SEARCH"),
            allow_redirects=False,
            stream=True,
        )
        if response.status_code in {301, 302, 303, 307, 308}:
            location = response.headers.get("location", "")
            if not location:
                raise RuntimeError("exact article redirect omitted its destination")
            current_url = assert_public_http_url(urljoin(current_url, location))
            continue
        break
    if response is None:
        raise RuntimeError("exact article fetch returned no response")
    if response.status_code >= 400:
        raise RuntimeError(
            f"exact article fetch returned HTTP {response.status_code}"
        )
    content_type = str(response.headers.get("content-type", "")).lower()
    if content_type and "html" not in content_type:
        raise RuntimeError("exact article fetch did not return HTML")
    body = bytearray()
    for chunk in response.iter_content(chunk_size=64 * 1024):
        body.extend(chunk)
        if len(body) > ARTICLE_FETCH_MAX_BYTES:
            raise RuntimeError("exact article fetch exceeded the safe size limit")
    article = Article(url=current_url)
    article.set_html(bytes(body).decode(response.encoding or "utf-8", errors="replace"))
    article.parse()
    text = clean_text(article.text)
    if len(text) < 200:
        raise RuntimeError(
            "exact article fetch did not produce enough readable body text"
        )
    publish_date = article.publish_date
    return {
        "content": text,
        "title": clean_text(article.title),
        "date": (
            publish_date.isoformat()
            if hasattr(publish_date, "isoformat")
            else clean_text(publish_date)
        ),
        "top_image": clean_text(article.top_image),
    }


def build_query(item: dict, keywords=None) -> str:
    title = clean_text(item.get("title"))
    link = clean_text(item.get("link") or item.get("url"))
    source = clean_text(item.get("source"))
    host = domain(link)
    if link:
        return (
            "Open and extract the complete factual news article from this exact "
            f"URL: {link}. Title hint: {title or 'unknown'}. "
            "Return the matching source reference, publisher, publication date, "
            "description, and article text. Do not substitute a different story."
        )
    if host and title:
        return f'site:{host} "{title}" complete article text publisher date'
    if title and source:
        return f'"{title}" "{source}" article details summary publisher date'
    return f'"{title or link}" article details summary publisher date' if title or link else clean_join(keywords or [])


def call_samsung_web_search_api(query: str, chat_id: str | None = None) -> dict:
    token = os.environ.get("SAMSUNG_WEB_SEARCH_TOKEN", "").strip()
    client = os.environ.get("SAMSUNG_WEB_SEARCH_CLIENT", "sense-news-intelligence").strip()
    if not ENDPOINT:
        raise RuntimeError("Missing SAMSUNG_WEB_SEARCH_URL")
    if not token:
        raise RuntimeError("Missing SAMSUNG_WEB_SEARCH_TOKEN")
    if not client:
        raise RuntimeError("Missing SAMSUNG_WEB_SEARCH_CLIENT")
    RATE_LIMITER.acquire()
    token_header = token if token.lower().startswith("bearer ") else f"Bearer {token}"
    response = requests.post(
        ENDPOINT,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-generative-ai-client": client,
            "x-openapi-token": token_header,
        },
        json={
            "input_value": query,
            "message_hists": [],
            "chat_id": chat_id or f"news-scrapper-{int(time.time())}",
            "data_source": {"web_search": True},
        },
        timeout=TIMEOUT,
        verify=tls_verify("SAMSUNG_WEB_SEARCH"),
    )
    if response.status_code >= 400:
        raise RuntimeError(
            f"Samsung Web Search HTTP {response.status_code} at {ENDPOINT}. "
            f"Response: {safe_error_excerpt(response) or '[empty body]'}"
        )
    data = response.json()
    if data.get("status") and clean_text(data.get("status")).upper() != "SUCCESS":
        raise RuntimeError(
            "Samsung Web Search status failed: "
            f"{clean_text(data.get('status'))}; "
            f"event_status={clean_text(data.get('event_status')) or 'unknown'}; "
            f"security_filter={clean_text(data.get('security_filter')) or 'none'}"
        )
    return data


def check_samsung_web_search() -> dict:
    """Make one authenticated request before a crawl chooses discovery mode."""

    started = time.monotonic()
    try:
        data = call_samsung_web_search_api(
            "Find Samsung's official global newsroom homepage and return one "
            "matching source reference. This is a connectivity health check.",
            chat_id=f"news-scrapper-health-{int(time.time())}",
        )
        if not isinstance(data, dict):
            raise RuntimeError("Web Search health check returned a non-object response")
        return {
            "available": True,
            "latency_ms": round((time.monotonic() - started) * 1000),
            "error": None,
        }
    except Exception as error:
        return {
            "available": False,
            "latency_ms": round((time.monotonic() - started) * 1000),
            "error": f"{type(error).__name__}: {error}"[:500],
        }


def enrich_article_with_web_search(item, keywords=None, chat_id=None, min_content_chars=40, min_match_score=25):
    output = dict(item or {})
    query = build_query(output, keywords)
    try:
        requested_url = normalize_url(output.get("link") or output.get("url"))
        if not requested_url:
            raise RuntimeError(
                "Scrapy candidate did not contain an authoritative HTTP(S) "
                "article URL; Web Search title-only substitution is disabled"
            )
        data = call_samsung_web_search_api(query, chat_id)
        refs = extract_references(data)
        best, score = choose_best_reference(output, refs)
        if not best or score < min_match_score:
            raise RuntimeError(
                "Web Search did not return the exact discovered article "
                f"URL ({requested_url}); unrelated references were rejected"
            )
        content = clean_join(
            [
                best.get("description"), best.get("content"), best.get("scraping"),
                output.get("rss_snippet"), output.get("snippet"),
            ]
        )
        final_url = clean_text(best.get("link") or best.get("url") or output.get("link"))
        publisher = clean_text(best.get("publisher")) or output.get("source") or domain(final_url) or "Web Search"
        published_time = clean_text(
            best.get("published_time")
            or best.get("publishedTime")
            or best.get("date")
        )
        reference_query = clean_text(best.get("query"))
        try:
            similarity = float(best.get("similarity"))
        except (TypeError, ValueError):
            similarity = None
        was_scraped = best.get("scraping") is True
        completion = None
        if best.get("scraping") is False:
            try:
                completion = fetch_exact_article_content(final_url)
                content = completion["content"]
                was_scraped = True
            except Exception as error:
                raise RuntimeError(
                    "Web Search returned only a reference snippet and exact "
                    f"article completion failed: {type(error).__name__}: {error}"
                ) from error
        if completion:
            published_time = published_time or completion.get("date", "")
            output["top_image"] = (
                output.get("top_image") or completion.get("top_image", "")
            )
        if len(content) < min_content_chars:
            raise RuntimeError(
                "Web Search reference did not contain enough article text"
            )
        summary = clean_join([best.get("description"), best.get("content"), output.get("snippet")]) or content[:1200]
        output.update(
            {
                "link": final_url,
                "canonical_link": final_url,
                "source": publisher,
                "date": output.get("date") or published_time,
                "published_time": published_time,
                "summary": summary[:1200],
                "snippet": summary[:1000],
                "master_summary": summary[:1500],
                "ppt_summary": summary[:900],
                "full_contents": content,
                "summary_input": content,
                "web_search_content": content,
                "web_search_query": query,
                "web_search_reference_query": reference_query,
                "web_search_match_score": score,
                "web_search_similarity": similarity,
                "web_search_scraping": was_scraped,
                "web_search_content_scope": (
                    "targeted_article_fetch"
                    if completion
                    else "scraped_article"
                    if was_scraped
                    else "reference_snippet"
                ),
                "enrichment_status": "success",
                "enrichment_error": None,
                "enriched_by": "samsung_web_search",
                "needs_web_search_enrichment": False,
                "sources": [{"name": publisher, "link": final_url, "date": output.get("date", "")}],
            }
        )
        if DEBUG:
            output["_web_search_debug"] = {"reference_count": len(refs), "match_score": score}
    except Exception as error:
        output["enrichment_status"] = "failed"
        output["enrichment_error"] = str(error)[:500]
    return output
