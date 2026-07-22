"""Samsung Chat final-summary adapter using the legacy request contract."""

from __future__ import annotations

import json
import os
import re

import requests

from secure_http import tls_verify


URL = os.environ.get(
    "SAMSUNG_CHAT_URL",
    "https://genai-openapi.sec.samsung.net/swahq/trial/api-chat/openapi/chat/v1/messages",
).strip()
CLIENT = os.environ.get("SAMSUNG_CHAT_CLIENT", "").strip()
TOKEN = os.environ.get("SAMSUNG_CHAT_TOKEN", "").strip()
MODEL_ID = os.environ.get("SAMSUNG_CHAT_MODEL_ID", "").strip()
TIMEOUT = int(os.environ.get("SAMSUNG_CHAT_TIMEOUT", "180"))


def clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


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


def call_samsung_chat(prompt: str) -> dict:
    if not CLIENT:
        raise RuntimeError("Missing SAMSUNG_CHAT_CLIENT")
    if not TOKEN:
        raise RuntimeError("Missing SAMSUNG_CHAT_TOKEN")
    if not MODEL_ID:
        raise RuntimeError("Missing SAMSUNG_CHAT_MODEL_ID")
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
                "top_k": 14,
                "top_p": 0.94,
                "temperature": 0.2,
                "repetition_penalty": 1.04,
            },
            "systemPrompt": "You are an executive technology intelligence summarizer. Return strict valid JSON only.",
        },
        timeout=TIMEOUT,
        verify=tls_verify("SAMSUNG_CHAT"),
    )
    response.raise_for_status()
    data = response.json()
    if data.get("status") and data.get("status") != "SUCCESS":
        raise RuntimeError(f"Samsung Chat status failed: {data.get('status')}")
    return data


def summarize_article_with_chat(item):
    output = dict(item or {})
    content = clean(
        output.get("full_contents")
        or output.get("summary_input")
        or output.get("master_summary")
        or output.get("snippet")
    )
    prompt = f"""Summarize this technology news article for an executive intelligence dashboard.
Return JSON only with keys: title, summary, ppt_summary, why_it_matters, category, region, importance_score.
Do not invent facts. Region must be Global or Local. importance_score must be 1-10.

Title: {clean(output.get('title'))}
Source: {clean(output.get('source'))}
Date: {clean(output.get('date'))}
Link: {clean(output.get('link'))}
Article: {content[:12000]}"""
    try:
        data = call_samsung_chat(prompt)
        parsed = extract_json(data.get("content", ""))
        summary = clean(parsed.get("summary"))
        if summary:
            output["summary"] = summary
            output["master_summary"] = summary
        output["title"] = clean(parsed.get("title")) or output.get("title", "")
        output["ppt_summary"] = clean(parsed.get("ppt_summary")) or summary
        output["why_it_matters"] = clean(parsed.get("why_it_matters"))
        output["category"] = clean(parsed.get("category")) or output.get("category", "Tech News")
        output["region"] = "Local" if clean(parsed.get("region")).lower() == "local" else "Global"
        try:
            score = float(parsed.get("importance_score", output.get("importance_score", 50)))
            output["importance_score"] = max(1, min(100, round(score * 10 if score <= 10 else score)))
        except (TypeError, ValueError):
            pass
        output["chat_summary_status"] = "success"
        output["summarized_by"] = "samsung_chat"
        output["chat_model_id"] = MODEL_ID
    except Exception as error:
        output["chat_summary_status"] = "failed"
        output["chat_summary_error"] = str(error)[:500]
    return output
