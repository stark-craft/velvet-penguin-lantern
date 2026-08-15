"""Validated public contracts for the For You API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ViewerPreferences(BaseModel):
    topics: list[str] = Field(default_factory=list)
    outcomes: list[str] = Field(default_factory=list)
    source_families: list[str] = Field(default_factory=list)
    regions: list[str] = Field(default_factory=lambda: ["balanced"])
    surprise_me: bool = True


class PauseRequest(BaseModel):
    paused: bool = True


class RecommendationEvent(BaseModel):
    event_id: str = Field(min_length=8, max_length=160)
    action: str = Field(min_length=2, max_length=64)
    article_id: str = Field(default="", max_length=600)
    cluster_id: str = Field(default="", max_length=300)
    surface: str = Field(default="for_you", max_length=80)
    position: int | None = Field(default=None, ge=0, le=10000)
    occurred_at: str = Field(default="", max_length=80)
    active_ms: int = Field(default=0, ge=0, le=86_400_000)
    visible_ratio: float = Field(default=0.0, ge=0.0, le=1.0)
    detail: dict[str, Any] = Field(default_factory=dict)


class RecommendationEventBatch(BaseModel):
    feed_request_id: str = Field(default="", max_length=160)
    events: list[RecommendationEvent] = Field(default_factory=list, max_length=100)
