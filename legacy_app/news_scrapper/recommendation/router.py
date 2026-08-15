"""FastAPI surface for private For You ranking and shared Briefing reads."""

from __future__ import annotations

import json
import os
import datetime as dt
import hashlib
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, Query, Request, Response

from core.settings import NEWS_RUNTIME_DIR
from .identity import clear_viewer_cookie, resolve_viewer
from .candidates import article_id, collect_candidates
from .events import aggregate_quality_metrics
from .migration import legacy_migration_offer
from .preferences import ViewerRepository, taxonomy
from .schemas import PauseRequest, RecommendationEventBatch, ViewerPreferences
from .service import RecommendationService
from .scoring import article_outcomes, article_topics, source_family


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


FOR_YOU_ENABLED = env_bool("FOR_YOU_ENABLED", True)
FOR_YOU_DEFAULT_LANDING = env_bool("FOR_YOU_DEFAULT_LANDING", True)
UNIFIED_CORPUS_ENABLED = env_bool("UNIFIED_CORPUS_ENABLED", True)
LEGACY_PROFILE_ROUTING_ENABLED = env_bool("LEGACY_PROFILE_ROUTING_ENABLED", False)
HOOKS_ENABLED = env_bool("FOR_YOU_HOOKS_ENABLED", True)
SEMANTIC_AFFINITY_ENABLED = env_bool("FOR_YOU_SEMANTIC_AFFINITY_ENABLED", False)
EXPLORATION_PERCENT = env_int("FOR_YOU_EXPLORATION_PERCENT", 15, 0, 50)
EVENT_BATCH_SIZE = env_int("FOR_YOU_EVENT_BATCH_SIZE", 10, 1, 100)
EVENT_FLUSH_SECONDS = env_int("FOR_YOU_EVENT_FLUSH_SECONDS", 15, 2, 120)
BROADCAST_VISIBILITY_MODE = os.environ.get(
    "BROADCAST_VISIBILITY_MODE", "interest"
).strip().lower()
if BROADCAST_VISIBILITY_MODE not in {"interest", "restricted"}:
    BROADCAST_VISIBILITY_MODE = "interest"

REPOSITORY = ViewerRepository(NEWS_RUNTIME_DIR / "recommendation" / "viewers")
SERVICE = RecommendationService(
    REPOSITORY,
    exploration_percent=EXPLORATION_PERCENT,
    hooks_enabled=HOOKS_ENABLED,
    semantic_affinity_enabled=SEMANTIC_AFFINITY_ENABLED,
)
router = APIRouter(tags=["For You"])

print(
    "[FOR YOU] "
    f"enabled={FOR_YOU_ENABLED} default_landing={FOR_YOU_DEFAULT_LANDING} "
    f"hooks={HOOKS_ENABLED} semantic_affinity={SEMANTIC_AFFINITY_ENABLED} "
    f"profile_mode={'unified' if UNIFIED_CORPUS_ENABLED else 'legacy'} "
    f"broadcast_visibility={BROADCAST_VISIBILITY_MODE}",
    flush=True,
)


def _legacy():
    from news_scrapper import application as legacy
    return legacy


