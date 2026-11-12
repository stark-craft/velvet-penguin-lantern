"""FastAPI routes for Venture Lens."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Body, HTTPException, Query, Request

from core.profile import client_ip
from core.settings import VENTURE_LENS_RUNTIME_DIR
from core.storage import JsonStore
from venture_lens.catalog import GITHUB_CATEGORIES, RESEARCH_CATEGORIES
from venture_lens.discovery import venture_discovery_service
from venture_lens.intelligence import VentureIntelligenceService
from venture_lens.service import venture_lens_service


router = APIRouter(prefix="/venture-lens", tags=["Venture Lens"])
venture_intelligence = VentureIntelligenceService(venture_lens_service)

VENTURE_VIEWER_CLAIMS = JsonStore(
    VENTURE_LENS_RUNTIME_DIR / "viewer_claims.json", dict
)

# Module-level RLock covering claim reservation and both bucket migrations to prevent partial migration
VENTURE_MIGRATION_LOCK = __import__("threading").RLock()


def _env_set(name: str, fallback: str = "") -> set[str]:
    return {
        item.strip()
        for item in os.environ.get(name, fallback).split(",")
        if item.strip()
    }


def _legacy_ip_key(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    resolved = client_ip(
        peer,
        request.headers,
        _env_set("TRUSTED_PROXY_IPS", "127.0.0.1,::1"),
    )
    secret = os.environ.get(
        "NEWSSCRAPPER_IP_HASH_SECRET", "development-only-change-this-secret"
    )
    return hashlib.sha256(f"{secret}:{resolved}".encode("utf-8")).hexdigest()


def _migrate_legacy_venture_viewer(request: Request, private_key: str) -> None:
    """One-time migration of IP-keyed Venture data to the signed browser viewer.

    Preserves the first browser that appears at an IP after the identity
    upgrade. Second browsers at the same IP never inherit the shared bucket.
    The claim is recorded so migration cannot replay. Uses a module-level
    RLock to make claim reservation and both bucket migrations atomic and
    prevents partial watchlist/notification migration. Does not swallow
    all exceptions silently; logs unexpected errors while preserving rollback inputs.
    """

    legacy_key = ""
    try:
        legacy_key = _legacy_ip_key(request)
        if not legacy_key or legacy_key == private_key:
            return
    except Exception as exc:
        print(f"[VENTURE_MIGRATION] could not resolve legacy key: {exc}", flush=True)
        return
    try:
        with VENTURE_MIGRATION_LOCK:
            # Atomic claim reservation via JsonStore.update
            def claim_updater(current):
                cur = current if isinstance(current, dict) else {}
                if legacy_key in cur:
                    return None  # no change, already claimed
                if not bool(getattr(request.state, "private_viewer_created", False)):
                    return None
                nxt = dict(cur)
                nxt[legacy_key] = private_key
                return nxt
            claimed_state = VENTURE_VIEWER_CLAIMS.update(claim_updater)
            claimed_state = claimed_state if isinstance(claimed_state, dict) else {}
            owner = claimed_state.get(legacy_key)
            if owner is None:
                return
            if owner != private_key:
                return
            # Atomic watchlist migration
            def watch_updater(data):
                wd = data if isinstance(data, dict) else {}
                if legacy_key not in wd:
                    return None
                nxt = dict(wd)
                if private_key not in nxt:
                    nxt[private_key] = nxt.pop(legacy_key)
                else:
                    nxt.pop(legacy_key, None)
                return nxt
            venture_intelligence.watchlist_store.update(watch_updater)
            # Atomic notification migration
            def notif_updater(data):
                nd = data if isinstance(data, dict) else {}
                if legacy_key not in nd:
                    return None
                nxt = dict(nd)
                if private_key not in nxt:
                    nxt[private_key] = nxt.pop(legacy_key)
                else:
                    nxt.pop(legacy_key, None)
                return nxt
            venture_intelligence.notification_store.update(notif_updater)
    except Exception as exc:
        print(f"[VENTURE_MIGRATION] unexpected error for {legacy_key[:8]}->{private_key[:8]}: {exc}", flush=True)
        return


def _viewer_key(request: Request) -> str:
    private = str(getattr(request.state, "private_viewer_key", "") or "").strip()
    if private:
        _migrate_legacy_venture_viewer(request, private)
        return private
    try:
        from news_scrapper.recommendation.identity import bind_viewer_request

        key, _created, _token = bind_viewer_request(request)
        if key:
            _migrate_legacy_venture_viewer(request, key)
            return key
    except Exception:
        pass
    # Do not fall back to a shared IP identity. IP key is only used as explicit source for one-time legacy migration.
    # If private identity cannot be resolved, issue a fresh ephemeral private key for this request only (not shared).
    import secrets, hashlib as _hl
    # Use request id or random to avoid sharing across browsers
    ephemeral = _hl.sha256(secrets.token_bytes(16)).hexdigest()
    return ephemeral


@router.get("/status")
def status():
    github = venture_lens_service.github()
    research = venture_lens_service.research()
    return {
        "status": "ready",
        "github": {
            "mode": github.get("status"),
            "refreshed_at": github.get("refreshed_at"),
            "items": len(github.get("items") or []),
        },
        "research": {
            "mode": research.get("status"),
            "refreshed_at": research.get("refreshed_at"),
            "items": len(research.get("items") or []),
        },
        "providers": venture_discovery_service.provider_states(),
    }


@router.get("/categories")
def categories():
    return {
        "github": GITHUB_CATEGORIES,
        "research": RESEARCH_CATEGORIES,
    }


@router.get("/github")
def github(
    background_tasks: BackgroundTasks,
    refresh: bool = Query(False),
):
    if refresh:
        return venture_lens_service.refresh_github(force=True)
    payload = venture_lens_service.github()
    if payload.get("status") != "live":
        background_tasks.add_task(venture_lens_service.refresh_github)
    return payload


@router.get("/research")
def research(
    background_tasks: BackgroundTasks,
    refresh: bool = Query(False),
):
    if refresh:
        return venture_lens_service.refresh_research(force=True)
    payload = venture_lens_service.research()
    if payload.get("status") != "live":
        background_tasks.add_task(venture_lens_service.refresh_research)
    return payload


@router.get("/overview")
def overview(background_tasks: BackgroundTasks):
    github_payload = venture_lens_service.github()
    research_payload = venture_lens_service.research()
    if github_payload.get("status") != "live":
        background_tasks.add_task(venture_lens_service.refresh_github)
    if research_payload.get("status") != "live":
        background_tasks.add_task(venture_lens_service.refresh_research)
    return {
        "status": "success",
        "github": github_payload,
        "research": research_payload,
    }


@router.get("/discovery")
def discovery(
    background_tasks: BackgroundTasks,
    refresh: bool = Query(False),
):
    """Return the last healthy multi-provider snapshot immediately.

    Refreshes are isolated per provider and do not participate in the news
    scheduler.  A caller may explicitly force a synchronous refresh for the
    existing Venture Lens refresh action; ordinary page loads only enqueue
    stale providers in the background.
    """

    if refresh:
        venture_discovery_service.refresh_all(force=True)
    else:
        for provider in venture_discovery_service.stale_providers():
            background_tasks.add_task(
                venture_discovery_service.refresh_provider,
                provider,
                False,
            )
    return venture_discovery_service.discovery()


@router.get("/intelligence")
def intelligence(request: Request):
    return {
        "status": "success",
        **venture_intelligence.overview(_viewer_key(request)),
    }


@router.get("/dossier/technology/{category_id}")
def technology_dossier(category_id: str):
    payload = venture_intelligence.technology_dossier(category_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Technology signal not found.")
    return payload


@router.get("/dossier/repository/{repository_id:path}")
def repository_dossier(repository_id: str):
    payload = venture_intelligence.repository_dossier(repository_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Repository not found.")
    return payload


@router.get("/dossier/paper/{paper_id:path}")
def paper_dossier(paper_id: str):
    payload = venture_intelligence.paper_dossier(paper_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Research paper not found.")
    return payload


@router.get("/dossier/model/{model_id:path}")
def model_dossier(model_id: str):
    payload = venture_discovery_service.artifact("model", model_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Model not found.")
    return payload


@router.get("/dossier/dataset/{dataset_id:path}")
def dataset_dossier(dataset_id: str):
    payload = venture_discovery_service.artifact("dataset", dataset_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    return payload


@router.get("/dossier/patent/{patent_id:path}")
def patent_dossier(patent_id: str):
    payload = venture_discovery_service.artifact("patent", patent_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Patent not found.")
    return payload


@router.post("/compare")
def compare(payload: dict = Body(...)):
    references = payload.get("items") or []
    if not isinstance(references, list) or len(references) < 2:
        raise HTTPException(status_code=400, detail="Select at least two signals to compare.")
    try:
        return venture_intelligence.compare(references)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/watchlist")
def watchlist(request: Request):
    return {
        "status": "success",
        "items": venture_intelligence.watchlist(_viewer_key(request)),
    }


@router.post("/watchlist/toggle")
def toggle_watchlist(request: Request, payload: dict = Body(...)):
    try:
        return {
            "status": "success",
            **venture_intelligence.toggle_watchlist(_viewer_key(request), payload),
        }
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/notifications")
def notifications(request: Request):
    return {
        "status": "success",
        "items": venture_intelligence.notifications(_viewer_key(request)),
    }


@router.post("/notifications/read")
def mark_notifications_read(request: Request):
    return {
        "status": "success",
        "items": venture_intelligence.mark_notifications_read(_viewer_key(request)),
    }


@router.post("/refresh")
def refresh():
    return {
        "status": "success",
        **venture_discovery_service.refresh_all(force=True),
    }
