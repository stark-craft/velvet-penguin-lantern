"""Read-only, profile-scoped views of the latest gatekeeper run.

The briefing table contains only retained representatives, so it cannot be the
source of truth for a gatekeeper review screen.  This service deliberately
starts with the latest successful job for one profile and reads every persisted
cluster for that job.  As a result, review and dropped clusters remain visible
even when they never entered the briefing.
"""

from __future__ import annotations

import math
from enum import Enum
from typing import Any, Dict, Mapping, Optional, Tuple
from uuid import UUID

from pydantic import AwareDatetime, Field

from signalroom.models import (
    ArticleDisposition,
    CrawlJobRead,
    CrawlJobStatus,
    PageParams,
    ProfileId,
    StrictModel,
)
from signalroom.storage import SQLiteRepository


class GatekeeperAuditBucket(str, Enum):
    RETAINED = "retained"
    REVIEW = "review"
    DROPPED = "dropped"


class GatekeeperAuditModel(StrictModel):
    profile: ProfileId
    version: Optional[str] = None
    stage: str = "final"
    degraded: bool = False
    embedding: Dict[str, Any] = Field(default_factory=dict)


class GatekeeperAuditDecision(StrictModel):
    decision: str
    bucket: GatekeeperAuditBucket
    retained: bool
    score: Optional[float] = None
    reason: str
    thresholds: Dict[str, float] = Field(default_factory=dict)
    model: GatekeeperAuditModel


class GatekeeperClusterAuditRow(StrictModel):
    cluster_id: UUID
    stable_id: str
    crawl_job_id: UUID
    profile: ProfileId
    title: str
    summary: Optional[str] = None
    source: Optional[str] = None
    sources: Tuple[str, ...] = ()
    article_count: int
    created_at: AwareDatetime
    gatekeeper: GatekeeperAuditDecision


class GatekeeperArticleAuditRow(StrictModel):
    article_id: UUID
    stable_id: str
    cluster_id: UUID
    crawl_job_id: UUID
    profile: ProfileId
    title: str
    summary: Optional[str] = None
    source: Optional[str] = None
    sources: Tuple[str, ...] = ()
    canonical_url: str
    published_at: Optional[AwareDatetime] = None
    is_primary: bool
    similarity: float
    gatekeeper: GatekeeperAuditDecision
    disposition: Optional[ArticleDisposition] = None


class GatekeeperBucketCounts(StrictModel):
    total: int = 0
    retained: int = 0
    review: int = 0
    dropped: int = 0


class GatekeeperAuditCounters(StrictModel):
    pipeline: Dict[str, int] = Field(default_factory=dict)
    clusters: GatekeeperBucketCounts = Field(default_factory=GatekeeperBucketCounts)
    articles: GatekeeperBucketCounts = Field(default_factory=GatekeeperBucketCounts)


class GatekeeperAuditBriefingRef(StrictModel):
    id: UUID
    crawl_job_id: Optional[UUID] = None
    created_at: AwareDatetime
    article_count: int
    is_for_audited_run: bool


class GatekeeperAuditRead(StrictModel):
    profile: ProfileId
    job: Optional[CrawlJobRead] = None
    latest_briefing: Optional[GatekeeperAuditBriefingRef] = None
    counters: GatekeeperAuditCounters
    clusters: Tuple[GatekeeperClusterAuditRow, ...] = ()
    articles: Tuple[GatekeeperArticleAuditRow, ...] = ()
    limit: int
    truncated: bool = False


