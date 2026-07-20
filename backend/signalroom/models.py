"""Typed domain contracts shared by the API, workers, and repository.

The models in this module deliberately use stable IDs and UUID primary keys.  A
stable ID describes business identity (for example, a canonical URL), while a
UUID identifies one persisted record.  API callers never need to use an article
title as an identifier.
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Dict, Generic, List, Optional, Tuple, TypeVar
from uuid import UUID, uuid4

from pydantic import (
    AnyHttpUrl,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from typing_extensions import Annotated


StableId = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=10,
        max_length=160,
        pattern=r"^[a-z][a-z0-9_-]{1,31}:[a-zA-Z0-9._~-]{8,128}$",
    ),
]
IpHash = Annotated[
    str,
    StringConstraints(pattern=r"^ip:v1:[0-9a-f]{64}$"),
]
Cursor = Annotated[str, StringConstraints(min_length=1, max_length=512)]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def make_stable_id(namespace: str, *parts: object) -> str:
    """Build a deterministic, opaque ID from normalized business keys."""

    clean_namespace = namespace.strip().lower().replace("_", "-")
    if not clean_namespace or not clean_namespace[0].isalpha():
        raise ValueError("stable ID namespace must begin with a letter")
    clean_namespace = "".join(
        character
        for character in clean_namespace
        if character.islower() or character.isdigit() or character == "-"
    )[:32]
    if len(clean_namespace) < 2:
        raise ValueError("stable ID namespace is too short")
    material = "\x1f".join(str(part).strip() for part in parts)
    if not material:
        raise ValueError("at least one non-empty stable ID component is required")
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
    return f"{clean_namespace}:{digest}"


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        from_attributes=True,
        populate_by_name=True,
        str_strip_whitespace=True,
        use_enum_values=False,
    )


class ProfileId(str, Enum):
    DEFAULT = "default"
    BROADCAST = "broadcast"

    def __str__(self) -> str:
        return self.value


class Capability(str, Enum):
    READ = "read"
    PERSONALIZE = "personalize"
    SUBMIT_FEEDBACK = "submit_feedback"
    BROADCAST = "broadcast"
    PROFILE_SWITCH = "profile_switch"
    GATEKEEPER_REVIEW = "gatekeeper_review"
    ANALYTICS = "analytics"
    MANAGE_SOURCES = "manage_sources"
    MANAGE_JOBS = "manage_jobs"
    ADMIN = "admin"


class ArticleActionType(str, Enum):
    SELECT = "select"
    DESELECT = "deselect"
    SAVE = "save"
    UNSAVE = "unsave"
    MARK_UNDER_REVIEW = "mark_under_review"
    CLEAR_REVIEW = "clear_review"
    APPROVE = "approve"
    INTERESTING = "interesting"
    NOT_INTERESTED = "not_interested"
    HIDE = "hide"
    RESTORE = "restore"


class FeedbackCategory(str, Enum):
    GENERAL = "general"
    CONTENT = "content"
    RELEVANCE = "relevance"
    USABILITY = "usability"
    PERFORMANCE = "performance"
    BUG = "bug"
    IDEA = "idea"


class TelemetryEventType(str, Enum):
    PAGE_VIEW = "page_view"
    ARTICLE_OPEN = "article_open"
    ARTICLE_ACTION = "article_action"
    SEARCH = "search"
    EXPORT = "export"
    HEARTBEAT = "heartbeat"
    FEEDBACK = "feedback"
    PROFILE_SWITCH = "profile_switch"


class CrawlJobKind(str, Enum):
    SCHEDULED = "scheduled"
    MANUAL = "manual"


class CrawlJobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CrawlJobEventType(str, Enum):
    STATUS = "status"
    PROGRESS = "progress"
    DISCOVERY = "discovery"
    WARNING = "warning"
    ERROR = "error"
    COMPLETE = "complete"


class DiscoveryMethod(str, Enum):
    RSS = "rss"
    ATOM = "atom"
    LISTING = "listing"
    MANUAL = "manual"


def _unique_text(values: Tuple[str, ...]) -> Tuple[str, ...]:
    result: List[str] = []
    seen = set()
    for value in values:
        normalized = value.strip()
        marker = normalized.casefold()
        if normalized and marker not in seen:
            result.append(normalized)
            seen.add(marker)
    return tuple(result)


class ArticleSourceCreate(StrictModel):
    stable_id: StableId
    profile: ProfileId
    source_key: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    publisher: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    url: AnyHttpUrl
    canonical_url: Optional[AnyHttpUrl] = None
    published_at: Optional[AwareDatetime] = None
    discovered_at: AwareDatetime = Field(default_factory=utc_now)
    discovery_method: DiscoveryMethod
    crawl_job_id: Optional[UUID] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ArticleSourceRead(ArticleSourceCreate):
    id: UUID
    article_id: UUID


class ArticleCreate(StrictModel):
    stable_id: StableId
    title: Annotated[str, StringConstraints(min_length=1, max_length=600)]
    canonical_url: AnyHttpUrl
    published_at: Optional[AwareDatetime] = None
    summary: Optional[Annotated[str, StringConstraints(max_length=20_000)]] = None
    intent: Optional[Annotated[str, StringConstraints(max_length=2_000)]] = None
    body_text: Optional[Annotated[str, StringConstraints(max_length=2_000_000)]] = None
    top_image_url: Optional[AnyHttpUrl] = None
    region: Annotated[str, StringConstraints(min_length=1, max_length=100)] = "Global"
    category: Annotated[str, StringConstraints(min_length=1, max_length=100)] = "Tech News"
    language: Annotated[str, StringConstraints(min_length=2, max_length=35)] = "en"
    importance_score: Annotated[float, Field(ge=0.0, le=1.0)] = 0.5
    keywords: Tuple[Annotated[str, StringConstraints(min_length=1, max_length=200)], ...] = ()
    profiles: Tuple[ProfileId, ...]
    sources: Tuple[ArticleSourceCreate, ...] = ()
    model_metadata: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("keywords")
    @classmethod
    def validate_keywords(cls, values: Tuple[str, ...]) -> Tuple[str, ...]:
        return _unique_text(values)

    @field_validator("profiles")
    @classmethod
    def validate_profiles(cls, values: Tuple[ProfileId, ...]) -> Tuple[ProfileId, ...]:
        unique = tuple(dict.fromkeys(values))
        if not unique:
            raise ValueError("at least one profile is required")
        return unique

    @model_validator(mode="after")
    def validate_source_profiles(self) -> "ArticleCreate":
        missing = [source.profile for source in self.sources if source.profile not in self.profiles]
        if missing:
            raise ValueError("every source profile must be present in article profiles")
        return self


class ArticleRead(StrictModel):
    id: UUID
    stable_id: StableId
    title: str
    canonical_url: AnyHttpUrl
    published_at: Optional[AwareDatetime] = None
    summary: Optional[str] = None
    intent: Optional[str] = None
    body_text: Optional[str] = None
    top_image_url: Optional[AnyHttpUrl] = None
    region: str
    category: str
    language: str
    importance_score: float
    keywords: Tuple[str, ...]
    profiles: Tuple[ProfileId, ...]
    sources: Tuple[ArticleSourceRead, ...]
    model_metadata: Dict[str, Any]
    metadata: Dict[str, Any]
    created_at: AwareDatetime


class ClusterMemberCreate(StrictModel):
    article_id: UUID
    rank: Annotated[int, Field(ge=0)] = 0
    similarity: Annotated[float, Field(ge=-1.0, le=1.0)]
    is_primary: bool = False


class ClusterMemberRead(ClusterMemberCreate):
    article: Optional[ArticleRead] = None


class ClusterCreate(StrictModel):
    stable_id: StableId
    profile: ProfileId
    crawl_job_id: Optional[UUID] = None
    title: Annotated[str, StringConstraints(min_length=1, max_length=600)]
    summary: Optional[Annotated[str, StringConstraints(max_length=20_000)]] = None
    intent: Optional[Annotated[str, StringConstraints(max_length=2_000)]] = None
    region: Annotated[str, StringConstraints(min_length=1, max_length=100)] = "Global"
    keywords: Tuple[Annotated[str, StringConstraints(min_length=1, max_length=200)], ...] = ()
    model_name: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    similarity_threshold: Annotated[float, Field(ge=-1.0, le=1.0)]
    members: Tuple[ClusterMemberCreate, ...]
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("keywords")
    @classmethod
    def validate_keywords(cls, values: Tuple[str, ...]) -> Tuple[str, ...]:
        return _unique_text(values)

    @field_validator("members")
    @classmethod
    def validate_members(
        cls, values: Tuple[ClusterMemberCreate, ...]
    ) -> Tuple[ClusterMemberCreate, ...]:
        if not values:
            raise ValueError("a cluster requires at least one member")
        article_ids = [member.article_id for member in values]
        if len(article_ids) != len(set(article_ids)):
            raise ValueError("cluster members must be unique")
        if sum(member.is_primary for member in values) != 1:
            raise ValueError("a cluster requires exactly one primary member")
        return values


class ClusterRead(ClusterCreate):
    id: UUID
    created_at: AwareDatetime
    members: Tuple[ClusterMemberRead, ...]


class ArticleActionRequest(StrictModel):
    action: ArticleActionType
    note: Optional[Annotated[str, StringConstraints(max_length=2_000)]] = None
    idempotency_key: Optional[
        Annotated[str, StringConstraints(min_length=8, max_length=200)]
    ] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ArticleActionCreate(ArticleActionRequest):
    article_id: UUID
    profile: ProfileId
    actor_id: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    ip_hash: Optional[IpHash] = None
    occurred_at: AwareDatetime = Field(default_factory=utc_now)


class ArticleActionRead(ArticleActionCreate):
    id: UUID


class ArticleDisposition(StrictModel):
    article_id: UUID
    actor_id: str
    selected: bool = False
    saved: bool = False
    under_review: bool = False
    approved: bool = False
    interesting: Optional[bool] = None
    hidden: bool = False
    last_action_at: Optional[AwareDatetime] = None


class VocFeedbackRequest(StrictModel):
    rating: Annotated[int, Field(ge=1, le=5)]
    category: FeedbackCategory = FeedbackCategory.GENERAL
    message: Annotated[str, StringConstraints(min_length=1, max_length=10_000)]
    allow_follow_up: bool = False
    include_diagnostics: bool = False
    contact_email: Optional[Annotated[str, StringConstraints(max_length=320)]] = None
    page: Optional[Annotated[str, StringConstraints(max_length=500)]] = None
    diagnostics: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("contact_email")
    @classmethod
    def validate_contact_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return None
        local, separator, domain = value.rpartition("@")
        if not separator or not local or "." not in domain or any(ch.isspace() for ch in value):
            raise ValueError("contact_email must be a valid email address")
        return f"{local}@{domain.lower()}"

    @model_validator(mode="after")
    def omit_unapproved_diagnostics(self) -> "VocFeedbackRequest":
        if self.diagnostics and not self.include_diagnostics:
            raise ValueError("diagnostics require include_diagnostics=true")
        if self.contact_email and not self.allow_follow_up:
            raise ValueError("contact_email requires allow_follow_up=true")
        return self


class VocFeedbackCreate(VocFeedbackRequest):
    profile: ProfileId
    actor_id: Optional[Annotated[str, StringConstraints(max_length=200)]] = None
    session_id: Optional[UUID] = None
    ip_hash: Optional[IpHash] = None


class VocFeedbackRead(VocFeedbackCreate):
    id: UUID
    reference: StableId
    created_at: AwareDatetime


class TelemetryEventRequest(StrictModel):
    event_type: TelemetryEventType
    session_id: UUID
    path: Optional[Annotated[str, StringConstraints(max_length=500)]] = None
    article_id: Optional[UUID] = None
    properties: Dict[str, Any] = Field(default_factory=dict)
    occurred_at: AwareDatetime = Field(default_factory=utc_now)


class TelemetryEventCreate(TelemetryEventRequest):
    profile: ProfileId
    actor_id: Optional[Annotated[str, StringConstraints(max_length=200)]] = None
    ip_hash: Optional[IpHash] = None


class TelemetryEventRead(TelemetryEventCreate):
    id: UUID
    received_at: AwareDatetime


class CrawlJobRequest(StrictModel):
    profile: ProfileId
    kind: CrawlJobKind = CrawlJobKind.MANUAL
    keywords: Tuple[Annotated[str, StringConstraints(min_length=1, max_length=200)], ...] = ()
    source_ids: Tuple[Annotated[str, StringConstraints(min_length=1, max_length=100)], ...] = ()
    from_date: Optional[date] = None
    to_date: Optional[date] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("keywords", "source_ids")
    @classmethod
    def validate_unique_text(cls, values: Tuple[str, ...]) -> Tuple[str, ...]:
        return _unique_text(values)

    @model_validator(mode="after")
    def validate_date_range(self) -> "CrawlJobRequest":
        if self.from_date and self.to_date and self.from_date > self.to_date:
            raise ValueError("from_date must not be after to_date")
        return self


class CrawlJobCreate(CrawlJobRequest):
    requested_by: Optional[Annotated[str, StringConstraints(max_length=200)]] = None


class CrawlJobUpdate(StrictModel):
    status: CrawlJobStatus
    counters: Dict[str, Annotated[int, Field(ge=0)]] = Field(default_factory=dict)
    error: Optional[Annotated[str, StringConstraints(max_length=10_000)]] = None

    @model_validator(mode="after")
    def validate_error(self) -> "CrawlJobUpdate":
        if self.status == CrawlJobStatus.FAILED and not self.error:
            raise ValueError("failed jobs require an error message")
        if self.status != CrawlJobStatus.FAILED and self.error:
            raise ValueError("only failed jobs may include an error message")
        return self


class CrawlJobRead(CrawlJobCreate):
    id: UUID
    stable_id: StableId
    status: CrawlJobStatus
    counters: Dict[str, int]
    error: Optional[str] = None
    created_at: AwareDatetime
    started_at: Optional[AwareDatetime] = None
    completed_at: Optional[AwareDatetime] = None


class CrawlJobEventCreate(StrictModel):
    job_id: UUID
    event_type: CrawlJobEventType
    message: Annotated[str, StringConstraints(min_length=1, max_length=4_000)]
    payload: Dict[str, Any] = Field(default_factory=dict)


class CrawlJobEventRead(CrawlJobEventCreate):
    id: UUID
    sequence: int
    created_at: AwareDatetime


class BriefingSnapshotCreate(StrictModel):
    stable_id: StableId
    profile: ProfileId
    crawl_job_id: Optional[UUID] = None
    article_ids: Tuple[UUID, ...]
    generated_by: Optional[Annotated[str, StringConstraints(max_length=200)]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("article_ids")
    @classmethod
    def unique_articles(cls, values: Tuple[UUID, ...]) -> Tuple[UUID, ...]:
        if len(values) != len(set(values)):
            raise ValueError("briefing article IDs must be unique")
        return values


class BriefingSnapshotRead(BriefingSnapshotCreate):
    id: UUID
    created_at: AwareDatetime
    articles: Tuple[ArticleRead, ...] = ()


class WorklistItem(StrictModel):
    article: ArticleRead
    disposition: ArticleDisposition


class AnalyticsSummary(StrictModel):
    profile: Optional[ProfileId] = None
    unique_actors: int
    unique_sessions: int
    total_events: int
    article_opens: int
    article_actions: int
    feedback_submissions: int
    heartbeat_events: int


class PageParams(StrictModel):
    limit: Annotated[int, Field(ge=1, le=100)] = 25
    cursor: Optional[Cursor] = None


class PageInfo(StrictModel):
    limit: int
    has_more: bool
    next_cursor: Optional[str] = None


PageItem = TypeVar("PageItem")


class Page(StrictModel, Generic[PageItem]):
    items: List[PageItem]
    page: PageInfo


class ErrorResponse(StrictModel):
    code: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    message: Annotated[str, StringConstraints(min_length=1, max_length=2_000)]
    request_id: Optional[UUID] = None


def new_record_id() -> UUID:
    return uuid4()