def _profile_and_articles(request: Request) -> tuple[str, list[dict]]:
    legacy = _legacy()
    profile = legacy.get_profile_for_request(request)
    serving_profile = legacy.DEFAULT_PROFILE if UNIFIED_CORPUS_ENABLED else profile
    latest = legacy.get_latest_briefing_file_for_profile(serving_profile)
    if UNIFIED_CORPUS_ENABLED:
        # Unified history is authoritative. The former shadow directory is no
        # longer a serving dependency and cannot silently lag the scheduler.
        latest = legacy.get_latest_briefing_file_for_profile(legacy.DEFAULT_PROFILE)
    if not latest:
        return profile, []
    try:
        with open(latest, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return profile, []
    articles = payload if isinstance(payload, list) else []
    if UNIFIED_CORPUS_ENABLED:
        visible = legacy.filter_viewer_hidden(articles, request, "default")
        visible = legacy.filter_viewer_hidden(visible, request, "broadcast")
        return "unified", legacy.apply_learned_regions(visible, legacy.DEFAULT_PROFILE)
    visible = legacy.filter_viewer_hidden(articles, request, profile)
    return profile, legacy.apply_learned_regions(visible, profile)


def _resolve(request: Request, response: Response) -> tuple[str, bool, str]:
    key, created = resolve_viewer(request, response)
    profile = _legacy().get_profile_for_request(request)
    return key, created, profile


SHARED_EVENT_ACTIONS = {
    "dossier_open",
    "dossier_dwell",
    "source_open",
    "why_this_story_open",
    "save",
    "unsave",
    "select",
    "approve",
    "interested",
    "not_interested",
    "less_like_this",
    "hide",
}
TRACK_ACTION_MAP = {
    "dossier_open": "dossier_open",
    "dossier_dwell": "dossier_dwell",
    "source_open": "source_open",
    "why_this_story_open": "why_this_story_open",
    "save_for_later": "save",
    "save_for_later_remove": "unsave",
    "select": "select",
    "archive_import": "select",
    "approve": "approve",
    "vote_interested": "interested",
    "vote_not_interested": "not_interested",
    "hide_personal": "hide",
}


def _article_aliases(item: dict) -> set[str]:
    aliases = {article_id(item)}
    for key in ("article_id", "id", "canonical_link", "link", "url", "title"):
        value = str(item.get(key) or "").strip()
        if value:
            aliases.add(value.casefold())
    return aliases


def _resolve_shared_article(request: Request, detail: dict) -> dict | None:
    _, articles = _profile_and_articles(request)
    candidates = collect_candidates(
        articles,
        entitled_audiences={"all", "technology", "default", "broadcast"},
    )
    requested = {
        str(detail.get(key) or "").strip().casefold()
        for key in ("article_id", "id", "canonical_link", "link", "url", "title")
        if str(detail.get(key) or "").strip()
    }
    requested_id = article_id(detail)
    if requested_id:
        requested.add(requested_id.casefold())
    for candidate in candidates:
        if requested & _article_aliases(candidate):
            return candidate
    return None


def _validated_shared_event(
    request: Request,
    *,
    action: str,
    detail: dict,
    event_id: str = "",
    occurred_at: str = "",
    active_ms: int = 0,
    visible_ratio: float = 0.0,
    surface: str = "shared_briefing",
) -> tuple[dict, str] | None:
    normalized_action = str(action or "").strip().lower()
    if normalized_action not in SHARED_EVENT_ACTIONS:
        return None
    active_ms = max(0, min(86_400_000, int(active_ms or 0)))
    # An accidental open must not train interest. The audit trail remains in
    # usage_tracker.json, but recommender ingestion begins at five seconds.
    if normalized_action == "dossier_dwell" and active_ms < 5_000:
        return None
    article = _resolve_shared_article(request, detail)
    if article is None:
        return None
    identifier = article_id(article)
    occurred = str(occurred_at or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))
    supplied_event_id = str(event_id or "").strip()
    if len(supplied_event_id) < 8:
        supplied_event_id = hashlib.sha256(
            f"{normalized_action}|{identifier}|{occurred}".encode("utf-8")
        ).hexdigest()[:32]
    safe_detail = {
        "title": str(article.get("title") or "")[:500],
        "source": str(article.get("source") or article.get("src") or "")[:300],
        "topics": article_topics(article),
        "outcomes": article_outcomes(article),
        "source_family": source_family(article),
        "vertical": str(article.get("vertical") or "technology")[:80],
    }
    return ({
        "event_id": supplied_event_id[:160],
        "action": normalized_action,
        "article_id": identifier,
        "cluster_id": str(article.get("cluster_id") or "")[:300],
        "surface": str(surface or "shared_briefing")[:80],
        "position": None,
        "occurred_at": occurred[:80],
        "active_ms": active_ms,
        "visible_ratio": max(0.0, min(1.0, float(visible_ratio or 0.0))),
        "detail": safe_detail,
    }, identifier)


