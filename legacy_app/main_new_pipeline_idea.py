"""Opt-in Samsung enrichment pipeline proposal.

This module is intentionally not imported by ``main.py`` and is not connected
to the current scheduler.  It provides a reviewable, separately executable
pipeline for the future architecture:

    RSS/Web discovery
      -> Samsung Web Search extraction (maximum 3 requests/minute)
      -> profile bouncer
      -> missing-image metadata enrichment
      -> local MiniLM semantic clustering
      -> Samsung Chat final summaries (maximum 3 requests/minute)
      -> feed-compatible JSON

The existing crawler, adapters, scheduler, and backend remain untouched.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pickle
import re
import threading
import time
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import urlparse

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_RUNTIME_DIR = ROOT_DIR / "new_pipeline_idea_runtime"
MAX_SAMSUNG_REQUESTS_PER_MINUTE = 3
DEFAULT_CLUSTER_DISTANCE_THRESHOLD = 0.32

# Load credentials before the existing adapter modules are imported. Process
# environment values still win, which keeps Windows launch scripts in control.
load_dotenv(ROOT_DIR / ".env", override=False)

Article = dict[str, Any]
Adapter = Callable[..., Article]
ProgressCallback = Callable[[dict[str, Any]], None]


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def stable_article_key(item: Article) -> str:
    identity = "|".join(
        [
            clean_text(item.get("canonical_link") or item.get("link")).lower(),
            clean_text(item.get("title")).casefold(),
            clean_text(item.get("date")),
        ]
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def utc_timestamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class PipelineSettings:
    """Configuration for the shadow pipeline.

    Samsung rate limits are deliberately capped at three even if an environment
    variable asks for a higher number.
    """

    profile: str = "default"
    web_search_requests_per_minute: int = MAX_SAMSUNG_REQUESTS_PER_MINUTE
    chat_requests_per_minute: int = MAX_SAMSUNG_REQUESTS_PER_MINUTE
    external_call_attempts: int = 3
    retry_backoff_seconds: float = 5.0
    bouncer_low_priority_threshold: float = 0.45
    bouncer_drop_threshold: float = 0.60
    cluster_distance_threshold: float = DEFAULT_CLUSTER_DISTANCE_THRESHOLD
    checkpoint_dir: Path = DEFAULT_RUNTIME_DIR
    keep_adapter_debug_fields: bool = False

    @classmethod
    def from_environment(
        cls,
        *,
        profile: str = "default",
        checkpoint_dir: Path | None = None,
    ) -> "PipelineSettings":
        def capped_rpm(name: str) -> int:
            requested = max(1, int(os.environ.get(name, "3")))
            return min(MAX_SAMSUNG_REQUESTS_PER_MINUTE, requested)

        return cls(
            profile=profile if profile in {"default", "broadcast"} else "default",
            web_search_requests_per_minute=capped_rpm(
                "NEW_PIPELINE_IDEA_WEB_SEARCH_RPM"
            ),
            chat_requests_per_minute=capped_rpm(
                "NEW_PIPELINE_IDEA_CHAT_RPM"
            ),
            external_call_attempts=max(
                1, int(os.environ.get("NEW_PIPELINE_IDEA_MAX_ATTEMPTS", "3"))
            ),
            retry_backoff_seconds=max(
                0.0,
                float(os.environ.get("NEW_PIPELINE_IDEA_RETRY_BACKOFF_SECONDS", "5")),
            ),
            bouncer_low_priority_threshold=float(
                os.environ.get("NEW_PIPELINE_IDEA_BOUNCER_LOW_THRESHOLD", "0.45")
            ),
            bouncer_drop_threshold=float(
                os.environ.get("NEW_PIPELINE_IDEA_BOUNCER_DROP_THRESHOLD", "0.60")
            ),
            cluster_distance_threshold=float(
                os.environ.get("NEW_PIPELINE_IDEA_CLUSTER_DISTANCE", "0.32")
            ),
            checkpoint_dir=checkpoint_dir or DEFAULT_RUNTIME_DIR,
            keep_adapter_debug_fields=env_bool(
                "NEW_PIPELINE_IDEA_KEEP_DEBUG_FIELDS", False
            ),
        )


class PacedRateLimiter:
    """Space calls evenly so a service never receives more than N calls/minute."""

    def __init__(
        self,
        requests_per_minute: int,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.requests_per_minute = min(
            MAX_SAMSUNG_REQUESTS_PER_MINUTE,
            max(1, int(requests_per_minute)),
        )
        self.minimum_interval = 60.0 / self.requests_per_minute
        self._clock = clock
        self._sleep = sleeper
        self._last_call_started: float | None = None
        self._lock = threading.Lock()

    def acquire(self) -> None:
        with self._lock:
            now = self._clock()
            if self._last_call_started is not None:
                wait_for = self.minimum_interval - (now - self._last_call_started)
                if wait_for > 0:
                    self._sleep(wait_for)
                    now = self._clock()
            self._last_call_started = now


class JsonCheckpointStore:
    """Persist successful expensive stages so interrupted runs can resume."""

    def __init__(self, directory: Path) -> None:
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _path(self, stage: str) -> Path:
        safe_stage = re.sub(r"[^a-z0-9_-]+", "_", stage.lower())
        return self.directory / f"{safe_stage}.json"

    def _load_stage(self, stage: str) -> dict[str, Article]:
        path = self._path(stage)
        if not path.exists():
            return {}
        try:
            with path.open("r", encoding="utf-8") as handle:
                value = json.load(handle)
            return value if isinstance(value, dict) else {}
        except (OSError, ValueError):
            return {}

    def get(self, stage: str, key: str) -> Article | None:
        with self._lock:
            value = self._load_stage(stage).get(key)
        return dict(value) if isinstance(value, dict) else None

    def put(self, stage: str, key: str, value: Article) -> None:
        with self._lock:
            data = self._load_stage(stage)
            data[key] = dict(value)
            path = self._path(stage)
            temporary = path.with_suffix(".tmp")
            with temporary.open("w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2, ensure_ascii=False)
            temporary.replace(path)


class ProfileBouncer:
    """Independent reader for the existing profile-specific bouncer artifacts."""

    MODEL_NAMES = {
        "default": "bouncer_model.pkl",
        "broadcast": "bouncer_model_broadcast.pkl",
    }
    NOT_INTERESTED_CLASSES = {
        0,
        "0",
        "not_interested",
        "not_intrested",
        "irrelevant",
        "drop",
        "dislike",
    }

    def __init__(self, settings: PipelineSettings, root_dir: Path = ROOT_DIR) -> None:
        self.settings = settings
        self.root_dir = Path(root_dir)
        self._embedder: Any = None
        self._models: dict[str, Any] = {}
        self._load_attempted = False

    def _load(self) -> None:
        if self._load_attempted:
            return
        self._load_attempted = True
        try:
            from sentence_transformers import SentenceTransformer

            model_dir = self.root_dir / "local_miniLM_model"
            if not model_dir.exists():
                model_dir = self.root_dir / "semantic_model"
            if not model_dir.exists():
                return
            self._embedder = SentenceTransformer(str(model_dir))
            for profile, filename in self.MODEL_NAMES.items():
                path = self.root_dir / filename
                if path.exists():
                    with path.open("rb") as handle:
                        self._models[profile] = pickle.load(handle)
        except Exception:
            self._embedder = None
            self._models = {}

    @staticmethod
    def _summary(item: Article) -> str:
        parts: list[str] = []
        for key in (
            "full_contents",
            "full_content",
            "summary_input",
            "summary",
            "master_summary",
            "snippet",
        ):
            text = clean_text(item.get(key))
            if text and text not in parts:
                parts.append(text)
        return clean_text(" ".join(parts))[:5000]

    def _score(self, item: Article, profile: str) -> float | None:
        self._load()
        model = self._models.get(profile)
        if self._embedder is None or model is None:
            return None
        keywords = item.get("keywords_found", [])
        if isinstance(keywords, list):
            keywords = ", ".join(clean_text(value) for value in keywords)
        text = (
            f"Title: {clean_text(item.get('title'))}\n"
            f"Keywords: {clean_text(keywords)}\n"
            f"Summary: {self._summary(item)}"
        )
        vector = self._embedder.encode([text])
        if hasattr(model, "predict_proba"):
            probabilities = model.predict_proba(vector)[0]
            classes = list(getattr(model, "classes_", []))
            for candidate in self.NOT_INTERESTED_CLASSES:
                if candidate in classes:
                    return float(probabilities[classes.index(candidate)])
            return None
        prediction = model.predict(vector)[0]
        return 1.0 if prediction in self.NOT_INTERESTED_CLASSES else 0.0

    def filter(
        self,
        items: Iterable[Article],
        profile: str,
    ) -> tuple[list[Article], list[Article]]:
        kept: list[Article] = []
        dropped: list[Article] = []
        for source in items:
            item = dict(source)
            score = self._score(item, profile)
            if score is None:
                item.update(
                    {
                        "bouncer_decision": "keep",
                        "bouncer_score": None,
                        "bouncer_reason": f"bouncer_unavailable_{profile}",
                    }
                )
                kept.append(item)
            elif score >= self.settings.bouncer_drop_threshold:
                item.update(
                    {
                        "bouncer_decision": "drop",
                        "bouncer_score": round(score, 4),
                        "bouncer_reason": (
                            f"high_confidence_not_interested_{profile}"
                        ),
                    }
                )
                dropped.append(item)
            else:
                decision = (
                    "low_priority"
                    if score >= self.settings.bouncer_low_priority_threshold
                    else "keep"
                )
                item.update(
                    {
                        "bouncer_decision": decision,
                        "bouncer_score": round(score, 4),
                        "bouncer_reason": (
                            f"{decision}_{profile}"
                        ),
                    }
                )
                kept.append(item)
        return kept, dropped


class MiniLMEventClusterer:
    """Cluster enriched articles without invoking the legacy BART summarizer."""

    def __init__(
        self,
        distance_threshold: float,
        root_dir: Path = ROOT_DIR,
    ) -> None:
        self.distance_threshold = distance_threshold
        self.root_dir = Path(root_dir)
        self._model: Any = None

    def _load_model(self) -> Any:
        if self._model is not None:
            return self._model
        from sentence_transformers import SentenceTransformer

        candidates = [
            self.root_dir / "semantic_model",
            self.root_dir / "local_miniLM_model",
        ]
        model_dir = next((path for path in candidates if path.exists()), None)
        if model_dir is None:
            raise RuntimeError(
                "The shadow pipeline requires semantic_model or "
                "local_miniLM_model. It never downloads a model automatically."
            )
        self._model = SentenceTransformer(str(model_dir))
        return self._model

    @staticmethod
    def _content(item: Article) -> str:
        return clean_text(
            item.get("full_contents")
            or item.get("summary_input")
            or item.get("web_search_content")
            or item.get("summary")
            or item.get("snippet")
        )

    def _cluster_text(self, item: Article) -> str:
        keywords = item.get("keywords_found", [])
        if isinstance(keywords, list):
            keywords = ", ".join(clean_text(value) for value in keywords)
        return clean_text(
            f"Title: {item.get('title', '')} "
            f"Keywords: {keywords} "
            f"Content: {self._content(item)[:3500]}"
        )

    @staticmethod
    def _source_identity(item: Article) -> str:
        source = clean_text(item.get("source")).casefold()
        if source and source != "unknown":
            return source
        hostname = urlparse(clean_text(item.get("link"))).hostname or ""
        return hostname.lower().removeprefix("www.") or stable_article_key(item)

    def _enforce_source_diversity(
        self,
        groups: list[list[int]],
        items: list[Article],
        embeddings: Any,
    ) -> list[list[int]]:
        import numpy as np

        output: list[list[int]] = []
        for group in groups:
            partitions: list[dict[str, Any]] = []
            for index in group:
                identity = self._source_identity(items[index])
                eligible = [
                    part for part in partitions if identity not in part["sources"]
                ]
                if eligible:
                    chosen = max(
                        eligible,
                        key=lambda part: float(
                            np.mean(
                                [
                                    np.dot(embeddings[index], embeddings[member])
                                    for member in part["members"]
                                ]
                            )
                        ),
                    )
                else:
                    chosen = {"members": [], "sources": set()}
                    partitions.append(chosen)
                chosen["members"].append(index)
                chosen["sources"].add(identity)
            output.extend(part["members"] for part in partitions)
        return output

    @staticmethod
    def _merge_cluster(cluster: list[Article]) -> Article:
        primary = next(
            (
                item
                for item in cluster
                if clean_text(item.get("top_image") or item.get("image"))
            ),
            cluster[0],
        )
        sources: list[dict[str, str]] = []
        source_keys: set[tuple[str, str]] = set()
        keywords: list[str] = []
        seen_keywords: set[str] = set()
        contents: list[str] = []
        for item in cluster:
            link = clean_text(item.get("canonical_link") or item.get("link"))
            name = clean_text(item.get("source")) or "Unknown"
            key = (name.casefold(), link.lower())
            if key not in source_keys:
                source_keys.add(key)
                sources.append(
                    {
                        "name": name,
                        "link": link or "#",
                        "date": clean_text(item.get("date")),
                    }
                )
            for keyword in item.get("keywords_found", []) or []:
                text = clean_text(keyword)
                if text and text.casefold() not in seen_keywords:
                    seen_keywords.add(text.casefold())
                    keywords.append(text)
            content = MiniLMEventClusterer._content(item)
            if content and content not in contents:
                contents.append(content)

        combined = clean_text(" ".join(contents))[:60000]
        fallback_summary = combined[:1500]
        return {
            **dict(primary),
            "title": clean_text(primary.get("title")) or "Untitled",
            "link": clean_text(
                primary.get("canonical_link") or primary.get("link")
            )
            or "#",
            "top_image": clean_text(
                primary.get("top_image") or primary.get("image")
            ),
            "sources": sources,
            "source_count": len(sources),
            "keywords_found": keywords,
            "full_contents": combined,
            "summary_input": combined,
            "summary": fallback_summary,
            "master_summary": fallback_summary,
            "ppt_summary": fallback_summary[:900],
            "pipeline_stage": "clustered_waiting_for_samsung_chat",
            "cluster_member_count": len(cluster),
        }

    def cluster(self, items: Iterable[Article]) -> list[Article]:
        source_items = [dict(item) for item in items]
        if len(source_items) < 2:
            return [
                self._merge_cluster([item])
                for item in source_items
            ]

        import numpy as np
        from sklearn.cluster import AgglomerativeClustering

        model = self._load_model()
        embeddings = np.asarray(
            model.encode(
                [self._cluster_text(item) for item in source_items],
                show_progress_bar=False,
            )
        )
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / np.maximum(norms, 1e-12)
        try:
            clusterer = AgglomerativeClustering(
                n_clusters=None,
                metric="cosine",
                linkage="average",
                distance_threshold=self.distance_threshold,
            )
        except TypeError:
            clusterer = AgglomerativeClustering(
                n_clusters=None,
                affinity="cosine",
                linkage="average",
                distance_threshold=self.distance_threshold,
            )
        labels = clusterer.fit_predict(embeddings)
        grouped: dict[int, list[int]] = defaultdict(list)
        for index, label in enumerate(labels):
            grouped[int(label)].append(index)
        diverse_groups = self._enforce_source_diversity(
            list(grouped.values()),
            source_items,
            embeddings,
        )
        events = [
            self._merge_cluster([source_items[index] for index in group])
            for group in diverse_groups
        ]
        events.sort(
            key=lambda item: (
                int(item.get("source_count") or 1),
                int(item.get("importance_score") or 0),
            ),
            reverse=True,
        )
        return events


@dataclass
class PipelineRun:
    profile: str
    started_at: str
    completed_at: str = ""
    items: list[Article] = field(default_factory=list)
    quarantine: list[Article] = field(default_factory=list)
    metrics: dict[str, int] = field(default_factory=dict)
    audit: list[dict[str, Any]] = field(default_factory=list)

    def report(self) -> dict[str, Any]:
        return {
            "profile": self.profile,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "metrics": dict(self.metrics),
            "audit": list(self.audit),
        }


class NewPipelineIdea:
    """Orchestrate the proposed flow without touching the active application."""

    def __init__(
        self,
        settings: PipelineSettings,
        *,
        web_search_adapter: Adapter,
        chat_adapter: Adapter,
        image_adapter: Adapter,
        bouncer: Any | None = None,
        clusterer: Any | None = None,
        checkpoints: JsonCheckpointStore | None = None,
        web_rate_limiter: PacedRateLimiter | None = None,
        chat_rate_limiter: PacedRateLimiter | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        progress: ProgressCallback | None = None,
    ) -> None:
        self.settings = settings
        self.web_search_adapter = web_search_adapter
        self.chat_adapter = chat_adapter
        self.image_adapter = image_adapter
        self.bouncer = bouncer or ProfileBouncer(settings)
        self.clusterer = clusterer or MiniLMEventClusterer(
            settings.cluster_distance_threshold
        )
        self.checkpoints = checkpoints or JsonCheckpointStore(
            settings.checkpoint_dir / settings.profile
        )
        self.web_rate_limiter = web_rate_limiter or PacedRateLimiter(
            settings.web_search_requests_per_minute
        )
        self.chat_rate_limiter = chat_rate_limiter or PacedRateLimiter(
            settings.chat_requests_per_minute
        )
        self.sleeper = sleeper
        self.progress = progress or self._default_progress

    @staticmethod
    def _default_progress(event: dict[str, Any]) -> None:
        print(
            f"[NEW-PIPELINE:{event.get('profile', 'default')}] "
            f"{event.get('stage')}: {event.get('message')}",
            flush=True,
        )

    def _emit(
        self,
        run: PipelineRun,
        stage: str,
        message: str,
        **details: Any,
    ) -> None:
        event = {
            "timestamp": utc_timestamp(),
            "profile": self.settings.profile,
            "stage": stage,
            "message": message,
            **details,
        }
        run.audit.append(event)
        self.progress(event)

    def _adapter_with_retry(
        self,
        *,
        adapter: Adapter,
        limiter: PacedRateLimiter,
        item: Article,
        status_field: str,
        adapter_kwargs: dict[str, Any] | None = None,
    ) -> Article:
        last = dict(item)
        for attempt in range(1, self.settings.external_call_attempts + 1):
            limiter.acquire()
            try:
                last = adapter(dict(item), **(adapter_kwargs or {}))
            except Exception as error:
                last = {
                    **dict(item),
                    status_field: "failed",
                    f"{status_field}_error": str(error)[:500],
                }
            if last.get(status_field) == "success":
                return last
            if attempt < self.settings.external_call_attempts:
                self.sleeper(
                    self.settings.retry_backoff_seconds * attempt
                )
        return last

    def _web_search_stage(
        self,
        run: PipelineRun,
        items: list[Article],
        keywords: list[str],
    ) -> list[Article]:
        output: list[Article] = []
        for index, item in enumerate(items, 1):
            key = stable_article_key(item)
            cached = self.checkpoints.get("web_search_success", key)
            if cached is not None:
                enriched = cached
                source = "checkpoint"
            else:
                enriched = self._adapter_with_retry(
                    adapter=self.web_search_adapter,
                    limiter=self.web_rate_limiter,
                    item=item,
                    status_field="enrichment_status",
                    adapter_kwargs={"keywords": keywords},
                )
                source = "live"
                if enriched.get("enrichment_status") == "success":
                    self.checkpoints.put("web_search_success", key, enriched)

            if enriched.get("enrichment_status") == "success":
                enriched["pipeline_stage"] = "web_search_extracted"
                output.append(enriched)
            else:
                run.quarantine.append(
                    {
                        **enriched,
                        "quarantine_stage": "samsung_web_search",
                        "quarantined_at": utc_timestamp(),
                    }
                )
            self._emit(
                run,
                "samsung_web_search",
                f"{index}/{len(items)} processed",
                result=enriched.get("enrichment_status", "failed"),
                source=source,
            )
        return output

    def _image_stage(
        self,
        run: PipelineRun,
        items: list[Article],
    ) -> list[Article]:
        output: list[Article] = []
        for index, source in enumerate(items, 1):
            item = dict(source)
            if clean_text(item.get("top_image") or item.get("image")):
                item["image_metadata_status"] = "already_present"
            else:
                try:
                    item = self.image_adapter(item)
                except Exception as error:
                    item["image_metadata_status"] = "failed"
                    item["image_metadata_error"] = str(error)[:500]
            item["pipeline_stage"] = "image_enriched"
            output.append(item)
            self._emit(
                run,
                "image_metadata",
                f"{index}/{len(items)} processed",
                result=item.get("image_metadata_status", "unknown"),
            )
        return output

    def _chat_stage(
        self,
        run: PipelineRun,
        events: list[Article],
    ) -> list[Article]:
        output: list[Article] = []
        for index, event in enumerate(events, 1):
            key = stable_article_key(
                {
                    **event,
                    "link": "|".join(
                        clean_text(source.get("link"))
                        for source in event.get("sources", [])
                        if isinstance(source, dict)
                    ),
                }
            )
            cached = self.checkpoints.get("chat_summary_success", key)
            if cached is not None:
                summarized = cached
                source = "checkpoint"
            else:
                summarized = self._adapter_with_retry(
                    adapter=self.chat_adapter,
                    limiter=self.chat_rate_limiter,
                    item=event,
                    status_field="chat_summary_status",
                )
                source = "live"
                if summarized.get("chat_summary_status") == "success":
                    self.checkpoints.put(
                        "chat_summary_success", key, summarized
                    )
            summarized["pipeline_stage"] = (
                "feed_ready"
                if summarized.get("chat_summary_status") == "success"
                else "chat_summary_failed_retryable"
            )
            output.append(summarized)
            self._emit(
                run,
                "samsung_chat",
                f"{index}/{len(events)} processed",
                result=summarized.get("chat_summary_status", "failed"),
                source=source,
            )
        return output

    def _remove_debug_fields(self, item: Article) -> Article:
        if self.settings.keep_adapter_debug_fields:
            return dict(item)
        return {
            key: value
            for key, value in item.items()
            if not key.startswith("_")
        }

    def run(
        self,
        discovered_articles: Iterable[Article],
        *,
        keywords: Iterable[str] = (),
    ) -> PipelineRun:
        run = PipelineRun(
            profile=self.settings.profile,
            started_at=utc_timestamp(),
        )
        discovered = [
            {**dict(item), "profile": self.settings.profile}
            for item in discovered_articles
            if isinstance(item, dict)
            and (
                clean_text(item.get("title"))
                or clean_text(item.get("link") or item.get("url"))
            )
        ]
        run.metrics["discovered"] = len(discovered)
        self._emit(
            run,
            "discovery_input",
            f"Received {len(discovered)} crawler/RSS candidates",
        )

        enriched = self._web_search_stage(
            run,
            discovered,
            [clean_text(value) for value in keywords if clean_text(value)],
        )
        run.metrics["web_search_enriched"] = len(enriched)
        run.metrics["web_search_quarantined"] = len(run.quarantine)

        kept, bouncer_dropped = self.bouncer.filter(
            enriched,
            self.settings.profile,
        )
        for item in bouncer_dropped:
            run.quarantine.append(
                {
                    **item,
                    "quarantine_stage": "bouncer",
                    "quarantined_at": utc_timestamp(),
                }
            )
        run.metrics["bouncer_kept"] = len(kept)
        run.metrics["bouncer_dropped"] = len(bouncer_dropped)
        self._emit(
            run,
            "bouncer",
            f"Kept {len(kept)}; dropped {len(bouncer_dropped)}",
        )

        imaged = self._image_stage(run, kept)
        run.metrics["image_enriched_or_checked"] = len(imaged)

        clustered = self.clusterer.cluster(imaged)
        run.metrics["clustered_events"] = len(clustered)
        self._emit(
            run,
            "minilm_clustering",
            f"Condensed {len(imaged)} articles into {len(clustered)} events",
        )

        summarized = self._chat_stage(run, clustered)
        run.items = [self._remove_debug_fields(item) for item in summarized]
        run.metrics["chat_summarized"] = sum(
            item.get("chat_summary_status") == "success"
            for item in run.items
        )
        run.metrics["feed_items"] = len(run.items)
        run.metrics["quarantined_total"] = len(run.quarantine)
        run.completed_at = utc_timestamp()
        self._emit(
            run,
            "feed_output",
            f"Prepared {len(run.items)} feed items",
        )
        return run


def build_pipeline(settings: PipelineSettings) -> NewPipelineIdea:
    """Use the existing secure adapters without changing their source files."""

    from article_metadata_adapter import enrich_article_image_metadata
    from samsung_chat_adapter import summarize_article_with_chat
    from samsung_web_search_adapter import enrich_article_with_web_search

    return NewPipelineIdea(
        settings,
        web_search_adapter=enrich_article_with_web_search,
        chat_adapter=summarize_article_with_chat,
        image_adapter=enrich_article_image_metadata,
    )


def flow_description() -> str:
    return """
