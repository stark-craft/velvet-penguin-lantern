"""Versioned HTTP API for Signalroom.

The router in this module is deliberately thin: identity and profile access are
resolved per request, while persistence and pipeline work remain in their
respective services.  This keeps the API usable with an injected repository and
pipeline in tests and in alternate process compositions.
"""

from __future__ import annotations

import re
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator

from signalroom.config import Settings
from signalroom.ml.training import train_gatekeeper
from signalroom.models import (
    AnalyticsSummary,
    ArticleActionCreate,
    ArticleActionRead,
    ArticleActionRequest,
    ArticleActionType,
    ArticleDisposition,
    ArticleRead,
    BriefingSnapshotRead,
    Capability,
    ClusterRead,
    CrawlJobCreate,
    CrawlJobEventRead,
    CrawlJobKind,
    CrawlJobRead,
    CrawlJobRequest,
    CrawlJobStatus,
    CrawlJobUpdate,
    Page,
    PageParams,
    ProfileId,
    TelemetryEventCreate,
    TelemetryEventRead,
    TelemetryEventRequest,
    VocFeedbackCreate,
    VocFeedbackRead,
    VocFeedbackRequest,
    WorklistItem,
)
from signalroom.profiles import ProfileRegistry
from signalroom.security import Principal, require_capability, resolve_principal
from signalroom.services.access import actor_id, resolve_profile
from signalroom.services.analytics import DetailedAnalytics, build_detailed_analytics
from signalroom.services.exports import (
    ExportArticleNotFoundError,
    ExportRequest,
    ExportService,
)
from signalroom.services.gatekeeper_audit import (
    GatekeeperAuditRead,
    get_gatekeeper_audit,
)
from signalroom.services.pipeline import PipelineService
from signalroom.services.source_configuration import (
    SourceAlreadyExistsError,
    create_source,
    update_source,
)
from signalroom.storage import RecordNotFoundError, SQLiteRepository


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class HealthResponse(ApiModel):
    status: str
    environment: str
    database_schema: int
    enabled_profiles: Tuple[ProfileId, ...]
    time: datetime


class ViewerPreferenceWrite(ApiModel):
    display_name: str = Field(min_length=1, max_length=60)
    contact_email: Optional[str] = Field(default=None, max_length=254)

    @field_validator("contact_email")
    @classmethod
    def validate_contact_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        normalized = value.strip().casefold()
        local, separator, domain = normalized.rpartition("@")
        if (
            not separator
            or not local
            or "." not in domain
            or domain.startswith(".")
            or domain.endswith(".")
            or any(character.isspace() for character in normalized)
        ):
            raise ValueError("contact_email must be a valid email address")
        return normalized


class ViewerPreferenceRead(ViewerPreferenceWrite):
    actor_id: str
    created_at: datetime
    updated_at: datetime


class MeResponse(ApiModel):
    actor_id: str
    identity: Optional[str] = None
    active_profile: ProfileId
    capabilities: Tuple[Capability, ...]
    authentication_method: str
    preferences: Optional[ViewerPreferenceRead] = None


class ProfileSummary(ApiModel):
    id: ProfileId
    label: str
    active: bool
    enabled: bool
    source_count: int
    keyword_count: int


class ArticleActionResult(ApiModel):
    action: ArticleActionRead
    disposition: ArticleDisposition


class BatchArticleActionRequest(ApiModel):
    article_ids: Tuple[UUID, ...] = Field(min_length=1, max_length=100)
    action: ArticleActionType
    note: Optional[str] = Field(default=None, max_length=2_000)
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=100)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class JobSubmissionResponse(ApiModel):
    job: CrawlJobRead
    status_url: str
    events_url: str


class GatekeeperTrainingRequest(ApiModel):
    profile: ProfileId
    min_samples: int = Field(default=4, ge=2, le=100_000)
    prefer_sklearn: bool = True
    version: Optional[str] = Field(default=None, min_length=1, max_length=96)


class SourceSummary(ApiModel):
    id: str
    name: str
    enabled: bool
    category: str
    rss_url: Optional[str] = None
    homepage: Optional[str] = None
    url: Optional[str] = None
    region: str
    timezone: str
    max_links: int
    allow_deep_scan: bool
    manual_deep_scan_candidate: bool