def record_shared_briefing_event(
    request: Request,
    response: Response,
    *,
    track_action: str,
    detail: dict,
    event_id: str = "",
    occurred_at: str = "",
    active_ms: int = 0,
    visible_ratio: float = 0.0,
) -> dict:
    """Bridge validated shared-Briefing behavior into For You state."""

    action = TRACK_ACTION_MAP.get(str(track_action or "").strip().lower())
    if not action:
        return {"accepted": 0, "duplicates": 0, "rejected": 0, "ignored": True}
    validated = _validated_shared_event(
        request,
        action=action,
        detail=detail if isinstance(detail, dict) else {},
        event_id=event_id,
        occurred_at=occurred_at,
        active_ms=active_ms,
        visible_ratio=visible_ratio,
    )
    if validated is None:
        return {"accepted": 0, "duplicates": 0, "rejected": 1, "ignored": True}
    event, identifier = validated
    key, _ = resolve_viewer(request, response)
    accepted, duplicates, rejected = REPOSITORY.append_events(
        key,
        [event],
        authorized_article_ids={identifier},
    )
    if accepted:
        REPOSITORY.mark_seen_external(key, [identifier], surface="shared_briefing")
    return {
        "accepted": accepted,
        "duplicates": duplicates,
        "rejected": rejected,
        "ignored": False,
        "article_id": identifier,
    }


@router.get("/viewer/recommendation-status")
def recommendation_status(request: Request, response: Response):
    key, created, profile = _resolve(request, response)
    legacy = _legacy()
    state = REPOSITORY.read(key)
    legacy_profile = legacy.get_viewer_profile(legacy.get_client_ip(request))
    return {
        "status": "success",
        "enabled": FOR_YOU_ENABLED,
        "default_landing": FOR_YOU_DEFAULT_LANDING,
        "hooks_enabled": HOOKS_ENABLED,
        "semantic_affinity_enabled": SEMANTIC_AFFINITY_ENABLED,
        "event_batch_size": EVENT_BATCH_SIZE,
        "event_flush_seconds": EVENT_FLUSH_SECONDS,
        "exploration_percent": EXPLORATION_PERCENT,
        "broadcast_visibility_mode": BROADCAST_VISIBILITY_MODE,
        "profile_mode": "unified" if UNIFIED_CORPUS_ENABLED else "legacy",
        "legacy_profile_routing": LEGACY_PROFILE_ROUTING_ENABLED,
        "active_profile": profile,
        "identity_created": created,
        "mode": (
            "paused" if state.get("personalization_paused")
            else "configured" if (state.get("preferences") or {}).get("completed_at")
            else "starter"
        ),
        "migration_offer": legacy_migration_offer(state, legacy_profile),
        "taxonomy": taxonomy(),
    }


@router.get("/viewer/preferences")
def read_preferences(request: Request, response: Response):
    key, _, _ = _resolve(request, response)
    state = REPOSITORY.read(key)
    return {
        "status": "success",
        "preferences": state.get("preferences"),
        "personalization_paused": bool(state.get("personalization_paused")),
        "taxonomy": taxonomy(),
    }


@router.put("/viewer/preferences")
def update_preferences(payload: ViewerPreferences, request: Request, response: Response):
    key, _, _ = _resolve(request, response)
    data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    state = REPOSITORY.update_preferences(key, data)
    return {"status": "success", "preferences": state.get("preferences")}


@router.post("/viewer/preferences/complete")
def complete_preferences(payload: ViewerPreferences, request: Request, response: Response):
    key, _, _ = _resolve(request, response)
    data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    state = REPOSITORY.update_preferences(key, data, complete=True)
    return {"status": "success", "preferences": state.get("preferences"), "mode": "configured"}


@router.post("/viewer/preferences/migrate")
def confirm_legacy_migration(request: Request, response: Response, confirmed: bool = Body(True, embed=True)):
    key, _, _ = _resolve(request, response)
    legacy = _legacy()
    client_ip = legacy.get_client_ip(request)
    legacy_key = legacy.get_viewer_key(client_ip)
    legacy_profile = legacy.get_viewer_profile(client_ip)
    if not confirmed:
        return {"status": "success", "migrated": False}
    if not str(legacy_profile.get("display_name") or "").strip():
        raise HTTPException(status_code=404, detail="No legacy desk was found for this browser to continue.")
    state = REPOSITORY.confirm_migration(key, legacy_key)
    return {
        "status": "success",
        "migrated": True,
        "display_name": legacy_profile.get("display_name"),
        "legacy_source_preserved": bool((state.get("migration") or {}).get("legacy_source_preserved")),
    }


