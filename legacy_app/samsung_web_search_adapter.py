"""Samsung Web Search enrichment using the original environment contract."""

from __future__ import annotations

import os
import re
import time
from urllib.parse import urlparse, urlsplit, urlunsplit

import requests

from secure_http import tls_verify


ENDPOINT = (
    os.environ.get("SAMSUNG_WEB_SEARCH_URL")
    or os.environ.get("SAMSUNG_WEB_SEARCH_ENDPOINT")
    or "https://genai-openapi.sec.samsung.net/swahq/trial/api-web-search/openapi/web-search/v1/search"
).strip()
TIMEOUT = int(os.environ.get("SAMSUNG_WEB_SEARCH_TIMEOUT", "90"))
DEBUG = os.environ.get("SAMSUNG_WEB_SEARCH_DEBUG", "false").lower() in {"1", "true", "yes"}


def clean_text(value) -> str:
    if value is None:
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


def build_query(item: dict, keywords=None) -> str:
    title = clean_text(item.get("title"))
    link = clean_text(item.get("link") or item.get("url"))
    source = clean_text(item.get("source"))
    host = domain(link)
    if host and title:
        return f'site:{host} "{title}" article details summary publisher date'
    if title and source:
        return f'"{title}" "{source}" article details summary publisher date'
    return f'"{title or link}" article details summary publisher date' if title or link else clean_join(keywords or [])


def call_samsung_web_search_api(query: str, chat_id: str | None = None) -> dict:
    token = os.environ.get("SAMSUNG_WEB_SEARCH_TOKEN", "").strip()
    client = os.environ.get("SAMSUNG_WEB_SEARCH_CLIENT", "sense-news-intelligence").strip()
    if not token:
        raise RuntimeError("Missing SAMSUNG_WEB_SEARCH_TOKEN")
    if not client:
        raise RuntimeError("Missing SAMSUNG_WEB_SEARCH_CLIENT")
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
    response.raise_for_status()
    return response.json()


def enrich_article_with_web_search(item, keywords=None, chat_id=None, min_content_chars=40, min_match_score=25):
    output = dict(item or {})
    query = build_query(output, keywords)
    try:
        data = call_samsung_web_search_api(query, chat_id)
        refs = extract_references(data)
        best, score = choose_best_reference(output, refs)
        if not best or score < min_match_score:
            raise RuntimeError("No sufficiently matching Web Search reference")
        content = clean_join(
            [
                best.get("description"), best.get("content"), best.get("scraping"),
                output.get("rss_snippet"), output.get("snippet"),
            ]
        )
        if len(content) < min_content_chars:
            raise RuntimeError("Web Search reference did not contain enough article text")
        final_url = clean_text(best.get("link") or best.get("url") or output.get("link"))
        publisher = clean_text(best.get("publisher")) or output.get("source") or domain(final_url) or "Web Search"
        summary = clean_join([best.get("description"), best.get("content"), output.get("snippet")]) or content[:1200]
        output.update(
            {
                "link": final_url,
                "canonical_link": final_url,
                "source": publisher,
                "summary": summary[:1200],
                "snippet": summary[:1000],
                "master_summary": summary[:1500],
                "ppt_summary": summary[:900],
                "full_contents": content,
                "summary_input": content,
                "web_search_query": query,
                "web_search_match_score": score,
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
