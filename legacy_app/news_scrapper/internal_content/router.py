"""Same-origin FastAPI surface for the Internal Contribution feature.

Identity reuses the platform's signed private viewer cookie — there is no
separate login system. Every record is scoped to its owning viewer key; other
viewers' drafts are indistinguishable from missing records (404).
"""

from __future__ import annotations

import hashlib
import os
import secrets

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse

from news_scrapper.recommendation.identity import resolve_viewer
from . import access, service, storage
from .document_parser import ContributionError
from .schemas import DraftUpdate, NotificationRead, ReviewNote, ReviewUnlock

router = APIRouter(prefix="/internal-content", tags=["Internal Content"])


def _owner(request: Request, response: Response) -> str:
    viewer_key, _created = resolve_viewer(request, response)
    return viewer_key


def _editor_key_expected() -> str:
    # Mirrors application.py's privileged-key chain: explicit editor key first,
    # then the Gatekeeper/Director settings, then the shared development
    # default. Production mode refuses short keys at startup.
    return (
        os.environ.get("INTERNAL_EDITOR_KEY")
        or os.environ.get("GATEKEEPER_KEY")
        or os.environ.get("DIRECTOR_KEY")
        or "1357"
    )


# The unlock cookie stores only a digest of the expected key. It is HttpOnly,
# so page JavaScript (and therefore the inspector's storage pane) never sees
# the key or its session marker.
EDITOR_COOKIE = "internal_editor_session"
EDITOR_COOKIE_MAX_AGE = 60 * 60 * 6


def _editor_session_token() -> str:
    return hashlib.sha256(_editor_key_expected().encode("utf-8")).hexdigest()


def _editor_ok(request: Request) -> bool:
    header_key = request.headers.get("x-editor-key", "")
    if header_key and secrets.compare_digest(header_key, _editor_key_expected()):
        return True
    cookie = request.cookies.get(EDITOR_COOKIE, "")
    if not cookie:
        return False
    try:
        return secrets.compare_digest(cookie, _editor_session_token())
    except Exception:
        return False


def _require_editor(request: Request) -> None:
    if not _editor_ok(request):
        raise HTTPException(status_code=401, detail="A valid editor key is required.")


def _fail(error: Exception) -> HTTPException:
    if isinstance(error, LookupError):
        return HTTPException(status_code=404, detail="Contribution not found.")
    return HTTPException(status_code=400, detail=str(error))


@router.get("/contribute-access")
def contribution_access(request: Request):
    ip = access.get_client_ip(request)
    return {"allowed": ip in access.CONTRIBUTIONS_ALLOWED_IPS, "ip": ip}


@router.get("/mine")
def list_mine(request: Request, response: Response):
    access.require_contributor_ip(request)
    try:
        return {"items": service.list_for_owner(_owner(request, response))}
    except ContributionError as error:
        raise _fail(error) from error


@router.post("/import")
async def import_document(
    request: Request,
    response: Response,
    document: UploadFile = File(...),
    owner_name: str = Form(default=""),
    content_type: str = Form(default=""),
):
    access.require_contributor_ip(request)
    data = await document.read()
    if not data:
        raise HTTPException(status_code=400, detail="Choose a PDF or Word (.docx) document to import.")
    try:
        record = service.import_document(
            _owner(request, response),
            document.filename or "",
            document.content_type or "",
            data,
            {"owner_name": owner_name, "content_type": content_type},
        )
    except ContributionError as error:
        raise _fail(error) from error
    return record


@router.post("/drafts")
def create_draft(request: Request, response: Response, payload: DraftUpdate):
    access.require_contributor_ip(request)
    try:
        return service.create_draft(_owner(request, response), payload.model_dump())
    except ContributionError as error:
        raise _fail(error) from error


@router.get("/published")
def list_published():
    """Future Samsung Internal contract. Returns only already-published records."""

    return {"items": service.list_published()}


@router.get("/published/{record_id}")
def get_published(record_id: str):
    """Public reader contract for already-published Internal content."""

    try:
        return service.get_published(record_id)
    except LookupError as error:
        raise _fail(error) from error


@router.get("/review")
def review_queue(request: Request):
    """Editor-key-guarded desk of every submitted contribution."""

    _require_editor(request)
    return {"items": service.list_submitted()}


@router.post("/review/unlock")
def unlock_review(request: Request, response: Response, payload: ReviewUnlock):
    provided = str(payload.key or "")
    if not provided or not secrets.compare_digest(provided, _editor_key_expected()):
        raise HTTPException(status_code=401, detail="That key was not accepted.")
    response.set_cookie(
        key=EDITOR_COOKIE,
        value=_editor_session_token(),
        httponly=True,
        samesite="strict",
        max_age=EDITOR_COOKIE_MAX_AGE,
        path="/internal-content",
    )
    return {"unlocked": True}


@router.post("/review/lock")
def lock_review(response: Response):
    response.delete_cookie(key=EDITOR_COOKIE, path="/internal-content")
    return {"unlocked": False}


@router.post("/{record_id}/publish")
def publish_one(record_id: str, request: Request):
    _require_editor(request)
    try:
        return service.publish_record(record_id)
    except ContributionError as error:
        raise _fail(error) from error
    except LookupError as error:
        raise _fail(error) from error


