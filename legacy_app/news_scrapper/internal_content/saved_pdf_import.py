"""Private, save-first PDF import for Sampark Create News.

The browser sends an original PDF once.  The server saves it as a unique
original, then reopens the stored file using the server's *normal authorized*
file access and passes those returned bytes to the existing Docling/RapidOCR
extraction pipeline.

This matters on enterprise-managed Windows systems where a file opened from
disk may be presented differently from its original multipart upload bytes.

The original is never replaced with the reopened representation.  The module
does not decrypt, bypass, export, or modify any enterprise-protected document.
This is a synchronous part of the existing POST /internal-content/import call:
the UI's existing "Extracting..." state remains active until import/summary.

Each upload is a new private draft and a new original file.  Save/submit/
approval remain separate operations, and normal ownership, deletion, and
review controls continue to be provided by service.py and router.py.
"""
from __future__ import annotations

import logging
from pathlib import Path

from . import service, storage
from .document_parser import ContributionError, detect_title, parse_document, validate_document_upload

LOG = logging.getLogger(__name__)

# Matches the local PC service's existing defaults, without depending on
# other fields that may have been added for stories, covers or leadership.
SUMMARY_MAX = 300


def _fallback_title(filename: str) -> str:
    title = str(Path(filename or "Imported document").stem)
    title = " ".join(title.replace("_", " ").replace("-", " ").split())
    return (title or "Imported document")[:120]


def _persist_owned(owner_id: str, record_id: str, updates: dict, source_updates: dict) -> dict:
    """Merge into the specific draft, preserving user edits and all other fields."""
    with storage.mutation_lock:
        items = storage.load_records()
        current = items.get(record_id)
        if not isinstance(current, dict) or current.get("owner_id") != owner_id:
            # Draft was removed while extraction ran: never resurrect it.
            raise LookupError("The imported draft is no longer available.")
        current.update(updates)
        source = current.get("source_document")
        if not isinstance(source, dict):
            raise RuntimeError("The imported draft has no original document metadata.")
        source.update(source_updates)
        current["updated_at"] = service.utc_now()
        items[record_id] = current
        storage.write_records(items)
        return current


def import_saved_pdf(
    owner_id: str,
    filename: str,
    declared_type: str,
    uploaded_bytes: bytes,
    fields: dict | None = None,
) -> dict:
    """Save one original, reopen it, extract text, and return its private draft.

    Does not call Samsung Chat here.  The existing import router invokes its
    proven Samsung Chat -> local BART summarizer after extraction succeeds.
    """
    fields = fields or {}
    kind = validate_document_upload(filename, declared_type, len(uploaded_bytes))
    if kind != "pdf" or not filename.lower().endswith(".pdf"):
        raise ContributionError("Choose a PDF file with the .pdf extension.")
    if not uploaded_bytes:
        raise ContributionError("Choose a nonempty PDF to upload.")

    target = storage.original_path(storage.new_file_id(), "pdf")
    source_type = storage.DOCUMENT_MIME_BY_EXTENSION["pdf"]
    base_title = _fallback_title(filename)

    # A fresh ID and unique original path for EVERY upload, even if two users
    # upload files of the same name concurrently.
    #
    # The PDF is retained under the existing private draft storage.  It is NOT
    # published, sent to review, or made globally visible by this operation.
    record_id = None
    try:
        with storage.mutation_lock:
            # Lock only file/metadata writes; ML inference must never hold it.
            storage.ensure_directories()
            target.write_bytes(uploaded_bytes)
            try:
                items = storage.load_records()
                record = service._base_record(
                    owner_id,
                    "document_import",
                    {
                        **fields,
                        "title": fields.get("title") or base_title,
                        "summary": "",
                    },
                )
                record_id = str(record["id"])
                if fields.get("owner_name"):
                    record["owner_name"] = str(fields["owner_name"]).strip()[:200]
                record["body"] = ""
                record["source_document"] = {
                    "file": target.name,
                    "name": str(filename or ""),
                    "type": source_type,
                    "size": len(uploaded_bytes),
                    "page_count": None,
                    "extracted_characters": 0,
                    "extraction_method": "pending",
                    "extraction_status": "processing",
                    "extraction_warning": "",
                    # Retain the local PC's existing metadata fields.
                    "metadata_status": "skipped",
                    "metadata_error": "",
                    "metadata_model_id": "",
                    "metadata_input_characters": 0,
                }
                items[record_id] = record
                storage.write_records(items)
            except Exception:
                # Failure to create the record must not strand an orphan PDF.
                storage.remove_quietly(target)
                raise
    except OSError as error:
        raise ContributionError(
            "The PDF could not be saved in private storage. Try again."
        ) from error

    # Heavy extraction happens OUTSIDE the mutation lock.
    # The original at target is not replaced or rewritten after this read.
    parsed = None
    failure = ""
    try:
        readable_bytes = target.read_bytes()
        if not readable_bytes:
            raise ValueError("The stored PDF is empty on reopen.")
        LOG.info(
            "[internal-content] PDF import: stored_upload_bytes=%d reopened_bytes=%d",
            len(uploaded_bytes), len(readable_bytes),
        )
        parsed = parse_document(filename, source_type, readable_bytes)
    except Exception as error:
        # Preserve draft + original for user review even when OCR/model loading
        # or enterprise permissions prevent automatic extraction.
        failure = (
            "The original was saved, but the server could not read it as a "
            "standard PDF. Please use an authorized PDF export or enter "
            "the Description manually."
        )
        LOG.warning(
            "[internal-content] Stored PDF extraction failed: type=%s file=%s",
            type(error).__name__, target.name,
        )

    if parsed is None:
        return _persist_owned(
            owner_id,
            record_id,
            {"body": "", "summary": ""},
            {
                "extraction_status": "unavailable",
                "extraction_method": "unavailable",
                "extraction_warning": failure,
                "page_count": None,
                "extracted_characters": 0,
            },
        )

    extracted = str(parsed.get("text") or "").strip()
    method = str(parsed.get("extraction_method") or "unknown")
    warning = str(parsed.get("extraction_warning") or "")
    if not extracted:
        warning = warning or (
            "The original was saved, but no readable text was found. "
            "You can still edit the Description manually."
        )
        method = "unavailable" if method == "unknown" else method

    try:
        count = int(parsed.get("character_count") or len(extracted))
    except (TypeError, ValueError):
        count = len(extracted)

    # Keep the existing draft semantics: provisional text is replaced by the
    # router's model-produced description before its HTTP response is returned.
    provisional_summary = extracted[:SUMMARY_MAX] if extracted else ""
    return _persist_owned(
        owner_id,
        record_id,
        {
            "title": (str(fields.get("title") or "").strip()
                      or str(parsed.get("detected_title") or "").strip()
                      or base_title)[:120],
            "body": extracted[:service.BODY_DRAFT_MAX],
            "summary": provisional_summary,
        },
        {
            "page_count": parsed.get("page_count"),
            "extracted_characters": count,
            "extraction_method": method,
            "extraction_status": "extracted" if extracted else "unavailable",
            "extraction_warning": warning,
        },
    )
