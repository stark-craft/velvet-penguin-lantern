"""Deterministic, explainable V1 recommendation scoring."""

from __future__ import annotations

import datetime as dt
import re
from collections import Counter
from typing import Any

from .candidates import article_id


WEIGHTS = {
    "editorial": 0.38,
    "freshness": 0.14,
    "confidence": 0.10,
    "explicit": 0.16,
    "behavior": 0.08,
    "source_family": 0.05,
    "saved_story": 0.06,
    "novelty": 0.03,
    "negative": 0.18,
    "seen": 0.10,
}

TOPIC_TERMS = {
    "ai_models": {"ai", "artificial intelligence", "model", "agent", "llm", "chatgpt", "claude", "gemini", "openai", "anthropic"},
    "devices_displays": {"device", "display", "oled", "qned", "television", "tv", "smart home", "mobile"},
    "semiconductors": {"semiconductor", "chip", "gpu", "tpu", "processor", "compute", "nvidia"},
    "robotics": {"robot", "robotics", "automation", "optimus"},
    "cloud_security": {"cloud", "enterprise", "security", "cyber", "data center"},
    "policy_markets": {"policy", "regulation", "market", "trai", "mib", "government"},
    "broadcast": {"broadcast", "dth", "cable", "iptv", "ott", "dvb", "connected tv", "streaming"},
    "samsung_competitors": {"samsung", "lg", "sony", "tcl", "apple", "google", "competitor"},
}
OUTCOME_TERMS = {
    "product_launches": {"launch", "release", "announced", "availability"},
    "competitive_moves": {"competitor", "strategy", "rival", "market share"},
    "regulation": {"regulation", "policy", "law", "ban", "compliance"},
    "research": {"research", "study", "paper", "breakthrough"},
    "partnerships_investment": {"partnership", "investment", "funding", "acquisition"},
    "market_shifts": {"market", "sales", "demand", "growth", "decline"},
    "risks_incidents": {"risk", "incident", "breach", "vulnerability", "recall"},
    "saved_followups": {"update", "follow-up", "continues", "expands"},
}


def _text(article: dict[str, Any]) -> str:
    values = [
        article.get("title"), article.get("category"), article.get("article_intent"),
        article.get("summary_lead"), article.get("summary"), article.get("why_it_matters"),
        article.get("vertical"),
        " ".join(str(value) for value in (article.get("verticals") or [])),
        " ".join(str(value) for value in (article.get("keywords_found") or article.get("keywords") or [])),
    ]
    return re.sub(r"\s+", " ", " ".join(str(value or "") for value in values)).casefold()


def article_topics(article: dict[str, Any]) -> list[str]:
    text = _text(article)
    return [topic for topic, terms in TOPIC_TERMS.items() if any(term in text for term in terms)] or ["general"]


def article_outcomes(article: dict[str, Any]) -> list[str]:
    text = _text(article)
    return [outcome for outcome, terms in OUTCOME_TERMS.items() if any(term in text for term in terms)]


def source_family(article: dict[str, Any]) -> str:
    explicit = str(article.get("source_family") or "").strip()
    if explicit:
        return explicit
    source = str(article.get("source") or article.get("src") or "").casefold()
    category = str(article.get("category") or "").casefold()
    if any(term in source for term in ("gov", "ministry", "trai", "meity")):
        return "public_sector"
    if any(term in source for term in ("research", "ieee", "arxiv", "nature")):
        return "research"
    if "broadcast" in category or "media" in category:
        return "industry_trade"
    if any(term in source for term in ("financial", "business", "economictimes", "moneycontrol")):
        return "business_press"
    return "tech_press"


def _score100(article: dict[str, Any]) -> float:
    value = article.get("signal_score") or article.get("importance_score") or article.get("importance") or article.get("confidence") or article.get("conf") or 50
    try:
        score = float(value)
    except (TypeError, ValueError):
        score = 50.0
    if 0 <= score <= 1:
        score *= 100
    return max(0.0, min(100.0, score)) / 100.0


def _freshness(article: dict[str, Any], now: dt.datetime) -> float:
    text = str(article.get("date") or article.get("published") or "").strip().replace("Z", "+00:00")
    try:
        value = dt.datetime.fromisoformat(text)
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt.timezone.utc)
        age = max(0.0, (now - value.astimezone(dt.timezone.utc)).total_seconds() / 86400)
        return max(0.0, 1.0 - age / 30.0)
    except ValueError:
        return 1.0 if article.get("is_fresh") else 0.45


def _event_affinities(events: list[dict[str, Any]]) -> tuple[Counter, Counter, int, int]:
    positive: Counter = Counter()
    negative: Counter = Counter()
    meaningful = 0
    sessions: set[str] = set()
    positive_weights = {
        "dossier_open": 0.5,
        "why_this_story_open": 0.75,
        "source_open": 1.5,
        "save": 4.0,
        "select": 3.0,
        "approve": 4.0,
        "interested": 4.0,
    }
    negative_weights = {
        "hide": 3.0,
        "less_like_this": 4.0,
        "not_interested": 5.0,
    }
    for event in events:
        action = str(event.get("action") or "")
        weight = positive_weights.get(action, negative_weights.get(action, 0.0))
        if action == "dossier_dwell":
            active_ms = max(0, int(event.get("active_ms") or 0))
            if active_ms >= 45_000:
                weight = 2.5
            elif active_ms >= 15_000:
                weight = 1.5
            elif active_ms >= 5_000:
                weight = 0.5
            else:
                weight = 0.0
        occurred = str(event.get("occurred_at") or "")[:10]
        if weight > 0:
            meaningful += 1
            if occurred:
                sessions.add(occurred)
        detail = event.get("detail") if isinstance(event.get("detail"), dict) else {}
        topics = detail.get("topics") if isinstance(detail.get("topics"), list) else []
        target = (
            positive
            if action in positive_weights or action == "dossier_dwell"
            else negative
            if action in negative_weights
            else None
        )
        if target is not None:
            for topic in topics:
                target[str(topic)] += weight
    return positive, negative, meaningful, len(sessions)