class SourceMutation(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    url: AnyHttpUrl
    category: str = Field(min_length=1, max_length=100)
    region: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    allow_deep_scan: bool = True
    timezone: str = Field(default="Asia/Kolkata", min_length=1, max_length=100)
    max_links: int = Field(default=100, ge=1, le=500)
    manual_deep_scan_candidate: bool = False


class FeedGatekeeper(ApiModel):
    verdict: str
    reason: str
    considered: List[str]


class FeedArticle(ApiModel):
    id: str
    headline: str
    summary: str
    insight: str
    source: str
    sourceCode: str
    author: str
    published: str
    date: str
    publishedAt: Optional[datetime] = None
    canonicalUrl: Optional[str] = None
    image: str
    category: str
    team: str
    region: str
    keywords: List[str]
    entities: List[str]
    technologies: List[str]
    priority: str
    relevance: int
    confidence: int
    signal: str
    status: str
    credibility: int
    gatekeeper: FeedGatekeeper


class FeedClusterSource(ApiModel):
    source: str
    code: str
    headline: str
    time: str
    summary: str
    similarity: int
    duplicate: Optional[str] = None
    articleId: Optional[str] = None
    url: Optional[str] = None


class FeedCluster(ApiModel):
    id: str
    title: str
    summary: str
    image: str
    category: str
    team: str
    region: str
    confidence: int
    priority: str
    signal: str
    entities: List[str]
    sources: List[FeedClusterSource]
    timeRange: str
    publishedAt: Optional[datetime] = None


class FeedBriefing(ApiModel):
    id: str
    generated_at: datetime
    crawl_job_id: Optional[str] = None
    counters: Dict[str, int]


class FeedResponse(ApiModel):
    profile: ProfileId
    briefing: Optional[FeedBriefing] = None
    articles: List[FeedArticle]
    clusters: List[FeedCluster]


class BackgroundJobManager:
    """Submit persistent pipeline jobs to a bounded worker pool.

    The crawl job is created before submission, so the client always receives a
    durable job ID.  PipelineService owns all subsequent status transitions.
    """

    def __init__(
        self,
        pipeline: PipelineService,
        repository: SQLiteRepository,
        *,
        executor: Optional[ThreadPoolExecutor] = None,
        max_workers: int = 2,
    ) -> None:
        self.pipeline = pipeline
        self.repository = repository
        self._executor = executor or ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="signalroom-scan",
        )
        self._owns_executor = executor is None
        self._lock = threading.Lock()
        self._futures: Dict[UUID, Future[Any]] = {}

    def submit(self, job: CrawlJobRead, payload: CrawlJobRequest) -> Future[Any]:
        try:
            future = self._executor.submit(
                self.pipeline.run_profile,
                profile_id=job.profile,
                trigger="manual",
                requested_by=job.requested_by,
                from_date=payload.from_date,
                to_date=payload.to_date,
                keywords=payload.keywords or None,
                source_ids=payload.source_ids or None,
                job=job,
            )
        except Exception as exc:
            self.repository.update_job(
                job.id,
                CrawlJobUpdate(
                    status=CrawlJobStatus.FAILED,
                    counters={},
                    error=f"background submission failed: {exc}"[:10_000],
                ),
            )
            raise
        with self._lock:
            self._futures[job.id] = future
        future.add_done_callback(lambda _: self._forget(job.id))
        return future

    def _forget(self, job_id: UUID) -> None:
        with self._lock:
            self._futures.pop(job_id, None)

    def is_active(self, job_id: UUID) -> bool:
        with self._lock:
            future = self._futures.get(job_id)
        return bool(future and not future.done())

    def shutdown(self, *, wait: bool = False) -> None:
        if self._owns_executor:
            self._executor.shutdown(wait=wait, cancel_futures=True)


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _profiles(request: Request) -> ProfileRegistry:
    return request.app.state.profiles


def _repository(request: Request) -> SQLiteRepository:
    return request.app.state.repository


def _pipeline(request: Request) -> PipelineService:
    return request.app.state.pipeline


def _job_manager(request: Request) -> BackgroundJobManager:
    return request.app.state.job_manager