@router.post("/{record_id}/changes")
def request_changes_one(record_id: str, request: Request, payload: ReviewNote):
    _require_editor(request)
    try:
        return service.request_changes(record_id, payload.note)
    except ContributionError as error:
        raise _fail(error) from error
    except LookupError as error:
        raise _fail(error) from error


@router.post("/{record_id}/reject")
def reject_one(record_id: str, request: Request, payload: ReviewNote):
    _require_editor(request)
    try:
        return service.reject_record(record_id, payload.note)
    except ContributionError as error:
        raise _fail(error) from error
    except LookupError as error:
        raise _fail(error) from error


@router.get("/notifications")
def list_owner_notifications(request: Request, response: Response):
    access.require_contributor_ip(request)
    return service.list_notifications(_owner(request, response))


@router.post("/notifications/read")
def read_owner_notifications(request: Request, response: Response, payload: NotificationRead):
    access.require_contributor_ip(request)
    owner = _owner(request, response)
    return service.mark_notifications_read(owner, payload.ids)


@router.get("/{record_id}")
def get_one(record_id: str, request: Request, response: Response):
    access.require_contributor_ip(request)
    try:
        return service.get_owned(_owner(request, response), record_id)
    except LookupError as error:
        raise _fail(error) from error


@router.put("/{record_id}")
def update_one(record_id: str, request: Request, response: Response, payload: DraftUpdate):
    access.require_contributor_ip(request)
    try:
        return service.update_draft(_owner(request, response), record_id, payload.model_dump())
    except ContributionError as error:
        raise _fail(error) from error
    except LookupError as error:
        raise _fail(error) from error


@router.delete("/{record_id}")
def delete_one(record_id: str, request: Request, response: Response):
    access.require_contributor_ip(request)
    try:
        deleted = service.delete_draft(_owner(request, response), record_id)
    except ContributionError as error:
        raise _fail(error) from error
    except LookupError as error:
        raise _fail(error) from error
    return {"deleted": deleted}


@router.post("/{record_id}/submit")
def submit_one(record_id: str, request: Request, response: Response):
    access.require_contributor_ip(request)
    try:
        return service.submit_draft(_owner(request, response), record_id)
    except ContributionError as error:
        raise _fail(error) from error
    except LookupError as error:
        raise _fail(error) from error


@router.post("/{record_id}/cover")
async def upload_cover(
    record_id: str,
    request: Request,
    response: Response,
    cover: UploadFile = File(...),
    focal_x: float = Form(default=0.5),
    focal_y: float = Form(default=0.5),
):
    access.require_contributor_ip(request)
    data = await cover.read()
    if not data:
        raise HTTPException(status_code=400, detail="Choose a JPG, PNG, or WebP image for the cover.")
    try:
        return service.attach_cover(
            _owner(request, response),
            record_id,
            cover.filename or "",
            data,
            focal_x,
            focal_y,
        )
    except ContributionError as error:
        raise _fail(error) from error
    except LookupError as error:
        raise _fail(error) from error


def _readable_media_record(request: Request, response: Response, record_id: str) -> dict:
    """Media follows the record's visibility: private while drafting, public
    once published, and always readable for its owner or a keyed editor."""

    if _editor_ok(request):
        return service.peek(record_id)
    record = service.peek(record_id)
    if record.get("status") == "published":
        return record
    access.require_contributor_ip(request)
    try:
        return service.get_owned(_owner(request, response), record_id)
    except LookupError as error:
        raise _fail(error) from error


@router.get("/{record_id}/cover")
def get_cover(record_id: str, request: Request, response: Response):
    try:
        record = _readable_media_record(request, response, record_id)
    except LookupError as error:
        raise _fail(error) from error
    cover = record.get("cover") or {}
    path = storage.COVERS_DIR / str(cover.get("file") or "")
    if not cover.get("file") or not path.exists():
        raise HTTPException(status_code=404, detail="This contribution has no cover yet.")
    extension = path.suffix.lstrip(".").lower()
    return FileResponse(
        path,
        media_type=storage.COVER_MIME_BY_EXTENSION.get(extension, "application/octet-stream"),
        headers={"Cache-Control": "private, max-age=60"},
    )


@router.get("/{record_id}/document")
def get_document(record_id: str, request: Request, response: Response):
    try:
        record = _readable_media_record(request, response, record_id)
    except LookupError as error:
        raise _fail(error) from error
    source = record.get("source_document") or {}
    path = storage.ORIGINALS_DIR / str(source.get("file") or "")
    if not source.get("file") or not path.exists():
        raise HTTPException(status_code=404, detail="This contribution has no original document.")
    extension = path.suffix.lstrip(".").lower()
    safe_name = "".join(character if character.isalnum() or character in "._- " else "_" for character in source.get("name") or path.name)
    return FileResponse(
        path,
        media_type=storage.DOCUMENT_MIME_BY_EXTENSION.get(extension, "application/octet-stream"),
        headers={"Cache-Control": "private, max-age=60"},
        filename=safe_name,
    )
