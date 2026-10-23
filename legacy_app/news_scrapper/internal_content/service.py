"""Business rules for the Internal Contribution feature.

The service owns ownership scoping, status transitions, submission gates, and
file lifecycle. Records are private to their owning viewer identity; nothing
is published by this feature yet — ``GET /internal-content/published`` only
returns records whose status is already "published".
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from . import storage
from .document_parser import (
    ContributionError,
    EXTRACT_MAX_CHARS,
    parse_document,
    validate_document_upload,
)
from .image_processor import (
    normalize_cover,
    normalize_leadership_cover,
    validate_cover_upload,
)

TITLE_MAX = 120
SUMMARY_MAX = 300
BODY_SUBMIT_MAX = 60_000
BODY_DRAFT_MAX = EXTRACT_MAX_CHARS
MIN_SUBMIT_BODY_CHARS = 20
FIELD_MAX = {
    "category": 200,
    "team": 400,
    "author": 400,
    "owner_name": 200,
}
CONTENT_TYPES = (
    "story",
    "document_import",
    "leadership",
    "announcement",
)
STORY_LAYOUTS = (
    "two-column",
    "list-view",
    "feature-card",
    "text-top",
)
DISPLAY_SECTIONS = ("hero", "srid")
TEMPLATE_TEXT_MAX = 12_000
LAYOUTS = (
    "two-column",
    "list-view",
    "feature-card",
    "text-top",
)
CARD_IMAGE_SOURCES = ("primary", "secondary")

STATUSES = (
    "draft",
    "ready",
    "submitted",
    "published",
    "needs_changes",
    "withdrawn",
    "archived",
)
# needs_changes is editable so the author can revise and resubmit after a
# reviewer requests changes.
EDITABLE_STATUSES = ("draft", "ready", "needs_changes", "withdrawn")
REVIEW_NOTE_MAX = 2000


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _clean(value: object, limit: int | None = None) -> str:
    text = str(value or "").strip()
    return text[:limit] if limit else text



def _clean_template_data(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {"desc0": "", "desc1": ""}
    return {
        "desc0": _clean(value.get("desc0"), TEMPLATE_TEXT_MAX),
        "desc1": _clean(value.get("desc1"), TEMPLATE_TEXT_MAX),
    }


def _clean_layout(content_type: str, value: object) -> str:
    candidate = _clean(value, 40)
    if content_type == "story":
        return candidate if candidate in STORY_LAYOUTS else "two-column"
    if content_type == "leadership":
        return "feature-card"
    return "text-top"


def _clean_display_section(content_type: str, value: object) -> str:
    candidate = _clean(value, 40)
    if content_type == "leadership":
        return "hero"
    if content_type != "story":
        return "srid"
    return candidate if candidate in DISPLAY_SECTIONS else "srid"


def _clean_display_image_slot(value: object) -> str:
    candidate = _clean(value, 20)
    return candidate if candidate in CARD_IMAGE_SOURCES else "primary"


def _optional_timestamp(value: object) -> str | None:
    text = _clean(value, 80)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ContributionError("Use a valid ISO date and time.") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def _is_effectively_published(record: dict, now: datetime | None = None) -> bool:
    if record.get("status") != "published" or record.get("archived_at"):
        return False
    current = now or datetime.now(timezone.utc)
    publish_at = record.get("publish_at")
    expires_at = record.get("expires_at")
    try:
        if publish_at and datetime.fromisoformat(str(publish_at).replace("Z", "+00:00")) > current:
            return False
        if expires_at and datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) <= current:
            return False
    except (TypeError, ValueError):
        return False
    return True


def _require_owned(items: dict[str, dict], record_id: str, owner_id: str) -> dict:
    record = items.get(record_id)
    if not record or record.get("owner_id") != owner_id:
        raise KeyError(record_id)
    return record


def _base_record(
    owner_id: str,
    content_type: str,
    fields: dict,
) -> dict:
    now = utc_now()
    safe_type = (
        content_type if content_type in CONTENT_TYPES else "story"
    )
    return {
        "id": storage.new_id(),
        "owner_id": owner_id,
        "content_type": safe_type,
        "title": _clean(fields.get("title"), TITLE_MAX),
        "summary": _clean(fields.get("summary"), SUMMARY_MAX),
        "body": _clean(fields.get("body")),
        "category": _clean(fields.get("category"), FIELD_MAX["category"]),
        "team": _clean(fields.get("team"), FIELD_MAX["team"]),
        "author": _clean(fields.get("author"), FIELD_MAX["author"]),
        "layout": _clean_layout(safe_type, fields.get("layout")),
        "display_section": _clean_display_section(
            safe_type, fields.get("display_section")
        ),
        "template_data": _clean_template_data(fields.get("template_data")),
        "card_image_source": "primary",
        "cover": None,
        "image_scale": min(
            1.8,
            max(0.6, float(fields.get("image_scale") or 1.0)),
        ),
        "source_document": None,
        "secondary_cover": None,
        "status": "draft",
        "created_at": now,
        "updated_at": now,
        "submitted_at": None,
        "published_at": None,
        "publish_at": _optional_timestamp(fields.get("publish_at")),
        "expires_at": _optional_timestamp(fields.get("expires_at")),
        "archived_at": None,
        "withdrawn_at": None,
    }

def create_draft(owner_id: str, fields: dict) -> dict:
    content_type = str(fields.get("content_type") or "story").strip() or "story"
    if content_type not in CONTENT_TYPES:
        raise ContributionError("This contribution type is not supported.")
    with storage.mutation_lock:
        storage.ensure_directories()
        items = storage.load_records()
        record = _base_record(owner_id, content_type, fields)
        record["body"] = record["body"][:BODY_DRAFT_MAX]
        if fields.get("owner_name"):
            record["owner_name"] = _clean(fields.get("owner_name"), FIELD_MAX["owner_name"])
        items[record["id"]] = record
        storage.write_records(items)
        return record


def import_document(
    owner_id: str,
    filename: str,
    declared_type: str,
    data: bytes,
    fields: dict | None = None,
) -> dict:
    """Import PDF/DOCX, retaining the original even when PDF extraction fails.

    Temporary diagnostic behavior: directly copy up to SUMMARY_MAX characters
    from the extracted text into Description. No OCR, Samsung Chat, or AI summary.
    The extracted text (up to BODY_DRAFT_MAX) is stored in ``body``.
    """
    fields = fields or {}
    # 1. Validate the file type/size before storing it.
    kind = validate_document_upload(
        filename,
        declared_type,
        len(data),
    )
    extension = kind
    file_id = storage.new_file_id()
    target = storage.original_path(file_id, extension)

    # 2. Store the original PDF/DOCX first.
    # Parsing should not lose this file.
    try:
        with storage.mutation_lock:
            storage.ensure_directories()
            target.write_bytes(data)
    except OSError as error:
        raise ContributionError(
            "The original document could not be stored on the server. Try again."
        ) from error

    # 3. Extract text.
    # PDF extraction is best-effort (including image-only PDFs).
    parsed = None
    extraction_status = "unavailable"
    extraction_warning = ""
    try:
        parsed = parse_document(
            filename,
            declared_type,
            data,
        )
        extraction_status = "extracted"
    except ContributionError as error:
        if kind == "pdf":
            extraction_status = "unavailable"
            extraction_warning = (
                "The PDF was uploaded successfully, but no readable text could be "
                "extracted. It may contain scanned or image-only pages, or use "
                "an unsupported PDF layout. Please enter the description manually."
            )
        else:
            storage.remove_quietly(target)
            raise error

    # 4. Derive a title and raw text, without invoking Samsung Chat.
    fallback_title = (
        Path(str(filename or "Imported document"))
        .stem.replace("_", " ")
        .replace("-", " ")
    )
    fallback_title = " ".join(fallback_title.split())
    fallback_title = fallback_title[:TITLE_MAX] or "Imported document"
    if parsed:
        extracted_text = str(parsed.get("text") or "").strip()
        detected_title = (
            str(parsed.get("detected_title") or "").strip()
            or fallback_title
        )
        page_count = parsed.get("page_count")
        character_count = int(
            parsed.get("character_count") or len(extracted_text)
        )
    else:
        extracted_text = ""
        detected_title = fallback_title
        page_count = None
        character_count = 0

    # A successfully returned but empty extraction still requires manual input.
    if not extracted_text.strip():
        extraction_status = "unavailable"
        extraction_warning = (
            "No readable text was found in this document. It may contain "
            "scanned or image-only pages. Please enter the description manually."
        )
    final_title = (
        _clean(fields.get("title"), TITLE_MAX)
        or _clean(detected_title, TITLE_MAX)
        or fallback_title
    )
    # IMPORTANT: Copy actual extracted text into Description.
    # No summarization or Samsung Chat API call.
    final_summary = (
        _clean(fields.get("summary"), SUMMARY_MAX)
        or _clean(extracted_text, SUMMARY_MAX)
    )

    # 5. Create the same document_import record, with raw text in Description.
    try:
        with storage.mutation_lock:
            items = storage.load_records()
            record = _base_record(
                owner_id,
                "document_import",
                {
                    **fields,
                    "title": final_title,
                    "summary": final_summary,
                },
            )
            record["body"] = extracted_text[:BODY_DRAFT_MAX]
            record["source_document"] = {
                "file": target.name,
                "name": str(filename or ""),
                "type": storage.DOCUMENT_MIME_BY_EXTENSION[extension],
                "size": len(data),
                "page_count": page_count,
                "extracted_characters": character_count,
                "extraction_method": (
                    parsed.get("extraction_method", "unknown")
                    if parsed is not None else "unavailable"
                ),
                "extraction_status": extraction_status,
                "extraction_warning": extraction_warning,
                # AI deliberately disabled for this diagnostic.
                "metadata_status": "skipped",
                "metadata_error": "",
                "metadata_model_id": "",
                "metadata_input_characters": 0,
            }
            items[record["id"]] = record
            storage.write_records(items)
    except Exception:
        storage.remove_quietly(target)
        raise
    return record


# ============================================================
# PDF REPLACEMENT
# ============================================================
def replace_document(
    owner_id: str,
    record_id: str,
    filename: str,
    declared_type: str,
    data: bytes,
) -> dict:
    """Safely replace an editable PDF after fully parsing the replacement."""
    if not data:
        raise ContributionError("The edited PDF is empty.")
    safe_filename = str(filename or "edited-document.pdf").strip()
    is_pdf = (
        declared_type == "application/pdf"
        or safe_filename.lower().endswith(".pdf")
    )
    if not is_pdf:
        raise ContributionError(
            "Edited document replacement currently supports PDF files only."
        )
    parsed = parse_document(
        safe_filename,
        "application/pdf",
        data,
    )
    new_file_id = storage.new_file_id()
    new_target = storage.original_path(new_file_id, "pdf")
    with storage.mutation_lock:
        storage.ensure_directories()
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record.get("status") not in EDITABLE_STATUSES:
            raise ContributionError(
                "Submitted contributions are read-only and their PDF cannot be edited."
            )
        if record.get("content_type") != "document_import":
            raise ContributionError(
                "Only imported document contributions can replace their PDF."
            )
        old_source = (
            record.get("source_document")
            if isinstance(record.get("source_document"), dict)
            else {}
        )
        old_filename = str(old_source.get("file") or "")
        old_path = (
            storage.ORIGINALS_DIR / old_filename
            if old_filename
            else None
        )
        try:
            new_target.write_bytes(data)
        except OSError as error:
            raise ContributionError(
                "The edited PDF could not be stored on the server. Try again."
            ) from error
        previous_record = dict(record)
        try:
            record["source_document"] = {
                "file": new_target.name,
                "name": safe_filename,
                "type": "application/pdf",
                "size": len(data),
                "page_count": parsed["page_count"],
                "extracted_characters": parsed["character_count"],
            }
            record["body"] = parsed["text"]
            record["updated_at"] = utc_now()
            items[record_id] = record
            storage.write_records(items)
        except Exception:
            storage.remove_quietly(new_target)
            items[record_id] = previous_record
            raise
        if old_path and old_path != new_target:
            storage.remove_quietly(old_path)
        return record


def update_draft(
    owner_id: str,
    record_id: str,
    fields: dict,
) -> dict:
    title = _clean(fields.get("title"))
    summary = _clean(fields.get("summary"))
    body = str(fields.get("body") or "")
    if len(title) > TITLE_MAX:
        raise ContributionError(
            f"Keep the title within {TITLE_MAX} characters."
        )
    if len(summary) > SUMMARY_MAX:
        raise ContributionError(
            f"Keep the summary within {SUMMARY_MAX} characters."
        )
    if len(body) > BODY_DRAFT_MAX:
        raise ContributionError(
            f"The story body is above the {BODY_DRAFT_MAX:,} character draft limit. Edit it down."
        )
    for key, limit in FIELD_MAX.items():
        if fields.get(key) and len(_clean(fields.get(key))) > limit:
            raise ContributionError(
                f"The {key.replace('_', ' ')} field is too long."
            )
    focal_x = fields.get("focal_x")
    focal_y = fields.get("focal_y")
    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record["status"] not in EDITABLE_STATUSES:
            raise ContributionError(
                "Submitted contributions are read-only in this prototype."
            )
        content_type = str(record.get("content_type") or "story")
        card_image_source = _clean(
            fields.get("card_image_source"),
            20,
        )
        if card_image_source not in CARD_IMAGE_SOURCES:
            card_image_source = "primary"
        record.update({
            "title": title[:TITLE_MAX],
            "summary": summary[:SUMMARY_MAX],
            "body": body[:BODY_DRAFT_MAX],
            "category": _clean(fields.get("category"), FIELD_MAX["category"]),
            "team": _clean(fields.get("team"), FIELD_MAX["team"]),
            "author": _clean(fields.get("author"), FIELD_MAX["author"]),
            "layout": _clean_layout(content_type, fields.get("layout")),
            "display_section": _clean_display_section(
                content_type, fields.get("display_section")
            ),
            "publish_at": _optional_timestamp(fields.get("publish_at")),
            "expires_at": _optional_timestamp(fields.get("expires_at")),
            "updated_at": utc_now(),
            "template_data": _clean_template_data(fields.get("template_data")),
            "card_image_source": card_image_source,
        })
        if fields.get("owner_name"):
            record["owner_name"] = _clean(
                fields.get("owner_name"), FIELD_MAX["owner_name"]
            )
        cover = record.get("cover")
        if isinstance(cover, dict):
            if focal_x is not None:
                cover["focal_x"] = min(1.0, max(0.0, float(focal_x)))
            if focal_y is not None:
                cover["focal_y"] = min(1.0, max(0.0, float(focal_y)))
        if fields.get("image_scale") is not None:
            record["image_scale"] = min(
                1.8, max(0.6, float(fields["image_scale"]))
            )
        items[record_id] = record
        storage.write_records(items)
        return record


# ============================================================
# IMAGE ATTACHMENTS
# ============================================================
def _attach_image_field(
    owner_id: str,
    record_id: str,
    filename: str,
    data: bytes,
    focal_x: float,
    focal_y: float,
    field_name: str,
) -> dict:
    """Store a normalized primary/secondary cover as a 1600x900 image."""
    if field_name not in {"cover", "secondary_cover"}:
        raise ContributionError("Unsupported contribution image field.")
    validate_cover_upload(filename, len(data))
    normalized = normalize_cover(
        data, filename, focal_x, focal_y,
    )
    file_id = storage.new_file_id()
    target = storage.cover_path(file_id, normalized["extension"])
    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record["status"] not in EDITABLE_STATUSES:
            raise ContributionError(
                "Submitted contributions are read-only in this prototype."
            )
        previous = record.get(field_name)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(normalized["data"])
        except OSError as error:
            raise ContributionError(
                "The image could not be stored on the server. Try again."
            ) from error
        record[field_name] = {
            "file": target.name,
            "name": str(filename or ""),
            "type": f"image/{normalized['extension'].replace('jpg', 'jpeg')}",
            "size": len(normalized["data"]),
            "width": normalized["width"],
            "height": normalized["height"],
            "focal_x": min(1.0, max(0.0, float(focal_x))),
            "focal_y": min(1.0, max(0.0, float(focal_y))),
        }
        record["updated_at"] = utc_now()
        items[record_id] = record
        storage.write_records(items)
    if isinstance(previous, dict) and previous.get("file"):
        storage.remove_quietly(storage.COVERS_DIR / previous["file"])
    return record


def attach_cover(
    owner_id: str,
    record_id: str,
    filename: str,
    data: bytes,
    focal_x: float = 0.5,
    focal_y: float = 0.5,
) -> dict:
    validate_cover_upload(filename, len(data))
    # Resolve the actual type from the server record, not the browser.
    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record["status"] not in EDITABLE_STATUSES:
            raise ContributionError(
                "Submitted contributions are read-only in this prototype."
            )
        is_leadership = (
            record.get("content_type") == "leadership"
        )
    # Leadership images keep their native aspect ratio.
    if is_leadership:
        normalized = normalize_leadership_cover(
            data, filename,
        )
    else:
        normalized = normalize_cover(
            data, filename, focal_x, focal_y,
        )
    file_id = storage.new_file_id()
    target = storage.cover_path(
        file_id, normalized["extension"],
    )
    # Re-check ownership after image processing outside the storage lock.
    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record["status"] not in EDITABLE_STATUSES:
            raise ContributionError(
                "Submitted contributions are read-only in this prototype."
            )
        previous = record.get("cover")
        try:
            target.parent.mkdir(
                parents=True,
                exist_ok=True,
            )
            target.write_bytes(normalized["data"])
        except OSError as error:
            raise ContributionError(
                "The cover could not be stored on the server. Try again."
            ) from error
        record["cover"] = {
            "file": target.name,
            "name": str(filename or ""),
            "type": f"image/{normalized['extension'].replace('jpg', 'jpeg')}",
            "size": len(normalized["data"]),
            "width": normalized["width"],
            "height": normalized["height"],
            "focal_x": min(1.0, max(0.0, float(focal_x))),
            "focal_y": min(1.0, max(0.0, float(focal_y))),
        }
        record["updated_at"] = utc_now()
        items[record_id] = record
        storage.write_records(items)
    if isinstance(previous, dict) and previous.get("file"):
        storage.remove_quietly(storage.COVERS_DIR / previous["file"])
    return record


def attach_secondary_cover(
    owner_id: str,
    record_id: str,
    filename: str,
    data: bytes,
    focal_x: float = 0.5,
    focal_y: float = 0.5,
) -> dict:
    return _attach_image_field(
        owner_id, record_id, filename, data,
        focal_x, focal_y, "secondary_cover",
    )


def _remove_image_field(
    owner_id: str,
    record_id: str,
    field_name: str,
) -> dict:
    if field_name not in {"cover", "secondary_cover"}:
        raise ContributionError("Unsupported contribution image field.")
    previous = None
    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record["status"] not in EDITABLE_STATUSES:
            raise ContributionError(
                "Submitted contributions are read-only in this prototype."
            )
        previous = record.get(field_name)
        record[field_name] = None
        record["updated_at"] = utc_now()
        items[record_id] = record
        storage.write_records(items)
    if isinstance(previous, dict) and previous.get("file"):
        storage.remove_quietly(storage.COVERS_DIR / previous["file"])
    return record


def remove_cover(
    owner_id: str,
    record_id: str,
) -> dict:
    return _remove_image_field(
        owner_id, record_id, "cover",
    )


def remove_secondary_cover(
    owner_id: str,
    record_id: str,
) -> dict:
    """Remove the second cover and reset the card-image selection."""
    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record["status"] not in EDITABLE_STATUSES:
            raise ContributionError(
                "Submitted contributions are read-only in this prototype."
            )
        previous = record.get("secondary_cover")
        record["secondary_cover"] = None
        if record.get("card_image_source") == "secondary":
            record["card_image_source"] = "primary"
        record["updated_at"] = utc_now()
        items[record_id] = record
        storage.write_records(items)
    if isinstance(previous, dict) and previous.get("file"):
        storage.remove_quietly(storage.COVERS_DIR / previous["file"])
    return record


def set_focal_point(owner_id: str, record_id: str, focal_x: float, focal_y: float) -> dict:
    return update_draft(owner_id, record_id, {"focal_x": focal_x, "focal_y": focal_y})


def submit_draft(
    owner_id: str,
    record_id: str,
) -> dict:
    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record["status"] == "submitted":
            return record
        if record["status"] not in EDITABLE_STATUSES:
            raise ContributionError(
                "This contribution can no longer be submitted."
            )
        problems = []
        content_type = str(record.get("content_type") or "story")
        if not _clean(record.get("title")):
            if content_type == "document_import":
                problems.append("Add a document title before submitting.")
            else:
                problems.append("Add a title before submitting.")
        # Document imports need a title, description and uploaded original,
        # but do not require story body, cover or a story template.
        if content_type == "document_import":
            if not _clean(record.get("summary")):
                problems.append("Add a document description before submitting.")
            source_document = record.get("source_document")
            if (
                not isinstance(source_document, dict)
                or not source_document.get("file")
            ):
                problems.append(
                    "The original document is required before submitting."
                )
        else:
            body = _clean(record.get("body"))
            if len(body) < MIN_SUBMIT_BODY_CHARS:
                problems.append("Add the story body before submitting.")
            elif len(body) > BODY_SUBMIT_MAX:
                problems.append(
                    f"Reduce the story body below {BODY_SUBMIT_MAX:,} characters before submitting."
                )
            cover = record.get("cover")
            if not isinstance(cover, dict) or not cover.get("file"):
                if content_type != "announcement":
                    problems.append("Select a cover image before submitting.")
        if problems:
            raise ContributionError(" ".join(problems))
        record["status"] = "submitted"
        record["submitted_at"] = utc_now()
        record["updated_at"] = utc_now()
        record["withdrawn_at"] = None
        items[record_id] = record
        storage.write_records(items)
        return record

def delete_owned_record(
    owner_id: str,
    record_id: str,
) -> bool:
    """Delete an owned contribution and retire its related disk files."""
    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        retired_files: list[tuple[str, Path]] = []
        cover = record.get("cover")
        secondary_cover = record.get("secondary_cover")
        source = record.get("source_document")
        if isinstance(cover, dict) and cover.get("file"):
            retired_files.append(
                ("cover", storage.COVERS_DIR / cover["file"])
            )
        if (
            isinstance(secondary_cover, dict)
            and secondary_cover.get("file")
        ):
            retired_files.append(
                ("secondary_cover", storage.COVERS_DIR / secondary_cover["file"])
            )
        if isinstance(source, dict) and source.get("file"):
            retired_files.append(
                ("original", storage.ORIGINALS_DIR / source["file"])
            )
        del items[record_id]
        storage.write_records(items)
        # Remove dead links from the author's private notification inbox.
        owners = storage.load_notifications()
        inbox = owners.get(owner_id, [])
        filtered_inbox = [
            entry for entry in inbox
            if not isinstance(entry, dict)
            or str(entry.get("record_id")) != record_id
        ]
        if len(filtered_inbox) != len(inbox):
            owners[owner_id] = filtered_inbox
            storage.write_notifications(owners)
    for kind, path in retired_files:
        storage.remove_quietly(path)
    return True

def list_for_owner(owner_id: str) -> list[dict]:
    records = [
        record for record in storage.load_records().values()
        if record.get("owner_id") == owner_id
    ]
    records.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    return records


def get_owned(owner_id: str, record_id: str) -> dict:
    record = storage.load_records().get(record_id)
    if not record or record.get("owner_id") != owner_id:
        raise LookupError(record_id)
    return record


def list_published() -> list[dict]:
    """Future contract for Samsung Internal. Returns only already-published work."""

    records = [
        record for record in storage.load_records().values()
        if _is_effectively_published(record)
    ]
    records.sort(key=lambda item: str(item.get("published_at") or ""), reverse=True)
    return records


def get_published(record_id: str) -> dict:
    """Return one public record only after editorial publication."""

    record = storage.load_records().get(record_id)
    if not isinstance(record, dict) or not _is_effectively_published(record):
        raise LookupError(record_id)
    return record


# -- editorial review (privileged) ---------------------------------------
#
# These transitions are called by the editor-key-guarded routes, never by the
# author. Every decision writes one private notification for the author's
# hashed viewer identity — never broadcast to other viewers.

def peek(record_id: str) -> dict:
    record = storage.load_records().get(record_id)
    if not isinstance(record, dict):
        raise LookupError(record_id)
    return record


def _review_record(items: dict[str, dict], record_id: str) -> dict:
    record = items.get(record_id)
    if not isinstance(record, dict):
        raise LookupError(record_id)
    return record


def _add_owner_notification(owner_id: str, kind: str, record: dict) -> None:
    if not owner_id:
        return
    owners = storage.load_notifications()
    inbox = [entry for entry in owners.get(owner_id, []) if isinstance(entry, dict)]
    inbox.insert(0, {
        "id": storage.new_id("in"),
        "kind": kind,
        "record_id": record.get("id"),
        "title": _clean(record.get("title"), 200),
        "note": _clean(record.get("review_note"), REVIEW_NOTE_MAX),
        "created_at": utc_now(),
        "read": False,
    })
    owners[owner_id] = inbox[: storage.NOTIFICATION_LIMIT_PER_OWNER]
    storage.write_notifications(owners)


def _decide_submitted(record_id: str, next_status: str, note: str) -> dict:
    with storage.mutation_lock:
        items = storage.load_records()
        record = _review_record(items, record_id)
        if record["status"] == next_status:
            return record
        if record["status"] != "submitted":
            raise ContributionError(
                "Only submitted contributions can receive an editorial decision."
            )
        now = utc_now()
        record["status"] = next_status
        record["review_note"] = _clean(note, REVIEW_NOTE_MAX)
        record["reviewed_at"] = now
        record["updated_at"] = now
        if next_status == "archived":
            record["previous_status"] = "submitted"
            record["archived_at"] = now
        items[record_id] = record
        storage.write_records(items)
    kind_by_status = {
        "published": "published",
        "needs_changes": "changes",
        "archived": "rejected",
    }
    _add_owner_notification(str(record.get("owner_id") or ""), kind_by_status[next_status], record)
    return record


def list_submitted() -> list[dict]:
    records = [
        record for record in storage.load_records().values()
        if record.get("status") == "submitted"
    ]
    records.sort(key=lambda item: str(item.get("submitted_at") or ""), reverse=True)
    return records


def publish_record(record_id: str) -> dict:
    with storage.mutation_lock:
        items = storage.load_records()
        record = _review_record(items, record_id)
        if record["status"] == "published":
            return record
        if record["status"] != "submitted":
            raise ContributionError(
                "Only submitted contributions can be published."
            )
        now = utc_now()
        record["status"] = "published"
        record["published_at"] = now
        record["archived_at"] = None
        record["previous_status"] = "submitted"
        record["reviewed_at"] = now
        record["updated_at"] = now
        # Leadership messages are a channel of one: publishing a new vision
        # retires the previous one so readers never see two competing visions.
        retired_ids: list[str] = []
        if record["content_type"] == "leadership":
            for other_id, other in items.items():
                if (
                    other_id != record_id
                    and isinstance(other, dict)
                    and other.get("content_type") == "leadership"
                    and other.get("status") == "published"
                ):
                    other["status"] = "archived"
                    other["updated_at"] = now
                    retired_ids.append(other_id)
        items[record_id] = record
        storage.write_records(items)
    _add_owner_notification(str(record.get("owner_id") or ""), "published", record)
    return record


def request_changes(record_id: str, note: str) -> dict:
    if not _clean(note):
        raise ContributionError("Add a short note describing the requested changes.")
    return _decide_submitted(record_id, "needs_changes", note)


def reject_record(record_id: str, note: str) -> dict:
    return _decide_submitted(record_id, "archived", note)


def withdraw_submission(owner_id: str, record_id: str) -> dict:
    """Withdraw a submitted item without erasing its review history."""

    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record.get("status") == "withdrawn":
            return record
        if record.get("status") != "submitted":
            raise ContributionError("Only submitted content can be withdrawn.")
        now = utc_now()
        record["previous_status"] = "submitted"
        record["status"] = "withdrawn"
        record["withdrawn_at"] = now
        record["updated_at"] = now
        items[record_id] = record
        storage.write_records(items)
        return record


def archive_record(record_id: str) -> dict:
    with storage.mutation_lock:
        items = storage.load_records()
        record = _review_record(items, record_id)
        if record.get("status") == "archived":
            return record
        now = utc_now()
        record["previous_status"] = record.get("status")
        record["status"] = "archived"
        record["archived_at"] = now
        record["updated_at"] = now
        items[record_id] = record
        storage.write_records(items)
        return record


def restore_record(record_id: str) -> dict:
    with storage.mutation_lock:
        items = storage.load_records()
        record = _review_record(items, record_id)
        if record.get("status") != "archived":
            raise ContributionError("Only archived content can be restored.")
        previous = record.get("previous_status")
        record["status"] = "published" if previous == "published" else "submitted"
        record["archived_at"] = None
        record["updated_at"] = utc_now()
        items[record_id] = record
        storage.write_records(items)
        return record


def permanently_delete(record_id: str) -> bool:
    """Super-admin-only destructive path; the route enforces access.manage."""

    with storage.mutation_lock:
        items = storage.load_records()
        record = _review_record(items, record_id)
        files: list[Path] = []
        cover = record.get("cover")
        source = record.get("source_document")
        if isinstance(cover, dict) and cover.get("file"):
            files.append(storage.COVERS_DIR / Path(str(cover["file"])).name)
        if isinstance(source, dict) and source.get("file"):
            files.append(storage.ORIGINALS_DIR / Path(str(source["file"])).name)
        del items[record_id]
        storage.write_records(items)
    for path in files:
        storage.remove_quietly(path)
    return True


# -- author notifications --------------------------------------------------

def list_notifications(owner_id: str) -> dict:
    inbox = [
        entry for entry in storage.load_notifications().get(owner_id, [])
        if isinstance(entry, dict)
    ]
    unread = sum(1 for entry in inbox if not entry.get("read"))
    return {"items": inbox, "unread": unread}


def mark_notifications_read(owner_id: str, ids: list[str] | None = None) -> dict:
    with storage.mutation_lock:
        owners = storage.load_notifications()
        inbox = [entry for entry in owners.get(owner_id, []) if isinstance(entry, dict)]
        wanted = {str(value) for value in ids} if ids else None
        for entry in inbox:
            if wanted is None or str(entry.get("id")) in wanted:
                entry["read"] = True
        owners[owner_id] = inbox
        storage.write_notifications(owners)
    remaining = sum(1 for entry in inbox if not entry.get("read"))
    return {"unread": remaining}
