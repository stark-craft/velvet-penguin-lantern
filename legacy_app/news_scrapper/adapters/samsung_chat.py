"""Samsung Chat final-summary adapter using the legacy request contract."""

from __future__ import annotations

import json
import os
import re
import time

import requests

from core.rate_limit import PacedRateLimiter
from core.secure_http import tls_verify


DEFAULT_URL = (
    "https://genai-openapi.sec.samsung.net/swahq/trial/"
    "api-chat/openapi/chat/v1/messages"
)


def normalize_chat_url(value: str) -> str:
    """Upgrade the legacy product base URL to the proven messages route."""

    url = str(value or "").strip().rstrip("/")
    if not url:
        return DEFAULT_URL
    if url.endswith("/api-chat"):
        return f"{url}/openapi/chat/v1/messages"
    return url


URL = normalize_chat_url(os.environ.get("SAMSUNG_CHAT_URL", DEFAULT_URL))
CLIENT = os.environ.get("SAMSUNG_CHAT_CLIENT", "").strip()
TOKEN = os.environ.get("SAMSUNG_CHAT_TOKEN", "").strip()
MODEL_ID = os.environ.get("SAMSUNG_CHAT_MODEL_ID", "").strip()
TIMEOUT = int(os.environ.get("SAMSUNG_CHAT_TIMEOUT", "180"))
REQUESTS_PER_MINUTE = min(
    3,
    max(1, int(os.environ.get("SAMSUNG_CHAT_REQUESTS_PER_MINUTE", "3"))),
)
RATE_LIMITER = PacedRateLimiter(REQUESTS_PER_MINUTE)


def clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def clean_points(value, maximum: int = 5) -> list[str]:
    if isinstance(value, str):
        candidates = re.split(r"(?:\r?\n|[•●▪])+", value)
    elif isinstance(value, (list, tuple)):
        candidates = value
    else:
        candidates = []
    output: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        point = re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", clean(candidate))
        key = point.casefold()
        if len(point) >= 12 and key not in seen:
            seen.add(key)
            output.append(point)
        if len(output) >= maximum:
            break
    return output


def extract_json(value: str) -> dict:
    text = str(value or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
    try:
        return json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise RuntimeError("Samsung Chat response did not contain valid JSON")


def safe_error_excerpt(response, limit: int = 1200) -> str:
    """Return useful API diagnostics without echoing tokens or huge HTML."""

    text = clean(getattr(response, "text", ""))
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


def call_samsung_chat(prompt: str) -> dict:
    if not CLIENT:
        raise RuntimeError("Missing SAMSUNG_CHAT_CLIENT")
    if not TOKEN:
        raise RuntimeError("Missing SAMSUNG_CHAT_TOKEN")
    if not MODEL_ID:
        raise RuntimeError("Missing SAMSUNG_CHAT_MODEL_ID")
    RATE_LIMITER.acquire()
    token = TOKEN if TOKEN.lower().startswith("bearer ") else f"Bearer {TOKEN}"
    response = requests.post(
        URL,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-generative-ai-client": CLIENT,
            "x-openapi-token": token,
        },
        json={
            "modelIds": [MODEL_ID],
            "contents": [prompt],
            "isStream": False,
            "llmConfig": {
                "max_new_tokens": 900,
                "seed": None,
                "top_k": 14,
                "top_p": 0.94,
                "temperature": 0.2,
                "repetition_penalty": 1.04,
            },
            "systemPrompt": "You are an executive technology intelligence summarizer. Return strict valid JSON only.",
        },
        timeout=TIMEOUT,
        verify=tls_verify("SAMSUNG_CHAT"),
        stream=False,
    )
    if response.status_code >= 400:
        excerpt = safe_error_excerpt(response)
        route_hint = (
            " The configured SAMSUNG_CHAT_URL route was not found; use the "
            "full /openapi/chat/v1/messages route."
            if response.status_code == 404
            else ""
        )
        raise RuntimeError(
            f"Samsung Chat HTTP {response.status_code} at {URL}.{route_hint} "
            f"Response: {excerpt or '[empty body]'}"
        )
    data = response.json()
    if data.get("status") and clean(data.get("status")).upper() != "SUCCESS":
        raise RuntimeError(
            "Samsung Chat status failed: "
            f"{clean(data.get('status'))}; "
            f"responseCode={clean(data.get('responseCode') or data.get('response_code')) or 'unknown'}; "
            f"filter={clean(data.get('filterBlockReason') or data.get('filter_block_reason')) or 'none'}"
        )
    response_code = clean(
        data.get("responseCode") or data.get("response_code")
    )
    if response_code and not response_code.upper().startswith("R2"):
        raise RuntimeError(
            f"Samsung Chat responseCode failed: {response_code}"
        )
    return data


