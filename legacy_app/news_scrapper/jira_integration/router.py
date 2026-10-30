"""Authenticated background preparation and publishing of independent Jira issues."""
from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from core.request_limits import REQUEST_LIMITER
from news_scrapper.access_control.service import require_capability
from . import jobs

router = APIRouter(prefix="/jira", tags=["Jira news tickets"])


class NewsArticle(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    summary: str = Field(min_length=1, max_length=15000)
    image_url: str = Field(default="", max_length=3000)
    source_url: str = Field(default="", max_length=3000)
    source: str = Field(default="", max_length=500)
    date: str = Field(default="", max_length=100)
    category: Any = None
    tags: Any = None
    sources: list[Any] = Field(default_factory=list)
    source_links: list[Any] = Field(default_factory=list)
    references: list[Any] = Field(default_factory=list)


class CreateDrafts(BaseModel):
    articles: list[NewsArticle] = Field(min_length=1, max_length=30)


class PublishDrafts(BaseModel):
    drafts: list[dict[str, Any]] = Field(min_length=1, max_length=30)


def _actor(request: Request) -> str:
    return require_capability(request, "review.news.submit")


@router.post("/news-drafts", status_code=202)
def generate_drafts(payload: CreateDrafts, request: Request):
    actor = _actor(request)
    REQUEST_LIMITER.check("jira.news.draft", actor, limit=8, window_seconds=600)
    try:
        identifier = jobs.begin_drafts(actor, [article.model_dump() for article in payload.articles])
        return {"job_id": identifier, "status": "queued"}
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/news-jobs/{job_id}")
def job_status(job_id: str, request: Request, response: Response):
    actor = _actor(request)
    response.headers["Cache-Control"] = "no-store"
    job = jobs.get_job(job_id, actor)
    if not job:
        raise HTTPException(status_code=404, detail="Jira job not found.")
    return job


@router.post("/news-drafts/{draft_job_id}/publish", status_code=202)
def publish_reports(draft_job_id: str, payload: PublishDrafts, request: Request):
    actor = _actor(request)
    REQUEST_LIMITER.check("jira.news.publish", actor, limit=8, window_seconds=600)
    if os.getenv("JIRA_NEWS_ENABLED", "false").strip().lower() != "true":
        raise HTTPException(status_code=503, detail="Jira creation is disabled on this server.")
    if not os.getenv("JIRA_NEWS_PROJECT", "").strip():
        raise HTTPException(status_code=503, detail="Jira project is not configured.")
    try:
        identifier = jobs.begin_publish(actor, draft_job_id, payload.drafts)
        return {"job_id": identifier, "status": "queued"}
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/news-drafts/{draft_job_id}/insights/{index}", status_code=202)
def regenerate_insight(draft_job_id: str, index: int, request: Request):
    actor = _actor(request)
    REQUEST_LIMITER.check("jira.news.insight", actor, limit=8, window_seconds=600)
    try:
        identifier = jobs.begin_insight_regeneration(actor, draft_job_id, index)
        return {"job_id": identifier, "status": "queued"}
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/news-tickets", status_code=410)
def obsolete_bulk_creation(request: Request):
    _actor(request)
    raise HTTPException(
        status_code=410,
        detail="The legacy combined-ticket action is retired. Refresh TechScout to prepare independent article drafts.",
    )
