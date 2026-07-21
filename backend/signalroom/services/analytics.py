"""Privacy-aware usage analytics derived from the telemetry event stream.

The repository deliberately stores telemetry as an append-only stream.  This
service turns that stream into bounded administrative rollups without exposing
network identifiers or the caller-controlled ``properties`` payload.

Active time is intentionally conservative: within each session, the elapsed
time between consecutive events is counted, but every gap is capped at five
minutes by default.  A lone event contributes zero minutes.  Regular heartbeat
events therefore improve the estimate without allowing an abandoned browser
tab to accumulate unlimited time.
"""

from __future__ import annotations

import ipaddress
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import AwareDatetime, Field

from signalroom.models import (
    ArticleActionType,
    PageParams,
    ProfileId,
    StrictModel,
    TelemetryEventRead,
    TelemetryEventType,
)
from signalroom.storage import SQLiteRepository


DEFAULT_WINDOW_DAYS = 7
MAX_WINDOW_DAYS = 90
DEFAULT_EVENT_LIMIT = 5_000
HARD_EVENT_LIMIT = 10_000
DEFAULT_USER_LIMIT = 100
DEFAULT_SESSION_LIMIT = 250
HARD_ROW_LIMIT = 500
REPOSITORY_PAGE_SIZE = 100
MAX_PATHS_PER_ROLLUP = 25
DEFAULT_IDLE_CAP_MINUTES = 5

_IPV4_CANDIDATE = re.compile(r"(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])")
_KNOWN_ACTIONS = frozenset(action.value for action in ArticleActionType)


class PathActivity(StrictModel):
    path: str
    count: int = Field(ge=1)


class ActivityRollup(StrictModel):
    active_minutes: float = Field(ge=0)
    event_count: int = Field(ge=0)
    article_count: int = Field(ge=0)
    paths: Tuple[PathActivity, ...] = ()
    event_types: Dict[str, int] = Field(default_factory=dict)
    action_types: Dict[str, int] = Field(default_factory=dict)
    started_at: Optional[AwareDatetime] = None
    last_seen_at: Optional[AwareDatetime] = None


class AnalyticsWindowSummary(ActivityRollup):
    unique_actors: int = Field(ge=0)
    session_count: int = Field(ge=0)
    unattributed_event_count: int = Field(ge=0)


class UserActivityRollup(ActivityRollup):
    # Null means the event stream had no safe stored actor identifier.  The
    # service never substitutes a network-derived identifier.
    actor_id: Optional[str] = None
    display_name: Optional[str] = None
    session_count: int = Field(ge=1)


class SessionActivityRollup(ActivityRollup):
    session_id: UUID
    # Null also covers the defensive case where a session contains multiple
    # actor IDs, because selecting one would be misleading.
    actor_id: Optional[str] = None
    display_name: Optional[str] = None


class AnalyticsCoverage(StrictModel):
    events_examined: int = Field(ge=0)
    event_limit: int = Field(ge=1)
    events_truncated: bool
    profile_total_events: int = Field(ge=0)
    user_rows_available: int = Field(ge=0)
    user_rows_returned: int = Field(ge=0)
    user_rows_truncated: bool
    session_rows_available: int = Field(ge=0)
    session_rows_returned: int = Field(ge=0)
    session_rows_truncated: bool


class DetailedAnalytics(StrictModel):
    profile: ProfileId
    window_started_at: AwareDatetime
    window_ended_at: AwareDatetime
    window_days: int = Field(ge=1, le=MAX_WINDOW_DAYS)
    idle_cap_minutes: int = Field(ge=1, le=60)
    summary: AnalyticsWindowSummary
    users: Tuple[UserActivityRollup, ...]
    sessions: Tuple[SessionActivityRollup, ...]
    coverage: AnalyticsCoverage


def _enum_value(value: object) -> str:
    return str(getattr(value, "value", value))


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("analytics timestamps must include a timezone")
    return value.astimezone(timezone.utc)


def _contains_ip_literal(value: str) -> bool:
    candidate = value.strip()
    try:
        ipaddress.ip_address(candidate)
        return True
    except ValueError:
        pass
    for match in _IPV4_CANDIDATE.finditer(candidate):
        try:
            ipaddress.ip_address(match.group(0))
            return True
        except ValueError:
            continue
    return False


def _safe_actor_id(value: Optional[str]) -> Optional[str]:
    """Return the stored pseudonym/identity unless it resembles network data."""

    if value is None:
        return None
    candidate = str(value).strip()
    if not candidate:
        return None
    if candidate.casefold().startswith("ip:v1:") or _contains_ip_literal(candidate):
        return None
    return candidate


def _safe_path(value: Optional[str]) -> Optional[str]:
    """Keep only a normalized URL path; drop hosts, queries, and fragments."""

    if not value:
        return None
    candidate = "".join(character for character in str(value) if character.isprintable())
    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return None
    path = parsed.path.strip()
    if not path:
        return None
    if not path.startswith("/"):
        path = "/" + path
    path = re.sub(r"/{2,}", "/", path)
    return path[:300]


