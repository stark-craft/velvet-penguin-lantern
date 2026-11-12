"""Grounded attention-hook validation and deterministic local fallback."""

from __future__ import annotations

import re
from typing import Any


BANNED_PHRASES = (
    "you won't believe",
    "shocking",
    "game-changing",
    "must read",
    "breaking the internet",
)
HOOK_TYPES = {"change", "risk", "opportunity", "follow_up", "disagreement", "watch"}


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def evidence_text(article: dict[str, Any]) -> str:
    values = [
        article.get("title"),
        article.get("summary_lead"),
        article.get("master_summary"),
        article.get("summary"),
        article.get("full_contents"),
        article.get("snippet"),
        article.get("why_it_matters"),
    ]
    return clean(" ".join(str(value or "") for value in values)).casefold()


def validate_hook(value: Any, article: dict[str, Any]) -> str:
    hook = clean(value)
    if not hook:
        return ""
    words = hook.split()
    lowered = hook.casefold()
    if len(words) < 18 or len(words) > 35:
        return ""
    if any(phrase in lowered for phrase in BANNED_PHRASES):
        return ""
    title = clean(article.get("title")).casefold()
    if title and lowered == title:
        return ""
    evidence = evidence_text(article)
    for token in re.findall(r"\b\d[\d,.%/-]*\b", hook):
        if token.casefold() not in evidence:
            return ""
    for entity in re.findall(r"\b[A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+)*", hook):
        if entity.casefold() in {"what", "what changed"}:
            continue
        if entity.casefold() not in evidence:
            return ""
    return hook


def first_sentence(value: Any) -> str:
    text = clean(value)
    if not text:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", text)
    return clean(parts[0])


def grounded_excerpt(value: Any, minimum_words: int = 16, maximum_words: int = 33) -> str:
    """Return whole factual sentences where possible, without inventing context."""

    text = clean(value)
    if not text:
        return ""
    chosen: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if sentence:
            chosen.append(sentence)
        if len(clean(" ".join(chosen)).split()) >= minimum_words:
            break
    words = clean(" ".join(chosen)).split()
    if len(words) < minimum_words:
        words = text.split()
    if len(words) < minimum_words:
        return ""
    excerpt = " ".join(words[:maximum_words]).rstrip(" ,;:")
    if len(words) > maximum_words:
        excerpt += "…"
    return excerpt


def ensure_article_hooks(article: dict[str, Any]) -> dict[str, Any]:
    output = dict(article or {})
    existing = validate_hook(output.get("attention_hook"), output)
    if existing:
        output["attention_hook"] = existing
        output["hook_type"] = output.get("hook_type") if output.get("hook_type") in HOOK_TYPES else "change"
        output["hook_source"] = output.get("hook_source") or "samsung_chat"
        output["hook_grounded"] = True
        return output

    fallback = grounded_excerpt(output.get("why_it_matters") or output.get("why_matters"))
    if not fallback:
        fallback = grounded_excerpt(
            output.get("summary_lead")
            or output.get("summary")
            or output.get("master_summary")
        )
    if fallback:
        candidate = f"What changed: {fallback}"
        words = candidate.split()
        if len(words) > 35:
            candidate = " ".join(words[:35]).rstrip(" ,;:") + "…"
        candidate = validate_hook(candidate, output)
        output["attention_hook"] = candidate
        output["what_changed"] = clean(output.get("what_changed")) or fallback
        output["hook_type"] = "change"
        output["hook_source"] = "local_fallback"
        output["hook_grounded"] = bool(candidate)
    else:
        output["attention_hook"] = ""
        output["hook_grounded"] = False
    output["why_now"] = clean(output.get("why_now"))
    output["watch_next"] = clean(output.get("watch_next"))
    return output
