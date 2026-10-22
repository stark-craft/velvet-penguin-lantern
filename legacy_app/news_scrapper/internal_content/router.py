"""Same-origin FastAPI surface for the Internal Contribution feature.

Identity reuses the platform's signed private viewer cookie — there is no
separate login system. Every record is scoped to its owning viewer key; other
viewers' drafts are indistinguishable from missing records (404).
"""

from __future__ import annotations

import asyncio
import os
import secrets

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse

from news_scrapper.recommendation.identity import resolve_viewer
from news_scrapper.access_control import service as access_service
from core.request_limits import REQUEST_LIMITER
from . import access, service, storage
from .document_parser import ContributionError
from .document_parser import (
    DOCUMENT_MAX_BYTES,
    _signature_matches,
    validate_document_upload,
)
from .document_summarizer import summarize_document
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


def _save_pdf_import_warning(
    record: dict, owner_id: str, signature_missing: bool,
) -> dict:
    """Show extraction failures in Description and persist them on the draft.

    The original upload remains saved. This is not a PDF repair or a bypass
    for documents subject to enterprise access restrictions.
    """
    source = record.get("source_document")
    if not isinstance(source, dict):
        return record
    if signature_missing:
        message = (
            "PDF uploaded, but its contents were not recognized as a standard "
            "PDF. Text extraction and preview may fail. Try an approved PDF "
            "export, or contact IT if the file is protected."
        )
    else:
        warning = str(source.get("extraction_warning") or "").strip()
        message = (
            "PDF uploaded, but automatic text extraction was unavailable. "
            + (warning or "Please enter the description manually.")
        )
    description = message[:300]
    record_id = str(record.get("id") or "")
    with storage.mutation_lock:
        records = storage.load_records()
        saved = records.get(record_id)
        if isinstance(saved, dict) and saved.get("owner_id") == owner_id:
            # Import form has no user-written Description; overwrite any
            # provisional first-300-characters value from the importer.
            saved["summary"] = description
            metadata = saved.get("source_document")
            if isinstance(metadata, dict):
                metadata["extraction_status"] = "unavailable"
                metadata["extraction_warning"] = message
            records[record_id] = saved
            storage.write_records(records)
            return saved
    # Defensive response fallback; the service's stored record is unchanged.
    record["summary"] = description
    source["extraction_status"] = "unavailable"
    source["extraction_warning"] = message
    return record


