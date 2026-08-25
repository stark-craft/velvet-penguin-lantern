"""FastAPI routes for Venture Lens."""

from __future__ import annotations

import hashlib
import os

from fastapi import APIRouter, BackgroundTasks, Body, HTTPException, Query, Request

from core.profile import client_ip
from venture_lens.catalog import GITHUB_CATEGORIES, RESEARCH_CATEGORIES
from venture_lens.discovery import venture_discovery_service
from venture_lens.intelligence import VentureIntelligenceService
from venture_lens.service import venture_lens_service


router = APIRouter(prefix="/venture-lens", tags=["Venture Lens"])
venture_intelligence = VentureIntelligenceService(venture_lens_service)


def _env_set(name: str, fallback: str = "") -> set[str]:
    return {
        item.strip()
        for item in os.environ.get(name, fallback).split(",")
        if item.strip()
    }


def _viewer_key(request: Request) -> str:
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
