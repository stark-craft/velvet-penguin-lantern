"""Private, explainable feed personalization for the JSON-first pilot.

The shared briefing remains the source of editorial truth.  This module only
calculates a viewer/profile-specific order and annotations at read time.  It
never removes an article, changes profile routing, or trains the shared
Bouncer model.
"""

from __future__ import annotations

import datetime as dt
import math
import re
from pathlib import Path
from typing import Any, Iterable

from core.storage import JsonStore


PERSONALIZATION_WINDOW_DAYS = 30
MAX_EVENTS_PER_PROFILE = 1200

ACTION_WEIGHTS = {
    "article_click": 1.25,
    "dossier_open": 2.0,
    "personal_briefing_open": 2.5,
    "vote_interested": 5.0,
    "vote_not_interested": -6.0,
    "save_for_later": 6.0,
    "save_for_later_remove": -0.75,
    "select": 4.0,
    "archive_import": 4.0,
    "hide_personal": -4.0,
}

_STOPWORDS = {
    "about", "after", "again", "against", "also", "among", "and", "are",
    "because", "been", "before", "being", "between", "but", "can", "could",
    "from", "had", "has", "have", "into", "its", "latest", "more", "most",
    "new", "news", "not", "now", "over", "said", "says", "that", "the",
    "their", "then", "there", "these", "they", "this", "through", "today",
    "under", "very", "was", "were", "what", "when", "where", "which", "who",
    "will", "with", "would", "your",
}


