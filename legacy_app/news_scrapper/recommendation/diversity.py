"""Greedy post-ranking diversity with deterministic constraints."""

from __future__ import annotations

from collections import Counter
from typing import Any


def diversify(items: list[dict[str, Any]], *, exploration_percent: int = 15) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    deferred: list[dict[str, Any]] = []
    publisher_counts: Counter = Counter()
    topic_counts: Counter = Counter()
    clusters: set[str] = set()
    exploration_target = max(1, round(10 * max(0, min(50, exploration_percent)) / 100))

    priority_items = [
        item for item in items
        if "institutional_priority" in (item.get("recommendation") or {}).get("reason_codes", [])
    ][:2]
    for item in priority_items:
        recommendation = item.get("recommendation") or {}
        publisher = str(item.get("source") or item.get("src") or "unknown").casefold()
        topic = str((recommendation.get("topics") or ["general"])[0])
        cluster = str(item.get("cluster_id") or item.get("article_id") or "")
        if cluster in clusters:
            continue
        selected.append(item)
        clusters.add(cluster)
        publisher_counts[publisher] += 1
        topic_counts[topic] += 1

    for item in items:
        if item in selected:
            continue
        recommendation = item.get("recommendation") or {}
        publisher = str(item.get("source") or item.get("src") or "unknown").casefold()
        topics = recommendation.get("topics") or ["general"]
        topic = str(topics[0])
        cluster = str(item.get("cluster_id") or item.get("article_id") or "")
        first_ten = len(selected) < 10
        exploration_count = sum(bool((entry.get("recommendation") or {}).get("exploration")) for entry in selected[:10])
        violates = (
            cluster in clusters
            or (first_ten and publisher_counts[publisher] >= 2)
            or (first_ten and topic_counts[topic] >= 3)
            or (
                first_ten
                and recommendation.get("exploration")
                and exploration_count >= exploration_target
            )
        )
        if violates:
            deferred.append(item)
            continue
        selected.append(item)
        clusters.add(cluster)
        publisher_counts[publisher] += 1
        topic_counts[topic] += 1

    selected.extend(deferred)
    for position, item in enumerate(selected):
        recommendation = item.setdefault("recommendation", {})
        recommendation["position"] = position
        # ``exploration`` describes the candidate; ``exploration_slot`` marks
        # the deliberately injected surprise readers actually encounter near
        # the top of this feed. Keeping the two separate prevents analytics and
        # UI counters from claiming that every unfamiliar article is a curated
        # exploration pick.
        recommendation["exploration_slot"] = bool(
            position < 10 and recommendation.get("exploration")
        )
    return selected
