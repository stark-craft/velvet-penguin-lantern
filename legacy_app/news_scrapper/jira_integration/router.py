"""Authenticated, rate-limited same-origin Jira ticket creation for selected news."""
from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from core.request_limits import REQUEST_LIMITER
from news_scrapper.access_control.service import require_capability
from . import service

router = APIRouter(prefix="/jira", tags=["Jira news tickets"])


class NewsArticle(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    summary: str = Field(default="", max_length=15000)
    image_url: str = Field(default="", max_length=3000)
    source_url: str = Field(default="", max_length=3000)
    source: str = Field(default="", max_length=500)
    date: str = Field(default="", max_length=100)


class CreateNewsTicket(BaseModel):
    articles: list[NewsArticle] = Field(min_length=1, max_length=30)


@router.post("/news-tickets")
async def create_news_ticket(payload: CreateNewsTicket, request: Request, response: Response):
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
