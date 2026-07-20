from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Mapping, Tuple


CATEGORY_KEYWORDS = {
    "AI Models": ("llm", "gpt", "gemini", "claude", "foundation model", "openai", "anthropic"),
    "AI Agents": ("agent", "copilot", "ai assistant", "autonomous"),
    "Robotics": ("robot", "robotics", "humanoid", "automation", "drone"),
    "Display Tech": ("oled", "microled", "display", "screen", "monitor", "television", "tv"),
    "Broadcasting": (
        "broadcast",
        "dth",
        "cable tv",
        "iptv",
        "dvb",
        "ott",
        "connected tv",
        "set top box",
        "hbbtv",
        "d2m",
    ),
    "Semiconductors": ("chip", "semiconductor", "gpu", "tpu", "processor", "foundry"),
    "Security": ("security", "privacy", "cybersecurity", "breach", "malware", "encryption"),
    "Partnership": ("partnership", "collaboration", "joint venture", "partnered"),
    "Research": ("research", "study", "paper", "breakthrough", "laboratory"),
    "Regulation": ("regulation", "regulator", "law", "policy", "antitrust", "trai", "mib"),
}


def _article_text(article: Mapping[str, Any]) -> str:
    return " ".join(
        str(article.get(key) or "")
        for key in ("title", "summary", "excerpt", "body_text", "keywords")
    ).casefold()


def assign_category(article: Mapping[str, Any]) -> str:
    text = _article_text(article)
    best = "Technology"
    best_score = 0
    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(len(re.findall(re.escape(keyword), text)) for keyword in keywords)
        if score > best_score:
            best, best_score = category, score
    return best


def route_team(category: str, article: Mapping[str, Any]) -> str:
    if category in {"AI Models", "AI Agents"}:
        return "AI & Cloud"
    if category == "Robotics":
        return "Robotics"
    if category == "Display Tech":
        return "TV & Display"
    if category == "Broadcasting":
        return "Broadcast"
    if category == "Semiconductors":
        return "Hardware"
    return "Intelligence"


def classify_region(article: Mapping[str, Any]) -> Tuple[str, str]:
    text = _article_text(article)
    local_terms = ("india", "indian", "new delhi", "mumbai", "bengaluru", "trai", "mib", "jio")
    for term in local_terms:
        if term in text:
            return "India", f"Matched geographic signal: {term}"
    return "Global", "No local geographic signal detected"


def classify_intent(article: Mapping[str, Any]) -> Tuple[str, float]:
    text = _article_text(article)
    risk = sum(term in text for term in ("risk", "ban", "breach", "lawsuit", "recall", "probe"))
    opportunity = sum(
        term in text for term in ("launch", "growth", "partnership", "investment", "expansion", "adoption")
    )
    if risk > opportunity:
        return "risk", min(0.96, 0.68 + risk * 0.06)
    if opportunity > risk:
        return "opportunity", min(0.96, 0.68 + opportunity * 0.06)
    return "market movement", 0.62


def importance_score(article: Mapping[str, Any], source_count: int = 1) -> int:
    keyword_count = len(article.get("keywords") or [])
    body_length = len(str(article.get("body_text") or ""))
    score = 48 + min(18, keyword_count * 3) + min(18, max(0, source_count - 1) * 6)
    if body_length >= 1500:
        score += 8
    return max(0, min(100, score))


def priority_label(score: int) -> str:
    if score >= 90:
        return "critical"
    if score >= 75:
        return "high"
    if score >= 55:
        return "medium"
    return "low"


def why_it_matters(category: str, source_count: int) -> str:
    consequence = {
        "Broadcasting": "It may reshape distribution reach, rights economics, and regulatory priorities.",
        "AI Models": "It may change model capability, compute demand, and competitive positioning.",
        "AI Agents": "It may move agentic workflows from experimentation into operational use.",
        "Display Tech": "It may influence product roadmaps, supplier choices, and differentiation.",
        "Robotics": "It may alter automation economics, deployment readiness, and safety expectations.",
        "Semiconductors": "It may affect compute supply, product cost, and platform roadmaps.",
        "Regulation": "It may change compliance obligations, market access, or execution risk.",
    }.get(category, "It may change competitive priorities, investment choices, or execution risk.")
    return (
        f"{consequence} The signal is supported by {source_count} "
        f"source{'s' if source_count != 1 else ''}."
    )


def enrich_editorial_fields(article: Dict[str, Any], source_count: int = 1) -> Dict[str, Any]:
    next_article = dict(article)
    category = assign_category(next_article)
    region, region_basis = classify_region(next_article)
    intent, intent_confidence = classify_intent(next_article)
    next_article.update(
        {
            "category": category,
            "team": route_team(category, next_article),
            "region": region,
            "region_basis": region_basis,
            "intent": intent,
            "intent_confidence": round(intent_confidence, 4),
            "importance_score": importance_score(next_article, source_count),
        }
    )
    next_article["priority"] = priority_label(next_article["importance_score"])
    next_article["insight"] = why_it_matters(category, source_count)
    return next_article
