from __future__ import annotations

import re
import logging
import threading
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from zoneinfo import ZoneInfo

from signalroom.config import Settings
from signalroom.ml.clustering import SemanticClusterer
from signalroom.ml.embeddings import EmbeddingService
from signalroom.ml.gatekeeper import Gatekeeper
from signalroom.ml.summarizer import SummarizationService
from signalroom.models import (
    ArticleCreate,
    ArticleSourceCreate,
    BriefingSnapshotCreate,
    ClusterCreate,
    ClusterMemberCreate,
    CrawlJobCreate,
    CrawlJobEventCreate,
    CrawlJobEventType,
    CrawlJobKind,
    CrawlJobRead,
    CrawlJobStatus,
    CrawlJobUpdate,
    DiscoveryMethod,
    ProfileId,
    make_stable_id,
)
from signalroom.profiles import LoadedProfile, ProfileRegistry
from signalroom.services.briefing import build_cluster_signal
from signalroom.services.classification import enrich_editorial_fields
from signalroom.services.crawl_runner import CrawlResult, CrawlRunError, ScrapyRunner
from signalroom.services.normalization import deduplicate_articles, normalize_article
from signalroom.storage import SQLiteRepository

logger = logging.getLogger(__name__)


class PipelineBusyError(RuntimeError):
    pass