NEW PIPELINE IDEA (not connected to main.py)

1. Existing Scrapy spider performs RSS/site discovery only.
2. Samsung Web Search extracts authoritative article content (maximum 3 RPM).
3. The profile-specific MiniLM bouncer removes not-interested articles.
4. Article metadata fills only missing images.
5. Local all-MiniLM-L6-v2 clusters matching reports into events.
6. Samsung Chat summarizes each clustered event (maximum 3 RPM).
7. Feed-compatible JSON is written; BART is not called.

Successful Web Search and Chat results are checkpointed. Failed Web Search
items are quarantined instead of silently using crawler body text.
""".strip()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
    temporary.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Review or manually run the isolated new pipeline idea."
    )
    parser.add_argument("--show-flow", action="store_true")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--keywords", default="")
    parser.add_argument(
        "--profile",
        choices=("default", "broadcast"),
        default="default",
    )
    parser.add_argument(
        "--allow-live-services",
        action="store_true",
        help="Required before Samsung Web Search or Chat can be called.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.show_flow:
        print(flow_description())
        if not args.input:
            return 0
    if not args.input or not args.output:
        raise SystemExit("--input and --output are required for a pipeline run.")
    if not args.allow_live_services:
        raise SystemExit(
            "Refusing external calls. Review the flow first, then pass "
            "--allow-live-services explicitly."
        )
    if not args.input.exists():
        raise SystemExit(f"Input file does not exist: {args.input}")

    with args.input.open("r", encoding="utf-8") as handle:
        discovered = json.load(handle)
    if not isinstance(discovered, list):
        raise SystemExit("Input must be a JSON list of discovered articles.")

    settings = PipelineSettings.from_environment(profile=args.profile)
    pipeline = build_pipeline(settings)
    run = pipeline.run(
        discovered,
        keywords=[
            value.strip()
            for value in args.keywords.split(",")
            if value.strip()
        ],
    )
    write_json(args.output, run.items)
    write_json(
        args.output.with_suffix(".quarantine.json"),
        run.quarantine,
    )
    write_json(
        args.output.with_suffix(".report.json"),
        run.report(),
    )
    print(json.dumps(asdict(run), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
