"""Authenticated, rate-limited same-origin Jira ticket creation for selected news."""
from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from core.request_limits import REQUEST_LIMITER
from news_scrapper.access_control.service import require_capability
from . import jobs, service

router = APIRouter(prefix="/jira", tags=["Jira news tickets"])


class NewsArticle(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    summary: str = Field(default="", max_length=15000)
    image_url: str = Field(default="", max_length=3000)
    source_url: str = Field(default="", max_length=3000)
    source: str = Field(default="", max_length=500)
    date: str = Field(default="", max_length=100)
    category: str = Field(default="", max_length=300)
    full_contents: str = Field(default="", max_length=24000)
    sources: list[dict] = Field(default_factory=list, max_length=30)


class CreateNewsTicket(BaseModel):
    articles: list[NewsArticle] = Field(min_length=1, max_length=30)


@router.post("/news-tickets")
async def create_news_ticket(
    payload: CreateNewsTicket,
    request: Request,
    response: Response,
):
    # A Jira issue is a write to a shared corporate system: never trust UI-only checks.
    actor = require_capability(request, "review.news.submit")
    response.headers["Cache-Control"] = "no-store"
    REQUEST_LIMITER.check("jira.news.create", actor, limit=8, window_seconds=600)
    if os.getenv("JIRA_NEWS_ENABLED", "false").strip().lower() != "true":
        raise HTTPException(status_code=503, detail="Create Jira is not enabled on this server.")
    project = os.getenv("JIRA_NEWS_PROJECT", "").strip().upper()
    if not project:
        raise HTTPException(status_code=503, detail="Jira project is not configured on this server.")
    try:
        result = await asyncio.to_thread(
            service.create_news_ticket,
            [article.model_dump() for article in payload.articles],
            project,
            os.getenv("JIRA_NEWS_ISSUE_TYPE", "Task").strip() or "Task",
        )
        return {"status": "partial" if result["warnings"] else "success", **result}
    except service.JiraNotReady as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except service.JiraCreationFailed as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


# Draft first, then user review, then one issue per article. The legacy
# /news-tickets route remains available for existing clients.
def _jira_settings() -> tuple[str, str]:
    if os.getenv("JIRA_NEWS_ENABLED", "false").strip().lower() != "true":
        raise HTTPException(status_code=503, detail="Create Jira is not enabled on this server.")
    project = os.getenv("JIRA_NEWS_PROJECT", "").strip().upper()
    if not project:
        raise HTTPException(status_code=503, detail="Jira project is not configured on this server.")
    return project, os.getenv("JIRA_NEWS_ISSUE_TYPE", "Task").strip() or "Task"


class PublishDrafts(BaseModel):
    reports: list[dict] = Field(min_length=1, max_length=30)


@router.post("/news-drafts")
async def create_news_drafts(
    payload: CreateNewsTicket,
    request: Request,
    response: Response,
):
    actor = require_capability(request, "review.news.submit")
    response.headers["Cache-Control"] = "no-store"
    _jira_settings()
    REQUEST_LIMITER.check("jira.news.drafts", actor, limit=4, window_seconds=600)
    articles = [item.model_dump() for item in payload.articles]
    try:
        identifier = jobs.begin_drafts(actor, articles)
        return {"job_id": identifier, "state": "queued"}
    except ValueError as error:
        raise HTTPException(status_code=429, detail=str(error)) from error


@router.get("/news-jobs/{job_id}")
def get_news_job(job_id: str, request: Request, response: Response):
    actor = require_capability(request, "review.news.submit")
    response.headers["Cache-Control"] = "no-store"
    job = jobs.get_job(job_id, actor)
    if job is None:
        raise HTTPException(status_code=404, detail="Jira job not found.")
    return job


@router.post("/news-drafts/{draft_job_id}/publish")
def publish_news_drafts(
    draft_job_id: str,
    payload: PublishDrafts,
    request: Request,
    response: Response,
):
    actor = require_capability(request, "review.news.submit")
    response.headers["Cache-Control"] = "no-store"
    _jira_settings()
    REQUEST_LIMITER.check("jira.news.publish", actor, limit=5, window_seconds=600)
    try:
        identifier = jobs.begin_publish(actor, draft_job_id, payload.reports)
        return {"job_id": identifier, "state": "queued"}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/news-drafts/{draft_job_id}/insights/{index}")
def regenerate_news_insight(
    draft_job_id: str,
    index: int,
    edits: dict,
    request: Request,
    response: Response,
):
    actor = require_capability(request, "review.news.submit")
    response.headers["Cache-Control"] = "no-store"
    _jira_settings()
    REQUEST_LIMITER.check("jira.news.insight", actor, limit=5, window_seconds=600)
    try:
        identifier = jobs.begin_insight_regeneration(actor, draft_job_id, index, edits)
        return {"job_id": identifier, "state": "queued"}
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