def _finite_score(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(score):
        return None
    return max(0.0, min(1.0, score))


def _thresholds(value: Any) -> Dict[str, float]:
    if not isinstance(value, Mapping):
        return {}
    result: Dict[str, float] = {}
    for key, candidate in value.items():
        score = _finite_score(candidate)
        if score is not None:
            result[str(key)[:100]] = score
    return result


def _decision(
    metadata: Mapping[str, Any], profile: ProfileId
) -> GatekeeperAuditDecision:
    raw_gatekeeper = metadata.get("gatekeeper")
    gatekeeper = raw_gatekeeper if isinstance(raw_gatekeeper, Mapping) else {}
    stored_retained = metadata.get("retained")
    gatekeeper_keep = gatekeeper.get("keep")
    if isinstance(stored_retained, bool):
        retained = stored_retained
    elif isinstance(gatekeeper_keep, bool):
        retained = gatekeeper_keep
    else:
        retained = True

    decision = str(gatekeeper.get("decision") or "").strip().casefold()
    if decision not in {"keep", "review", "drop"}:
        decision = "keep" if retained else "drop"
    # The persisted pipeline outcome is authoritative if old or malformed model
    # metadata disagrees with it.
    if not retained:
        decision = "drop"
    elif decision == "drop":
        retained = False

    bucket = {
        "keep": GatekeeperAuditBucket.RETAINED,
        "review": GatekeeperAuditBucket.REVIEW,
        "drop": GatekeeperAuditBucket.DROPPED,
    }[decision]
    embedding = gatekeeper.get("embedding")
    if not isinstance(embedding, Mapping):
        embedding = {}
    has_gatekeeper_metadata = bool(gatekeeper)
    reason = str(
        gatekeeper.get("reason")
        or ("gatekeeper_metadata_unavailable" if not has_gatekeeper_metadata else "unspecified")
    )[:2_000]
    version = gatekeeper.get("model_version")
    return GatekeeperAuditDecision(
        decision=decision,
        bucket=bucket,
        retained=retained,
        score=_finite_score(gatekeeper.get("score")),
        reason=reason,
        thresholds=_thresholds(gatekeeper.get("thresholds")),
        model=GatekeeperAuditModel(
            profile=profile,
            version=str(version)[:200] if version is not None else None,
            stage=str(gatekeeper.get("stage") or "final")[:100],
            degraded=bool(gatekeeper.get("degraded", not has_gatekeeper_metadata)),
            embedding=dict(embedding),
        ),
    )


def _source_names(article: Any, profile: ProfileId, crawl_job_id: UUID) -> Tuple[str, ...]:
    profile_sources = [source for source in article.sources if source.profile == profile]
    run_sources = [
        source for source in profile_sources if source.crawl_job_id == crawl_job_id
    ]
    candidates = run_sources or profile_sources
    names = []
    seen = set()
    for source in candidates:
        name = str(source.publisher).strip()
        marker = name.casefold()
        if name and marker not in seen:
            names.append(name)
            seen.add(marker)
    return tuple(names)


def _increment(counts: Dict[GatekeeperAuditBucket, int], bucket: GatekeeperAuditBucket) -> None:
    counts[bucket] += 1


def _bucket_counts(
    counts: Dict[GatekeeperAuditBucket, int]
) -> GatekeeperBucketCounts:
    return GatekeeperBucketCounts(
        total=sum(counts.values()),
        retained=counts[GatekeeperAuditBucket.RETAINED],
        review=counts[GatekeeperAuditBucket.REVIEW],
        dropped=counts[GatekeeperAuditBucket.DROPPED],
    )


class GatekeeperAuditService:
    """Compose a bounded audit projection without crossing profile boundaries."""

    def __init__(self, repository: SQLiteRepository) -> None:
        self.repository = repository

    def get_latest(
        self,
        profile: ProfileId,
        *,
        actor_id: Optional[str] = None,
        limit: int = 100,
    ) -> GatekeeperAuditRead:
        profile = ProfileId(profile)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("limit must be an integer between 1 and 100")
        normalized_actor = str(actor_id).strip()[:200] if actor_id else None

        jobs = self.repository.list_jobs(
            profile=profile,
            status=CrawlJobStatus.SUCCEEDED,
            page=PageParams(limit=1),
        )
        job = jobs.items[0] if jobs.items else None
        if job is not None and job.profile != profile:
            # Profile scope is a security boundary; fail closed if a custom
            # repository implementation violates the contract.
            raise RuntimeError("repository returned a job from another profile")

        latest_briefing = self.repository.get_latest_briefing(profile)
        briefing_ref = None
        if latest_briefing is not None:
            if latest_briefing.profile != profile:
                raise RuntimeError("repository returned a briefing from another profile")
            briefing_ref = GatekeeperAuditBriefingRef(
                id=latest_briefing.id,
                crawl_job_id=latest_briefing.crawl_job_id,
                created_at=latest_briefing.created_at,
                article_count=len(latest_briefing.article_ids),
                is_for_audited_run=bool(
                    job is not None and latest_briefing.crawl_job_id == job.id
                ),
            )

        if job is None:
            return GatekeeperAuditRead(
                profile=profile,
                latest_briefing=briefing_ref,
                counters=GatekeeperAuditCounters(),
                limit=limit,
            )

        cluster_page = self.repository.list_clusters(
            profile=profile,
            crawl_job_id=job.id,
            page=PageParams(limit=limit),
        )
        cluster_rows = []
        article_rows = []
        cluster_counts = {bucket: 0 for bucket in GatekeeperAuditBucket}
        article_counts = {bucket: 0 for bucket in GatekeeperAuditBucket}
        articles_truncated = False

        for cluster in cluster_page.items:
            if cluster.profile != profile or cluster.crawl_job_id != job.id:
                raise RuntimeError("repository returned a cluster outside the audited run")
            gatekeeper = _decision(cluster.metadata, profile)
            _increment(cluster_counts, gatekeeper.bucket)

            primary = next((member for member in cluster.members if member.is_primary), None)
            primary_sources = (
                _source_names(primary.article, profile, job.id)
                if primary is not None and primary.article is not None
                else ()
            )
            all_sources = []
            seen_sources = set()
            for member in cluster.members:
                if member.article is None:
                    continue
                for publisher in _source_names(member.article, profile, job.id):
                    marker = publisher.casefold()
                    if marker not in seen_sources:
                        all_sources.append(publisher)
                        seen_sources.add(marker)
            cluster_rows.append(
                GatekeeperClusterAuditRow(
                    cluster_id=cluster.id,
                    stable_id=cluster.stable_id,
                    crawl_job_id=job.id,
                    profile=profile,
                    title=cluster.title,
                    summary=cluster.summary,
                    source=primary_sources[0] if primary_sources else None,
                    sources=tuple(all_sources),
                    article_count=len(cluster.members),
                    created_at=cluster.created_at,
                    gatekeeper=gatekeeper,
                )
            )

            for member in cluster.members:
                _increment(article_counts, gatekeeper.bucket)
                if len(article_rows) >= limit:
                    articles_truncated = True
                    continue
                article = member.article
                if article is None:
                    continue
                sources = _source_names(article, profile, job.id)
                disposition = (
                    self.repository.get_disposition(article.id, normalized_actor, profile)
                    if normalized_actor
                    else None
                )
                article_rows.append(
                    GatekeeperArticleAuditRow(
                        article_id=article.id,
                        stable_id=article.stable_id,
                        cluster_id=cluster.id,
                        crawl_job_id=job.id,
                        profile=profile,
                        title=article.title,
                        summary=article.summary,
                        source=sources[0] if sources else None,
                        sources=sources,
                        canonical_url=str(article.canonical_url),
                        published_at=article.published_at,
                        is_primary=member.is_primary,
                        similarity=member.similarity,
                        gatekeeper=gatekeeper,
                        disposition=disposition,
                    )
                )

        pipeline_counters = {
            str(key): int(value)
            for key, value in job.counters.items()
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0
        }
        return GatekeeperAuditRead(
            profile=profile,
            job=job,
            latest_briefing=briefing_ref,
            counters=GatekeeperAuditCounters(
                pipeline=pipeline_counters,
                clusters=_bucket_counts(cluster_counts),
                articles=_bucket_counts(article_counts),
            ),
            clusters=tuple(cluster_rows),
            articles=tuple(article_rows),
            limit=limit,
            truncated=cluster_page.page.has_more or articles_truncated,
        )


def get_gatekeeper_audit(
    repository: SQLiteRepository,
    profile: ProfileId,
    *,
    actor_id: Optional[str] = None,
    limit: int = 100,
) -> GatekeeperAuditRead:
    """Functional adapter for API dependency wiring."""

    return GatekeeperAuditService(repository).get_latest(
        profile, actor_id=actor_id, limit=limit
    )


__all__ = [
    "GatekeeperArticleAuditRow",
    "GatekeeperAuditBucket",
    "GatekeeperAuditCounters",
    "GatekeeperAuditRead",
    "GatekeeperAuditService",
    "GatekeeperClusterAuditRow",
    "get_gatekeeper_audit",
]
