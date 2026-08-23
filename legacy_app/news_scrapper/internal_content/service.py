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
)
from .image_processor import normalize_cover, validate_cover_upload

TITLE_MAX = 120
SUMMARY_MAX = 300
BODY_SUBMIT_MAX = 60_000
BODY_DRAFT_MAX = EXTRACT_MAX_CHARS
MIN_SUBMIT_BODY_CHARS = 20
FIELD_MAX = {"category": 200, "team": 400, "author": 400, "owner_name": 200}
CONTENT_TYPES = ("story", "document_import", "leadership", "announcement")

STATUSES = ("draft", "ready", "submitted", "published", "needs_changes", "archived")
# needs_changes is editable so the author can revise and resubmit after a
# reviewer requests changes.
EDITABLE_STATUSES = ("draft", "ready", "needs_changes")
REVIEW_NOTE_MAX = 2000


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _clean(value: object, limit: int | None = None) -> str:
    text = str(value or "").strip()
    return text[:limit] if limit else text


def _require_owned(items: dict[str, dict], record_id: str, owner_id: str) -> dict:
    record = items.get(record_id)
    if not record or record.get("owner_id") != owner_id:
        raise KeyError(record_id)
    return record


def _base_record(owner_id: str, content_type: str, fields: dict) -> dict:
    now = utc_now()
    return {
        "id": storage.new_id(),
        "owner_id": owner_id,
        "content_type": content_type if content_type in CONTENT_TYPES else "story",
        "title": _clean(fields.get("title"), TITLE_MAX),
        "summary": _clean(fields.get("summary"), SUMMARY_MAX),
        "body": _clean(fields.get("body")),
        "category": _clean(fields.get("category"), FIELD_MAX["category"]),
        "team": _clean(fields.get("team"), FIELD_MAX["team"]),
        "author": _clean(fields.get("author"), FIELD_MAX["author"]),
        "cover": None,
        "source_document": None,
        "status": "draft",
        "created_at": now,
        "updated_at": now,
        "submitted_at": None,
        "published_at": None,
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
    fields = fields or {}
    parsed = parse_document(filename, declared_type, data)

    # Imports usually produce document stories, but a caller may route the
    # extracted copy into another channel (for example an HR announcement).
    requested_type = str(fields.get("content_type") or "").strip()
    content_type = requested_type if requested_type in CONTENT_TYPES else "document_import"

    file_id = storage.new_file_id()
    extension = "pdf" if (declared_type == "application/pdf" or filename.lower().endswith(".pdf")) else "docx"
    target = storage.original_path(file_id, extension)
    with storage.mutation_lock:
        try:
            storage.ensure_directories()
            target.write_bytes(data)
        except OSError as error:
            raise ContributionError(
                "The original document could not be stored on the server. Try again."
            ) from error
        try:
            items = storage.load_records()
            record = _base_record(owner_id, content_type, {
                **fields,
                "title": fields.get("title") or parsed["detected_title"],
            })
            record["body"] = parsed["text"]
            record["source_document"] = {
                "file": target.name,
                "name": str(filename or ""),
                "type": declared_type or storage.DOCUMENT_MIME_BY_EXTENSION[extension],
                "size": len(data),
                "page_count": parsed["page_count"],
                "extracted_characters": parsed["character_count"],
            }
            items[record["id"]] = record
            storage.write_records(items)
        except Exception:
            # A failed import must not strand an orphan original on disk.
            storage.remove_quietly(target)
            raise
    return record


def update_draft(owner_id: str, record_id: str, fields: dict) -> dict:
    title = _clean(fields.get("title"))
    summary = _clean(fields.get("summary"))
    body = str(fields.get("body") or "")
    if len(title) > TITLE_MAX:
        raise ContributionError(f"Keep the title within {TITLE_MAX} characters.")
    if len(summary) > SUMMARY_MAX:
        raise ContributionError(f"Keep the summary within {SUMMARY_MAX} characters.")
    if len(body) > BODY_DRAFT_MAX:
        raise ContributionError(
            f"The story body is above the {BODY_DRAFT_MAX:,} character draft limit. Edit it down."
        )
    for key, limit in FIELD_MAX.items():
        if fields.get(key) and len(_clean(fields.get(key))) > limit:
            raise ContributionError(f"The {key.replace('_', ' ')} field is too long.")

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
        record.update({
            "title": title[:TITLE_MAX],
            "summary": summary[:SUMMARY_MAX],
            "body": body[:BODY_DRAFT_MAX],
            "category": _clean(fields.get("category"), FIELD_MAX["category"]),
            "team": _clean(fields.get("team"), FIELD_MAX["team"]),
            "author": _clean(fields.get("author"), FIELD_MAX["author"]),
            "updated_at": utc_now(),
        })
        if fields.get("owner_name"):
            record["owner_name"] = _clean(fields.get("owner_name"), FIELD_MAX["owner_name"])
        cover = record.get("cover")
        if isinstance(cover, dict):
            if focal_x is not None:
                cover["focal_x"] = min(1.0, max(0.0, float(focal_x)))
            if focal_y is not None:
                cover["focal_y"] = min(1.0, max(0.0, float(focal_y)))
        items[record_id] = record
        storage.write_records(items)
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
    normalized = normalize_cover(data, filename, focal_x, focal_y)
    file_id = storage.new_file_id()
    target = storage.cover_path(file_id, normalized["extension"])

    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record["status"] not in EDITABLE_STATUSES:
            raise ContributionError("Submitted contributions are read-only in this prototype.")

        previous = record.get("cover")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
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


def set_focal_point(owner_id: str, record_id: str, focal_x: float, focal_y: float) -> dict:
    return update_draft(owner_id, record_id, {"focal_x": focal_x, "focal_y": focal_y})


def submit_draft(owner_id: str, record_id: str) -> dict:
    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record["status"] == "submitted":
            return record
        if record["status"] not in EDITABLE_STATUSES:
            raise ContributionError("This contribution can no longer be submitted.")
        problems = []
        if not _clean(record.get("title")):
            problems.append("Add a title before submitting.")
        if len(_clean(record.get("body"))) < MIN_SUBMIT_BODY_CHARS:
            problems.append("Add the story body before submitting.")
        elif len(_clean(record.get("body"))) > BODY_SUBMIT_MAX:
            problems.append(
                f"Reduce the story body below {BODY_SUBMIT_MAX:,} characters before submitting."
            )
        cover = record.get("cover")
        if not isinstance(cover, dict) or not cover.get("file"):
            # Announcements are text-first notices; a cover is optional there.
            if record["content_type"] != "announcement":
                problems.append("Select a cover image before submitting.")
        if problems:
            raise ContributionError(" ".join(problems))
        record["status"] = "submitted"
        record["submitted_at"] = utc_now()
        record["updated_at"] = utc_now()
        items[record_id] = record
        storage.write_records(items)
        return record


def delete_draft(owner_id: str, record_id: str) -> bool:
    with storage.mutation_lock:
        items = storage.load_records()
        try:
            record = _require_owned(items, record_id, owner_id)
        except KeyError as error:
            raise LookupError(record_id) from error
        if record["status"] == "submitted":
            raise ContributionError(
                "Submitted contributions are kept for the review trail and cannot be deleted."
            )
        retired_files: list[tuple[str, Path]] = []
        cover = record.get("cover")
        source = record.get("source_document")
        if isinstance(cover, dict) and cover.get("file"):
            retired_files.append(("cover", storage.COVERS_DIR / cover["file"]))
        if isinstance(source, dict) and source.get("file"):
            retired_files.append(("original", storage.ORIGINALS_DIR / source["file"]))
        del items[record_id]
        storage.write_records(items)

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
        if record.get("status") == "published"
    ]
    records.sort(key=lambda item: str(item.get("published_at") or ""), reverse=True)
    return records


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