@router.post("/viewer/preferences/pause")
def pause_preferences(payload: PauseRequest, request: Request, response: Response):
    key, _, _ = _resolve(request, response)
    state = REPOSITORY.pause(key, payload.paused)
    return {"status": "success", "personalization_paused": state.get("personalization_paused")}


@router.post("/viewer/preferences/reset")
def reset_preferences(request: Request, response: Response):
    key, _, _ = _resolve(request, response)
    removed = REPOSITORY.reset(key)
    clear_viewer_cookie(response)
    return {"status": "success", "removed_events": removed, "new_identity_on_next_request": True}


@router.post("/viewer/recommendation-events")
def recommendation_events(payload: RecommendationEventBatch, request: Request, response: Response):
    key, _, _ = _resolve(request, response)
    values = []
    authorized_article_ids: set[str] = set()
    for event in payload.events:
        value = event.model_dump() if hasattr(event, "model_dump") else event.dict()
        value["feed_request_id"] = payload.feed_request_id
        if str(value.get("surface") or "for_you") != "for_you":
            validated = _validated_shared_event(
                request,
                action=value.get("action"),
                detail=value.get("detail") if isinstance(value.get("detail"), dict) else {},
                event_id=value.get("event_id"),
                occurred_at=value.get("occurred_at"),
                active_ms=value.get("active_ms") or 0,
                visible_ratio=value.get("visible_ratio") or 0.0,
                surface=value.get("surface") or "shared_briefing",
            )
            if validated is None:
                # Keep an invalid placeholder so repository accounting returns
                # a rejection instead of silently claiming success.
                value["article_id"] = ""
            else:
                value, identifier = validated
                value["feed_request_id"] = payload.feed_request_id
                authorized_article_ids.add(identifier)
        values.append(value)
    accepted, duplicates, rejected = REPOSITORY.append_events(
        key,
        values,
        authorized_article_ids=authorized_article_ids,
    )
    if authorized_article_ids and accepted:
        REPOSITORY.mark_seen_external(
            key,
            sorted(authorized_article_ids),
            surface="shared_briefing",
        )
    return {
        "status": "success",
        "accepted": accepted,
        "duplicates": duplicates,
        "rejected": rejected,
    }


@router.get("/analytics/recommendation-summary")
def recommendation_analytics(request: Request, key: str = Query(default=None)):
    legacy = _legacy()
    legacy.require_analytics_access(request, key)
    return {
        "status": "success",
        **aggregate_quality_metrics(REPOSITORY.root),
    }


@router.get("/briefing/shared/latest")
def shared_briefing(request: Request):
    profile, articles = _profile_and_articles(request)
    return {
        "status": "success" if articles else "empty",
        "result": articles,
        "profile": profile,
        "type": "scheduler",
        "source": "shared",
        "personalization": {"applied": False},
    }


@router.get("/for-you")
@router.get("/viewer/for-you", include_in_schema=False)
def for_you(
    request: Request,
    response: Response,
    cursor: str = Query(default=""),
    limit: int = Query(default=20, ge=1, le=50),
):
    if not FOR_YOU_ENABLED:
        raise HTTPException(status_code=404, detail="For You is not enabled for this deployment.")
    key, _, profile = _resolve(request, response)
    legacy = _legacy()
    serving_profile, articles = _profile_and_articles(request)
    saved = legacy.get_viewer_saved_items(request, profile)
    if UNIFIED_CORPUS_ENABLED:
        saved = [
            *legacy.get_viewer_saved_items(request, "default"),
            *legacy.get_viewer_saved_items(request, "broadcast"),
        ]
    viewer = legacy.get_viewer_profile(legacy.get_client_ip(request))
    result = SERVICE.build_feed(
        key,
        articles,
        saved,
        cursor=cursor,
        limit=limit,
        viewer_name=str(viewer.get("display_name") or ""),
        entitled_audiences={"all", "technology", "default", "broadcast"},
    )
    result.update({"enabled": True, "profile": serving_profile})
    return result
