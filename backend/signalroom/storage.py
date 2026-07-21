"""SQLite persistence for Signalroom's immutable records and event streams."""

from __future__ import annotations

import base64
import ipaddress
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence, Tuple
from uuid import UUID, uuid4

from pydantic import BaseModel

from .models import (
    AnalyticsSummary,
    ArticleActionCreate,
    ArticleActionRead,
    ArticleActionType,
    ArticleCreate,
    ArticleDisposition,
    ArticleRead,
    ArticleSourceCreate,
    ArticleSourceRead,
    BriefingSnapshotCreate,
    BriefingSnapshotRead,
    ClusterCreate,
    ClusterMemberRead,
    ClusterRead,
    CrawlJobCreate,
    CrawlJobEventCreate,
    CrawlJobEventRead,
    CrawlJobRead,
    CrawlJobStatus,
    CrawlJobUpdate,
    Page,
    PageInfo,
    PageParams,
    ProfileId,
    TelemetryEventCreate,
    TelemetryEventRead,
    TelemetryEventType,
    VocFeedbackCreate,
    VocFeedbackRead,
    WorklistItem,
    make_stable_id,
    utc_now,
)


SCHEMA_VERSION = 2
RAW_IP_KEYS = frozenset(
    {
        "ip",
        "ip_address",
        "raw_ip",
        "client_ip",
        "client_host",
        "remote_addr",
        "x_forwarded_for",
        "x-forwarded-for",
    }
)
MAX_GENERIC_PAYLOAD_BYTES = 262_144
MAX_GENERIC_PAYLOAD_DEPTH = 16
MAX_GENERIC_PAYLOAD_ENTRIES = 4_096


class RepositoryError(RuntimeError):
    pass


class DuplicateRecordError(RepositoryError):
    pass


class RecordNotFoundError(RepositoryError):
    pass


class InvalidJobTransitionError(RepositoryError):
    pass


class UnsafePayloadError(RepositoryError):
    pass


def _utc_text(value: Optional[datetime] = None) -> str:
    current = value or utc_now()
    if current.tzinfo is None:
        raise ValueError("persisted timestamps must include a timezone")
    return current.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_default(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return _utc_text(value)
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, tuple):
        return list(value)
    raise TypeError(f"cannot JSON serialize {type(value).__name__}")


def json_dumps(value: Any) -> str:
    return json.dumps(
        value,
        default=_json_default,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def json_loads(value: Optional[str], default: Any) -> Any:
    if value is None or value == "":
        return default
    return json.loads(value)


def _is_exact_ip_literal(value: str) -> bool:
    candidate = value.strip()
    if not candidate:
        return False
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        return False
    return True


def _assert_no_raw_ip(
    value: Any,
    path: str = "payload",
    *,
    _depth: int = 0,
    _entries: Optional[List[int]] = None,
) -> None:
    """Reject sensitive or pathologically large generic JSON payloads.

    URL strings containing an IP host remain valid because only a complete
    string that parses as an address is considered a raw IP value.
    """

    if isinstance(value, BaseModel):
        value = value.model_dump(mode="python")

    if _entries is None:
        try:
            encoded_size = len(json_dumps(value).encode("utf-8"))
        except (TypeError, ValueError, OverflowError) as exc:
            raise UnsafePayloadError(
                f"generic payload is not safely JSON serializable: {path}"
            ) from exc
        if encoded_size > MAX_GENERIC_PAYLOAD_BYTES:
            raise UnsafePayloadError(
                f"generic payload exceeds {MAX_GENERIC_PAYLOAD_BYTES} bytes: {path}"
            )
        _entries = [0]

    if _depth > MAX_GENERIC_PAYLOAD_DEPTH:
        raise UnsafePayloadError(
            f"generic payload exceeds nesting depth {MAX_GENERIC_PAYLOAD_DEPTH}: {path}"
        )
    _entries[0] += 1
    if _entries[0] > MAX_GENERIC_PAYLOAD_ENTRIES:
        raise UnsafePayloadError(
            f"generic payload exceeds {MAX_GENERIC_PAYLOAD_ENTRIES} entries: {path}"
        )

    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key).strip()
            normalized = key_text.casefold()
            if normalized in RAW_IP_KEYS:
                raise UnsafePayloadError(f"raw IP field is not persistable: {path}.{key}")
            if _is_exact_ip_literal(key_text):
                raise UnsafePayloadError(f"raw IP key is not persistable: {path}.{key}")
            _assert_no_raw_ip(
                item,
                f"{path}.{key}",
                _depth=_depth + 1,
                _entries=_entries,
            )
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _assert_no_raw_ip(
                item,
                f"{path}[{index}]",
                _depth=_depth + 1,
                _entries=_entries,
            )
    elif isinstance(value, str) and _is_exact_ip_literal(value):
        raise UnsafePayloadError(f"raw IP value is not persistable: {path}")


def _encode_cursor(offset: int) -> str:
    encoded = base64.urlsafe_b64encode(str(offset).encode("ascii")).decode("ascii")
    return encoded.rstrip("=")


def _decode_cursor(cursor: Optional[str]) -> int:
    if cursor is None:
        return 0
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        value = int(base64.urlsafe_b64decode(padded.encode("ascii")).decode("ascii"))
    except (ValueError, UnicodeError, base64.binascii.Error) as exc:
        raise ValueError("invalid pagination cursor") from exc
    if value < 0:
        raise ValueError("invalid pagination cursor")
    return value


MIGRATION_1 = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_jobs (
    id TEXT PRIMARY KEY,
    stable_id TEXT NOT NULL UNIQUE,
    profile TEXT NOT NULL CHECK(profile IN ('default', 'broadcast')),
    kind TEXT NOT NULL CHECK(kind IN ('scheduled', 'manual')),
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    requested_by TEXT,
    request_json TEXT NOT NULL,
    counters_json TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS crawl_job_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES crawl_jobs(id),
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(job_id, sequence)
);

CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    stable_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    canonical_url TEXT NOT NULL UNIQUE,
    published_at TEXT,
    summary TEXT,
    intent TEXT,
    body_text TEXT,
    top_image_url TEXT,
    region TEXT NOT NULL,
    category TEXT NOT NULL,
    language TEXT NOT NULL,
    importance_score REAL NOT NULL CHECK(importance_score >= 0 AND importance_score <= 1),
    keywords_json TEXT NOT NULL,
    model_metadata_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_profiles (
    article_id TEXT NOT NULL REFERENCES articles(id),
    profile TEXT NOT NULL CHECK(profile IN ('default', 'broadcast')),
    first_seen_at TEXT NOT NULL,
    PRIMARY KEY(article_id, profile)
);

CREATE TABLE IF NOT EXISTS article_sources (
    id TEXT PRIMARY KEY,
    stable_id TEXT NOT NULL UNIQUE,
    article_id TEXT NOT NULL REFERENCES articles(id),
    profile TEXT NOT NULL CHECK(profile IN ('default', 'broadcast')),
    source_key TEXT NOT NULL,
    publisher TEXT NOT NULL,
    url TEXT NOT NULL,
    canonical_url TEXT,
    published_at TEXT,
    discovered_at TEXT NOT NULL,
    discovery_method TEXT NOT NULL,
    crawl_job_id TEXT REFERENCES crawl_jobs(id),
    metadata_json TEXT NOT NULL,
    UNIQUE(article_id, profile, url)
);

