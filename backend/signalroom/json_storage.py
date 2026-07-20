"""Crash-safe JSON persistence for Signalroom's single-laptop deployment.

The repository keeps one coherent JSON document so changes spanning articles,
sources, profile intelligence, clusters, and briefings are committed together.
Every mutation is protected by an in-process re-entrant lock and an operating
system file lock, then published with an atomic ``os.replace``.

The public methods intentionally mirror :class:`SQLiteRepository`.  SQLite is
kept as a migration/testing implementation, but the application runtime uses
this repository by default.
"""

from __future__ import annotations

import json
import os
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Iterator, List, Mapping, Optional, Tuple
from uuid import UUID, uuid4

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
from .storage import (
    ALLOWED_JOB_TRANSITIONS,
    DuplicateRecordError,
    InvalidJobTransitionError,
    RecordNotFoundError,
    RepositoryError,
    UnsafePayloadError,
    _assert_no_raw_ip,
    _decode_cursor,
    _encode_cursor,
    _utc_text,
)


JSON_SCHEMA_VERSION = 1
_TERMINAL_JOB_STATES = {
    CrawlJobStatus.SUCCEEDED,
    CrawlJobStatus.FAILED,
    CrawlJobStatus.CANCELLED,
}

# Several repository instances can exist in one process (tests, API workers).
# ``flock`` semantics alone do not provide a portable thread-level guarantee.
_LOCKS_GUARD = threading.Lock()
_PATH_LOCKS: Dict[str, threading.RLock] = {}


def _path_lock(path: Path) -> threading.RLock:
    key = os.path.normcase(str(path.resolve()))
    with _LOCKS_GUARD:
        return _PATH_LOCKS.setdefault(key, threading.RLock())