def check_samsung_chat() -> dict:
    """Make one authenticated request before choosing the summary engine."""

    started = time.monotonic()
    prompt = (
        'Return strict JSON only: {"status":"ok"}. '
        "This is a connectivity health check; do not add other text."
    )
    try:
        data = call_samsung_chat(prompt)
        if not clean(data.get("content")):
            raise RuntimeError("Samsung Chat health check returned empty content")
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


def summarize_article_with_chat(item):
    output = dict(item or {})
    content = clean(
        output.get("full_contents")
        or output.get("summary_input")
        or output.get("master_summary")
        or output.get("snippet")
    )
    prompt = f"""Analyze this technology news article for an executive intelligence dashboard.
Return strict JSON only with these keys:
- title: a factual headline
- summary_lead: one or two concise sentences explaining what happened
- key_points: an array of 3 to 5 factual, non-repetitive important points
- ppt_summary: a concise presentation-ready summary
- why_it_matters: one or two sentences describing strategic impact without repeating the summary
- article_intent: one concise label such as Product Launch, Research, Regulation, Partnership, Investment, Market Update, Security, or Corporate Strategy
- category: a concise technology category
- region: exactly Global or Local
- importance_score: an integer from 1 to 10

Do not invent facts, numbers, quotations, dates, or implications. Use only the supplied article and source metadata.

Title: {clean(output.get('title'))}
Source: {clean(output.get('source'))}
Date: {clean(output.get('date'))}
Link: {clean(output.get('link'))}
Article: {content}"""
    try:
        data = call_samsung_chat(prompt)
        parsed = extract_json(data.get("content", ""))
        lead = clean(parsed.get("summary_lead") or parsed.get("summary"))
        points = clean_points(
            parsed.get("key_points")
            or parsed.get("important_points")
            or parsed.get("summary_points")
        )
        if not lead:
            raise RuntimeError("Samsung Chat response did not contain summary_lead")
        if not points:
            raise RuntimeError("Samsung Chat response did not contain usable key_points")
        combined_summary = " ".join([lead, *[f"• {point}" for point in points]])
        output["summary"] = lead
        output["summary_lead"] = lead
        output["summary_points"] = points
        output["key_points"] = points
        output["master_summary"] = combined_summary
        output["title"] = clean(parsed.get("title")) or output.get("title", "")
        output["ppt_summary"] = clean(parsed.get("ppt_summary")) or combined_summary
        output["why_it_matters"] = clean(parsed.get("why_it_matters"))
        output["why_matters"] = output["why_it_matters"]
        output["article_intent"] = clean(parsed.get("article_intent"))
        output["category"] = clean(parsed.get("category")) or output.get("category", "Tech News")
        output["region"] = "Local" if clean(parsed.get("region")).lower() == "local" else "Global"
        try:
            score = float(parsed.get("importance_score", output.get("importance_score", 50)))
            output["importance_score"] = max(1, min(100, round(score * 10 if score <= 10 else score)))
        except (TypeError, ValueError):
            pass
        output["chat_summary_status"] = "success"
        output["summarized_by"] = "samsung_chat"
        output["summary_format"] = "lead_and_bullets"
        output["chat_model_id"] = MODEL_ID
    except Exception as error:
        output["chat_summary_status"] = "failed"
        output["chat_summary_error"] = str(error)[:500]
    return output
