"""Same-origin FastAPI surface for the Internal Contribution feature.

Identity reuses the platform's signed private viewer cookie — there is no
separate login system. Every record is scoped to its owning viewer key; other
viewers' drafts are indistinguishable from missing records (404).
"""

from __future__ import annotations

import os
import secrets

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse

from news_scrapper.recommendation.identity import resolve_viewer
from news_scrapper.access_control import service as access_service
from core.request_limits import REQUEST_LIMITER
from . import access, service, storage
from .document_parser import ContributionError
from .document_parser import DOCUMENT_MAX_BYTES
from .image_processor import COVER_MAX_BYTES
from .schemas import DraftUpdate, NotificationRead, ReviewNote, ReviewUnlock

router = APIRouter(prefix="/internal-content", tags=["Internal Content"])


def _owner(request: Request, response: Response) -> str:
    viewer_key, _created = resolve_viewer(request, response)
    return viewer_key


def _editor_key_expected() -> str:
    # Mirrors application.py's privileged-key chain: explicit editor key first,
    # then the Gatekeeper/Director settings, then the shared development
    # default. Production mode refuses short keys at startup.
    configured = (
        os.environ.get("INTERNAL_EDITOR_KEY")
        or os.environ.get("GATEKEEPER_KEY")
        or os.environ.get("DIRECTOR_KEY")
    )
    if configured:
        return configured
    environment = os.environ.get("NEWSSCRAPPER_ENV", "development").strip().lower()
    return "1357" if environment not in {"production", "prod"} else ""


# The unlock cookie stores only a digest of the expected key. It is HttpOnly,
# so page JavaScript (and therefore the inspector's storage pane) never sees
# the key or its session marker.
EDITOR_COOKIE = access_service.PRIVILEGED_COOKIE


def _editor_ok(request: Request) -> bool:
    if access_service.has_capability(request, "review.contributions.view"):
        return True
    header_key = request.headers.get("x-editor-key", "")
    expected = _editor_key_expected()
    if expected and header_key and secrets.compare_digest(header_key, expected):
        return True
    return False


def _require_editor(request: Request) -> None:
    if not _editor_ok(request):
        raise HTTPException(status_code=403, detail="Contribution review access is required.")


def _require_publisher(request: Request) -> None:
    if access_service.has_capability(request, "review.contributions.publish"):
        return
    expected = _editor_key_expected()
    header_key = request.headers.get("x-editor-key", "")
    if not expected or not header_key or not secrets.compare_digest(header_key, expected):
        raise HTTPException(status_code=403, detail="Contribution publishing access is required.")


async def _read_upload_limited(upload: UploadFile, maximum: int, label: str) -> bytes:
    chunks = bytearray()
    while True:
        chunk = await upload.read(min(1024 * 1024, maximum + 1 - len(chunks)))
        if not chunk:
            break
        chunks.extend(chunk)
        if len(chunks) > maximum:
            raise HTTPException(
                status_code=413,
                detail=f"The {label} is larger than the permitted upload limit.",
            )
    return bytes(chunks)


def _fail(error: Exception) -> HTTPException:
    if isinstance(error, LookupError):
        return HTTPException(status_code=404, detail="Contribution not found.")
    return HTTPException(status_code=400, detail=str(error))


@router.get("/contribute-access")
def contribution_access(request: Request):
    ip = access.get_client_ip(request)
    return {"allowed": access.is_contributor_ip(request), "ip": ip}


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
    REQUEST_LIMITER.check(
        "contribution.import", access.get_client_ip(request), limit=20, window_seconds=60 * 60
    )
    data = await _read_upload_limited(document, DOCUMENT_MAX_BYTES, "document")
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
    REQUEST_LIMITER.check(
        "privileged.unlock", access.get_client_ip(request), limit=10, window_seconds=15 * 60
    )
    provided = str(payload.key or "")
    expected = _editor_key_expected()
    if not expected or not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="That key was not accepted.")
    access_service.create_privileged_session(
        request,
        response,
        {"review.contributions.view", "review.contributions.publish"},
        role="editor",
    )
    return {"unlocked": True}


@router.post("/review/lock")
def lock_review(request: Request, response: Response):
    access_service.revoke_privileged_session(request, response)
    return {"unlocked": False}


@router.post("/{record_id}/publish")
def publish_one(record_id: str, request: Request):
    _require_publisher(request)
    try:
        return service.publish_record(record_id)
    except ContributionError as error:
        raise _fail(error) from error
    except LookupError as error:
        raise _fail(error) from error


@router.post("/{record_id}/changes")
def request_changes_one(record_id: str, request: Request, payload: ReviewNote):
    _require_publisher(request)
    try:
        return service.request_changes(record_id, payload.note)
    except ContributionError as error:
        raise _fail(error) from error
    except LookupError as error:
        raise _fail(error) from error


@router.post("/{record_id}/reject")
def reject_one(record_id: str, request: Request, payload: ReviewNote):
    _require_publisher(request)
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
        deleted = service.delete_owned_record(_owner(request, response), record_id)
    except ContributionError as error:
        raise _fail(error) from error
    except LookupError as error:
        raise _fail(error) from error
    return {"deleted": deleted}


@router.post("/{record_id}/withdraw")
def withdraw_one(record_id: str, request: Request, response: Response):
    access.require_contributor_ip(request)
    try:
        return service.withdraw_submission(_owner(request, response), record_id)
    except ContributionError as error:
        raise _fail(error) from error
    except LookupError as error:
        raise _fail(error) from error


@router.post("/{record_id}/archive")
def archive_one(record_id: str, request: Request):
    _require_publisher(request)
    try:
        return service.archive_record(record_id)
    except (ContributionError, LookupError) as error:
        raise _fail(error) from error


@router.post("/{record_id}/restore")
def restore_one(record_id: str, request: Request):
    _require_publisher(request)
    try:
        return service.restore_record(record_id)
    except (ContributionError, LookupError) as error:
        raise _fail(error) from error


@router.delete("/{record_id}/permanent")
def permanent_delete_one(record_id: str, request: Request):
    access_service.require_capability(request, "access.manage")
    try:
        return {"deleted": service.permanently_delete(record_id)}
    except LookupError as error:
        raise _fail(error) from error


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
    REQUEST_LIMITER.check(
        "contribution.cover", access.get_client_ip(request), limit=30, window_seconds=60 * 60
    )
    data = await _read_upload_limited(cover, COVER_MAX_BYTES, "cover image")
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