def current_principal(
    request: Request,
    settings: Settings = Depends(_settings),
) -> Principal:
    verified_identity = getattr(request.state, "verified_identity", None)
    try:
        return resolve_principal(
            request,
            settings,
            verified_identity=verified_identity,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def capability_dependency(capability: Capability) -> Callable[..., Principal]:
    def dependency(principal: Principal = Depends(current_principal)) -> Principal:
        try:
            require_capability(principal, capability)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        return principal

    return dependency


require_read = capability_dependency(Capability.READ)
require_personalize = capability_dependency(Capability.PERSONALIZE)
require_feedback = capability_dependency(Capability.SUBMIT_FEEDBACK)
require_jobs = capability_dependency(Capability.MANAGE_JOBS)
require_sources = capability_dependency(Capability.MANAGE_SOURCES)
require_analytics = capability_dependency(Capability.ANALYTICS)
require_gatekeeper = capability_dependency(Capability.GATEKEEPER_REVIEW)


def _active_profile(
    request: Request,
    principal: Principal,
    settings: Settings,
    requested: Optional[ProfileId],
) -> ProfileId:
    try:
        automatic = resolve_profile(request, settings, principal, None)
        if (
            requested is not None
            and requested != automatic
            and not principal.can(Capability.PROFILE_SWITCH)
        ):
            raise PermissionError("profile switching is not enabled for this viewer")
        return resolve_profile(
            request,
            settings,
            principal,
            requested.value if requested else None,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _page(limit: int, cursor: Optional[str]) -> PageParams:
    return PageParams(limit=limit, cursor=cursor)


def _article_for_profile(
    repository: SQLiteRepository,
    article_id: UUID,
    profile: ProfileId,
) -> ArticleRead:
    article = repository.get_article(article_id, profile=profile)
    if profile not in article.profiles:
        # Do not reveal records belonging only to another desk.
        raise RecordNotFoundError(f"article not found: {article_id}")
    return article


def _source_code(source: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", source)
    if not words:
        return "?"
    if len(words) == 1:
        return words[0][:2].upper()
    return "".join(word[0] for word in words[:3]).upper()


def _source_summary(site: Any) -> SourceSummary:
    return SourceSummary(
        id=site.id,
        name=site.name,
        enabled=site.enabled,
        category=site.category,
        rss_url=str(site.rss_url) if site.rss_url else None,
        homepage=str(site.homepage) if site.homepage else None,
        url=str(site.url) if site.url else None,
        region=site.region,
        timezone=site.timezone,
        max_links=site.max_links,
        allow_deep_scan=site.allow_deep_scan,
        manual_deep_scan_candidate=site.manual_deep_scan_candidate,
    )


def _entities(article: ArticleRead) -> List[str]:
    supplied = article.metadata.get("entities")
    if isinstance(supplied, (list, tuple)):
        return list(dict.fromkeys(str(item).strip() for item in supplied if str(item).strip()))[
            :8
        ]
    candidates = re.findall(
        r"\b(?:[A-Z][A-Za-z0-9+.-]*)(?:\s+[A-Z][A-Za-z0-9+.-]*){0,2}\b",
        article.title,
    )
    ignored = {"The", "A", "An", "New", "This", "That"}
    return [item for item in dict.fromkeys(candidates) if item not in ignored][:8]


def _display_time(value: Optional[datetime], timezone_name: str) -> Tuple[str, str]:
    if value is None:
        return "Unknown", "Unknown date"
    localized = value.astimezone(ZoneInfo(timezone_name))
    return localized.strftime("%H:%M %Z"), localized.strftime("%d %b %Y")


def _priority(value: Any, relevance: int) -> str:
    normalized = str(value or "").strip().casefold()
    if normalized in {"critical", "high", "medium", "low"}:
        return normalized
    if relevance >= 90:
        return "critical"
    if relevance >= 75:
        return "high"
    if relevance >= 55:
        return "medium"
    return "low"


def _signal(value: Any) -> str:
    normalized = str(value or "").strip().casefold()
    if normalized in {"opportunity", "risk", "mixed", "neutral"}:
        return normalized
    return "neutral"


def _article_status(
    repository: SQLiteRepository,
    article: ArticleRead,
    profile: ProfileId,
    actor: str,
) -> Tuple[str, bool]:
    disposition = repository.get_disposition(article.id, actor, profile)
    if disposition.hidden:
        return "Hidden", True
    if disposition.interesting is False:
        return "Not Interested", True
    if disposition.approved:
        return "Approved", False
    if disposition.under_review:
        return "Under Review", False
    if disposition.selected:
        return "Selected", False
    return "New", False


def _feed_article(
    repository: SQLiteRepository,
    article: ArticleRead,
    profile: ProfileId,
    actor: str,
    timezone_name: str,
) -> Tuple[FeedArticle, bool]:
    source_record = article.sources[0] if article.sources else None
    source = (
        source_record.publisher
        if source_record is not None
        else str(article.metadata.get("source") or "Unknown")
    )
    published, date = _display_time(article.published_at, timezone_name)
    relevance = max(0, min(100, round(article.importance_score * 100)))
    gatekeeper = article.model_metadata.get("gatekeeper") or {}
    decision = str(gatekeeper.get("decision") or "keep")
    confidence = 50
    if isinstance(article.metadata.get("intent_confidence"), (int, float)):
        confidence = round(float(article.metadata["intent_confidence"]) * 100)
    confidence = max(0, min(100, confidence))
    status_label, hidden = _article_status(repository, article, profile, actor)
    author_value = article.metadata.get("author") or ""
    if isinstance(author_value, (list, tuple)):
        author_value = ", ".join(str(item) for item in author_value)
    technologies = article.metadata.get("technologies") or []
    if not isinstance(technologies, (list, tuple)):
        technologies = [str(technologies)] if technologies else []
    credibility = article.metadata.get("credibility")
    if not isinstance(credibility, (int, float)):
        credibility = 88 if article.metadata.get("extraction_quality") == "good" else 75
    reason = str(gatekeeper.get("reason") or "retained_by_current_relevance_policy")
    feed = FeedArticle(
        id=str(article.id),
        headline=article.title,
        summary=article.summary or str(article.metadata.get("excerpt") or ""),
        insight=str(article.metadata.get("insight") or ""),
        source=source,
        sourceCode=_source_code(source),
        author=str(author_value),
        published=published,
        date=date,
        publishedAt=article.published_at,
        canonicalUrl=str(article.canonical_url),
        image=str(article.top_image_url or ""),
        category=article.category,
        team=str(article.metadata.get("team") or "Intelligence"),
        region=article.region,
        keywords=list(article.keywords),
        entities=_entities(article),
        technologies=[str(item) for item in technologies],
        priority=_priority(article.metadata.get("priority"), relevance),
        relevance=relevance,
        confidence=confidence,
        signal=_signal(article.intent),
        status=status_label,
        credibility=max(0, min(100, round(float(credibility)))),
        gatekeeper=FeedGatekeeper(
            verdict="Rejected" if decision == "drop" else "Retained",
            reason=reason.replace("_", " ").capitalize(),
            considered=list(article.keywords),
        ),
    )
    return feed, hidden


def _feed_cluster(cluster: ClusterRead, timezone_name: str) -> FeedCluster:
    primary = next((member.article for member in cluster.members if member.is_primary), None)
    primary = primary or next(
        (member.article for member in cluster.members if member.article is not None), None
    )
    source_rows = cluster.metadata.get("sources") or []
    sources: List[FeedClusterSource] = []
    timestamps: List[datetime] = []
    if isinstance(source_rows, list):
        for row in source_rows:
            if not isinstance(row, dict):
                continue
            raw_time = row.get("published_at")
            parsed: Optional[datetime] = None
            if raw_time:
                try:
                    parsed = datetime.fromisoformat(str(raw_time).replace("Z", "+00:00"))
                except ValueError:
                    parsed = None
            if parsed is not None:
                timestamps.append(parsed)
            time_label, _ = _display_time(parsed, timezone_name)
            source_name = str(row.get("source") or "Unknown")
            sources.append(
                FeedClusterSource(
                    source=source_name,
                    code=str(row.get("code") or _source_code(source_name)),
                    headline=str(row.get("headline") or cluster.title),
                    time=time_label.split(" ", 1)[0],
                    summary=str(row.get("summary") or ""),
                    similarity=max(0, min(100, round(float(row.get("similarity") or 0)))),
                    articleId=(
                        str(row.get("article_id") or row.get("articleId"))
                        if row.get("article_id") or row.get("articleId")
                        else None
                    ),
                    url=str(row.get("url") or "") or None,
                )
            )
    if not sources:
        for member in cluster.members:
            article = member.article
            if article is None:
                continue
            source_record = article.sources[0] if article.sources else None
            source_name = source_record.publisher if source_record else "Unknown"
            time_label, _ = _display_time(article.published_at, timezone_name)
            if article.published_at is not None:
                timestamps.append(article.published_at)
            sources.append(
                FeedClusterSource(
                    source=source_name,
                    code=_source_code(source_name),
                    headline=article.title,
                    time=time_label.split(" ", 1)[0],
                    summary=article.summary or str(article.metadata.get("excerpt") or ""),
                    similarity=max(0, min(100, round(member.similarity * 100))),
                    articleId=str(article.id),
                    url=(
                        str(source_record.canonical_url or source_record.url)
                        if source_record is not None
                        else str(article.canonical_url)
                    ),
                )
            )
    local_zone = ZoneInfo(timezone_name)
    localized_times = sorted(value.astimezone(local_zone) for value in timestamps)
    zone_label = localized_times[0].tzname() if localized_times else None
    time_range = (
        f"{localized_times[0]:%H:%M}–{localized_times[-1]:%H:%M} {zone_label or timezone_name}"
        if localized_times
        else "Time unavailable"
    )
    similarities = [member.similarity for member in cluster.members]
    confidence = (
        round(sum(similarities) / len(similarities) * 100) if similarities else 50
    )
    relevance = (
        round(primary.importance_score * 100) if primary is not None else confidence
    )
    return FeedCluster(
        id=str(cluster.id),
        title=cluster.title,
        summary=cluster.summary or "",
        image=str(primary.top_image_url or "") if primary is not None else "",
        category=primary.category if primary is not None else "Technology",
        team=(
            str(primary.metadata.get("team") or "Intelligence")
            if primary is not None
            else "Intelligence"
        ),
        region=cluster.region,
        confidence=max(0, min(100, confidence)),
        priority=_priority(cluster.metadata.get("priority"), relevance),
        signal=_signal(cluster.intent),
        entities=_entities(primary) if primary is not None else [],
        sources=sources,
        timeRange=time_range,
        publishedAt=localized_times[-1] if localized_times else None,
    )


router = APIRouter(prefix="/api/v1")


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health(
    settings: Settings = Depends(_settings),
    profiles: ProfileRegistry = Depends(_profiles),
    repository: SQLiteRepository = Depends(_repository),
) -> HealthResponse:
    return HealthResponse(
        status="ok",
        environment=settings.environment,
        database_schema=repository.schema_version,
        enabled_profiles=tuple(item.id for item in profiles.enabled()),
        time=datetime.now(timezone.utc),
    )


@router.get("/me", response_model=MeResponse, tags=["identity"])
def me(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_read),
) -> MeResponse:
    active = _active_profile(request, principal, settings, profile)
    preference_reader = getattr(repository, "get_viewer_preference", None)
    preference = (
        preference_reader(actor_id(principal)) if callable(preference_reader) else None
    )
    return MeResponse(
        actor_id=actor_id(principal),
        identity=principal.identity,
        active_profile=active,
        capabilities=principal.capabilities,
        authentication_method=principal.authentication_method,
        preferences=(
            ViewerPreferenceRead.model_validate(preference) if preference else None
        ),
    )


@router.get(
    "/me/preferences",
    response_model=Optional[ViewerPreferenceRead],
    tags=["identity"],
)
def get_viewer_preferences(
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_personalize),
) -> Optional[ViewerPreferenceRead]:
    preference_reader = getattr(repository, "get_viewer_preference", None)
    if not callable(preference_reader):
        return None
    preference = preference_reader(actor_id(principal))
    return ViewerPreferenceRead.model_validate(preference) if preference else None


@router.put(
    "/me/preferences",
    response_model=ViewerPreferenceRead,
    tags=["identity"],
)
def save_viewer_preferences(
    payload: ViewerPreferenceWrite,
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_personalize),
) -> ViewerPreferenceRead:
    preference_writer = getattr(repository, "upsert_viewer_preference", None)
    if not callable(preference_writer):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="viewer preference storage is unavailable",
        )
    preference = preference_writer(
        actor_id(principal),
        display_name=payload.display_name,
        contact_email=payload.contact_email,
    )
    return ViewerPreferenceRead.model_validate(preference)