def _event_action(event: TelemetryEventRead) -> Optional[str]:
    if _enum_value(event.event_type) != TelemetryEventType.ARTICLE_ACTION.value:
        return None
    # Read only a fixed semantic field and emit only known enum values.  No
    # other property key or value can cross the service boundary.
    raw = event.properties.get("action")
    if raw is None:
        raw = event.properties.get("action_type")
    candidate = str(raw or "").strip().casefold()
    return candidate if candidate in _KNOWN_ACTIONS else None


def _active_seconds(
    events: Iterable[TelemetryEventRead], idle_cap: timedelta
) -> float:
    by_session: Dict[UUID, List[datetime]] = defaultdict(list)
    for event in events:
        by_session[event.session_id].append(_as_utc(event.occurred_at))
    cap_seconds = idle_cap.total_seconds()
    total = 0.0
    for timestamps in by_session.values():
        ordered = sorted(timestamps)
        for previous, current in zip(ordered, ordered[1:]):
            gap = (current - previous).total_seconds()
            if gap > 0:
                total += min(gap, cap_seconds)
    return total


def _sorted_counts(values: Counter) -> Dict[str, int]:
    return {
        key: count
        for key, count in sorted(values.items(), key=lambda item: (-item[1], item[0]))
    }


def _rollup_values(
    events: Sequence[TelemetryEventRead], idle_cap: timedelta
) -> Mapping[str, object]:
    ordered = sorted(events, key=lambda event: (_as_utc(event.occurred_at), str(event.id)))
    path_counts: Counter = Counter()
    event_counts: Counter = Counter()
    action_counts: Counter = Counter()
    article_ids = set()
    for event in ordered:
        event_counts[_enum_value(event.event_type)] += 1
        path = _safe_path(event.path)
        if path:
            path_counts[path] += 1
        action = _event_action(event)
        if action:
            action_counts[action] += 1
        if event.article_id is not None:
            article_ids.add(event.article_id)

    top_paths = tuple(
        PathActivity(path=path, count=count)
        for path, count in sorted(
            path_counts.items(), key=lambda item: (-item[1], item[0])
        )[:MAX_PATHS_PER_ROLLUP]
    )
    return {
        "active_minutes": round(_active_seconds(ordered, idle_cap) / 60.0, 2),
        "event_count": len(ordered),
        "article_count": len(article_ids),
        "paths": top_paths,
        "event_types": _sorted_counts(event_counts),
        "action_types": _sorted_counts(action_counts),
        "started_at": _as_utc(ordered[0].occurred_at) if ordered else None,
        "last_seen_at": _as_utc(ordered[-1].occurred_at) if ordered else None,
    }


def _rank_rollup(rollup: ActivityRollup) -> Tuple[float, int, float]:
    last_seen = rollup.last_seen_at
    timestamp = last_seen.timestamp() if last_seen is not None else 0.0
    return (rollup.active_minutes, rollup.event_count, timestamp)