class _CrossProcessFileLock:
    """Small stdlib-only advisory lock that works on Windows and POSIX."""

    def __init__(self, path: Path, timeout_seconds: float) -> None:
        self.path = path
        self.timeout_seconds = timeout_seconds
        self._handle: Any = None

    def __enter__(self) -> "_CrossProcessFileLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._handle = self.path.open("a+b")
        self._handle.seek(0, os.SEEK_END)
        if self._handle.tell() == 0:
            self._handle.write(b"0")
            self._handle.flush()
        deadline = time.monotonic() + self.timeout_seconds
        while True:
            try:
                self._handle.seek(0)
                if os.name == "nt":  # pragma: no cover - exercised on deployment host
                    import msvcrt

                    msvcrt.locking(self._handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(self._handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except (BlockingIOError, OSError):
                if time.monotonic() >= deadline:
                    self._handle.close()
                    self._handle = None
                    raise RepositoryError(
                        f"timed out waiting for JSON store lock: {self.path}"
                    )
                time.sleep(0.025)

    def __exit__(self, *_: object) -> None:
        if self._handle is None:
            return
        try:
            self._handle.seek(0)
            if os.name == "nt":  # pragma: no cover - exercised on deployment host
                import msvcrt

                msvcrt.locking(self._handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
        finally:
            self._handle.close()
            self._handle = None


def _default_state(now: datetime) -> Dict[str, Any]:
    stamp = _utc_text(now)
    return {
        "schema_version": JSON_SCHEMA_VERSION,
        "generation": 0,
        "created_at": stamp,
        "updated_at": stamp,
        "jobs": {},
        "job_events": {},
        "articles": {},
        "article_profiles": {},
        "article_intelligence": {},
        "article_sources": {},
        "clusters": {},
        "briefings": {},
        "actions": {},
        "viewer_preferences": {},
        "voc": {},
        "telemetry": {},
    }


def _as_utc(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise RepositoryError("JSON store contains a timestamp without a timezone")
    return parsed.astimezone(timezone.utc)


def _sort_records(records: Iterable[Mapping[str, Any]], field: str) -> List[Mapping[str, Any]]:
    return sorted(records, key=lambda row: (row.get(field) or "", row.get("id") or ""), reverse=True)


def _page(items: List[Any], params: Optional[PageParams]) -> Page[Any]:
    params = params or PageParams()
    offset = _decode_cursor(params.cursor)
    segment = items[offset : offset + params.limit + 1]
    has_more = len(segment) > params.limit
    return Page(
        items=segment[: params.limit],
        page=PageInfo(
            limit=params.limit,
            has_more=has_more,
            next_cursor=_encode_cursor(offset + params.limit) if has_more else None,
        ),
    )


class JSONRepository:
    """Atomic JSON repository for a small, multi-user internal deployment."""

    def __init__(
        self,
        storage_path: Path,
        *,
        timeout_seconds: float = 10.0,
        history_retention_days: int = 30,
        audit_retention_days: int = 90,
        voc_retention_days: int = 365,
        max_actions: int = 100_000,
        max_telemetry: int = 50_000,
        max_voc: int = 5_000,
        max_jobs: int = 5_000,
        max_job_events: int = 20_000,
        now_factory: Callable[[], datetime] = utc_now,
    ) -> None:
        supplied = Path(storage_path).expanduser().resolve()
        self.storage_path = supplied if supplied.suffix.lower() == ".json" else supplied / "state.json"
        self.backup_path = self.storage_path.with_suffix(self.storage_path.suffix + ".bak")
        self.lock_path = self.storage_path.with_suffix(self.storage_path.suffix + ".lock")
        # Compatibility for diagnostics that previously displayed this attribute.
        self.database_path = self.storage_path
        self.timeout_seconds = timeout_seconds
        self.history_retention_days = history_retention_days
        self.audit_retention_days = audit_retention_days
        self.voc_retention_days = voc_retention_days
        self.max_actions = max_actions
        self.max_telemetry = max_telemetry
        self.max_voc = max_voc
        self.max_jobs = max_jobs
        self.max_job_events = max_job_events
        self._now_factory = now_factory
        if min(history_retention_days, audit_retention_days, voc_retention_days) < 1:
            raise ValueError("retention periods must be positive")
        if min(max_actions, max_telemetry, max_voc, max_jobs, max_job_events) < 1:
            raise ValueError("retention limits must be positive")
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._thread_lock = _path_lock(self.lock_path)
        self.migrate()

    @property
    def schema_version(self) -> int:
        return JSON_SCHEMA_VERSION

    @contextmanager
    def _locked(self) -> Iterator[None]:
        with self._thread_lock:
            with _CrossProcessFileLock(self.lock_path, self.timeout_seconds):
                yield

    def _decode_state_file(self, path: Path) -> Dict[str, Any]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise RepositoryError(f"cannot read JSON store {path}: {exc}") from exc
        if not isinstance(payload, dict):
            raise RepositoryError(f"JSON store root must be an object: {path}")
        version = payload.get("schema_version")
        if version != JSON_SCHEMA_VERSION:
            raise RepositoryError(
                f"JSON store schema {version!r} is not supported (expected {JSON_SCHEMA_VERSION})"
            )
        # ``viewer_preferences`` was added while schema v1 was still under
        # development; tolerate an early v1 document and upgrade in place.
        payload.setdefault("viewer_preferences", {})
        required = set(_default_state(self._now()).keys())
        missing = sorted(required.difference(payload))
        if missing:
            raise RepositoryError(f"JSON store is missing collections: {', '.join(missing)}")
        return payload

    def _load_unlocked(self) -> Tuple[Dict[str, Any], bool]:
        if self.storage_path.exists():
            try:
                return self._decode_state_file(self.storage_path), False
            except RepositoryError as primary_error:
                if not self.backup_path.exists():
                    raise primary_error
        if self.backup_path.exists():
            return self._decode_state_file(self.backup_path), True
        return _default_state(self._now()), True

    def _serialize(self, state: Mapping[str, Any]) -> bytes:
        return (
            json.dumps(state, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        ).encode("utf-8")

    def _atomic_publish(self, path: Path, payload: bytes) -> None:
        temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            if os.name != "nt":
                directory_fd = os.open(str(path.parent), os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _write_unlocked(self, state: Dict[str, Any]) -> None:
        state["generation"] = int(state.get("generation", 0)) + 1
        state["updated_at"] = _utc_text(self._now())
        payload = self._serialize(state)
        # The primary is the commit point.  The backup is a recoverable copy;
        # failure to refresh it must never invalidate a committed primary.
        self._atomic_publish(self.storage_path, payload)
        try:
            self._atomic_publish(self.backup_path, payload)
        except OSError:
            pass

    def _now(self) -> datetime:
        current = self._now_factory()
        if current.tzinfo is None:
            raise ValueError("now_factory must return a timezone-aware datetime")
        return current.astimezone(timezone.utc)

    def migrate(self) -> None:
        """Create the store or restore a valid backup; future schemas migrate here."""

        with self._locked():
            state, needs_publish = self._load_unlocked()
            changed = self._prune_state(state)
            if needs_publish or changed:
                self._write_unlocked(state)

    def _read(self) -> Dict[str, Any]:
        with self._locked():
            state, recovered = self._load_unlocked()
            changed = self._prune_state(state)
            if recovered or changed:
                self._write_unlocked(state)
            return state

    def _mutate(self, operation: Callable[[Dict[str, Any]], Any]) -> Any:
        with self._locked():
            state, _ = self._load_unlocked()
            self._prune_state(state)
            result = operation(state)
            self._prune_state(state)
            self._write_unlocked(state)
            return result

    def prune(self) -> Dict[str, int]:
        """Apply retention immediately and return removed-record counts."""

        with self._locked():
            state, _ = self._load_unlocked()
            before = {name: len(value) for name, value in state.items() if isinstance(value, dict)}
            changed = self._prune_state(state)
            if changed:
                self._write_unlocked(state)
            after = {name: len(value) for name, value in state.items() if isinstance(value, dict)}
            return {name: before[name] - after.get(name, 0) for name in before if before[name] != after.get(name, 0)}

    # ------------------------------------------------------------- retention
    def _current_dispositions(self, state: Mapping[str, Any]) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
        grouped: Dict[Tuple[str, str, str], List[Mapping[str, Any]]] = {}
        for row in state["actions"].values():
            key = (row["article_id"], row["actor_id"], row["profile"])
            grouped.setdefault(key, []).append(row)
        results: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
        for key, rows in grouped.items():
            results[key] = self._fold_actions(rows)
        return results

    @staticmethod
    def _action_anchor_ids(state: Mapping[str, Any], surviving_articles: set[str]) -> set[str]:
        dimensions = {
            ArticleActionType.SELECT.value: ("selected",),
            ArticleActionType.DESELECT.value: ("selected",),
            ArticleActionType.SAVE.value: ("saved",),
            ArticleActionType.UNSAVE.value: ("saved",),
            ArticleActionType.MARK_UNDER_REVIEW.value: ("review", "approved"),
            ArticleActionType.CLEAR_REVIEW.value: ("review", "approved"),
            ArticleActionType.APPROVE.value: ("review", "approved"),
            ArticleActionType.INTERESTING.value: ("interesting",),
            ArticleActionType.NOT_INTERESTED.value: ("selected", "review", "approved", "interesting"),
            ArticleActionType.HIDE.value: ("selected", "hidden"),
            ArticleActionType.RESTORE.value: ("interesting", "hidden"),
        }
        latest: Dict[Tuple[str, str, str, str], Mapping[str, Any]] = {}
        for row in state["actions"].values():
            if row["article_id"] not in surviving_articles:
                continue
            for dimension in dimensions.get(row["action"], ()):
                key = (row["article_id"], row["actor_id"], row["profile"], dimension)
                previous = latest.get(key)
                if previous is None or (row["occurred_at"], row["id"]) > (
                    previous["occurred_at"], previous["id"]
                ):
                    latest[key] = row
        return {str(row["id"]) for row in latest.values()}

    def _prune_state(self, state: Dict[str, Any]) -> bool:
        now = self._now()
        history_cutoff = now - timedelta(days=self.history_retention_days)
        audit_cutoff = now - timedelta(days=self.audit_retention_days)
        voc_cutoff = now - timedelta(days=self.voc_retention_days)
        original_state = json.dumps(
            state, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )

        dispositions = self._current_dispositions(state)
        protected_articles = {
            article_id
            for (article_id, _actor, _profile), disposition in dispositions.items()
            if disposition.get("saved") or disposition.get("under_review") or disposition.get("approved")
        }

        state["briefings"] = {
            key: row
            for key, row in state["briefings"].items()
            if _as_utc(row["created_at"]) >= history_cutoff
        }
        state["clusters"] = {
            key: row
            for key, row in state["clusters"].items()
            if _as_utc(row["created_at"]) >= history_cutoff
        }
        live_articles = set(protected_articles)
        for row in state["briefings"].values():
            live_articles.update(row["article_ids"])
        for row in state["clusters"].values():
            live_articles.update(member["article_id"] for member in row["members"])
        for article_id, profiles in state["article_profiles"].items():
            if any(_as_utc(stamp) >= history_cutoff for stamp in profiles.values()):
                live_articles.add(article_id)
        for row in state["article_intelligence"].values():
            if _as_utc(row["created_at"]) >= history_cutoff:
                live_articles.add(row["article_id"])

        state["articles"] = {
            key: row for key, row in state["articles"].items() if key in live_articles
        }
        surviving = set(state["articles"])
        state["article_profiles"] = {
            key: row for key, row in state["article_profiles"].items() if key in surviving
        }
        state["article_sources"] = {
            key: row
            for key, row in state["article_sources"].items()
            if row["article_id"] in surviving
        }

        briefing_jobs = {
            row["crawl_job_id"] for row in state["briefings"].values() if row.get("crawl_job_id")
        }
        cluster_jobs = {
            row["crawl_job_id"] for row in state["clusters"].values() if row.get("crawl_job_id")
        }
        latest_intelligence: Dict[Tuple[str, str], Mapping[str, Any]] = {}
        for row in state["article_intelligence"].values():
            if row["article_id"] not in surviving:
                continue
            key = (row["article_id"], row["profile"])
            previous = latest_intelligence.get(key)
            if previous is None or (row["created_at"], row["id"]) > (
                previous["created_at"], previous["id"]
            ):
                latest_intelligence[key] = row
        intelligence_anchors = {str(row["id"]) for row in latest_intelligence.values()}
        state["article_intelligence"] = {
            key: row
            for key, row in state["article_intelligence"].items()
            if row["article_id"] in surviving
            and (
                _as_utc(row["created_at"]) >= history_cutoff
                or key in intelligence_anchors
                or row.get("crawl_job_id") in briefing_jobs
                or row.get("crawl_job_id") in cluster_jobs
            )
        }

        action_anchors = self._action_anchor_ids(state, surviving)
        recent_actions = [
            row
            for row in state["actions"].values()
            if row["article_id"] in surviving
            and (_as_utc(row["occurred_at"]) >= audit_cutoff or row["id"] in action_anchors)
        ]
        recent_actions.sort(key=lambda row: (row["occurred_at"], row["id"]), reverse=True)
        kept_action_ids = set(action_anchors)
        for row in recent_actions:
            if len(kept_action_ids) >= self.max_actions and row["id"] not in kept_action_ids:
                continue
            kept_action_ids.add(row["id"])
        state["actions"] = {
            key: row for key, row in state["actions"].items() if key in kept_action_ids
        }

        telemetry = [
            row for row in state["telemetry"].values() if _as_utc(row["occurred_at"]) >= audit_cutoff
        ]
        telemetry.sort(key=lambda row: (row["occurred_at"], row["id"]), reverse=True)
        state["telemetry"] = {row["id"]: row for row in telemetry[: self.max_telemetry]}

        voc = [row for row in state["voc"].values() if _as_utc(row["created_at"]) >= voc_cutoff]
        voc.sort(key=lambda row: (row["created_at"], row["id"]), reverse=True)
        state["voc"] = {row["id"]: row for row in voc[: self.max_voc]}

        referenced_jobs = briefing_jobs | cluster_jobs | {
            row["crawl_job_id"]
            for row in state["article_sources"].values()
            if row.get("crawl_job_id")
        } | {
            row["crawl_job_id"]
            for row in state["article_intelligence"].values()
            if row.get("crawl_job_id")
        }
        jobs = [
            row
            for row in state["jobs"].values()
            if row["id"] in referenced_jobs or _as_utc(row["created_at"]) >= audit_cutoff
        ]
        jobs.sort(key=lambda row: (row["created_at"], row["id"]), reverse=True)
        anchored_jobs = [row for row in jobs if row["id"] in referenced_jobs]
        ordinary_jobs = [row for row in jobs if row["id"] not in referenced_jobs]
        retained_jobs = anchored_jobs + ordinary_jobs[: max(0, self.max_jobs - len(anchored_jobs))]
        state["jobs"] = {row["id"]: row for row in retained_jobs}
        job_ids = set(state["jobs"])
        events: List[Mapping[str, Any]] = []
        for job_id, rows in state["job_events"].items():
            if job_id not in job_ids:
                continue
            events.extend(rows[-1_000:])
        events.sort(key=lambda row: (row["created_at"], row["id"]), reverse=True)
        events = events[: self.max_job_events]
        rebuilt_events: Dict[str, List[Mapping[str, Any]]] = {}
        for row in sorted(events, key=lambda item: (item["job_id"], item["sequence"])):
            rebuilt_events.setdefault(row["job_id"], []).append(row)
        state["job_events"] = rebuilt_events

        current_state = json.dumps(
            state, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        return current_state != original_state

    # ------------------------------------------------------------------ jobs
    def create_job(self, job: CrawlJobCreate) -> CrawlJobRead:
        _assert_no_raw_ip(job.parameters)
        record_id = uuid4()
        record = {
            **job.model_dump(mode="json"),
            "id": str(record_id),
            "stable_id": make_stable_id("job", record_id),
            "status": CrawlJobStatus.QUEUED.value,
            "counters": {},
            "error": None,
            "created_at": _utc_text(self._now()),
            "started_at": None,
            "completed_at": None,
        }

        def operation(state: Dict[str, Any]) -> None:
            state["jobs"][str(record_id)] = record
            state["job_events"].setdefault(str(record_id), [])

        self._mutate(operation)
        return CrawlJobRead.model_validate(record)

    def get_job(self, job_id: UUID) -> CrawlJobRead:
        state = self._read()
        row = state["jobs"].get(str(job_id))
        if row is None:
            raise RecordNotFoundError(f"crawl job not found: {job_id}")
        return CrawlJobRead.model_validate(row)

    def list_jobs(
        self,
        *,
        profile: Optional[ProfileId] = None,
        status: Optional[CrawlJobStatus] = None,
        page: Optional[PageParams] = None,
    ) -> Page[CrawlJobRead]:
        active_profile = ProfileId(profile).value if profile is not None else None
        active_status = CrawlJobStatus(status).value if status is not None else None
        rows = _sort_records(self._read()["jobs"].values(), "created_at")
        models = [
            CrawlJobRead.model_validate(row)
            for row in rows
            if (active_profile is None or row["profile"] == active_profile)
            and (active_status is None or row["status"] == active_status)
        ]
        return _page(models, page)

    def update_job(self, job_id: UUID, update: CrawlJobUpdate) -> CrawlJobRead:
        def operation(state: Dict[str, Any]) -> Dict[str, Any]:
            row = state["jobs"].get(str(job_id))
            if row is None:
                raise RecordNotFoundError(f"crawl job not found: {job_id}")
            old = CrawlJobStatus(row["status"])
            if update.status != old and update.status not in ALLOWED_JOB_TRANSITIONS[old]:
                raise InvalidJobTransitionError(
                    f"invalid crawl job transition: {old.value} -> {update.status.value}"
                )
            now = _utc_text(self._now())
            if old == CrawlJobStatus.QUEUED and update.status == CrawlJobStatus.RUNNING:
                row["started_at"] = row.get("started_at") or now
            if update.status in _TERMINAL_JOB_STATES:
                row["completed_at"] = row.get("completed_at") or now
            row["status"] = update.status.value
            row["counters"] = dict(update.counters)
            row["error"] = update.error
            return row

        return CrawlJobRead.model_validate(self._mutate(operation))

    update_job_status = update_job

    def add_job_event(self, event: CrawlJobEventCreate) -> CrawlJobEventRead:
        _assert_no_raw_ip(event.payload)
        event_id = uuid4()

        def operation(state: Dict[str, Any]) -> Dict[str, Any]:
            if str(event.job_id) not in state["jobs"]:
                raise RecordNotFoundError(f"crawl job not found: {event.job_id}")
            rows = state["job_events"].setdefault(str(event.job_id), [])
            record = {
                **event.model_dump(mode="json"),
                "id": str(event_id),
                "sequence": max((int(row["sequence"]) for row in rows), default=0) + 1,
                "created_at": _utc_text(self._now()),
            }
            rows.append(record)
            return record

        return CrawlJobEventRead.model_validate(self._mutate(operation))

    def list_job_events(
        self, job_id: UUID, *, after_sequence: int = 0, limit: int = 200
    ) -> Tuple[CrawlJobEventRead, ...]:
        state = self._read()
        if str(job_id) not in state["jobs"]:
            raise RecordNotFoundError(f"crawl job not found: {job_id}")
        rows = state["job_events"].get(str(job_id), [])
        return tuple(
            CrawlJobEventRead.model_validate(row)
            for row in rows
            if int(row["sequence"]) > after_sequence
        )[: min(max(limit, 1), 1_000)]

    # -------------------------------------------------------------- articles
    @staticmethod
    def _require_job_for_profile(
        state: Mapping[str, Any], job_id: Optional[UUID], profile: ProfileId
    ) -> None:
        if job_id is None:
            return
        job = state["jobs"].get(str(job_id))
        if job is None:
            raise RecordNotFoundError(f"crawl job not found: {job_id}")
        if job["profile"] != profile.value:
            raise DuplicateRecordError(
                f"crawl job {job_id} belongs to profile {job['profile']}, not {profile.value}"
            )

    def _article_from_state(
        self,
        state: Mapping[str, Any],
        article_id: str,
        *,
        profile: Optional[ProfileId] = None,
        crawl_job_id: Optional[UUID] = None,
    ) -> ArticleRead:
        raw = state["articles"].get(article_id)
        if raw is None:
            raise RecordNotFoundError(f"article not found: {article_id}")
        profiles = state["article_profiles"].get(article_id, {})
        profile_value = ProfileId(profile).value if profile is not None else None
        if profile_value is not None and profile_value not in profiles:
            raise RecordNotFoundError(f"article not found in profile {profile_value}: {article_id}")
        sources = [
            row
            for row in state["article_sources"].values()
            if row["article_id"] == article_id
            and (profile_value is None or row["profile"] == profile_value)
        ]
        sources.sort(key=lambda row: (row["discovered_at"], row["id"]))
        intelligence = [
            row
            for row in state["article_intelligence"].values()
            if row["article_id"] == article_id
            and (profile_value is None or row["profile"] == profile_value)
        ]
        selected = None
        if profile_value is not None and crawl_job_id is not None:
            selected = next(
                (row for row in intelligence if row.get("crawl_job_id") == str(crawl_job_id)),
                None,
            )
        if profile_value is not None and selected is None:
            matching = [row for row in intelligence if row["profile"] == profile_value]
            if matching:
                selected = max(matching, key=lambda row: (row["created_at"], row["id"]))
        projection = dict(raw)
        if selected is not None:
            for field in (
                "summary",
                "intent",
                "region",
                "category",
                "language",
                "importance_score",
                "keywords",
                "model_metadata",
                "metadata",
            ):
                projection[field] = selected[field]
        projection["profiles"] = sorted(profiles)
        projection["sources"] = sources
        return ArticleRead.model_validate(projection)

    def _add_source(self, state: Dict[str, Any], article_id: str, source: ArticleSourceCreate) -> str:
        self._require_job_for_profile(state, source.crawl_job_id, source.profile)
        for row in state["article_sources"].values():
            if row["stable_id"] == source.stable_id:
                if row["article_id"] != article_id:
                    raise DuplicateRecordError("source stable ID belongs to a different article")
                return row["id"]
            if (
                row["article_id"] == article_id
                and row["profile"] == source.profile.value
                and row["url"] == str(source.url)
            ):
                raise DuplicateRecordError("article source URL already exists with another stable ID")
        source_id = str(uuid4())
        state["article_sources"][source_id] = {
            **source.model_dump(mode="json"),
            "id": source_id,
            "article_id": article_id,
        }
        return source_id

    def upsert_article(self, article: ArticleCreate) -> ArticleRead:
        _assert_no_raw_ip(article.metadata)
        _assert_no_raw_ip(article.model_metadata)
        for source in article.sources:
            _assert_no_raw_ip(source.metadata)

        def operation(state: Dict[str, Any]) -> str:
            operation_stamp = _utc_text(self._now())
            stable_match = next(
                (row for row in state["articles"].values() if row["stable_id"] == article.stable_id),
                None,
            )
            url_match = next(
                (row for row in state["articles"].values() if row["canonical_url"] == str(article.canonical_url)),
                None,
            )
            if stable_match and url_match and stable_match["id"] != url_match["id"]:
                raise DuplicateRecordError("stable ID and canonical URL identify different articles")
            if stable_match:
                if stable_match["canonical_url"] != str(article.canonical_url):
                    raise DuplicateRecordError("stable article ID has a different canonical URL")
                article_id = stable_match["id"]
            elif url_match:
                if url_match["stable_id"] != article.stable_id:
                    raise DuplicateRecordError("canonical URL has a different stable article ID")
                article_id = url_match["id"]
            else:
                article_id = str(uuid4())
                raw = article.model_dump(mode="json", exclude={"profiles", "sources"})
                raw.update({"id": article_id, "created_at": operation_stamp})
                state["articles"][article_id] = raw
            profile_rows = state["article_profiles"].setdefault(article_id, {})
            for profile in article.profiles:
                profile_rows.setdefault(profile.value, operation_stamp)
                crawl_job_id = next(
                    (
                        source.crawl_job_id
                        for source in article.sources
                        if source.profile == profile and source.crawl_job_id is not None
                    ),
                    None,
                )
                stable_id = make_stable_id(
                    "intel", article_id, profile.value, crawl_job_id or "initial"
                )
                if not any(
                    row["stable_id"] == stable_id
                    for row in state["article_intelligence"].values()
                ):
                    intelligence_id = str(uuid4())
                    state["article_intelligence"][intelligence_id] = {
                        "id": intelligence_id,
                        "stable_id": stable_id,
                        "article_id": article_id,
                        "profile": profile.value,
                        "crawl_job_id": str(crawl_job_id) if crawl_job_id else None,
                        "summary": article.summary,
                        "intent": article.intent,
                        "region": article.region,
                        "category": article.category,
                        "language": article.language,
                        "importance_score": article.importance_score,
                        "keywords": list(article.keywords),
                        "model_metadata": article.model_metadata,
                        "metadata": article.metadata,
                        "created_at": operation_stamp,
                    }
            for source in article.sources:
                self._add_source(state, article_id, source)
            return article_id

        article_id = self._mutate(operation)
        return self.get_article(UUID(article_id), profile=article.profiles[0])

    create_article = upsert_article

    def upsert_article_source(
        self, article_id: UUID, source: ArticleSourceCreate
    ) -> ArticleSourceRead:
        _assert_no_raw_ip(source.metadata)

        def operation(state: Dict[str, Any]) -> str:
            if str(article_id) not in state["articles"]:
                raise RecordNotFoundError(f"article not found: {article_id}")
            if source.profile.value not in state["article_profiles"].get(str(article_id), {}):
                raise RecordNotFoundError(
                    f"article not found in profile {source.profile.value}: {article_id}"
                )
            return self._add_source(state, str(article_id), source)

        source_id = self._mutate(operation)
        return ArticleSourceRead.model_validate(self._read()["article_sources"][source_id])

    def get_article(
        self,
        identifier: UUID,
        *,
        profile: Optional[ProfileId] = None,
        crawl_job_id: Optional[UUID] = None,
    ) -> ArticleRead:
        state = self._read()
        return self._article_from_state(
            state, str(identifier), profile=profile, crawl_job_id=crawl_job_id
        )

    def get_article_by_stable_id(
        self,
        stable_id: str,
        *,
        profile: Optional[ProfileId] = None,
        crawl_job_id: Optional[UUID] = None,
    ) -> ArticleRead:
        state = self._read()
        row = next(
            (row for row in state["articles"].values() if row["stable_id"] == stable_id),
            None,
        )
        if row is None:
            raise RecordNotFoundError(f"article not found: {stable_id}")
        return self._article_from_state(
            state, row["id"], profile=profile, crawl_job_id=crawl_job_id
        )

    def list_articles(
        self, *, profile: Optional[ProfileId] = None, page: Optional[PageParams] = None
    ) -> Page[ArticleRead]:
        state = self._read()
        profile_value = ProfileId(profile).value if profile is not None else None
        rows = _sort_records(state["articles"].values(), "created_at")
        models = [
            self._article_from_state(state, row["id"], profile=profile)
            for row in rows
            if profile_value is None
            or profile_value in state["article_profiles"].get(row["id"], {})
        ]
        return _page(models, page)

    # --------------------------------------------------------------- clusters
    def _cluster_from_state(self, state: Mapping[str, Any], cluster_id: str) -> ClusterRead:
        row = state["clusters"].get(cluster_id)
        if row is None:
            raise RecordNotFoundError(f"cluster not found: {cluster_id}")
        members = tuple(
            ClusterMemberRead(
                **member,
                article=self._article_from_state(
                    state,
                    member["article_id"],
                    profile=ProfileId(row["profile"]),
                    crawl_job_id=UUID(row["crawl_job_id"]) if row.get("crawl_job_id") else None,
                ),
            )
            for member in sorted(row["members"], key=lambda item: (item["rank"], item["article_id"]))
        )
        projection = dict(row)
        projection["members"] = members
        return ClusterRead.model_validate(projection)

    def _insert_cluster(self, state: Dict[str, Any], cluster: ClusterCreate) -> str:
        existing = next(
            (row for row in state["clusters"].values() if row["stable_id"] == cluster.stable_id),
            None,
        )
        if existing:
            if (
                existing["profile"] != cluster.profile.value
                or existing.get("crawl_job_id")
                != (str(cluster.crawl_job_id) if cluster.crawl_job_id else None)
            ):
                raise DuplicateRecordError(
                    "cluster stable ID belongs to another profile or crawl run"
                )
            return existing["id"]
        self._require_job_for_profile(state, cluster.crawl_job_id, cluster.profile)
        for member in cluster.members:
            profiles = state["article_profiles"].get(str(member.article_id), {})
            if cluster.profile.value not in profiles:
                raise RecordNotFoundError(
                    f"cluster article not found in profile {cluster.profile.value}: {member.article_id}"
                )
        cluster_id = str(uuid4())
        state["clusters"][cluster_id] = {
            **cluster.model_dump(mode="json"),
            "id": cluster_id,
            "created_at": _utc_text(self._now()),
        }
        return cluster_id

    def upsert_cluster(self, cluster: ClusterCreate) -> ClusterRead:
        _assert_no_raw_ip(cluster.metadata)
        cluster_id = self._mutate(lambda state: self._insert_cluster(state, cluster))
        return self.get_cluster(UUID(cluster_id))

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
        def operation(state: Dict[str, Any]) -> None:
            row = state["clusters"].get(str(cluster_id))
            if row is None:
                raise RecordNotFoundError(f"cluster not found: {cluster_id}")
            if any(member["article_id"] == str(article_id) for member in row["members"]):
                raise DuplicateRecordError("article is already linked to cluster")
            if str(article_id) not in state["articles"]:
                raise RecordNotFoundError(f"article not found: {article_id}")
            row["members"].append(
                {
                    "article_id": str(article_id),
                    "rank": rank,
                    "similarity": similarity,
                    "is_primary": is_primary,
                }
            )

        self._mutate(operation)
        return self.get_cluster(cluster_id)

    def get_cluster(self, cluster_id: UUID) -> ClusterRead:
        state = self._read()
        return self._cluster_from_state(state, str(cluster_id))

    def list_clusters(
        self,
        *,
        profile: Optional[ProfileId] = None,
        crawl_job_id: Optional[UUID] = None,
        page: Optional[PageParams] = None,
    ) -> Page[ClusterRead]:
        state = self._read()
        profile_value = ProfileId(profile).value if profile is not None else None
        job_value = str(crawl_job_id) if crawl_job_id is not None else None
        rows = _sort_records(state["clusters"].values(), "created_at")
        models = [
            self._cluster_from_state(state, row["id"])
            for row in rows
            if (profile_value is None or row["profile"] == profile_value)
            and (job_value is None or row.get("crawl_job_id") == job_value)
        ]
        return _page(models, page)

    def replace_run_clusters(
        self, crawl_job_id: UUID, clusters: Iterable[ClusterCreate]
    ) -> Tuple[ClusterRead, ...]:
        supplied = tuple(clusters)
        if any(cluster.crawl_job_id != crawl_job_id for cluster in supplied):
            raise ValueError("every cluster must reference the supplied crawl_job_id")

        def operation(state: Dict[str, Any]) -> Tuple[str, ...]:
            if any(row.get("crawl_job_id") == str(crawl_job_id) for row in state["clusters"].values()):
                raise DuplicateRecordError("clusters for a completed run are immutable")
            return tuple(self._insert_cluster(state, cluster) for cluster in supplied)

        identifiers = self._mutate(operation)
        return tuple(self.get_cluster(UUID(identifier)) for identifier in identifiers)

    # ------------------------------------------------------------- briefings
    def _briefing_from_state(self, state: Mapping[str, Any], briefing_id: str) -> BriefingSnapshotRead:
        row = state["briefings"].get(briefing_id)
        if row is None:
            raise RecordNotFoundError(f"briefing not found: {briefing_id}")
        profile = ProfileId(row["profile"])
        job_id = UUID(row["crawl_job_id"]) if row.get("crawl_job_id") else None
        articles = tuple(
            self._article_from_state(
                state, article_id, profile=profile, crawl_job_id=job_id
            )
            for article_id in row["article_ids"]
        )
        projection = dict(row)
        projection["articles"] = articles
        return BriefingSnapshotRead.model_validate(projection)

    def create_briefing_snapshot(
        self, briefing: BriefingSnapshotCreate
    ) -> BriefingSnapshotRead:
        _assert_no_raw_ip(briefing.metadata)

        def operation(state: Dict[str, Any]) -> str:
            if any(row["stable_id"] == briefing.stable_id for row in state["briefings"].values()):
                raise DuplicateRecordError("briefing stable ID already exists")
            self._require_job_for_profile(
                state, briefing.crawl_job_id, briefing.profile
            )
            for article_id in briefing.article_ids:
                if briefing.profile.value not in state["article_profiles"].get(str(article_id), {}):
                    raise RecordNotFoundError(
                        f"briefing article not found in profile {briefing.profile.value}: {article_id}"
                    )
            briefing_id = str(uuid4())
            state["briefings"][briefing_id] = {
                **briefing.model_dump(mode="json"),
                "id": briefing_id,
                "created_at": _utc_text(self._now()),
            }
            return briefing_id

        briefing_id = self._mutate(operation)
        return self.get_briefing(UUID(briefing_id))

    def get_briefing(self, briefing_id: UUID) -> BriefingSnapshotRead:
        state = self._read()
        return self._briefing_from_state(state, str(briefing_id))

    def get_latest_briefing(self, profile: ProfileId) -> Optional[BriefingSnapshotRead]:
        state = self._read()
        profile_value = ProfileId(profile).value
        rows = _sort_records(
            (row for row in state["briefings"].values() if row["profile"] == profile_value),
            "created_at",
        )
        return self._briefing_from_state(state, rows[0]["id"]) if rows else None

    def list_briefings(
        self, profile: ProfileId, *, page: Optional[PageParams] = None
    ) -> Page[BriefingSnapshotRead]:
        state = self._read()
        profile_value = ProfileId(profile).value
        rows = _sort_records(
            (row for row in state["briefings"].values() if row["profile"] == profile_value),
            "created_at",
        )
        return _page([self._briefing_from_state(state, row["id"]) for row in rows], page)

    # --------------------------------------------------------------- actions
    def record_article_action(self, action: ArticleActionCreate) -> ArticleActionRead:
        _assert_no_raw_ip(action.metadata)

        def operation(state: Dict[str, Any]) -> Dict[str, Any]:
            if action.profile.value not in state["article_profiles"].get(str(action.article_id), {}):
                raise RecordNotFoundError(
                    f"article not found in profile {action.profile.value}: {action.article_id}"
                )
            if action.idempotency_key:
                existing = next(
                    (
                        row
                        for row in state["actions"].values()
                        if row["actor_id"] == action.actor_id
                        and row.get("idempotency_key") == action.idempotency_key
                    ),
                    None,
                )
                if existing:
                    return existing
            action_id = str(uuid4())
            record = {**action.model_dump(mode="json"), "id": action_id}
            state["actions"][action_id] = record
            return record

        return ArticleActionRead.model_validate(self._mutate(operation))

    def list_actions(
        self,
        *,
        article_id: Optional[UUID] = None,
        actor_id: Optional[str] = None,
        profile: Optional[ProfileId] = None,
        page: Optional[PageParams] = None,
    ) -> Page[ArticleActionRead]:
        state = self._read()
        profile_value = ProfileId(profile).value if profile is not None else None
        rows = _sort_records(state["actions"].values(), "occurred_at")
        models = [
            ArticleActionRead.model_validate(row)
            for row in rows
            if (article_id is None or row["article_id"] == str(article_id))
            and (actor_id is None or row["actor_id"] == actor_id)
            and (profile_value is None or row["profile"] == profile_value)
        ]
        return _page(models, page)

    @staticmethod
    def _fold_actions(rows: Iterable[Mapping[str, Any]]) -> Dict[str, Any]:
        state: Dict[str, Any] = {}
        for row in sorted(rows, key=lambda item: (item["occurred_at"], item["id"])):
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
                state.update(
                    interesting=False,
                    selected=False,
                    under_review=False,
                    approved=False,
                )
            elif action == ArticleActionType.HIDE:
                state["hidden"] = True
                state["selected"] = False
            elif action == ArticleActionType.RESTORE:
                state["hidden"] = False
                if state.get("interesting") is False:
                    state["interesting"] = None
            state["last_action_at"] = row["occurred_at"]
        return state

    def get_disposition(
        self, article_id: UUID, actor_id: str, profile: ProfileId
    ) -> ArticleDisposition:
        state = self._read()
        profile_value = ProfileId(profile).value
        if profile_value not in state["article_profiles"].get(str(article_id), {}):
            raise RecordNotFoundError(
                f"article not found in profile {profile_value}: {article_id}"
            )
        rows = [
            row
            for row in state["actions"].values()
            if row["article_id"] == str(article_id)
            and row["actor_id"] == actor_id
            and row["profile"] == profile_value
        ]
        return ArticleDisposition(
            article_id=article_id,
            actor_id=actor_id,
            **self._fold_actions(rows),
        )

    def list_worklist(
        self,
        *,
        actor_id: str,
        profile: ProfileId,
        state: str,
        page: Optional[PageParams] = None,
    ) -> Page[WorklistItem]:
        allowed = {
            "selected",
            "saved",
            "under_review",
            "approved",
            "interesting",
            "not_interested",
            "hidden",
        }
        if state not in allowed:
            raise ValueError(f"unsupported worklist state: {state}")
        snapshot = self._read()
        profile_value = ProfileId(profile).value
        relevant = [
            row
            for row in snapshot["actions"].values()
            if row["actor_id"] == actor_id and row["profile"] == profile_value
        ]
        latest: Dict[str, str] = {}
        for row in relevant:
            latest[row["article_id"]] = max(
                latest.get(row["article_id"], ""), row["occurred_at"]
            )
        items: List[WorklistItem] = []
        for article_id in sorted(latest, key=lambda key: (latest[key], key), reverse=True):
            rows = [row for row in relevant if row["article_id"] == article_id]
            disposition = ArticleDisposition(
                article_id=UUID(article_id),
                actor_id=actor_id,
                **self._fold_actions(rows),
            )
            matches = (
                disposition.interesting is False
                if state == "not_interested"
                else getattr(disposition, state) is True
            )
            if matches and article_id in snapshot["articles"]:
                items.append(
                    WorklistItem(
                        article=self._article_from_state(
                            snapshot, article_id, profile=ProfileId(profile)
                        ),
                        disposition=disposition,
                    )
                )
        return _page(items, page)

    # ----------------------------------------------------------- VOC/events
    def get_viewer_preference(self, actor_id: str) -> Optional[Dict[str, Any]]:
        normalized_actor = actor_id.strip()
        if not normalized_actor or len(normalized_actor) > 200:
            raise ValueError("actor_id must contain between 1 and 200 characters")
        row = self._read()["viewer_preferences"].get(normalized_actor)
        return dict(row) if row is not None else None

    def upsert_viewer_preference(
        self,
        actor_id: str,
        *,
        display_name: str,
        contact_email: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized_actor = actor_id.strip()
        normalized_name = display_name.strip()
        normalized_email = contact_email.strip() if contact_email else None
        if not normalized_actor or len(normalized_actor) > 200:
            raise ValueError("actor_id must contain between 1 and 200 characters")
        if not normalized_name or len(normalized_name) > 120:
            raise ValueError("display_name must contain between 1 and 120 characters")
        if normalized_email:
            local, separator, domain = normalized_email.rpartition("@")
            if (
                not separator
                or not local
                or "." not in domain
                or any(character.isspace() for character in normalized_email)
                or len(normalized_email) > 320
            ):
                raise ValueError("contact_email must be a valid email address")
            normalized_email = f"{local}@{domain.casefold()}"

        def operation(state: Dict[str, Any]) -> Dict[str, Any]:
            now = _utc_text(self._now())
            previous = state["viewer_preferences"].get(normalized_actor)
            record = {
                "actor_id": normalized_actor,
                "display_name": normalized_name,
                "contact_email": normalized_email,
                "created_at": previous["created_at"] if previous else now,
                "updated_at": now,
            }
            state["viewer_preferences"][normalized_actor] = record
            return record

        return dict(self._mutate(operation))

    def record_voc(self, feedback: VocFeedbackCreate) -> VocFeedbackRead:
        _assert_no_raw_ip(feedback.diagnostics)
        feedback_id = str(uuid4())
        record = {
            **feedback.model_dump(mode="json"),
            "id": feedback_id,
            "reference": make_stable_id("voc", feedback_id),
            "created_at": _utc_text(self._now()),
        }
        self._mutate(lambda state: state["voc"].__setitem__(feedback_id, record))
        return VocFeedbackRead.model_validate(record)

    def list_voc(
        self, *, profile: Optional[ProfileId] = None, page: Optional[PageParams] = None
    ) -> Page[VocFeedbackRead]:
        profile_value = ProfileId(profile).value if profile is not None else None
        rows = _sort_records(self._read()["voc"].values(), "created_at")
        return _page(
            [
                VocFeedbackRead.model_validate(row)
                for row in rows
                if profile_value is None or row["profile"] == profile_value
            ],
            page,
        )

    def record_activity(self, event: TelemetryEventCreate) -> TelemetryEventRead:
        _assert_no_raw_ip(event.properties)
        event_id = str(uuid4())
        record = {
            **event.model_dump(mode="json"),
            "id": event_id,
            "received_at": _utc_text(self._now()),
        }

        def operation(state: Dict[str, Any]) -> None:
            if event.article_id is not None and event.profile.value not in state[
                "article_profiles"
            ].get(str(event.article_id), {}):
                raise RecordNotFoundError(
                    f"article not found in profile {event.profile.value}: {event.article_id}"
                )
            state["telemetry"][event_id] = record

        self._mutate(operation)
        return TelemetryEventRead.model_validate(record)

    record_event = record_activity

    def list_activity(
        self,
        *,
        profile: Optional[ProfileId] = None,
        actor_id: Optional[str] = None,
        session_id: Optional[UUID] = None,
        page: Optional[PageParams] = None,
    ) -> Page[TelemetryEventRead]:
        profile_value = ProfileId(profile).value if profile is not None else None
        rows = _sort_records(self._read()["telemetry"].values(), "occurred_at")
        models = [
            TelemetryEventRead.model_validate(row)
            for row in rows
            if (profile_value is None or row["profile"] == profile_value)
            and (actor_id is None or row.get("actor_id") == actor_id)
            and (session_id is None or row["session_id"] == str(session_id))
        ]
        return _page(models, page)

    list_events = list_activity

    def analytics_summary(
        self, *, profile: Optional[ProfileId] = None
    ) -> AnalyticsSummary:
        profile_value = ProfileId(profile).value if profile is not None else None
        rows = [
            row
            for row in self._read()["telemetry"].values()
            if profile_value is None or row["profile"] == profile_value
        ]
        return AnalyticsSummary(
            profile=profile,
            unique_actors=len({row["actor_id"] for row in rows if row.get("actor_id")}),
            unique_sessions=len({row["session_id"] for row in rows}),
            total_events=len(rows),
            article_opens=sum(row["event_type"] == TelemetryEventType.ARTICLE_OPEN.value for row in rows),
            article_actions=sum(row["event_type"] == TelemetryEventType.ARTICLE_ACTION.value for row in rows),
            feedback_submissions=sum(row["event_type"] == TelemetryEventType.FEEDBACK.value for row in rows),
            heartbeat_events=sum(row["event_type"] == TelemetryEventType.HEARTBEAT.value for row in rows),
        )


Repository = JSONRepository


__all__ = ["JSONRepository", "Repository", "JSON_SCHEMA_VERSION"]