@router.get("/profiles", response_model=List[ProfileSummary], tags=["identity"])
def list_profiles(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    profiles: ProfileRegistry = Depends(_profiles),
    principal: Principal = Depends(require_read),
) -> List[ProfileSummary]:
    profiles = ProfileRegistry.from_settings(settings)
    active = _active_profile(request, principal, settings, profile)
    can_switch = principal.can(Capability.PROFILE_SWITCH)
    visible = []
    for loaded in profiles.enabled():
        if loaded.id != active and not can_switch:
            continue
        visible.append(
            ProfileSummary(
                id=loaded.id,
                label=loaded.label,
                active=loaded.id == active,
                enabled=loaded.enabled,
                source_count=len(loaded.enabled_sites),
                keyword_count=len(loaded.keywords),
            )
        )
    return visible


@router.get("/sources", response_model=List[SourceSummary], tags=["sources"])
def list_sources(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    profiles: ProfileRegistry = Depends(_profiles),
    principal: Principal = Depends(require_read),
) -> List[SourceSummary]:
    profiles = ProfileRegistry.from_settings(settings)
    active = _active_profile(request, principal, settings, profile)
    loaded = profiles.get(active)
    return [_source_summary(site) for site in loaded.sites]


@router.post(
    "/sources",
    response_model=SourceSummary,
    status_code=status.HTTP_201_CREATED,
    tags=["sources"],
)
def add_source(
    request: Request,
    payload: SourceMutation,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    principal: Principal = Depends(require_sources),
) -> SourceSummary:
    active = _active_profile(request, principal, settings, profile)
    try:
        site, profiles = create_source(
            settings,
            active,
            payload.model_dump(mode="json"),
        )
    except SourceAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    request.app.state.profiles = profiles
    return _source_summary(site)