def _save_document_summary(
    record: dict, owner_id: str, summary: str, method: str,
) -> dict:
    """Persist the document-wide description instead of the opening text."""
    summary = str(summary or "").strip()[:300]
    if not summary:
        return record
    record_id = str(record.get("id") or "")
    with storage.mutation_lock:
        records = storage.load_records()
        saved = records.get(record_id)
        if isinstance(saved, dict) and saved.get("owner_id") == owner_id:
            saved["summary"] = summary
            metadata = saved.get("source_document")
            if isinstance(metadata, dict):
                metadata["summary_method"] = method
                if method == "unavailable":
                    metadata["summary_warning"] = summary
            records[record_id] = saved
            storage.write_records(records)
            return saved
    # Returning the correct description is useful even if persistence fails,
    # but should not hide the fact the original draft may have been removed.
    record["summary"] = summary
    metadata = record.get("source_document")
    if isinstance(metadata, dict):
        metadata["summary_method"] = method
        if method == "unavailable":
            metadata["summary_warning"] = summary
    return record


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
    filename = document.filename or ""
    declared_type = document.content_type or ""
    try:
        kind = validate_document_upload(filename, declared_type, len(data))
        if kind == "pdf" and not filename.lower().endswith(".pdf"):
            raise ContributionError("Choose a file with the .pdf extension.")
        # A PDF can be stored even when its signature/parser is unavailable.
        # Keep DOCX strict: an invalid ZIP/Word structure is not a DOCX.
        if kind == "docx" and not _signature_matches(kind, data):
            raise ContributionError(
                "This upload is not a valid Word (.docx) document."
            )
        owner_id = _owner(request, response)
        # Avoid blocking the FastAPI event loop while Docling / RapidOCR
        # performs CPU-heavy extraction in the isolated offline worker.
        record = await asyncio.to_thread(
            service.import_document,
            owner_id,
            filename,
            declared_type,
            data,
            {"owner_name": owner_name, "content_type": content_type},
        )
        # service.import_document on the current PC already stores PDFs even
        # when parse_document raises ContributionError. Fill the blank
        # Description *and persist it* without modifying the original bytes.
        source = record.get("source_document") or {}
        signature_missing = kind == "pdf" and not _signature_matches("pdf", data)
        body_text = str(record.get("body") or "").strip()
        no_text = (
            source.get("extraction_status") == "unavailable"
            or not body_text
        )
        if kind == "pdf" and (signature_missing or no_text):
            # An unreadable PDF still uploads; Description explains why
            # automatic summarization was impossible.
            record = _save_pdf_import_warning(
                record, owner_id, signature_missing,
            )
        elif body_text:
            # Samsung Chat first, shared local DistilBART second.
            # Both see evidence spanning the extracted document, not just
            # its introductory characters.
            try:
                summary, method = await asyncio.to_thread(
                    summarize_document, body_text, 300,
                )
                if summary:
                    record = _save_document_summary(
                        record, owner_id, summary, method,
                    )
            except Exception:
                # Do NOT silently pass through a first-300-char excerpt and
                # call it a model-produced summary when both models fail.
                record = _save_document_summary(
                    record,
                    owner_id,
                    "PDF uploaded and text extracted, but Samsung Chat and "
                    "local BART could not generate a summary. Please enter "
                    "the Description manually.",
                    "unavailable",
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


@router.post("/{record_id}/secondary-cover")
async def upload_secondary_cover(
    record_id: str,
    request: Request,
    response: Response,
    cover: UploadFile = File(...),
    focal_x: float = Form(default=0.5),
    focal_y: float = Form(default=0.5),
):
    access.require_contributor_ip(request)
    REQUEST_LIMITER.check(
        "contribution.cover",
        access.get_client_ip(request),
        limit=30,
        window_seconds=60 * 60,
    )
    data = await _read_upload_limited(cover, COVER_MAX_BYTES, "cover image")
    if not data:
        raise HTTPException(
            status_code=400,
            detail="Choose a JPG, PNG, or WebP image for the secondary image.",
        )
    try:
        return service.attach_secondary_cover(
            _owner(request, response),
            record_id,
            cover.filename or "",
            data,
            focal_x,
            focal_y,
        )
    except (ContributionError, LookupError) as error:
        raise _fail(error) from error


@router.delete("/{record_id}/cover")
def delete_cover(record_id: str, request: Request, response: Response):
    access.require_contributor_ip(request)
    try:
        return service.remove_cover(_owner(request, response), record_id)
    except (ContributionError, LookupError) as error:
        raise _fail(error) from error


@router.delete("/{record_id}/secondary-cover")
def delete_secondary_cover(
    record_id: str,
    request: Request,
    response: Response,
):
    access.require_contributor_ip(request)
    try:
        return service.remove_secondary_cover(
            _owner(request, response), record_id,
        )
    except (ContributionError, LookupError) as error:
        raise _fail(error) from error


@router.get("/{record_id}/secondary-cover")
def get_secondary_cover(
    record_id: str,
    request: Request,
    response: Response,
):
    try:
        record = _readable_media_record(request, response, record_id)
    except LookupError as error:
        raise _fail(error) from error
    cover = record.get("secondary_cover") or {}
    path = storage.COVERS_DIR / str(cover.get("file") or "")
    if not cover.get("file") or not path.exists():
        raise HTTPException(
            status_code=404,
            detail="This contribution has no secondary image yet.",
        )
    extension = path.suffix.lstrip(".").lower()
    return FileResponse(
        path,
        media_type=storage.COVER_MIME_BY_EXTENSION.get(
            extension, "application/octet-stream"
        ),
        headers={"Cache-Control": "private, max-age=60"},
    )


@router.put("/{record_id}/document")
async def replace_document(
    record_id: str,
    request: Request,
    response: Response,
    document: UploadFile = File(...),
):
    access.require_contributor_ip(request)
    REQUEST_LIMITER.check(
        "contribution.document.replace",
        access.get_client_ip(request),
        limit=20,
        window_seconds=60 * 60,
    )
    data = await _read_upload_limited(
        document, DOCUMENT_MAX_BYTES, "edited PDF",
    )
    if not data:
        raise HTTPException(
            status_code=400, detail="Choose an edited PDF to save.",
        )
    filename = document.filename or "edited-document.pdf"
    declared_type = document.content_type or "application/pdf"
    is_pdf = (
        declared_type == "application/pdf"
        or filename.lower().endswith(".pdf")
    )
    if not is_pdf:
        raise HTTPException(
            status_code=400,
            detail="PDF editing currently supports PDF files only.",
        )
    if not _signature_matches("pdf", data):
        raise HTTPException(
            status_code=400,
            detail="The edited file is not a recognizable PDF. "
                   "Nothing has been replaced.",
        )
    try:
        return service.replace_document(
            _owner(request, response),
            record_id,
            filename,
            declared_type,
            data,
        )
    except (ContributionError, LookupError) as error:
        raise _fail(error) from error


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
