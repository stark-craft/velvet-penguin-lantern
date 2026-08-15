"""Aggregate privacy-safe For You quality metrics across viewer stores."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from core.storage import JsonStore


def aggregate_quality_metrics(viewers_root: Path) -> dict[str, Any]:
    actions: Counter[str] = Counter()
    configured = paused = viewers = 0
    for path in Path(viewers_root).glob("*.json"):
        state = JsonStore(path, dict).read()
        if not isinstance(state, dict):
            continue
        viewers += 1
        preferences = state.get("preferences") if isinstance(state.get("preferences"), dict) else {}
        configured += bool(preferences.get("completed_at"))
        paused += bool(state.get("personalization_paused"))
        for event in state.get("events") if isinstance(state.get("events"), list) else []:
            actions[str(event.get("action") or "unknown")] += 1
    impressions = actions["qualified_impression"]
    dossier_opens = actions["dossier_open"]
    source_opens = actions["source_open"]
    useful = actions["save"] + actions["select"] + actions["interested"]
    negative = actions["hide"] + actions["less_like_this"] + actions["not_interested"]
    def rate(value: int, total: int) -> float:
        return round(value / total, 4) if total else 0.0
    return {
        "viewers": viewers,
        "configured_viewers": configured,
        "paused_viewers": paused,
        "events": dict(actions),
        "quality": {
            "impression_to_dossier_open": rate(dossier_opens, impressions),
            "impression_to_source_open": rate(source_opens, impressions),
            "impression_to_useful_action": rate(useful, impressions),
            "negative_feedback_rate": rate(negative, impressions),
        },
        "privacy": "aggregate_only",
    }