@router.put(
    "/sources/{source_id}",
    response_model=SourceSummary,
    tags=["sources"],
)
def edit_source(
    request: Request,
    source_id: str,
    payload: SourceMutation,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    principal: Principal = Depends(require_sources),
) -> SourceSummary:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", source_id):
        raise HTTPException(status_code=422, detail="source_id must be a source slug")
    active = _active_profile(request, principal, settings, profile)
    site, profiles = update_source(
        settings,
        active,
        source_id,
        payload.model_dump(mode="json"),
    )
    if site is None:
        raise HTTPException(status_code=404, detail=f"source not found: {source_id}")
    request.app.state.profiles = profiles
    return _source_summary(site)


@router.get("/feed", response_model=FeedResponse, tags=["briefings"])
def feed(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_read),
) -> FeedResponse:
    active = _active_profile(request, principal, settings, profile)
    briefing = repository.get_latest_briefing(active)
    if briefing is None:
        return FeedResponse(profile=active, briefing=None, articles=[], clusters=[])

    actor = actor_id(principal)
    clusters: List[ClusterRead] = []
    cluster_ids = briefing.metadata.get("cluster_ids") or []
    if isinstance(cluster_ids, list):
        for identifier in cluster_ids:
            try:
                cluster = repository.get_cluster(UUID(str(identifier)))
            except (ValueError, RecordNotFoundError):
                continue
            if cluster.profile == active and cluster.metadata.get("retained") is not False:
                clusters.append(cluster)
    if not clusters and briefing.crawl_job_id is not None:
        clusters = [
            item
            for item in repository.list_clusters(
                profile=active,
                crawl_job_id=briefing.crawl_job_id,
                page=PageParams(limit=100),
            ).items
            if item.metadata.get("retained") is not False
        ]
    multi_member_clusters = [item for item in clusters if len(item.members) > 1]
    clustered_representatives = {
        member.article_id
        for cluster in multi_member_clusters
        for member in cluster.members
        if member.is_primary
    }
    visible_clusters = []
    for cluster in multi_member_clusters:
        primary = next(
            (member.article for member in cluster.members if member.is_primary),
            None,
        )
        if primary is not None:
            _, hidden = _article_status(repository, primary, active, actor)
            if hidden:
                continue
        visible_clusters.append(_feed_cluster(cluster, settings.timezone_name))

    articles = []
    for article in briefing.articles:
        if article.id in clustered_representatives:
            continue
        mapped, hidden = _feed_article(
            repository,
            article,
            active,
            actor,
            settings.timezone_name,
        )
        if not hidden:
            articles.append(mapped)
    counters = {
        str(key): int(value)
        for key, value in (briefing.metadata.get("counters") or {}).items()
        if isinstance(value, int) and value >= 0
    }
    return FeedResponse(
        profile=active,
        briefing=FeedBriefing(
            id=str(briefing.id),
            generated_at=briefing.created_at,
            crawl_job_id=str(briefing.crawl_job_id) if briefing.crawl_job_id else None,
            counters=counters,
        ),
        articles=articles,
        clusters=visible_clusters,
    )


