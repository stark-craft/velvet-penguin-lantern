"""Request contracts for the Internal Contribution API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DraftUpdate(BaseModel):
    """Editable contribution fields.

    Hard caps here are deliberately looser than the product limits so the
    service layer can return friendly, specific validation messages instead of
    generic pydantic 422 payloads while still bounding request size.
    """

    title: str = Field(default="", max_length=1000)
    summary: str = Field(default="", max_length=2000)
    body: str = Field(default="", max_length=250_000)
    category: str = Field(default="", max_length=200)
    team: str = Field(default="", max_length=400)
    author: str = Field(default="", max_length=400)
    owner_name: str = Field(default="", max_length=200)
    content_type: str = Field(default="", max_length=40)
    focal_x: float | None = Field(default=None, ge=0.0, le=1.0)
    focal_y: float | None = Field(default=None, ge=0.0, le=1.0)


class ReviewNote(BaseModel):
    """Editorial decision note. Required for change requests, optional on reject."""

    note: str = Field(default="", max_length=4000)


class ReviewUnlock(BaseModel):
    """Key presented to open the contributions review session."""

    key: str = Field(default="", max_length=200)


class NotificationRead(BaseModel):
    """Mark specific notifications read; an empty list marks everything read."""

    ids: list[str] = Field(default_factory=list)