class DetailedAnalyticsService:
    """Build bounded windowed rollups using only the repository's public API."""

    def __init__(
        self,
        repository: SQLiteRepository,
        *,
        event_limit: int = DEFAULT_EVENT_LIMIT,
        user_limit: int = DEFAULT_USER_LIMIT,
        session_limit: int = DEFAULT_SESSION_LIMIT,
        idle_cap_minutes: int = DEFAULT_IDLE_CAP_MINUTES,
    ) -> None:
        if not 1 <= event_limit <= HARD_EVENT_LIMIT:
            raise ValueError(f"event_limit must be between 1 and {HARD_EVENT_LIMIT}")
        if not 1 <= user_limit <= HARD_ROW_LIMIT:
            raise ValueError(f"user_limit must be between 1 and {HARD_ROW_LIMIT}")
        if not 1 <= session_limit <= HARD_ROW_LIMIT:
            raise ValueError(f"session_limit must be between 1 and {HARD_ROW_LIMIT}")
        if not 1 <= idle_cap_minutes <= 60:
            raise ValueError("idle_cap_minutes must be between 1 and 60")
        self.repository = repository
        self.event_limit = event_limit
        self.user_limit = user_limit
        self.session_limit = session_limit
        self.idle_cap = timedelta(minutes=idle_cap_minutes)
        self.idle_cap_minutes = idle_cap_minutes

    def _window_events(
        self,
        *,
        profile: ProfileId,
        started_at: datetime,
        ended_at: datetime,
    ) -> Tuple[List[TelemetryEventRead], int, bool]:
        events: List[TelemetryEventRead] = []
        examined = 0
        cursor: Optional[str] = None
        reached_window_start = False
        truncated = False

        while examined < self.event_limit and not reached_window_start:
            page_size = min(REPOSITORY_PAGE_SIZE, self.event_limit - examined)
            page = self.repository.list_activity(
                profile=profile,
                page=PageParams(limit=page_size, cursor=cursor),
            )
            if not page.items:
                break
            for event in page.items:
                examined += 1
                occurred_at = _as_utc(event.occurred_at)
                if occurred_at < started_at:
                    reached_window_start = True
                    break
                if occurred_at <= ended_at:
                    events.append(event)
            if reached_window_start or not page.page.has_more:
                break
            cursor = page.page.next_cursor
            if cursor is None:
                break

        if examined >= self.event_limit and not reached_window_start:
            # If the source says there are more rows, those rows may still be
            # inside the requested window.  The response makes this explicit.
            truncated = bool(page.page.has_more)  # type: ignore[possibly-undefined]
        return events, examined, truncated

    def build(
        self,
        *,
        profile: ProfileId,
        window_days: int = DEFAULT_WINDOW_DAYS,
        end_at: Optional[datetime] = None,
    ) -> DetailedAnalytics:
        if not 1 <= window_days <= MAX_WINDOW_DAYS:
            raise ValueError(f"window_days must be between 1 and {MAX_WINDOW_DAYS}")
        active_profile = ProfileId(profile)
        ended_at = _as_utc(end_at or datetime.now(timezone.utc))
        started_at = ended_at - timedelta(days=window_days)

        # The lifetime aggregate is intentionally used only as coverage
        # context.  Window metrics below are derived from bounded event pages.
        profile_totals = self.repository.analytics_summary(profile=active_profile)
        events, examined, events_truncated = self._window_events(
            profile=active_profile,
            started_at=started_at,
            ended_at=ended_at,
        )

        by_actor: Dict[Optional[str], List[TelemetryEventRead]] = defaultdict(list)
        by_session: Dict[UUID, List[TelemetryEventRead]] = defaultdict(list)
        for event in events:
            by_actor[_safe_actor_id(event.actor_id)].append(event)
            by_session[event.session_id].append(event)

        preference_reader = getattr(self.repository, "get_viewer_preference", None)

        def display_name_for(actor: Optional[str]) -> Optional[str]:
            if actor is None or not callable(preference_reader):
                return None
            preference = preference_reader(actor)
            if not preference:
                return None
            name = str(preference.get("display_name") or "").strip()
            return name or None

        users = [
            UserActivityRollup(
                actor_id=actor,
                display_name=display_name_for(actor),
                session_count=len({event.session_id for event in actor_events}),
                **_rollup_values(actor_events, self.idle_cap),
            )
            for actor, actor_events in by_actor.items()
        ]
        users.sort(
            key=lambda item: (
                -_rank_rollup(item)[0],
                -_rank_rollup(item)[1],
                -_rank_rollup(item)[2],
                item.actor_id or "",
            )
        )

        sessions: List[SessionActivityRollup] = []
        for session_id, session_events in by_session.items():
            actors = {
                actor
                for actor in (_safe_actor_id(event.actor_id) for event in session_events)
                if actor is not None
            }
            session_actor = next(iter(actors)) if len(actors) == 1 else None
            sessions.append(
                SessionActivityRollup(
                    session_id=session_id,
                    actor_id=session_actor,
                    display_name=display_name_for(session_actor),
                    **_rollup_values(session_events, self.idle_cap),
                )
            )
        sessions.sort(
            key=lambda item: (
                -_rank_rollup(item)[0],
                -_rank_rollup(item)[1],
                -_rank_rollup(item)[2],
                str(item.session_id),
            )
        )

        summary_values = _rollup_values(events, self.idle_cap)
        summary = AnalyticsWindowSummary(
            unique_actors=len([actor for actor in by_actor if actor is not None]),
            session_count=len(by_session),
            unattributed_event_count=len(by_actor.get(None, ())),
            **summary_values,
        )
        returned_users = tuple(users[: self.user_limit])
        returned_sessions = tuple(sessions[: self.session_limit])
        return DetailedAnalytics(
            profile=active_profile,
            window_started_at=started_at,
            window_ended_at=ended_at,
            window_days=window_days,
            idle_cap_minutes=self.idle_cap_minutes,
            summary=summary,
            users=returned_users,
            sessions=returned_sessions,
            coverage=AnalyticsCoverage(
                events_examined=examined,
                event_limit=self.event_limit,
                events_truncated=events_truncated,
                profile_total_events=profile_totals.total_events,
                user_rows_available=len(users),
                user_rows_returned=len(returned_users),
                user_rows_truncated=len(users) > len(returned_users),
                session_rows_available=len(sessions),
                session_rows_returned=len(returned_sessions),
                session_rows_truncated=len(sessions) > len(returned_sessions),
            ),
        )


def build_detailed_analytics(
    repository: SQLiteRepository,
    *,
    profile: ProfileId,
    window_days: int = DEFAULT_WINDOW_DAYS,
    end_at: Optional[datetime] = None,
) -> DetailedAnalytics:
    """Small dependency-injection friendly entry point for the admin route."""

    return DetailedAnalyticsService(repository).build(
        profile=profile,
        window_days=window_days,
        end_at=end_at,
    )


__all__ = [
    "ActivityRollup",
    "AnalyticsCoverage",
    "AnalyticsWindowSummary",
    "DetailedAnalytics",
    "DetailedAnalyticsService",
    "PathActivity",
    "SessionActivityRollup",
    "UserActivityRollup",
    "build_detailed_analytics",
]