@router.get(
    "/briefings/latest",
    response_model=Optional[BriefingSnapshotRead],
    tags=["briefings"],
)
def latest_briefing(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_read),
) -> Optional[BriefingSnapshotRead]:
    active = _active_profile(request, principal, settings, profile)
    return repository.get_latest_briefing(active)


@router.get(
    "/briefings",
    response_model=Page[BriefingSnapshotRead],
    tags=["briefings"],
)
def list_briefings(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: Optional[str] = Query(default=None, min_length=1, max_length=512),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_read),
) -> Page[BriefingSnapshotRead]:
    active = _active_profile(request, principal, settings, profile)
    return repository.list_briefings(active, page=_page(limit, cursor))


@router.get(
    "/briefings/{briefing_id}",
    response_model=BriefingSnapshotRead,
    tags=["briefings"],
)
def get_briefing(
    briefing_id: UUID,
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_read),
) -> BriefingSnapshotRead:
    active = _active_profile(request, principal, settings, profile)
    briefing = repository.get_briefing(briefing_id)
    if briefing.profile != active:
        raise RecordNotFoundError(f"briefing not found: {briefing_id}")
    return briefing


@router.get("/articles", response_model=Page[ArticleRead], tags=["articles"])
def list_articles(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: Optional[str] = Query(default=None, min_length=1, max_length=512),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_read),
) -> Page[ArticleRead]:
    active = _active_profile(request, principal, settings, profile)
    return repository.list_articles(profile=active, page=_page(limit, cursor))


@router.get("/articles/{article_id}", response_model=ArticleRead, tags=["articles"])
def get_article(
    article_id: UUID,
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_read),
) -> ArticleRead:
    active = _active_profile(request, principal, settings, profile)
    return _article_for_profile(repository, article_id, active)


@router.get("/clusters", response_model=Page[ClusterRead], tags=["clusters"])
def list_clusters(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    crawl_job_id: Optional[UUID] = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: Optional[str] = Query(default=None, min_length=1, max_length=512),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_read),
) -> Page[ClusterRead]:
    active = _active_profile(request, principal, settings, profile)
    return repository.list_clusters(
        profile=active,
        crawl_job_id=crawl_job_id,
        page=_page(limit, cursor),
    )


@router.get("/clusters/{cluster_id}", response_model=ClusterRead, tags=["clusters"])
def get_cluster(
    cluster_id: UUID,
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_read),
) -> ClusterRead:
    active = _active_profile(request, principal, settings, profile)
    cluster = repository.get_cluster(cluster_id)
    if cluster.profile != active:
        raise RecordNotFoundError(f"cluster not found: {cluster_id}")
    return cluster


@router.post(
    "/articles/{article_id}/actions",
    response_model=ArticleActionResult,
    status_code=status.HTTP_201_CREATED,
    tags=["workflow"],
)
def record_article_action(
    article_id: UUID,
    payload: ArticleActionRequest,
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_personalize),
) -> ArticleActionResult:
    active = _active_profile(request, principal, settings, profile)
    if payload.action == ArticleActionType.APPROVE and not principal.can(
        Capability.GATEKEEPER_REVIEW
    ):
        raise HTTPException(
            status_code=403,
            detail="capability required: gatekeeper_review",
        )
    _article_for_profile(repository, article_id, active)
    actor = actor_id(principal)
    recorded = repository.record_article_action(
        ArticleActionCreate(
            **payload.model_dump(),
            article_id=article_id,
            profile=active,
            actor_id=actor,
            ip_hash=principal.ip_hash,
        )
    )
    return ArticleActionResult(
        action=recorded,
        disposition=repository.get_disposition(article_id, actor, active),
    )


@router.get(
    "/articles/{article_id}/actions",
    response_model=Page[ArticleActionRead],
    tags=["workflow"],
)
def list_article_actions(
    article_id: UUID,
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: Optional[str] = Query(default=None, min_length=1, max_length=512),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_personalize),
) -> Page[ArticleActionRead]:
    active = _active_profile(request, principal, settings, profile)
    _article_for_profile(repository, article_id, active)
    return repository.list_actions(
        article_id=article_id,
        actor_id=actor_id(principal),
        profile=active,
        page=_page(limit, cursor),
    )