def _utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _parse_datetime(value: Any) -> dt.datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    for candidate in (normalized, normalized.replace(" ", "T", 1)):
        try:
            parsed = dt.datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.astimezone(dt.timezone.utc)
        except ValueError:
            continue
    for pattern in ("%Y-%m-%d", "%d %b %Y", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(text[:11].strip(), pattern).replace(
                tzinfo=dt.timezone.utc
            )
        except ValueError:
            continue
    return None


def _clean_label(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().casefold())[:120]


def _values(value: Any) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        result: list[str] = []
        for item in value:
            if isinstance(item, dict):
                label = item.get("name") or item.get("title") or item.get("value")
            else:
                label = item
            cleaned = _clean_label(label)
            if cleaned:
                result.append(cleaned)
        return result
    if isinstance(value, str):
        return [
            cleaned
            for cleaned in (_clean_label(item) for item in re.split(r"[,;|]", value))
            if cleaned
        ]
    return []


def _title_terms(value: Any, limit: int = 14) -> list[str]:
    words = re.findall(r"[a-z0-9][a-z0-9+#.-]{2,}", _clean_label(value))
    result: list[str] = []
    for word in words:
        normalized = word.strip(".-")
        if normalized in _STOPWORDS or normalized.isdigit() or normalized in result:
            continue
        result.append(normalized)
        if len(result) >= limit:
            break
    return result


def extract_features(article: dict[str, Any] | None) -> set[str]:
    """Extract bounded, human-auditable features from an article-like payload."""

    if not isinstance(article, dict):
        return set()
    features: set[str] = set()
    for key in ("keywords", "keywords_found", "matched_keywords", "matched_terms"):
        features.update(f"keyword:{value}" for value in _values(article.get(key)))
    for key, prefix in (
        ("category", "category"),
        ("region", "region"),
        ("source", "source"),
        ("src", "source"),
        ("publisher", "source"),
        ("article_intent", "intent"),
        ("intent", "intent"),
        ("cluster_id", "cluster"),
    ):
        value = _clean_label(article.get(key))
        if value:
            features.add(f"{prefix}:{value}")
    for key in ("entities", "named_entities", "people", "companies", "topics"):
        features.update(f"entity:{value}" for value in _values(article.get(key)))
    title = article.get("title") or article.get("dossier_title")
    features.update(f"term:{term}" for term in _title_terms(title))
    return features


def _feature_factor(feature: str) -> float:
    prefix = feature.split(":", 1)[0]
    return {
        "cluster": 1.8,
        "keyword": 1.25,
        "entity": 1.15,
        "intent": 0.85,
        "category": 0.8,
        "source": 0.45,
        "term": 0.32,
        "region": 0.12,
    }.get(prefix, 0.25)


def _article_identity(article: dict[str, Any]) -> str:
    return _clean_label(
        article.get("article_key")
        or article.get("canonical_link")
        or article.get("link")
        or article.get("url")
        or article.get("title")
    )


def _saved_match_score(article: dict[str, Any], saved: dict[str, Any]) -> float:
    article_features = extract_features(article)
    saved_features = extract_features(saved)
    if not article_features or not saved_features:
        return 0.0
    shared = article_features & saved_features
    score = 0.0
    for feature in shared:
        prefix = feature.split(":", 1)[0]
        score += {
            "cluster": 20.0,
            "keyword": 8.0,
            "entity": 7.0,
            "term": 1.8,
            "intent": 2.0,
            "category": 1.0,
            "source": 0.5,
            "region": 0.0,
        }.get(prefix, 0.0)
    # A single generic title word is not enough to call a story related.
    shared_terms = sum(feature.startswith("term:") for feature in shared)
    if shared_terms < 2 and not any(
        feature.startswith(("keyword:", "entity:", "cluster:"))
        for feature in shared
    ):
        return 0.0
    return score


class PersonalizationService:
    """Persist private behavioral signals and rank one response at a time."""

    def __init__(
        self,
        path: Path,
        *,
        window_days: int = PERSONALIZATION_WINDOW_DAYS,
        max_events: int = MAX_EVENTS_PER_PROFILE,
    ):
        self.store = JsonStore(Path(path), dict)
        self.window_days = max(1, int(window_days))
        self.max_events = max(100, int(max_events))

    def _active_events(
        self,
        viewer_key: str,
        profile: str,
        *,
        now: dt.datetime | None = None,
    ) -> list[dict[str, Any]]:
        now = now or _utcnow()
        cutoff = now - dt.timedelta(days=self.window_days)
        data = self.store.read()
        events = (
            data.get(str(viewer_key), {})
            .get(str(profile), {})
            .get("events", [])
        )
        result = []
        for event in events if isinstance(events, list) else []:
            recorded = _parse_datetime(event.get("at"))
            if recorded and recorded >= cutoff:
                result.append(event)
        return result

    def record_event(
        self,
        viewer_key: str,
        profile: str,
        action: str,
        detail: dict[str, Any] | None,
        *,
        now: dt.datetime | None = None,
    ) -> bool:
        weight = ACTION_WEIGHTS.get(str(action))
        features = sorted(extract_features(detail))
        if weight is None or not viewer_key or not features:
            return False
        now = now or _utcnow()
        cutoff = now - dt.timedelta(days=self.window_days)
        event = {
            "at": now.isoformat(timespec="seconds"),
            "action": action,
            "weight": weight,
            "features": features,
        }

        def updater(data: dict[str, Any]) -> dict[str, Any]:
            viewer = data.setdefault(str(viewer_key), {})
            profile_data = viewer.setdefault(str(profile), {})
            current = profile_data.setdefault("events", [])
            retained = []
            for existing in current if isinstance(current, list) else []:
                recorded = _parse_datetime(existing.get("at"))
                if recorded and recorded >= cutoff:
                    retained.append(existing)
            retained.append(event)
            profile_data["events"] = retained[-self.max_events :]
            profile_data["updated_at"] = event["at"]
            profile_data["window_days"] = self.window_days
            return data

        self.store.update(updater)
        return True

    def preference_weights(
        self,
        viewer_key: str,
        profile: str,
        *,
        now: dt.datetime | None = None,
    ) -> tuple[dict[str, float], int]:
        now = now or _utcnow()
        events = self._active_events(viewer_key, profile, now=now)
        weights: dict[str, float] = {}
        for event in events:
            recorded = _parse_datetime(event.get("at")) or now
            age_days = max(0.0, (now - recorded).total_seconds() / 86400.0)
            decay = max(0.0, 1.0 - age_days / self.window_days)
            features = event.get("features", [])
            normalizer = max(1.0, math.sqrt(len(features)))
            event_weight = float(event.get("weight", 0.0)) * decay / normalizer
            for feature in features:
                weights[feature] = weights.get(feature, 0.0) + event_weight
        return weights, len(events)

    def rank_articles(
        self,
        articles: Iterable[dict[str, Any]],
        viewer_key: str,
        profile: str,
        saved_items: Iterable[dict[str, Any]] = (),
        *,
        now: dt.datetime | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        now = now or _utcnow()
        source = [dict(item) for item in articles if isinstance(item, dict)]
        weights, event_count = self.preference_weights(viewer_key, profile, now=now)
        cutoff = now - dt.timedelta(days=self.window_days)
        active_saved: list[dict[str, Any]] = []
        for saved in saved_items:
            if not isinstance(saved, dict):
                continue
            saved_at = _parse_datetime(saved.get("saved_at"))
            if saved_at is None or saved_at >= cutoff:
                active_saved.append(saved)

        ranked: list[tuple[float, int, dict[str, Any]]] = []
        follow_count = 0
        for index, article in enumerate(source):
            features = extract_features(article)
            raw_affinity = sum(
                weights.get(feature, 0.0) * _feature_factor(feature)
                for feature in features
            ) / max(1.0, math.sqrt(len(features)))
            affinity = max(-18.0, min(18.0, raw_affinity * 5.0))

            best_saved = None
            best_match = 0.0
            identity = _article_identity(article)
            for saved in active_saved:
                if identity and identity == _article_identity(saved):
                    continue
                match_score = _saved_match_score(article, saved)
                if match_score > best_match:
                    best_match = match_score
                    best_saved = saved
            follows_saved_story = best_match >= 8.0
            if follows_saved_story:
                follow_count += 1

            reasons: list[str] = []
            if follows_saved_story:
                reasons.append("Update to a story you saved")
            matching_positive = [
                feature for feature in features if weights.get(feature, 0.0) > 0.12
            ]
            matching_positive.sort(key=lambda feature: weights[feature], reverse=True)
            for feature in matching_positive[:2]:
                label = feature.split(":", 1)[1]
                reasons.append(f"Matches your interest in {label}")

            editorial_score = float(
                article.get("signal_score")
                or article.get("score")
                or article.get("importance_score")
                or article.get("importance")
                or article.get("confidence")
                or article.get("conf")
                or 50.0
            )
            if 0.0 <= editorial_score <= 1.0:
                editorial_score *= 100.0
            editorial_score = max(0.0, min(100.0, editorial_score))
            coverage = min(5.0, float(article.get("source_count") or 1.0))
            base = editorial_score * 0.65 + coverage * 3.0
            if article.get("is_fresh"):
                base += 4.0
            follow_boost = min(30.0, best_match * 2.0) if follows_saved_story else 0.0
            final_score = base + affinity + follow_boost
            article["personal_rank_score"] = round(final_score, 4)
            article["personalization"] = {
                "applied": bool(event_count or active_saved),
                "affinity_score": round(affinity, 4),
                "reasons": reasons,
                "follow_up": follows_saved_story,
                "follow_label": (
                    "Update to a story you saved" if follows_saved_story else ""
                ),
                "matched_saved_title": (
                    str(best_saved.get("title") or "") if best_saved else ""
                ),
                "window_days": self.window_days,
            }
            ranked.append((final_score, index, article))

        applied = bool(event_count or active_saved)
        if applied:
            ranked.sort(key=lambda row: (-row[0], row[1]))
        else:
            ranked.sort(key=lambda row: row[1])
        result = [row[2] for row in ranked]
        return result, {
            "applied": applied,
            "event_count": event_count,
            "saved_signal_count": len(active_saved),
            "follow_up_count": follow_count,
            "window_days": self.window_days,
        }

    def summary(self, viewer_key: str, profile: str) -> dict[str, Any]:
        weights, event_count = self.preference_weights(viewer_key, profile)
        top = [
            {"feature": feature, "score": round(score, 3)}
            for feature, score in sorted(
                weights.items(), key=lambda pair: pair[1], reverse=True
            )
            if score > 0 and not feature.startswith("term:")
        ][:10]
        return {
            "active": bool(event_count),
            "event_count": event_count,
            "top_interests": top,
            "window_days": self.window_days,
        }

    def reset(self, viewer_key: str, profile: str) -> int:
        removed = 0

        def updater(data: dict[str, Any]) -> dict[str, Any]:
            nonlocal removed
            viewer = data.get(str(viewer_key), {})
            profile_data = viewer.pop(str(profile), None)
            if isinstance(profile_data, dict):
                removed = len(profile_data.get("events", []))
            if not viewer:
                data.pop(str(viewer_key), None)
            return data

        self.store.update(updater)
        return removed