CREATE TABLE IF NOT EXISTS clusters (
    id TEXT PRIMARY KEY,
    stable_id TEXT NOT NULL UNIQUE,
    profile TEXT NOT NULL CHECK(profile IN ('default', 'broadcast')),
    crawl_job_id TEXT REFERENCES crawl_jobs(id),
    title TEXT NOT NULL,
    summary TEXT,
    intent TEXT,
    region TEXT NOT NULL,
    keywords_json TEXT NOT NULL,
    model_name TEXT NOT NULL,
    similarity_threshold REAL NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cluster_articles (
    cluster_id TEXT NOT NULL REFERENCES clusters(id),
    article_id TEXT NOT NULL REFERENCES articles(id),
    rank INTEGER NOT NULL,
    similarity REAL NOT NULL,
    is_primary INTEGER NOT NULL CHECK(is_primary IN (0, 1)),
    PRIMARY KEY(cluster_id, article_id)
);

CREATE TABLE IF NOT EXISTS briefing_snapshots (
    id TEXT PRIMARY KEY,
    stable_id TEXT NOT NULL UNIQUE,
    profile TEXT NOT NULL CHECK(profile IN ('default', 'broadcast')),
    crawl_job_id TEXT REFERENCES crawl_jobs(id),
    generated_by TEXT,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS briefing_articles (
    briefing_id TEXT NOT NULL REFERENCES briefing_snapshots(id),
    article_id TEXT NOT NULL REFERENCES articles(id),
    position INTEGER NOT NULL,
    PRIMARY KEY(briefing_id, article_id),
    UNIQUE(briefing_id, position)
);

CREATE TABLE IF NOT EXISTS article_actions (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL REFERENCES articles(id),
    profile TEXT NOT NULL CHECK(profile IN ('default', 'broadcast')),
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    note TEXT,
    idempotency_key TEXT,
    ip_hash TEXT,
    metadata_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_action_idempotency
ON article_actions(actor_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS voc_feedback (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    profile TEXT NOT NULL CHECK(profile IN ('default', 'broadcast')),
    actor_id TEXT,
    session_id TEXT,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    allow_follow_up INTEGER NOT NULL CHECK(allow_follow_up IN (0, 1)),
    include_diagnostics INTEGER NOT NULL CHECK(include_diagnostics IN (0, 1)),
    contact_email TEXT,
    page TEXT,
    diagnostics_json TEXT NOT NULL,
    ip_hash TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    session_id TEXT NOT NULL,
    profile TEXT NOT NULL CHECK(profile IN ('default', 'broadcast')),
    actor_id TEXT,
    path TEXT,
    article_id TEXT REFERENCES articles(id),
    properties_json TEXT NOT NULL,
    ip_hash TEXT,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_article_profiles_profile
ON article_profiles(profile, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_article ON article_sources(article_id, discovered_at);
CREATE INDEX IF NOT EXISTS idx_clusters_profile ON clusters(profile, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON crawl_job_events(job_id, sequence);
CREATE INDEX IF NOT EXISTS idx_briefings_profile ON briefing_snapshots(profile, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_actor
ON article_actions(actor_id, profile, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_article ON article_actions(article_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_voc_created ON voc_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_session ON telemetry_events(session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_actor ON telemetry_events(actor_id, occurred_at DESC);

CREATE TRIGGER IF NOT EXISTS immutable_articles_update
BEFORE UPDATE ON articles BEGIN SELECT RAISE(ABORT, 'articles are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_articles_delete
BEFORE DELETE ON articles BEGIN SELECT RAISE(ABORT, 'articles are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_article_profiles_update
BEFORE UPDATE ON article_profiles BEGIN SELECT RAISE(ABORT, 'article profiles are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_article_profiles_delete
BEFORE DELETE ON article_profiles BEGIN SELECT RAISE(ABORT, 'article profiles are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_sources_update
BEFORE UPDATE ON article_sources BEGIN SELECT RAISE(ABORT, 'article sources are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_sources_delete
BEFORE DELETE ON article_sources BEGIN SELECT RAISE(ABORT, 'article sources are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_clusters_update
BEFORE UPDATE ON clusters BEGIN SELECT RAISE(ABORT, 'clusters are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_clusters_delete
BEFORE DELETE ON clusters BEGIN SELECT RAISE(ABORT, 'clusters are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_cluster_articles_update
BEFORE UPDATE ON cluster_articles BEGIN SELECT RAISE(ABORT, 'cluster members are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_cluster_articles_delete
BEFORE DELETE ON cluster_articles BEGIN SELECT RAISE(ABORT, 'cluster members are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_briefings_update
BEFORE UPDATE ON briefing_snapshots BEGIN SELECT RAISE(ABORT, 'briefings are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_briefings_delete
BEFORE DELETE ON briefing_snapshots BEGIN SELECT RAISE(ABORT, 'briefings are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_briefing_articles_update
BEFORE UPDATE ON briefing_articles BEGIN SELECT RAISE(ABORT, 'briefing members are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_briefing_articles_delete
BEFORE DELETE ON briefing_articles BEGIN SELECT RAISE(ABORT, 'briefing members are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_job_request
BEFORE UPDATE ON crawl_jobs
WHEN NEW.id != OLD.id
  OR NEW.stable_id != OLD.stable_id
  OR NEW.profile != OLD.profile
  OR NEW.kind != OLD.kind
  OR NEW.requested_by IS NOT OLD.requested_by
  OR NEW.request_json != OLD.request_json
  OR NEW.created_at != OLD.created_at
BEGIN SELECT RAISE(ABORT, 'crawl job request fields are immutable'); END;
CREATE TRIGGER IF NOT EXISTS append_only_job_events_update
BEFORE UPDATE ON crawl_job_events BEGIN SELECT RAISE(ABORT, 'job events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS append_only_job_events_delete
BEFORE DELETE ON crawl_job_events BEGIN SELECT RAISE(ABORT, 'job events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS append_only_actions_update
BEFORE UPDATE ON article_actions BEGIN SELECT RAISE(ABORT, 'actions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS append_only_actions_delete
BEFORE DELETE ON article_actions BEGIN SELECT RAISE(ABORT, 'actions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS append_only_voc_update
BEFORE UPDATE ON voc_feedback BEGIN SELECT RAISE(ABORT, 'VOC is append-only'); END;
CREATE TRIGGER IF NOT EXISTS append_only_voc_delete
BEFORE DELETE ON voc_feedback BEGIN SELECT RAISE(ABORT, 'VOC is append-only'); END;
CREATE TRIGGER IF NOT EXISTS append_only_events_update
BEFORE UPDATE ON telemetry_events BEGIN SELECT RAISE(ABORT, 'telemetry is append-only'); END;
CREATE TRIGGER IF NOT EXISTS append_only_events_delete
BEFORE DELETE ON telemetry_events BEGIN SELECT RAISE(ABORT, 'telemetry is append-only'); END;
"""


MIGRATION_2 = """
CREATE TABLE IF NOT EXISTS article_profile_intelligence (
    id TEXT PRIMARY KEY,
    stable_id TEXT NOT NULL UNIQUE,
    article_id TEXT NOT NULL REFERENCES articles(id),
    profile TEXT NOT NULL CHECK(profile IN ('default', 'broadcast')),
    crawl_job_id TEXT REFERENCES crawl_jobs(id),
    summary TEXT,
    intent TEXT,
    region TEXT NOT NULL,
    category TEXT NOT NULL,
    language TEXT NOT NULL,
    importance_score REAL NOT NULL CHECK(importance_score >= 0 AND importance_score <= 1),
    keywords_json TEXT NOT NULL,
    model_metadata_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_article_intelligence_lookup
ON article_profile_intelligence(article_id, profile, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_intelligence_job
ON article_profile_intelligence(crawl_job_id, profile);

CREATE TRIGGER IF NOT EXISTS immutable_article_intelligence_update
BEFORE UPDATE ON article_profile_intelligence
BEGIN SELECT RAISE(ABORT, 'article intelligence snapshots are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_article_intelligence_delete
BEFORE DELETE ON article_profile_intelligence
BEGIN SELECT RAISE(ABORT, 'article intelligence snapshots are immutable'); END;
"""


ALLOWED_JOB_TRANSITIONS = {
    CrawlJobStatus.QUEUED: {
        CrawlJobStatus.RUNNING,
        CrawlJobStatus.FAILED,
        CrawlJobStatus.CANCELLED,
    },
    CrawlJobStatus.RUNNING: {
        CrawlJobStatus.SUCCEEDED,
        CrawlJobStatus.FAILED,
        CrawlJobStatus.CANCELLED,
    },
    CrawlJobStatus.SUCCEEDED: set(),
    CrawlJobStatus.FAILED: set(),
    CrawlJobStatus.CANCELLED: set(),
}


class SQLiteRepository:
    def __init__(self, database_path: Path, *, timeout_seconds: float = 10.0):
        self.database_path = Path(database_path).expanduser().resolve()
        self.timeout_seconds = timeout_seconds
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.migrate()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            str(self.database_path),
            timeout=self.timeout_seconds,
            isolation_level=None,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.execute(f"PRAGMA busy_timeout = {int(self.timeout_seconds * 1000)}")
        return connection

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def migrate(self) -> None:
        connection = self._connect()
        try:
            current = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if current > SCHEMA_VERSION:
                raise RepositoryError(
                    f"database schema {current} is newer than supported {SCHEMA_VERSION}"
                )
            if current < 1:
                connection.executescript(MIGRATION_1)
                connection.execute(
                    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                    (1, _utc_text()),
                )
                connection.execute("PRAGMA user_version = 1")
                current = 1
            if current < 2:
                connection.executescript(MIGRATION_2)
                connection.execute(
                    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                    (2, _utc_text()),
                )
                connection.execute("PRAGMA user_version = 2")
        finally:
            connection.close()

    @property
    def schema_version(self) -> int:
        connection = self._connect()
        try:
            return int(connection.execute("PRAGMA user_version").fetchone()[0])
        finally:
            connection.close()

    def query(self, sql: str, parameters: Sequence[Any] = ()) -> List[sqlite3.Row]:
        if not sql.lstrip().casefold().startswith(("select", "pragma", "with")):
            raise ValueError("query() only accepts read-only SQL")
        connection = self._connect()
        try:
            return list(connection.execute(sql, tuple(parameters)).fetchall())
        finally:
            connection.close()

    # ------------------------------------------------------------------ jobs
    def create_job(self, job: CrawlJobCreate) -> CrawlJobRead:
        _assert_no_raw_ip(job.parameters)
        record_id = uuid4()
        stable_id = make_stable_id("job", record_id)
        created_at = _utc_text()
        request_json = json_dumps(job.model_dump(mode="json"))
        with self.transaction() as connection:
            connection.execute(
                """
                INSERT INTO crawl_jobs(
                    id, stable_id, profile, kind, status, requested_by, request_json,
                    counters_json, error, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', NULL, ?)
                """,
                (
                    str(record_id),
                    stable_id,
                    job.profile.value,
                    job.kind.value,
                    CrawlJobStatus.QUEUED.value,
                    job.requested_by,
                    request_json,
                    created_at,
                ),
            )
        return self.get_job(record_id)

    def get_job(self, job_id: UUID) -> CrawlJobRead:
        rows = self.query("SELECT * FROM crawl_jobs WHERE id = ?", (str(job_id),))
        if not rows:
            raise RecordNotFoundError(f"crawl job not found: {job_id}")
        return self._job_from_row(rows[0])

    def list_jobs(
        self,
        *,
        profile: Optional[ProfileId] = None,
        status: Optional[CrawlJobStatus] = None,
        page: Optional[PageParams] = None,
    ) -> Page[CrawlJobRead]:
        page = page or PageParams()
        offset = _decode_cursor(page.cursor)
        clauses = []
        parameters: List[Any] = []
        if profile is not None:
            clauses.append("profile = ?")
            parameters.append(ProfileId(profile).value)
        if status is not None:
            clauses.append("status = ?")
            parameters.append(CrawlJobStatus(status).value)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        parameters.extend([page.limit + 1, offset])
        rows = self.query(
            f"SELECT * FROM crawl_jobs {where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            parameters,
        )
        has_more = len(rows) > page.limit
        return Page[CrawlJobRead](
            items=[self._job_from_row(row) for row in rows[: page.limit]],
            page=PageInfo(
                limit=page.limit,
                has_more=has_more,
                next_cursor=_encode_cursor(offset + page.limit) if has_more else None,
            ),
        )

    def _job_from_row(self, row: sqlite3.Row) -> CrawlJobRead:
        request = json_loads(row["request_json"], {})
        return CrawlJobRead(
            **request,
            id=row["id"],
            stable_id=row["stable_id"],
            status=row["status"],
            counters=json_loads(row["counters_json"], {}),
            error=row["error"],
            created_at=row["created_at"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
        )

    def update_job(self, job_id: UUID, update: CrawlJobUpdate) -> CrawlJobRead:
        with self.transaction() as connection:
            row = connection.execute(
                "SELECT status FROM crawl_jobs WHERE id = ?", (str(job_id),)
            ).fetchone()
            if row is None:
                raise RecordNotFoundError(f"crawl job not found: {job_id}")
            old_status = CrawlJobStatus(row["status"])
            if (
                update.status != old_status
                and update.status not in ALLOWED_JOB_TRANSITIONS[old_status]
            ):
                raise InvalidJobTransitionError(
                    f"invalid crawl job transition: {old_status.value} -> {update.status.value}"
                )
            now = _utc_text()
            started_at = (
                now
                if old_status == CrawlJobStatus.QUEUED
                and update.status == CrawlJobStatus.RUNNING
                else None
            )
            completed_at = (
                now
                if update.status
                in {CrawlJobStatus.SUCCEEDED, CrawlJobStatus.FAILED, CrawlJobStatus.CANCELLED}
                else None
            )
            connection.execute(
                """
                UPDATE crawl_jobs
                SET status = ?, counters_json = ?, error = ?,
                    started_at = COALESCE(started_at, ?),
                    completed_at = COALESCE(completed_at, ?)
                WHERE id = ?
                """,
                (
                    update.status.value,
                    json_dumps(update.counters),
                    update.error,
                    started_at,
                    completed_at,
                    str(job_id),
                ),
            )
        return self.get_job(job_id)

    update_job_status = update_job

    def add_job_event(self, event: CrawlJobEventCreate) -> CrawlJobEventRead:
        _assert_no_raw_ip(event.payload)
        record_id = uuid4()
        created_at = _utc_text()
        with self.transaction() as connection:
            if connection.execute(
                "SELECT 1 FROM crawl_jobs WHERE id = ?", (str(event.job_id),)
            ).fetchone() is None:
                raise RecordNotFoundError(f"crawl job not found: {event.job_id}")
            sequence = int(
                connection.execute(
                    "SELECT COALESCE(MAX(sequence), 0) + 1 FROM crawl_job_events WHERE job_id = ?",
                    (str(event.job_id),),
                ).fetchone()[0]
            )
            connection.execute(
                """
                INSERT INTO crawl_job_events(
                    id, job_id, sequence, event_type, message, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(record_id),
                    str(event.job_id),
                    sequence,
                    event.event_type.value,
                    event.message,
                    json_dumps(event.payload),
                    created_at,
                ),
            )
        return CrawlJobEventRead(
            **event.model_dump(), id=record_id, sequence=sequence, created_at=created_at
        )

    def list_job_events(
        self, job_id: UUID, *, after_sequence: int = 0, limit: int = 200
    ) -> Tuple[CrawlJobEventRead, ...]:
        rows = self.query(
            """
            SELECT * FROM crawl_job_events
            WHERE job_id = ? AND sequence > ? ORDER BY sequence LIMIT ?
            """,
            (str(job_id), after_sequence, min(max(limit, 1), 1_000)),
        )
        return tuple(
            CrawlJobEventRead(
                id=row["id"],
                job_id=row["job_id"],
                sequence=row["sequence"],
                event_type=row["event_type"],
                message=row["message"],
                payload=json_loads(row["payload_json"], {}),
                created_at=row["created_at"],
            )
            for row in rows
        )

    # -------------------------------------------------------------- articles
    def upsert_article(self, article: ArticleCreate) -> ArticleRead:
        _assert_no_raw_ip(article.metadata)
        _assert_no_raw_ip(article.model_metadata)
        for source in article.sources:
            _assert_no_raw_ip(source.metadata)
        record_id = uuid4()
        created_at = _utc_text()
        with self.transaction() as connection:
            existing_by_stable = connection.execute(
                "SELECT id, canonical_url FROM articles WHERE stable_id = ?",
                (article.stable_id,),
            ).fetchone()
            existing_by_url = connection.execute(
                "SELECT id, stable_id FROM articles WHERE canonical_url = ?",
                (str(article.canonical_url),),
            ).fetchone()
            if (
                existing_by_stable
                and existing_by_url
                and existing_by_stable["id"] != existing_by_url["id"]
            ):
                raise DuplicateRecordError(
                    "stable ID and canonical URL identify different articles"
                )
            if existing_by_stable:
                article_id = existing_by_stable["id"]
                if existing_by_stable["canonical_url"] != str(article.canonical_url):
                    raise DuplicateRecordError("stable article ID has a different canonical URL")
            elif existing_by_url:
                article_id = existing_by_url["id"]
                if existing_by_url["stable_id"] != article.stable_id:
                    raise DuplicateRecordError("canonical URL has a different stable article ID")
            else:
                article_id = str(record_id)
                connection.execute(
                    """
                    INSERT INTO articles(
                        id, stable_id, title, canonical_url, published_at, summary, intent,
                        body_text, top_image_url, region, category, language, importance_score,
                        keywords_json, model_metadata_json, metadata_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        article_id,
                        article.stable_id,
                        article.title,
                        str(article.canonical_url),
                        _utc_text(article.published_at) if article.published_at else None,
                        article.summary,
                        article.intent,
                        article.body_text,
                        str(article.top_image_url) if article.top_image_url else None,
                        article.region,
                        article.category,
                        article.language,
                        article.importance_score,
                        json_dumps(article.keywords),
                        json_dumps(article.model_metadata),
                        json_dumps(article.metadata),
                        created_at,
                    ),
                )
            for profile in article.profiles:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO article_profiles(article_id, profile, first_seen_at)
                    VALUES (?, ?, ?)
                    """,
                    (article_id, profile.value, created_at),
                )
                crawl_job_id = next(
                    (
                        source.crawl_job_id
                        for source in article.sources
                        if source.profile == profile and source.crawl_job_id is not None
                    ),
                    None,
                )
                self._insert_article_intelligence(
                    connection,
                    UUID(article_id),
                    profile,
                    article,
                    crawl_job_id=crawl_job_id,
                    created_at=created_at,
                )
            for source in article.sources:
                self._upsert_article_source(connection, UUID(article_id), source)
        return self.get_article(UUID(article_id), profile=article.profiles[0])

    create_article = upsert_article

    def _insert_article_intelligence(
        self,
        connection: sqlite3.Connection,
        article_id: UUID,
        profile: ProfileId,
        article: ArticleCreate,
        *,
        crawl_job_id: Optional[UUID],
        created_at: str,
    ) -> None:
        """Persist one immutable profile/run interpretation of a shared article."""

        stable_id = make_stable_id(
            "intel",
            article_id,
            profile.value,
            crawl_job_id or "initial",
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO article_profile_intelligence(
                id, stable_id, article_id, profile, crawl_job_id, summary, intent,
                region, category, language, importance_score, keywords_json,
                model_metadata_json, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid4()),
                stable_id,
                str(article_id),
                profile.value,
                str(crawl_job_id) if crawl_job_id else None,
                article.summary,
                article.intent,
                article.region,
                article.category,
                article.language,
                article.importance_score,
                json_dumps(article.keywords),
                json_dumps(article.model_metadata),
                json_dumps(article.metadata),
                created_at,
            ),
        )

    def _upsert_article_source(
        self,
        connection: sqlite3.Connection,
        article_id: UUID,
        source: ArticleSourceCreate,
    ) -> UUID:
        row = connection.execute(
            "SELECT id, article_id FROM article_sources WHERE stable_id = ?",
            (source.stable_id,),
        ).fetchone()
        if row:
            if row["article_id"] != str(article_id):
                raise DuplicateRecordError("source stable ID belongs to a different article")
            return UUID(row["id"])
        natural_row = connection.execute(
            """
            SELECT id FROM article_sources
            WHERE article_id = ? AND profile = ? AND url = ?
            """,
            (str(article_id), source.profile.value, str(source.url)),
        ).fetchone()
        if natural_row:
            # Compatibility with rows created by older job-scoped stable IDs.
            return UUID(natural_row["id"])
        record_id = uuid4()
        try:
            connection.execute(
                """
                INSERT INTO article_sources(
                    id, stable_id, article_id, profile, source_key, publisher, url,
                    canonical_url, published_at, discovered_at, discovery_method,
                    crawl_job_id, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(record_id),
                    source.stable_id,
                    str(article_id),
                    source.profile.value,
                    source.source_key,
                    source.publisher,
                    str(source.url),
                    str(source.canonical_url) if source.canonical_url else None,
                    _utc_text(source.published_at) if source.published_at else None,
                    _utc_text(source.discovered_at),
                    source.discovery_method.value,
                    str(source.crawl_job_id) if source.crawl_job_id else None,
                    json_dumps(source.metadata),
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise DuplicateRecordError(str(exc)) from exc
        return record_id

    def upsert_article_source(
        self, article_id: UUID, source: ArticleSourceCreate
    ) -> ArticleSourceRead:
        _assert_no_raw_ip(source.metadata)
        with self.transaction() as connection:
            source_id = self._upsert_article_source(connection, article_id, source)
        rows = self.query("SELECT * FROM article_sources WHERE id = ?", (str(source_id),))
        if not rows:
            raise RecordNotFoundError(f"article source not found: {source_id}")
        return self._source_from_row(rows[0])

    def _source_from_row(self, row: sqlite3.Row) -> ArticleSourceRead:
        return ArticleSourceRead(
            id=row["id"],
            article_id=row["article_id"],
            stable_id=row["stable_id"],
            profile=row["profile"],
            source_key=row["source_key"],
            publisher=row["publisher"],
            url=row["url"],
            canonical_url=row["canonical_url"],
            published_at=row["published_at"],
            discovered_at=row["discovered_at"],
            discovery_method=row["discovery_method"],
            crawl_job_id=row["crawl_job_id"],
            metadata=json_loads(row["metadata_json"], {}),
        )

    def _article_from_row(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        *,
        profile: Optional[ProfileId] = None,
        crawl_job_id: Optional[UUID] = None,
    ) -> ArticleRead:
        profile_rows = connection.execute(
            "SELECT profile FROM article_profiles WHERE article_id = ? ORDER BY profile",
            (row["id"],),
        ).fetchall()
        profile_value = ProfileId(profile).value if profile is not None else None
        if profile_value is None:
            source_rows = connection.execute(
                "SELECT * FROM article_sources WHERE article_id = ? ORDER BY discovered_at, id",
                (row["id"],),
            ).fetchall()
        else:
            source_rows = connection.execute(
                """
                SELECT * FROM article_sources
                WHERE article_id = ? AND profile = ? ORDER BY discovered_at, id
                """,
                (row["id"], profile_value),
            ).fetchall()

        intelligence = None
        if profile_value is not None and crawl_job_id is not None:
            intelligence = connection.execute(
                """
                SELECT * FROM article_profile_intelligence
                WHERE article_id = ? AND profile = ? AND crawl_job_id = ?
                ORDER BY created_at DESC, id DESC LIMIT 1
                """,
                (row["id"], profile_value, str(crawl_job_id)),
            ).fetchone()
        if profile_value is not None and intelligence is None:
            intelligence = connection.execute(
                """
                SELECT * FROM article_profile_intelligence
                WHERE article_id = ? AND profile = ?
                ORDER BY created_at DESC, id DESC LIMIT 1
                """,
                (row["id"], profile_value),
            ).fetchone()

        summary = intelligence["summary"] if intelligence is not None else row["summary"]
        intent = intelligence["intent"] if intelligence is not None else row["intent"]
        region = intelligence["region"] if intelligence is not None else row["region"]
        category = intelligence["category"] if intelligence is not None else row["category"]
        language = intelligence["language"] if intelligence is not None else row["language"]
        importance_score = (
            intelligence["importance_score"]
            if intelligence is not None
            else row["importance_score"]
        )
        keywords_json = (
            intelligence["keywords_json"] if intelligence is not None else row["keywords_json"]
        )
        model_metadata_json = (
            intelligence["model_metadata_json"]
            if intelligence is not None
            else row["model_metadata_json"]
        )
        metadata_json = (
            intelligence["metadata_json"] if intelligence is not None else row["metadata_json"]
        )
        return ArticleRead(
            id=row["id"],
            stable_id=row["stable_id"],
            title=row["title"],
            canonical_url=row["canonical_url"],
            published_at=row["published_at"],
            summary=summary,
            intent=intent,
            body_text=row["body_text"],
            top_image_url=row["top_image_url"],
            region=region,
            category=category,
            language=language,
            importance_score=importance_score,
            keywords=tuple(json_loads(keywords_json, [])),
            profiles=tuple(item["profile"] for item in profile_rows),
            sources=tuple(self._source_from_row(item) for item in source_rows),
            model_metadata=json_loads(model_metadata_json, {}),
            metadata=json_loads(metadata_json, {}),
            created_at=row["created_at"],
        )

    def get_article(
        self,
        identifier: UUID,
        *,
        profile: Optional[ProfileId] = None,
        crawl_job_id: Optional[UUID] = None,
    ) -> ArticleRead:
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT * FROM articles WHERE id = ?", (str(identifier),)
            ).fetchone()
            if row is None:
                raise RecordNotFoundError(f"article not found: {identifier}")
            return self._article_from_row(
                connection, row, profile=profile, crawl_job_id=crawl_job_id
            )
        finally:
            connection.close()

    def get_article_by_stable_id(
        self,
        stable_id: str,
        *,
        profile: Optional[ProfileId] = None,
        crawl_job_id: Optional[UUID] = None,
    ) -> ArticleRead:
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT * FROM articles WHERE stable_id = ?", (stable_id,)
            ).fetchone()
            if row is None:
                raise RecordNotFoundError(f"article not found: {stable_id}")
            return self._article_from_row(
                connection, row, profile=profile, crawl_job_id=crawl_job_id
            )
        finally:
            connection.close()

    def list_articles(
        self, *, profile: Optional[ProfileId] = None, page: Optional[PageParams] = None
    ) -> Page[ArticleRead]:
        page = page or PageParams()
        offset = _decode_cursor(page.cursor)
        connection = self._connect()
        try:
            parameters: List[Any] = []
            join = ""
            where = ""
            if profile is not None:
                join = "JOIN article_profiles ap ON ap.article_id = a.id"
                where = "WHERE ap.profile = ?"
                parameters.append(ProfileId(profile).value)
            parameters.extend([page.limit + 1, offset])
            rows = connection.execute(
                f"""
                SELECT a.* FROM articles a {join} {where}
                ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?
                """,
                tuple(parameters),
            ).fetchall()
            has_more = len(rows) > page.limit
            items = [
                self._article_from_row(connection, row, profile=profile)
                for row in rows[: page.limit]
            ]
        finally:
            connection.close()
        return Page[ArticleRead](
            items=items,
            page=PageInfo(
                limit=page.limit,
                has_more=has_more,
                next_cursor=_encode_cursor(offset + page.limit) if has_more else None,
            ),
        )

    # --------------------------------------------------------------- clusters
    def upsert_cluster(self, cluster: ClusterCreate) -> ClusterRead:
        _assert_no_raw_ip(cluster.metadata)
        existing = self.query("SELECT id FROM clusters WHERE stable_id = ?", (cluster.stable_id,))
        if existing:
            return self.get_cluster(UUID(existing[0]["id"]))
        record_id = uuid4()
        created_at = _utc_text()
        try:
            with self.transaction() as connection:
                connection.execute(
                    """
                    INSERT INTO clusters(
                        id, stable_id, profile, crawl_job_id, title, summary, intent, region,
                        keywords_json, model_name, similarity_threshold, metadata_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(record_id),
                        cluster.stable_id,
                        cluster.profile.value,
                        str(cluster.crawl_job_id) if cluster.crawl_job_id else None,
                        cluster.title,
                        cluster.summary,
                        cluster.intent,
                        cluster.region,
                        json_dumps(cluster.keywords),
                        cluster.model_name,
                        cluster.similarity_threshold,
                        json_dumps(cluster.metadata),
                        created_at,
                    ),
                )
                for member in cluster.members:
                    connection.execute(
                        """
                        INSERT INTO cluster_articles(
                            cluster_id, article_id, rank, similarity, is_primary
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            str(record_id),
                            str(member.article_id),
                            member.rank,
                            member.similarity,
                            int(member.is_primary),
                        ),
                    )
        except sqlite3.IntegrityError as exc:
            raise DuplicateRecordError(str(exc)) from exc
        return self.get_cluster(record_id)

    create_cluster = upsert_cluster

    def link_cluster_article(
        self,
        cluster_id: UUID,
        article_id: UUID,
        *,
        rank: int,
        similarity: float,
        is_primary: bool = False,
    ) -> ClusterRead:
        with self.transaction() as connection:
            connection.execute(
                """
                INSERT INTO cluster_articles(cluster_id, article_id, rank, similarity, is_primary)
                VALUES (?, ?, ?, ?, ?)
                """,
                (str(cluster_id), str(article_id), rank, similarity, int(is_primary)),
            )
        return self.get_cluster(cluster_id)

    def get_cluster(self, cluster_id: UUID) -> ClusterRead:
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT * FROM clusters WHERE id = ?", (str(cluster_id),)
            ).fetchone()
            if row is None:
                raise RecordNotFoundError(f"cluster not found: {cluster_id}")
            members = connection.execute(
                """
                SELECT * FROM cluster_articles WHERE cluster_id = ?
                ORDER BY rank, article_id
                """,
                (str(cluster_id),),
            ).fetchall()
            member_models = tuple(
                ClusterMemberRead(
                    article_id=member["article_id"],
                    rank=member["rank"],
                    similarity=member["similarity"],
                    is_primary=bool(member["is_primary"]),
                    article=self._article_from_row(
                        connection,
                        connection.execute(
                            "SELECT * FROM articles WHERE id = ?", (member["article_id"],)
                        ).fetchone(),
                        profile=ProfileId(row["profile"]),
                        crawl_job_id=UUID(row["crawl_job_id"])
                        if row["crawl_job_id"]
                        else None,
                    ),
                )
                for member in members
            )
            return ClusterRead(
                id=row["id"],
                stable_id=row["stable_id"],
                profile=row["profile"],
                crawl_job_id=row["crawl_job_id"],
                title=row["title"],
                summary=row["summary"],
                intent=row["intent"],
                region=row["region"],
                keywords=tuple(json_loads(row["keywords_json"], [])),
                model_name=row["model_name"],
                similarity_threshold=row["similarity_threshold"],
                metadata=json_loads(row["metadata_json"], {}),
                created_at=row["created_at"],
                members=member_models,
            )
        finally:
            connection.close()

    def list_clusters(
        self,
        *,
        profile: Optional[ProfileId] = None,
        crawl_job_id: Optional[UUID] = None,
        page: Optional[PageParams] = None,
    ) -> Page[ClusterRead]:
        page = page or PageParams()
        offset = _decode_cursor(page.cursor)
        clauses = []
        parameters: List[Any] = []
        if profile is not None:
            clauses.append("profile = ?")
            parameters.append(ProfileId(profile).value)
        if crawl_job_id is not None:
            clauses.append("crawl_job_id = ?")
            parameters.append(str(crawl_job_id))
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        parameters.extend([page.limit + 1, offset])
        rows = self.query(
            f"SELECT id FROM clusters {where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            parameters,
        )
        has_more = len(rows) > page.limit
        items = [self.get_cluster(UUID(row["id"])) for row in rows[: page.limit]]
        return Page[ClusterRead](
            items=items,
            page=PageInfo(
                limit=page.limit,
                has_more=has_more,
                next_cursor=_encode_cursor(offset + page.limit) if has_more else None,
            ),
        )

    def replace_run_clusters(
        self, crawl_job_id: UUID, clusters: Iterable[ClusterCreate]
    ) -> Tuple[ClusterRead, ...]:
        if self.query("SELECT 1 FROM clusters WHERE crawl_job_id = ?", (str(crawl_job_id),)):
            raise DuplicateRecordError("clusters for a completed run are immutable")
        created = []
        for cluster in clusters:
            if cluster.crawl_job_id != crawl_job_id:
                raise ValueError("every cluster must reference the supplied crawl_job_id")
            created.append(self.upsert_cluster(cluster))
        return tuple(created)

    # ------------------------------------------------------------- briefings
    def create_briefing_snapshot(
        self, briefing: BriefingSnapshotCreate
    ) -> BriefingSnapshotRead:
        _assert_no_raw_ip(briefing.metadata)
        record_id = uuid4()
        created_at = _utc_text()
        try:
            with self.transaction() as connection:
                connection.execute(
                    """
                    INSERT INTO briefing_snapshots(
                        id, stable_id, profile, crawl_job_id, generated_by,
                        metadata_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(record_id),
                        briefing.stable_id,
                        briefing.profile.value,
                        str(briefing.crawl_job_id) if briefing.crawl_job_id else None,
                        briefing.generated_by,
                        json_dumps(briefing.metadata),
                        created_at,
                    ),
                )
                for position, article_id in enumerate(briefing.article_ids):
                    connection.execute(
                        """
                        INSERT INTO briefing_articles(briefing_id, article_id, position)
                        VALUES (?, ?, ?)
                        """,
                        (str(record_id), str(article_id), position),
                    )
        except sqlite3.IntegrityError as exc:
            raise DuplicateRecordError(str(exc)) from exc
        return self.get_briefing(record_id)

    def get_briefing(self, briefing_id: UUID) -> BriefingSnapshotRead:
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT * FROM briefing_snapshots WHERE id = ?", (str(briefing_id),)
            ).fetchone()
            if row is None:
                raise RecordNotFoundError(f"briefing not found: {briefing_id}")
            article_rows = connection.execute(
                """
                SELECT a.* FROM briefing_articles ba
                JOIN articles a ON a.id = ba.article_id
                WHERE ba.briefing_id = ? ORDER BY ba.position
                """,
                (str(briefing_id),),
            ).fetchall()
            briefing_profile = ProfileId(row["profile"])
            briefing_job_id = UUID(row["crawl_job_id"]) if row["crawl_job_id"] else None
            articles = tuple(
                self._article_from_row(
                    connection,
                    item,
                    profile=briefing_profile,
                    crawl_job_id=briefing_job_id,
                )
                for item in article_rows
            )
            return BriefingSnapshotRead(
                id=row["id"],
                stable_id=row["stable_id"],
                profile=row["profile"],
                crawl_job_id=row["crawl_job_id"],
                article_ids=tuple(article.id for article in articles),
                generated_by=row["generated_by"],
                metadata=json_loads(row["metadata_json"], {}),
                created_at=row["created_at"],
                articles=articles,
            )
        finally:
            connection.close()

    def get_latest_briefing(self, profile: ProfileId) -> Optional[BriefingSnapshotRead]:
        rows = self.query(
            """
            SELECT id FROM briefing_snapshots WHERE profile = ?
            ORDER BY created_at DESC, id DESC LIMIT 1
            """,
            (ProfileId(profile).value,),
        )
        return self.get_briefing(UUID(rows[0]["id"])) if rows else None

    def list_briefings(
        self, profile: ProfileId, *, page: Optional[PageParams] = None
    ) -> Page[BriefingSnapshotRead]:
        page = page or PageParams()
        offset = _decode_cursor(page.cursor)
        rows = self.query(
            """
            SELECT id FROM briefing_snapshots WHERE profile = ?
            ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
            """,
            (ProfileId(profile).value, page.limit + 1, offset),
        )
        has_more = len(rows) > page.limit
        items = [self.get_briefing(UUID(row["id"])) for row in rows[: page.limit]]
        return Page[BriefingSnapshotRead](
            items=items,
            page=PageInfo(
                limit=page.limit,
                has_more=has_more,
                next_cursor=_encode_cursor(offset + page.limit) if has_more else None,
            ),
        )

    # --------------------------------------------------------------- actions
    def record_article_action(self, action: ArticleActionCreate) -> ArticleActionRead:
        _assert_no_raw_ip(action.metadata)
        record_id = uuid4()
        try:
            with self.transaction() as connection:
                connection.execute(
                    """
                    INSERT INTO article_actions(
                        id, article_id, profile, actor_id, action, note, idempotency_key,
                        ip_hash, metadata_json, occurred_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(record_id),
                        str(action.article_id),
                        action.profile.value,
                        action.actor_id,
                        action.action.value,
                        action.note,
                        action.idempotency_key,
                        action.ip_hash,
                        json_dumps(action.metadata),
                        _utc_text(action.occurred_at),
                    ),
                )
        except sqlite3.IntegrityError as exc:
            if action.idempotency_key:
                rows = self.query(
                    "SELECT * FROM article_actions WHERE actor_id = ? AND idempotency_key = ?",
                    (action.actor_id, action.idempotency_key),
                )
                if rows:
                    return self._action_from_row(rows[0])
            raise DuplicateRecordError(str(exc)) from exc
        return ArticleActionRead(**action.model_dump(), id=record_id)

    def _action_from_row(self, row: sqlite3.Row) -> ArticleActionRead:
        return ArticleActionRead(
            id=row["id"],
            article_id=row["article_id"],
            profile=row["profile"],
            actor_id=row["actor_id"],
            action=row["action"],
            note=row["note"],
            idempotency_key=row["idempotency_key"],
            ip_hash=row["ip_hash"],
            metadata=json_loads(row["metadata_json"], {}),
            occurred_at=row["occurred_at"],
        )

    def list_actions(
        self,
        *,
        article_id: Optional[UUID] = None,
        actor_id: Optional[str] = None,
        profile: Optional[ProfileId] = None,
        page: Optional[PageParams] = None,
    ) -> Page[ArticleActionRead]:
        page = page or PageParams()
        offset = _decode_cursor(page.cursor)
        clauses = []
        parameters: List[Any] = []
        if article_id is not None:
            clauses.append("article_id = ?")
            parameters.append(str(article_id))
        if actor_id is not None:
            clauses.append("actor_id = ?")
            parameters.append(actor_id)
        if profile is not None:
            clauses.append("profile = ?")
            parameters.append(ProfileId(profile).value)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        parameters.extend([page.limit + 1, offset])
        rows = self.query(
            f"""
            SELECT * FROM article_actions {where}
            ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?
            """,
            parameters,
        )
        has_more = len(rows) > page.limit
        return Page[ArticleActionRead](
            items=[self._action_from_row(row) for row in rows[: page.limit]],
            page=PageInfo(
                limit=page.limit,
                has_more=has_more,
                next_cursor=_encode_cursor(offset + page.limit) if has_more else None,
            ),
        )

    def get_disposition(
        self, article_id: UUID, actor_id: str, profile: ProfileId
    ) -> ArticleDisposition:
        rows = self.query(
            """
            SELECT action, occurred_at FROM article_actions
            WHERE article_id = ? AND actor_id = ? AND profile = ?
            ORDER BY occurred_at, id
            """,
            (str(article_id), actor_id, ProfileId(profile).value),
        )
        state: Dict[str, Any] = {
            "article_id": article_id,
            "actor_id": actor_id,
        }
        for row in rows:
            action = ArticleActionType(row["action"])
            if action == ArticleActionType.SELECT:
                state["selected"] = True
            elif action == ArticleActionType.DESELECT:
                state["selected"] = False
            elif action == ArticleActionType.SAVE:
                state["saved"] = True
            elif action == ArticleActionType.UNSAVE:
                state["saved"] = False
            elif action == ArticleActionType.MARK_UNDER_REVIEW:
                state["under_review"] = True
                state["approved"] = False
            elif action == ArticleActionType.CLEAR_REVIEW:
                state["under_review"] = False
                state["approved"] = False
            elif action == ArticleActionType.APPROVE:
                state["approved"] = True
                state["under_review"] = False
            elif action == ArticleActionType.INTERESTING:
                state["interesting"] = True
            elif action == ArticleActionType.NOT_INTERESTED:
                state["interesting"] = False
                state["selected"] = False
                state["under_review"] = False
                state["approved"] = False
            elif action == ArticleActionType.HIDE:
                state["hidden"] = True
                state["selected"] = False
            elif action == ArticleActionType.RESTORE:
                state["hidden"] = False
                if state.get("interesting") is False:
                    state["interesting"] = None
            state["last_action_at"] = row["occurred_at"]
        return ArticleDisposition(**state)

    def get_shared_disposition(
        self, article_id: UUID, profile: ProfileId
    ) -> ArticleDisposition:
        rows = self.query(
            """
            SELECT actor_id, action, metadata_json, occurred_at, id
            FROM article_actions
            WHERE article_id = ? AND profile = ?
              AND action IN ('mark_under_review', 'clear_review', 'approve')
            ORDER BY occurred_at, id
            """,
            (str(article_id), ProfileId(profile).value),
        )
        owners: Dict[str, str] = {}
        approved = False
        current_actor = "shared"
        last_action_at = None
        for row in rows:
            action = ArticleActionType(row["action"])
            actor = str(row["actor_id"])
            metadata = json_loads(row["metadata_json"], {})
            if action == ArticleActionType.MARK_UNDER_REVIEW:
                owners[actor] = row["occurred_at"]
                approved = False
                current_actor = actor
            elif action == ArticleActionType.CLEAR_REVIEW:
                if bool(metadata.get("clear_all_review")):
                    owners.clear()
                else:
                    owners.pop(actor, None)
                approved = False
                current_actor = actor
            elif action == ArticleActionType.APPROVE:
                owners.clear()
                approved = True
                current_actor = actor
            last_action_at = row["occurred_at"]
        if owners:
            current_actor = max(owners, key=lambda owner: (owners[owner], owner))
        return ArticleDisposition(
            article_id=article_id,
            actor_id=current_actor,
            under_review=bool(owners),
            approved=approved,
            last_action_at=last_action_at,
        )

    def list_worklist(
        self,
        *,
        actor_id: str,
        profile: ProfileId,
        state: str,
        page: Optional[PageParams] = None,
    ) -> Page[WorklistItem]:
        allowed_states = {
            "selected",
            "saved",
            "under_review",
            "approved",
            "interesting",
            "not_interested",
            "hidden",
        }
        if state not in allowed_states:
            raise ValueError(f"unsupported worklist state: {state}")
        shared_state = state in {"under_review", "approved"}
        if shared_state:
            article_rows = self.query(
                """
                SELECT article_id, MAX(occurred_at) AS occurred_at FROM article_actions
                WHERE profile = ? AND action IN ('mark_under_review', 'clear_review', 'approve')
                GROUP BY article_id ORDER BY occurred_at DESC
                """,
                (ProfileId(profile).value,),
            )
        else:
            article_rows = self.query(
                """
                SELECT DISTINCT article_id FROM article_actions
                WHERE actor_id = ? AND profile = ? ORDER BY occurred_at DESC
                """,
                (actor_id, ProfileId(profile).value),
            )
        worklist = []
        for row in article_rows:
            article_id = UUID(row["article_id"])
            disposition = (
                self.get_shared_disposition(article_id, profile)
                if shared_state
                else self.get_disposition(article_id, actor_id, profile)
            )
            matches = (
                disposition.interesting is False
                if state == "not_interested"
                else getattr(disposition, state) is True
            )
            if matches:
                worklist.append(
                    WorklistItem(article=self.get_article(article_id), disposition=disposition)
                )
        page = page or PageParams()
        offset = _decode_cursor(page.cursor)
        segment = worklist[offset : offset + page.limit + 1]
        has_more = len(segment) > page.limit
        return Page[WorklistItem](
            items=segment[: page.limit],
            page=PageInfo(
                limit=page.limit,
                has_more=has_more,
                next_cursor=_encode_cursor(offset + page.limit) if has_more else None,
            ),
        )

    # ----------------------------------------------------------- VOC/events
    def record_voc(self, feedback: VocFeedbackCreate) -> VocFeedbackRead:
        _assert_no_raw_ip(feedback.diagnostics)
        record_id = uuid4()
        reference = make_stable_id("voc", record_id)
        created_at = _utc_text()
        with self.transaction() as connection:
            connection.execute(
                """
                INSERT INTO voc_feedback(
                    id, reference, profile, actor_id, session_id, rating, category,
                    message, allow_follow_up, include_diagnostics, contact_email,
                    page, diagnostics_json, ip_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(record_id),
                    reference,
                    feedback.profile.value,
                    feedback.actor_id,
                    str(feedback.session_id) if feedback.session_id else None,
                    feedback.rating,
                    feedback.category.value,
                    feedback.message,
                    int(feedback.allow_follow_up),
                    int(feedback.include_diagnostics),
                    feedback.contact_email,
                    feedback.page,
                    json_dumps(feedback.diagnostics),
                    feedback.ip_hash,
                    created_at,
                ),
            )
        return VocFeedbackRead(
            **feedback.model_dump(), id=record_id, reference=reference, created_at=created_at
        )

    def _voc_from_row(self, row: sqlite3.Row) -> VocFeedbackRead:
        return VocFeedbackRead(
            id=row["id"],
            reference=row["reference"],
            profile=row["profile"],
            actor_id=row["actor_id"],
            session_id=row["session_id"],
            rating=row["rating"],
            category=row["category"],
            message=row["message"],
            allow_follow_up=bool(row["allow_follow_up"]),
            include_diagnostics=bool(row["include_diagnostics"]),
            contact_email=row["contact_email"],
            page=row["page"],
            diagnostics=json_loads(row["diagnostics_json"], {}),
            ip_hash=row["ip_hash"],
            created_at=row["created_at"],
        )

    def list_voc(
        self, *, profile: Optional[ProfileId] = None, page: Optional[PageParams] = None
    ) -> Page[VocFeedbackRead]:
        page = page or PageParams()
        offset = _decode_cursor(page.cursor)
        where = "WHERE profile = ?" if profile else ""
        parameters: List[Any] = [ProfileId(profile).value] if profile else []
        parameters.extend([page.limit + 1, offset])
        rows = self.query(
            f"""
            SELECT * FROM voc_feedback {where}
            ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
            """,
            parameters,
        )
        has_more = len(rows) > page.limit
        return Page[VocFeedbackRead](
            items=[self._voc_from_row(row) for row in rows[: page.limit]],
            page=PageInfo(
                limit=page.limit,
                has_more=has_more,
                next_cursor=_encode_cursor(offset + page.limit) if has_more else None,
            ),
        )

    def record_activity(self, event: TelemetryEventCreate) -> TelemetryEventRead:
        _assert_no_raw_ip(event.properties)
        record_id = uuid4()
        received_at = _utc_text()
        with self.transaction() as connection:
            connection.execute(
                """
                INSERT INTO telemetry_events(
                    id, event_type, session_id, profile, actor_id, path, article_id,
                    properties_json, ip_hash, occurred_at, received_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(record_id),
                    event.event_type.value,
                    str(event.session_id),
                    event.profile.value,
                    event.actor_id,
                    event.path,
                    str(event.article_id) if event.article_id else None,
                    json_dumps(event.properties),
                    event.ip_hash,
                    _utc_text(event.occurred_at),
                    received_at,
                ),
            )
        return TelemetryEventRead(
            **event.model_dump(), id=record_id, received_at=received_at
        )

    record_event = record_activity

    def _event_from_row(self, row: sqlite3.Row) -> TelemetryEventRead:
        return TelemetryEventRead(
            id=row["id"],
            event_type=row["event_type"],
            session_id=row["session_id"],
            profile=row["profile"],
            actor_id=row["actor_id"],
            path=row["path"],
            article_id=row["article_id"],
            properties=json_loads(row["properties_json"], {}),
            ip_hash=row["ip_hash"],
            occurred_at=row["occurred_at"],
            received_at=row["received_at"],
        )

    def list_activity(
        self,
        *,
        profile: Optional[ProfileId] = None,
        actor_id: Optional[str] = None,
        session_id: Optional[UUID] = None,
        page: Optional[PageParams] = None,
    ) -> Page[TelemetryEventRead]:
        page = page or PageParams()
        offset = _decode_cursor(page.cursor)
        clauses = []
        parameters: List[Any] = []
        if profile is not None:
            clauses.append("profile = ?")
            parameters.append(ProfileId(profile).value)
        if actor_id is not None:
            clauses.append("actor_id = ?")
            parameters.append(actor_id)
        if session_id is not None:
            clauses.append("session_id = ?")
            parameters.append(str(session_id))
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        parameters.extend([page.limit + 1, offset])
        rows = self.query(
            f"""
            SELECT * FROM telemetry_events {where}
            ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?
            """,
            parameters,
        )
        has_more = len(rows) > page.limit
        return Page[TelemetryEventRead](
            items=[self._event_from_row(row) for row in rows[: page.limit]],
            page=PageInfo(
                limit=page.limit,
                has_more=has_more,
                next_cursor=_encode_cursor(offset + page.limit) if has_more else None,
            ),
        )

    list_events = list_activity

    def analytics_summary(
        self, *, profile: Optional[ProfileId] = None
    ) -> AnalyticsSummary:
        where = "WHERE profile = ?" if profile else ""
        parameters: Tuple[Any, ...] = (ProfileId(profile).value,) if profile else ()
        rows = self.query(
            f"""
            SELECT
                COUNT(*) AS total_events,
                COUNT(DISTINCT actor_id) AS unique_actors,
                COUNT(DISTINCT session_id) AS unique_sessions,
                SUM(CASE WHEN event_type = ? THEN 1 ELSE 0 END) AS article_opens,
                SUM(CASE WHEN event_type = ? THEN 1 ELSE 0 END) AS article_actions,
                SUM(CASE WHEN event_type = ? THEN 1 ELSE 0 END) AS feedback_submissions,
                SUM(CASE WHEN event_type = ? THEN 1 ELSE 0 END) AS heartbeat_events
            FROM telemetry_events {where}
            """,
            (
                TelemetryEventType.ARTICLE_OPEN.value,
                TelemetryEventType.ARTICLE_ACTION.value,
                TelemetryEventType.FEEDBACK.value,
                TelemetryEventType.HEARTBEAT.value,
                *parameters,
            ),
        )[0]
        return AnalyticsSummary(
            profile=profile,
            unique_actors=rows["unique_actors"] or 0,
            unique_sessions=rows["unique_sessions"] or 0,
            total_events=rows["total_events"] or 0,
            article_opens=rows["article_opens"] or 0,
            article_actions=rows["article_actions"] or 0,
            feedback_submissions=rows["feedback_submissions"] or 0,
            heartbeat_events=rows["heartbeat_events"] or 0,
        )


# Concise alias for dependency injection and worker code.
Repository = SQLiteRepository