@router.post(
    "/article-actions/batch",
    response_model=List[ArticleActionResult],
    status_code=status.HTTP_201_CREATED,
    tags=["workflow"],
)
def record_batch_article_actions(
    payload: BatchArticleActionRequest,
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_personalize),
) -> List[ArticleActionResult]:
    """Apply one editorial action to a bounded, prevalidated visible selection."""

    active = _active_profile(request, principal, settings, profile)
    if len(payload.article_ids) != len(set(payload.article_ids)):
        raise HTTPException(status_code=422, detail="article_ids must be unique")
    if payload.action == ArticleActionType.APPROVE and not principal.can(
        Capability.GATEKEEPER_REVIEW
    ):
        raise HTTPException(
            status_code=403,
            detail="capability required: gatekeeper_review",
        )
    for article_id in payload.article_ids:
        _article_for_profile(repository, article_id, active)

    actor = actor_id(principal)
    results = []
    for article_id in payload.article_ids:
        idempotency_key = (
            f"{payload.idempotency_key}:{article_id}"
            if payload.idempotency_key
            else None
        )
        recorded = repository.record_article_action(
            ArticleActionCreate(
                article_id=article_id,
                profile=active,
                actor_id=actor,
                action=payload.action,
                note=payload.note,
                idempotency_key=idempotency_key,
                metadata=payload.metadata,
                ip_hash=principal.ip_hash,
            )
        )
        results.append(
            ArticleActionResult(
                action=recorded,
                disposition=repository.get_disposition(article_id, actor, active),
            )
        )
    return results


@router.post("/exports", tags=["exports"])
def export_articles(
    payload: ExportRequest,
    request: Request,
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_read),
) -> Response:
    """Generate one bounded, profile-scoped file without remote media fetching."""

    active = _active_profile(request, principal, settings, payload.profile)
    try:
        result = ExportService(repository).generate(
            payload.model_copy(update={"profile": active})
        )
    except ExportArticleNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(
        content=result.content,
        media_type=result.media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{result.filename}"',
            "X-Signalroom-Article-Count": str(result.article_count),
        },
    )


@router.get("/worklists", response_model=Page[WorklistItem], tags=["workflow"])
def list_worklist(
    request: Request,
    state: str = Query(
        ...,
        pattern="^(selected|saved|under_review|approved|interesting|not_interested|hidden)$",
    ),
    profile: Optional[ProfileId] = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: Optional[str] = Query(default=None, min_length=1, max_length=512),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_personalize),
) -> Page[WorklistItem]:
    active = _active_profile(request, principal, settings, profile)
    result = repository.list_worklist(
        actor_id=actor_id(principal),
        profile=active,
        state=state,
        page=_page(limit, cursor),
    )
    return Page[WorklistItem](
        items=[
            WorklistItem(
                article=repository.get_article(item.article.id, profile=active),
                disposition=item.disposition,
            )
            for item in result.items
        ],
        page=result.page,
    )


@router.post(
    "/feedback",
    response_model=VocFeedbackRead,
    status_code=status.HTTP_201_CREATED,
    tags=["feedback"],
)
def submit_feedback(
    payload: VocFeedbackRequest,
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_feedback),
) -> VocFeedbackRead:
    active = _active_profile(request, principal, settings, profile)
    return repository.record_voc(
        VocFeedbackCreate(
            **payload.model_dump(),
            profile=active,
            actor_id=actor_id(principal),
            ip_hash=principal.ip_hash,
        )
    )


@router.post(
    "/events",
    response_model=TelemetryEventRead,
    status_code=status.HTTP_201_CREATED,
    tags=["telemetry"],
)
def record_event(
    payload: TelemetryEventRequest,
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_personalize),
) -> TelemetryEventRead:
    active = _active_profile(request, principal, settings, profile)
    if payload.article_id is not None:
        _article_for_profile(repository, payload.article_id, active)
    return repository.record_activity(
        TelemetryEventCreate(
            **payload.model_dump(),
            profile=active,
            actor_id=actor_id(principal),
            ip_hash=principal.ip_hash,
        )
    )


@router.post(
    "/admin/scans",
    response_model=JobSubmissionResponse,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["admin"],
)
def submit_scan(
    payload: CrawlJobRequest,
    request: Request,
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    manager: BackgroundJobManager = Depends(_job_manager),
    principal: Principal = Depends(require_jobs),
) -> JobSubmissionResponse:
    active = _active_profile(request, principal, settings, payload.profile)
    requested_by = actor_id(principal)
    job = repository.create_job(
        CrawlJobCreate(
            **payload.model_dump(exclude={"profile", "kind"}),
            profile=active,
            kind=CrawlJobKind.MANUAL,
            requested_by=requested_by,
        )
    )
    manager.submit(job, payload.model_copy(update={"profile": active}))
    return JobSubmissionResponse(
        job=job,
        status_url=f"/api/v1/admin/jobs/{job.id}",
        events_url=f"/api/v1/admin/jobs/{job.id}/events",
    )