def score_candidates(
    articles: list[dict[str, Any]],
    state: dict[str, Any],
    saved_items: list[dict[str, Any]],
    *,
    now: dt.datetime | None = None,
    semantic_affinity_enabled: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    now = now or dt.datetime.now(dt.timezone.utc)
    preferences = state.get("preferences") if isinstance(state.get("preferences"), dict) else {}
    paused = bool(state.get("personalization_paused"))
    chosen_topics = set(preferences.get("topics") or []) if not paused else set()
    chosen_outcomes = set(preferences.get("outcomes") or []) if not paused else set()
    chosen_families = set(preferences.get("source_families") or []) if not paused else set()
    events = state.get("events") if isinstance(state.get("events"), list) and not paused else []
    positive, negative, meaningful, session_count = _event_affinities(events)
    behavior_confidence = min(1.0, meaningful / 20.0)
    served = state.get("served") if isinstance(state.get("served"), dict) else {}
    saved_topics = Counter(topic for item in saved_items for topic in article_topics(item))
    ranked = []
    for original_index, article in enumerate(articles):
        item = dict(article)
        topics = article_topics(item)
        outcomes = article_outcomes(item)
        family = source_family(item)
        explicit_matches = len(set(topics) & chosen_topics) + len(set(outcomes) & chosen_outcomes)
        explicit_total = max(1, len(chosen_topics) + len(chosen_outcomes))
        explicit = min(1.0, explicit_matches / min(3, explicit_total))
        behavior = min(1.0, sum(positive[topic] for topic in topics) / 5.0) * behavior_confidence
        negative_affinity = min(1.0, sum(negative[topic] for topic in topics) / 3.0)
        if semantic_affinity_enabled and events:
            from .semantic import semantic_affinity
            semantic_positive, semantic_negative = semantic_affinity(_text(item), events)
            behavior = (0.7 * behavior + 0.3 * semantic_positive * behavior_confidence)
            negative_affinity = max(negative_affinity, semantic_negative)
        saved_affinity = min(1.0, sum(saved_topics[topic] for topic in topics) / 2.0)
        family_match = 1.0 if family in chosen_families else 0.0
        coverage = min(1.0, max(1.0, float(item.get("source_count") or 1)) / 4.0)
        seen = 1.0 if article_id(item) in served else 0.0
        # Behavioral affinity should lift a newly learned lane immediately;
        # do not remove the full exploration credit after a single valid
        # interaction. The novelty component fades gradually as confidence in
        # that learned lane grows.
        novelty = 0.25 if explicit_matches else max(0.25, 1.0 - behavior)
        editorial = _score100(item)
        score = (
            WEIGHTS["editorial"] * editorial
            + WEIGHTS["freshness"] * _freshness(item, now)
            + WEIGHTS["confidence"] * coverage
            + WEIGHTS["explicit"] * explicit
            + WEIGHTS["behavior"] * behavior
            + WEIGHTS["source_family"] * family_match
            + WEIGHTS["saved_story"] * saved_affinity
            + WEIGHTS["novelty"] * novelty
            - WEIGHTS["negative"] * negative_affinity
            - WEIGHTS["seen"] * seen
        )
        reasons = []
        codes = []
        if editorial >= 0.75 or item.get("institutional_priority"):
            codes.append("institutional_priority")
        matched_topics = list(set(topics) & chosen_topics)
        if matched_topics:
            codes.append("explicit_topic")
            reasons.append(f"Matches your {matched_topics[0].replace('_', ' ')} preference")
        if saved_affinity:
            codes.append("saved_follow_up")
            reasons.append("Related to a story you saved")
        if item.get("is_fresh") or _freshness(item, now) > 0.9:
            codes.append("fresh")
            reasons.append("New since your recent visit")
        if coverage >= 0.5:
            codes.append("multi_source")
            reasons.append(f"Supported by {int(item.get('source_count') or 1)} sources")
        if "institutional_priority" in codes:
            reasons.append("High-priority shared Briefing signal")
        exploration = not codes or (novelty == 1.0 and bool(preferences.get("surprise_me", True)))
        if exploration:
            codes.append("exploration")
            reasons.append("Important outside your usual lane")
        item["recommendation"] = {
            "score": round(score, 6),
            "raw_score": round(score, 6),
            "reason_codes": codes,
            "reasons": reasons[:3],
            "starter_mix": not bool(preferences.get("completed_at")),
            "exploration": exploration,
            "seen_before": bool(seen),
            "topics": topics,
            "outcomes": outcomes,
            "source_family": family,
            "original_index": original_index,
        }
        ranked.append(item)
    ranked.sort(key=lambda item: (-item["recommendation"]["score"], item["recommendation"]["original_index"]))
    return ranked, {
        "meaningful_events": meaningful,
        "session_count": session_count,
        "behavior_confidence": round(behavior_confidence, 3),
        "paused": paused,
        "semantic_affinity_enabled": bool(semantic_affinity_enabled),
    }