def _source_key(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", str(value or "").casefold()).strip("-")
    return (normalized or "unknown")[:100]


def _discovery_method(value: Any) -> DiscoveryMethod:
    normalized = str(value or "").strip().casefold()
    if normalized == "rss":
        return DiscoveryMethod.RSS
    if normalized == "atom":
        return DiscoveryMethod.ATOM
    if normalized in {"html", "listing"}:
        return DiscoveryMethod.LISTING
    return DiscoveryMethod.MANUAL


def _profile_id(value: Any) -> ProfileId:
    if isinstance(value, ProfileId):
        return value
    return ProfileId(str(value))


class PipelineService:
    """Coordinates one profile run without mixing API, Scrapy, or ML runtimes."""

    def __init__(
        self,
        settings: Settings,
        profiles: ProfileRegistry,
        repository: SQLiteRepository,
        *,
        crawler: Optional[ScrapyRunner] = None,
        embedder: Optional[EmbeddingService] = None,
        summarizer: Optional[SummarizationService] = None,
    ) -> None:
        self.settings = settings
        self.profiles = profiles
        self.repository = repository
        self.crawler = crawler or ScrapyRunner(settings)
        self.embedder = embedder or EmbeddingService(
            settings.embedding_model,
            model_identity=settings.embedding_model_id,
            local_files_only=settings.hf_local_only,
        )
        self.summarizer = summarizer or SummarizationService(
            settings.summarization_model,
            model_identity=settings.summarization_model_id,
            local_files_only=settings.hf_local_only,
        )
        self._profile_locks = {profile.id: threading.Lock() for profile in profiles.all()}

    def _event(
        self,
        job: CrawlJobRead,
        event_type: CrawlJobEventType,
        message: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        logger.info(
            "[pipeline:%s:%s] %s%s",
            job.profile.value,
            event_type.value,
            message,
            f" | {payload}" if payload else "",
        )
        self.repository.add_job_event(
            CrawlJobEventCreate(
                job_id=job.id,
                event_type=event_type,
                message=message,
                payload=payload or {},
            )
        )

    def _loaded_profile(self, profile: ProfileId) -> LoadedProfile:
        """Read profile and source JSON at the boundary of every run.

        API and scheduler processes are intentionally long lived, while source
        operators edit the JSON files in place. Building a short-lived registry
        here prevents either manual or scheduled scans from using the startup
        snapshot of keywords, enablement flags, thresholds, or source entries.
        """

        return ProfileRegistry.from_settings(self.settings).get(profile)

    def _date_window(
        self, from_date: Optional[date], to_date: Optional[date]
    ) -> Tuple[date, date]:
        local_today = datetime.now(ZoneInfo(self.settings.timezone_name)).date()
        end = to_date or local_today
        start = from_date or (end - timedelta(days=1))
        if start > end:
            raise ValueError("from_date cannot be after to_date")
        return start, end

    def _create_job(
        self,
        *,
        profile: ProfileId,
        trigger: str,
        requested_by: Optional[str],
        from_date: date,
        to_date: date,
        keywords: Sequence[str],
        source_ids: Sequence[str],
    ) -> CrawlJobRead:
        kind = CrawlJobKind.SCHEDULED if trigger == "scheduler" else CrawlJobKind.MANUAL
        return self.repository.create_job(
            CrawlJobCreate(
                profile=profile,
                kind=kind,
                requested_by=requested_by,
                keywords=tuple(keywords),
                source_ids=tuple(source_ids),
                from_date=from_date,
                to_date=to_date,
                parameters={"trigger": trigger},
            )
        )

    def _crawl(
        self,
        loaded: LoadedProfile,
        job: CrawlJobRead,
        from_date: date,
        to_date: date,
        keywords: Sequence[str],
        source_ids: Sequence[str],
    ) -> CrawlResult:
        if not loaded.enabled_sites:
            raise CrawlRunError(
                f"{loaded.config.label} has no enabled source entrypoints"
            )
        return self.crawler.run(
            loaded,
            from_date,
            to_date,
            target_sites=source_ids,
            keywords=keywords,
            run_id=str(job.id),
            discovery_only=False,
        )

    def _article_create(
        self,
        article: Mapping[str, Any],
        *,
        profile: ProfileId,
        job: CrawlJobRead,
        signal: Optional[Mapping[str, Any]],
    ) -> ArticleCreate:
        canonical_url = str(article.get("canonical_url") or "")
        source = str(article.get("source") or "Unknown")
        provenance = [
            {
                "source": source,
                "source_id": article.get("source_id") or source,
                "url": article.get("requested_url") or canonical_url,
                "primary": True,
            },
            *(article.get("source_provenance") or []),
        ]
        source_models = []
        seen_sources = set()
        for item in provenance:
            if not isinstance(item, Mapping):
                continue
            publisher = str(item.get("source") or source or "Unknown")[:200]
            source_id = str(item.get("source_id") or publisher)
            source_url = str(item.get("url") or canonical_url)
            # Storage treats one article/profile/URL as one provenance record.
            # Multiple feeds that point at the exact same URL must not create
            # conflicting duplicate rows.
            source_identity = source_url
            if source_identity in seen_sources:
                continue
            seen_sources.add(source_identity)
            source_models.append(
                ArticleSourceCreate(
                    stable_id=make_stable_id(
                        "source",
                        profile.value,
                        source_id,
                        source_url,
                    ),
                    profile=profile,
                    source_key=_source_key(source_id),
                    publisher=publisher or "Unknown",
                    url=source_url,
                    canonical_url=canonical_url,
                    published_at=article.get("published_at") or None,
                    discovered_at=article.get("discovered_at"),
                    discovery_method=(
                        _discovery_method(article.get("discovery_method"))
                        if item.get("primary")
                        else DiscoveryMethod.MANUAL
                    ),
                    crawl_job_id=job.id,
                    metadata={
                        "run_id": str(job.id),
                        "date_source": article.get("date_source"),
                        "extraction_quality": article.get("extraction_quality"),
                        "source_category": (article.get("metadata") or {}).get(
                            "source_category"
                        ),
                        "excerpt": article.get("excerpt"),
                        "merged_provenance": not bool(item.get("primary")),
                    },
                )
            )
        metadata = dict(article.get("metadata") or {})
        metadata.update(
            {
                "source": source,
                "source_id": article.get("source_id"),
                "author": article.get("author"),
                "excerpt": article.get("excerpt"),
                "priority": article.get("priority"),
                "team": article.get("team"),
                "region_basis": article.get("region_basis"),
                "intent_confidence": article.get("intent_confidence"),
                "content_hash": article.get("content_hash"),
            }
        )
        model_metadata = {}
        summary = None
        intent = article.get("intent")
        if signal:
            summary = signal.get("summary") or None
            intent = signal.get("signal") or intent
            model_metadata = {
                "summary": signal.get("summary_metadata"),
                "gatekeeper": signal.get("gatekeeper"),
                "cluster": signal.get("cluster_metadata"),
            }
            metadata["insight"] = signal.get("insight")
            metadata["retained"] = signal.get("retained")
            metadata["cluster_id"] = signal.get("id")
            metadata["is_cluster_representative"] = (
                str(article.get("id")) == str(signal.get("representative_article_id"))
            )
        return ArticleCreate(
            stable_id=str(article["id"]),
            title=str(article.get("title") or "Untitled signal")[:600],
            canonical_url=canonical_url,
            published_at=article.get("published_at") or None,
            summary=summary,
            intent=str(intent)[:2000] if intent else None,
            body_text=str(article.get("body_text") or "")[:2_000_000] or None,
            top_image_url=article.get("image_url") or None,
            region=str(article.get("region") or "Global")[:100],
            category=str(article.get("category") or "Technology")[:100],
            language=str(metadata.get("language") or "en")[:35],
            importance_score=max(
                0.0, min(1.0, float(article.get("importance_score") or 50) / 100.0)
            ),
            keywords=tuple(str(item)[:200] for item in article.get("keywords") or []),
            profiles=(profile,),
            sources=tuple(source_models),
            model_metadata=model_metadata,
            metadata=metadata,
        )

    def run_profile(
        self,
        *,
        profile_id: Any,
        trigger: str = "manual",
        requested_by: Optional[str] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        keywords: Optional[Iterable[str]] = None,
        source_ids: Optional[Iterable[str]] = None,
        job: Optional[CrawlJobRead] = None,
    ) -> Dict[str, Any]:
        profile = _profile_id(profile_id)
        lock = self._profile_locks[profile]
        if not lock.acquire(blocking=False):
            if job is not None:
                try:
                    failed = self.repository.update_job(
                        job.id,
                        CrawlJobUpdate(
                            status=CrawlJobStatus.FAILED,
                            counters={},
                            error=f"a {profile.value} pipeline run is already active",
                        ),
                    )
                    self._event(
                        failed,
                        CrawlJobEventType.ERROR,
                        "Pipeline could not start because this profile is already running",
                    )
                except Exception:
                    pass
            raise PipelineBusyError(f"a {profile.value} pipeline run is already active")
        counters: Dict[str, int] = {}
        active_job = job
        try:
            loaded = self._loaded_profile(profile)
            start, end = self._date_window(from_date, to_date)
            active_keywords = tuple(keywords or loaded.config.keywords)
            active_sources = tuple(source_ids or ())
            active_job = active_job or self._create_job(
                profile=profile,
                trigger=trigger,
                requested_by=requested_by,
                from_date=start,
                to_date=end,
                keywords=active_keywords,
                source_ids=active_sources,
            )
            active_job = self.repository.update_job(
                active_job.id,
                CrawlJobUpdate(status=CrawlJobStatus.RUNNING, counters={}),
            )
            self._event(
                active_job,
                CrawlJobEventType.STATUS,
                f"{loaded.config.label} crawl started",
                {"from_date": start.isoformat(), "to_date": end.isoformat()},
            )
            self._event(
                active_job,
                CrawlJobEventType.PROGRESS,
                "Crawler is loading source JSON and generating RSS/HTML entrypoints",
                {"source_file": str(loaded.sources_path), "source_count": len(loaded.enabled_sites)},
            )

            crawl = self._crawl(
                loaded, active_job, start, end, active_keywords, active_sources
            )
            counters["discovered"] = len(crawl.articles)
            for name in ("configured", "attempted", "responded", "failed"):
                value = crawl.source_health.get(name)
                if value is not None:
                    counters[f"sources_{name}"] = max(0, int(value))
            self._event(
                active_job,
                CrawlJobEventType.DISCOVERY,
                f"Scrapy returned {len(crawl.articles)} extracted articles",
                {
                    "count": len(crawl.articles),
                    "source_health": crawl.source_health,
                },
            )
            normalized = [
                normalize_article(item, profile.value, str(active_job.id))
                for item in crawl.articles
            ]
            normalized = [
                item for item in normalized if item.get("title") and item.get("canonical_url")
            ]
            normalized = deduplicate_articles(normalized)
            counters["normalized"] = len(normalized)
            if not normalized:
                self._event(
                    active_job,
                    CrawlJobEventType.WARNING,
                    "No valid articles were found; the previous briefing remains current",
                )
                completed = self.repository.update_job(
                    active_job.id,
                    CrawlJobUpdate(status=CrawlJobStatus.SUCCEEDED, counters=counters),
                )
                self._event(
                    completed,
                    CrawlJobEventType.COMPLETE,
                    "Crawl completed without new briefing signals",
                    counters,
                )
                return {
                    "job": completed.model_dump(mode="json"),
                    "profile": profile.value,
                    "briefing": None,
                    "clusters": [],
                    "counters": counters,
                }

            clusterer = SemanticClusterer(
                threshold=loaded.config.cluster_similarity_threshold,
                embedder=self.embedder,
            )
            self._event(
                active_job,
                CrawlJobEventType.PROGRESS,
                "Loading MiniLM embeddings and starting semantic clustering",
                {"model": self.settings.embedding_model_id},
            )
            clustered = clusterer.cluster_with_metadata(normalized, profile=profile.value)
            clusters = clustered["clusters"]
            counters["clusters"] = len(clusters)
            self._event(
                active_job,
                CrawlJobEventType.PROGRESS,
                f"MiniLM grouped the run into {len(clusters)} semantic clusters",
                clustered["metadata"],
            )

            gatekeeper = Gatekeeper(
                self.settings.model_dir,
                embedder=self.embedder,
                review_threshold=loaded.config.gatekeeper_review_threshold,
                hard_drop_threshold=loaded.config.gatekeeper_drop_threshold,
                prefetch_drop_threshold=loaded.config.prefetch_drop_threshold,
            )
            self._event(
                active_job,
                CrawlJobEventType.PROGRESS,
                "Running gatekeeper decisions and summarization for each cluster",
                {
                    "gatekeeper_model_dir": str(self.settings.model_dir),
                    "summarization_model": self.settings.summarization_model_id,
                },
            )
            signals = [
                build_cluster_signal(
                    cluster,
                    profile=profile.value,
                    summarizer=self.summarizer,
                    gatekeeper=gatekeeper,
                )
                for cluster in clusters
            ]
            signal_by_article = {}
            for signal in signals:
                for source in signal.get("sources") or []:
                    article_id = source.get("article_id")
                    if article_id:
                        signal_by_article[str(article_id)] = signal
            persisted = {}
            for article in normalized:
                enriched = enrich_editorial_fields(article, source_count=1)
                signal = signal_by_article.get(str(article.get("id")))
                if signal:
                    enriched.update(
                        {
                            "category": signal.get("category"),
                            "team": signal.get("team"),
                            "region": signal.get("region"),
                            "priority": signal.get("priority"),
                            "importance_score": signal.get("relevance"),
                            "intent": signal.get("signal"),
                        }
                    )
                model = self._article_create(
                    enriched,
                    profile=profile,
                    job=active_job,
                    signal=signal,
                )
                persisted[str(article["id"])] = self.repository.upsert_article(model)

            cluster_models = []
            for cluster, signal in zip(clusters, signals):
                representative_id = str(signal.get("representative_article_id"))
                members = []
                for rank, member in enumerate(cluster.get("articles") or []):
                    stored = persisted[str(member["id"])]
                    members.append(
                        ClusterMemberCreate(
                            article_id=stored.id,
                            rank=rank,
                            similarity=float(member.get("cluster_similarity") or 0),
                            is_primary=str(member["id"]) == representative_id,
                        )
                    )
                persisted_sources = []
                for source in signal.get("sources") or []:
                    source_record = dict(source)
                    raw_article_id = source_record.get("article_id")
                    stored_article = (
                        persisted.get(str(raw_article_id))
                        if raw_article_id is not None
                        else None
                    )
                    if stored_article is not None:
                        source_record["article_id"] = str(stored_article.id)
                    persisted_sources.append(source_record)
                cluster_models.append(
                    ClusterCreate(
                        stable_id=make_stable_id(
                            "cluster", active_job.id, cluster.get("cluster_id")
                        ),
                        profile=profile,
                        crawl_job_id=active_job.id,
                        title=str(signal.get("title") or "Untitled signal")[:600],
                        summary=signal.get("summary") or None,
                        intent=str(signal.get("signal") or "market movement"),
                        region=str(signal.get("region") or "Global")[:100],
                        keywords=tuple(
                            str(item)[:200] for item in signal.get("keywords") or []
                        ),
                        model_name=self.settings.embedding_model_id,
                        similarity_threshold=loaded.config.cluster_similarity_threshold,
                        members=tuple(members),
                        metadata={
                            "retained": signal.get("retained"),
                            "priority": signal.get("priority"),
                            "team": signal.get("team"),
                            "source_count": signal.get("source_count"),
                            "sources": persisted_sources,
                            "gatekeeper": signal.get("gatekeeper"),
                            "summary_metadata": signal.get("summary_metadata"),
                            "insight": signal.get("insight"),
                        },
                    )
                )
            stored_clusters = self.repository.replace_run_clusters(
                active_job.id, cluster_models
            )

            retained_ids = []
            for signal in signals:
                if signal.get("retained"):
                    stored = persisted.get(str(signal.get("representative_article_id")))
                    if stored:
                        retained_ids.append(stored.id)
            counters["retained"] = len(retained_ids)
            counters["dropped"] = len(signals) - len(retained_ids)
            briefing = None
            if retained_ids:
                briefing = self.repository.create_briefing_snapshot(
                    BriefingSnapshotCreate(
                        stable_id=make_stable_id(
                            "briefing", profile.value, active_job.id
                        ),
                        profile=profile,
                        crawl_job_id=active_job.id,
                        article_ids=tuple(retained_ids),
                        generated_by=trigger,
                        metadata={
                            "cluster_ids": [str(item.id) for item in stored_clusters],
                            "counters": counters,
                            "models": {
                                "embedding": self.embedder.status(),
                                "summarization": self.summarizer.status(),
                            },
                        },
                    )
                )
            completed = self.repository.update_job(
                active_job.id,
                CrawlJobUpdate(status=CrawlJobStatus.SUCCEEDED, counters=counters),
            )
            self._event(
                completed,
                CrawlJobEventType.COMPLETE,
                f"Briefing ready with {len(retained_ids)} retained signals",
                counters,
            )
            return {
                "job": completed.model_dump(mode="json"),
                "profile": profile.value,
                "briefing": briefing.model_dump(mode="json") if briefing else None,
                "clusters": [item.model_dump(mode="json") for item in stored_clusters],
                "counters": counters,
            }
        except Exception as exc:
            if active_job is not None:
                try:
                    failed = self.repository.update_job(
                        active_job.id,
                        CrawlJobUpdate(
                            status=CrawlJobStatus.FAILED,
                            counters=counters,
                            error=str(exc)[:10_000],
                        ),
                    )
                    self._event(
                        failed,
                        CrawlJobEventType.ERROR,
                        "Pipeline failed",
                        {"error_type": type(exc).__name__},
                    )
                except Exception:
                    pass
            raise
        finally:
            lock.release()