@router.get("/admin/jobs/{job_id}", response_model=CrawlJobRead, tags=["admin"])
def get_job(
    job_id: UUID,
    repository: SQLiteRepository = Depends(_repository),
    _: Principal = Depends(require_jobs),
) -> CrawlJobRead:
    return repository.get_job(job_id)


@router.get(
    "/admin/jobs/{job_id}/events",
    response_model=Tuple[CrawlJobEventRead, ...],
    tags=["admin"],
)
def get_job_events(
    job_id: UUID,
    after_sequence: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1_000),
    repository: SQLiteRepository = Depends(_repository),
    _: Principal = Depends(require_jobs),
) -> Tuple[CrawlJobEventRead, ...]:
    # Distinguish an unknown job from a valid job with no events.
    repository.get_job(job_id)
    return repository.list_job_events(
        job_id,
        after_sequence=after_sequence,
        limit=limit,
    )


@router.get(
    "/admin/analytics",
    response_model=AnalyticsSummary,
    tags=["admin"],
)
def analytics(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_analytics),
) -> AnalyticsSummary:
    active = _active_profile(request, principal, settings, profile)
    return repository.analytics_summary(profile=active)


@router.get(
    "/admin/analytics/detail",
    response_model=DetailedAnalytics,
    tags=["admin"],
)
def detailed_analytics(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    window_days: int = Query(default=7, ge=1, le=90),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_analytics),
) -> DetailedAnalytics:
    active = _active_profile(request, principal, settings, profile)
    return build_detailed_analytics(
        repository,
        profile=active,
        window_days=window_days,
    )


@router.get(
    "/admin/feedback",
    response_model=Page[VocFeedbackRead],
    tags=["admin"],
)
def feedback_admin(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: Optional[str] = Query(default=None, min_length=1, max_length=512),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_analytics),
) -> Page[VocFeedbackRead]:
    active = _active_profile(request, principal, settings, profile)
    return repository.list_voc(profile=active, page=_page(limit, cursor))


@router.get(
    "/gatekeeper/audit",
    response_model=GatekeeperAuditRead,
    tags=["gatekeeper"],
)
def gatekeeper_audit(
    request: Request,
    profile: Optional[ProfileId] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=100),
    settings: Settings = Depends(_settings),
    repository: SQLiteRepository = Depends(_repository),
    principal: Principal = Depends(require_gatekeeper),
) -> GatekeeperAuditRead:
    active = _active_profile(request, principal, settings, profile)
    return get_gatekeeper_audit(
        repository,
        active,
        actor_id=actor_id(principal),
        limit=limit,
    )


@router.post("/admin/gatekeeper/train", tags=["admin"])
def train_gatekeeper_from_actions(
    payload: GatekeeperTrainingRequest,
    request: Request,
    settings: Settings = Depends(_settings),
    profiles: ProfileRegistry = Depends(_profiles),
    repository: SQLiteRepository = Depends(_repository),
    pipeline: PipelineService = Depends(_pipeline),
    principal: Principal = Depends(require_gatekeeper),
) -> Dict[str, Any]:
    active = _active_profile(request, principal, settings, payload.profile)
    loaded = profiles.get(active)
    records: List[Dict[str, Any]] = []
    keep_actions = {
        ArticleActionType.SELECT,
        ArticleActionType.SAVE,
        ArticleActionType.APPROVE,
        ArticleActionType.INTERESTING,
        ArticleActionType.RESTORE,
    }
    drop_actions = {
        ArticleActionType.NOT_INTERESTED,
        ArticleActionType.HIDE,
    }
    seen_decisions = set()
    cursor: Optional[str] = None
    while True:
        actions = repository.list_actions(
            profile=active,
            page=PageParams(limit=100, cursor=cursor),
        )
        for action in actions.items:
            if action.action not in keep_actions | drop_actions:
                continue
            decision_key = (action.actor_id, action.article_id)
            if decision_key in seen_decisions:
                continue
            seen_decisions.add(decision_key)
            try:
                article = repository.get_article(action.article_id, profile=active)
            except RecordNotFoundError:
                continue
            records.append(
                {
                    "profile": active.value,
                    "action": (
                        "not_interested"
                        if action.action in drop_actions
                        else "interesting"
                    ),
                    "article": article.model_dump(mode="json"),
                }
            )
        if not actions.page.has_more:
            break
        cursor = actions.page.next_cursor
    return train_gatekeeper(
        records,
        profile=active.value,
        artifact_root=settings.model_dir,
        embedder=getattr(pipeline, "embedder", None),
        min_samples=payload.min_samples,
        prefer_sklearn=payload.prefer_sklearn,
        version=payload.version,
        review_threshold=loaded.gatekeeper_review_threshold,
        hard_drop_threshold=loaded.gatekeeper_drop_threshold,
        prefetch_drop_threshold=loaded.prefetch_drop_threshold,
    )
