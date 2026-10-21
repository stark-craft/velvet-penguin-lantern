"""Server-side validation and best-effort text extraction for contributions.

The original PDF is stored by service.import_document independently of whether
text can be extracted. For a readable PDF with no selectable text, return an
empty result WITH its page count instead of raising an empty-text error.

Primary extractor: pypdf. Optional per-page fallback: PyMuPDF.
No OCR, network calls, Samsung Chat, or automatic summarization.
"""

from __future__ import annotations

import io
import logging
import re
import zipfile

import docx
from pypdf import PdfReader

logger = logging.getLogger(__name__)

DOCUMENT_MAX_BYTES = 150 * 1024 * 1024
DOCX_MAX_UNCOMPRESSED_BYTES = 300 * 1024 * 1024
DOCX_MAX_ARCHIVE_MEMBERS = 5000
PDF_MAX_PAGES = 500
EXTRACT_MAX_CHARS = 200_000
MIN_READABLE_CHARS = 8

WORD_DOCX_TYPE = (
    "application/vnd.openxmlformats-officedocument."
    "wordprocessingml.document"
)
PDF_TYPE = "application/pdf"

_BLOCKED_EXTENSION_MESSAGES = {
    "doc": (
        "This Word format is not supported yet. "
        "Save the document as .docx and try again."
    ),
}
_BLOCKED_GENERIC_EXTENSIONS = {
    "docm", "xls", "xlsx", "ppt", "pptx", "zip", "rar", "7z",
    "tar", "gz", "exe", "dll", "bat", "cmd", "sh", "msi",
}


class ContributionError(Exception):
    """A user-facing failure. The message may be shown directly in the UI."""


def extension_of(filename: str) -> str:
    name = str(filename or "").strip()
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def validate_document_upload(
    filename: str,
    declared_type: str,
    size_bytes: int,
) -> str:
    """Return 'pdf' or 'docx' for an acceptable upload; reject other types."""
    extension = extension_of(filename)
    if extension == "doc":
        raise ContributionError(_BLOCKED_EXTENSION_MESSAGES["doc"])
    if extension in _BLOCKED_GENERIC_EXTENSIONS:
        raise ContributionError(
            f"{filename} is not a supported format. "
            "Choose a PDF or Word (.docx) document."
        )

    is_pdf = extension == "pdf" or declared_type == PDF_TYPE
    is_docx = extension == "docx" or declared_type == WORD_DOCX_TYPE
    if not (is_pdf or is_docx):
        raise ContributionError(
            "Choose a PDF or Word (.docx) document to import."
        )
    if size_bytes > DOCUMENT_MAX_BYTES:
        readable = DOCUMENT_MAX_BYTES / (1024 * 1024)
        raise ContributionError(
            f"{filename} is larger than the {readable:.0f} MB document "
            "limit. Upload a smaller copy."
        )
    return "pdf" if is_pdf else "docx"


def _signature_matches(kind: str, data: bytes) -> bool:
    """Inspect a bounded header; tolerate enterprise PDF preambles up to 1 MB."""
    if kind == "pdf":
        return bool(data) and b"%PDF-" in data[: 1024 * 1024]
    if kind == "docx":
        if data[:4] != b"PK\x03\x04":
            return False
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                members = archive.infolist()
                if len(members) > DOCX_MAX_ARCHIVE_MEMBERS:
                    return False
                if sum(max(0, m.file_size) for m in members) > DOCX_MAX_UNCOMPRESSED_BYTES:
                    return False
                return any(m.filename.startswith("word/") for m in members)
        except zipfile.BadZipFile:
            return False
    return False


def _normalize_extracted(value: str) -> str:
    cleaned = str(value or "")
    cleaned = cleaned.replace("\u00a0", " ")
    cleaned = re.sub(
        r"([A-Za-z])-[ \t]*\r?\n[ \t]*([a-z])",
        r"\1\2",
        cleaned,
    )
    cleaned = re.sub(r"[ \t]+\r?\n", "\n", cleaned)
    cleaned = re.sub(r"\r?\n[ \t]+", "\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def detect_title(text: str, filename: str) -> str:
    """Use the first meaningful line or the cleaned filename."""
    for line in (part.strip() for part in str(text or "").splitlines()):
        if 3 <= len(line) <= 120:
            return line
    base = re.sub(
        r"\.(pdf|docx)$", "", str(filename or ""), flags=re.IGNORECASE
    )
    base = re.sub(r"[_-]+", " ", base).strip()
    return base[:120]


def _empty_text_error(kind: str) -> ContributionError:
    if kind == "pdf":
        return ContributionError(
            "No selectable text was found in this PDF. "
            "The original PDF may still be stored."
        )
    return ContributionError(
        "We couldn't find readable text in this document. "
        "Upload a text-based PDF or DOCX, or start a story manually."
    )


def _open_pymupdf(data: bytes):
    """Load the optional alternate PDF engine only when needed."""
    try:
        import pymupdf
    except ImportError:
        try:
            import fitz as pymupdf
        except ImportError:
            return None
    doc = pymupdf.open(stream=data, filetype="pdf")
    if doc.needs_pass and not doc.authenticate(""):
        doc.close()
        raise ContributionError(
            "This PDF is password protected. "
            "Automatic text extraction is unavailable."
        )
    return doc


def extract_pdf(data: bytes, filename: str) -> tuple[str, int | None]:
    """Extract text page by page; preserve page count on zero-text PDFs.

    A failed individual page does not invalidate all other readable pages.
    PyMuPDF is tried when pypdf cannot open the document or a particular
    page yields no meaningful selectable text.
    """
    reader = None
    page_count = None
    pypdf_problem = None

    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            try:
                if not reader.decrypt(""):
                    raise ContributionError(
                        "This PDF is password protected. "
                        "Automatic text extraction is unavailable."
                    )
            except ContributionError:
                raise
            except Exception as error:
                raise ContributionError(
                    "This PDF is protected. "
                    "Automatic text extraction is unavailable."
                ) from error
        page_count = len(reader.pages)
    except Exception as error:  # pypdf has multiple internal error classes
        pypdf_problem = error
        reader = None
        logger.warning(
            "[internal-content] pypdf could not inspect %s: %s",
            filename,
            error,
        )

    if page_count is not None and page_count > PDF_MAX_PAGES:
        logger.warning(
            "[internal-content] PDF page limit: %s has %s pages (max %s)",
            filename, page_count, PDF_MAX_PAGES,
        )
        # The upload is still preserved by service.py. We do not attempt
        # automatic extraction above the explicit safety limit.
        return "", page_count

    # Fallback is lazy to avoid opening the same file twice unnecessarily.
    fallback_doc = None
    fallback_attempted = False
    fallback_problem = None

    def ensure_fallback():
        nonlocal fallback_doc, fallback_attempted, fallback_problem
        if not fallback_attempted:
            fallback_attempted = True
            try:
                fallback_doc = _open_pymupdf(data)
            except Exception as error:
                fallback_problem = error
                logger.warning(
                    "[internal-content] PyMuPDF cannot inspect %s: %s",
                    filename, error,
                )
        return fallback_doc

    try:
        if page_count is None:
            doc = ensure_fallback()
            if doc is None:
                # No engine could determine whether these bytes are readable.
                reason = fallback_problem or pypdf_problem
                raise ContributionError(
                    f"{filename} could not be opened as a PDF. "
                    "The original can still be kept without extracted text."
                ) from reason
            page_count = len(doc)
            if page_count > PDF_MAX_PAGES:
                logger.warning(
                    "[internal-content] PDF page limit: %s has %s pages",
                    filename, page_count,
                )
                return "", page_count

        pages: list[str] = []
        failed_pages = 0
        fallback_pages = 0
        total_characters = 0
        truncated = False

        for page_index in range(page_count):
            extracted = ""
            if reader is not None:
                try:
                    extracted = _normalize_extracted(
                        reader.pages[page_index].extract_text() or ""
                    )
                except Exception as error:
                    failed_pages += 1
                    logger.warning(
                        "[internal-content] pypdf extraction failed: %s "
                        "page %s/%s: %s",
                        filename, page_index + 1, page_count, error,
                    )

            # Empty and extremely short/encoding-damaged pages merit another
            # extraction attempt. A document with perfectly legitimate short
            # text is retained even if PyMuPDF is not installed.
            meaningful = sum(ch.isalnum() for ch in extracted)
            if meaningful < MIN_READABLE_CHARS:
                doc = ensure_fallback()
                if doc is not None:
                    try:
                        if page_index < len(doc):
                            candidate = _normalize_extracted(
                                doc[page_index].get_text("text", sort=True) or ""
                            )
                            if len(candidate) > len(extracted):
                                extracted = candidate
                                fallback_pages += 1
                    except Exception as error:
                        logger.warning(
                            "[internal-content] PyMuPDF extraction failed: %s "
                            "page %s/%s: %s",
                            filename, page_index + 1, page_count, error,
                        )

            if not extracted:
                continue

            # Bound memory and preserve the first useful material, which is
            # what the editable 300-character Description draws from.
            separator = "\n\n" if pages else ""
            remaining = EXTRACT_MAX_CHARS - total_characters
            piece = (separator + extracted)[:remaining]
            if piece:
                pages.append(piece)
                total_characters += len(piece)
            if len(separator) + len(extracted) > remaining:
                truncated = True
                break
            if total_characters >= EXTRACT_MAX_CHARS:
                truncated = True
                break

        text = _normalize_extracted("".join(pages))
        if len(text) > EXTRACT_MAX_CHARS:
            text = text[:EXTRACT_MAX_CHARS]
            truncated = True
        if truncated:
            logger.warning(
                "[internal-content] PDF text truncated at %s characters: %s",
                EXTRACT_MAX_CHARS, filename,
            )
        logger.info(
            "[internal-content] PDF extraction: %s pages, %s chars, "
            "%s alternate-engine pages, %s pypdf page failures; %s",
            page_count, len(text), fallback_pages, failed_pages, filename,
        )
        return text, page_count
    finally:
        if fallback_doc is not None:
            fallback_doc.close()


def extract_docx(data: bytes, filename: str) -> tuple[str, int | None]:
    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as error:
        logger.warning(
            "[internal-content] DOCX open failed for %s: %s",
            filename, error,
        )
        raise ContributionError(
            f"{filename} could not be read as a Word document. "
            "It may be damaged."
        ) from error

    blocks: list[str] = [
        paragraph.text.strip()
        for paragraph in document.paragraphs
        if paragraph.text.strip()
    ]
    for table in document.tables:
        rows = [
            " | ".join(cell.text.strip() for cell in row.cells)
            for row in table.rows
        ]
        blocks.extend(row for row in rows if row.strip())
    return _normalize_extracted("\n\n".join(blocks)), None


def parse_document(
    filename: str,
    declared_type: str,
    data: bytes,
) -> dict:
    """Validate and extract one upload, preserving the existing service contract.

    A syntactically valid PDF with no selectable text returns empty text
    rather than raising. service.import_document already turns empty text
    into extraction_status='unavailable' and retains the original PDF.
    DOCX validation remains strict, as in the user's current implementation.
    """
    kind = validate_document_upload(filename, declared_type, len(data))
    if not _signature_matches(kind, data):
        if kind == "pdf":
            raise ContributionError(
                f"{filename} could not be recognized as a standard PDF. "
                "Its contents could not be inspected for automatic extraction."
            )
        raise ContributionError(
            f"{filename} does not look like a Word .docx file. "
            "Check the file and try again."
        )

    if kind == "pdf":
        text, page_count = extract_pdf(data, filename)
        # No text still produces a draft with a page count, wherever possible.
    else:
        text, page_count = extract_docx(data, filename)
        meaningful = re.sub(r"\s+", "", text)
        if len(meaningful) < MIN_READABLE_CHARS:
            raise _empty_text_error(kind)
        if len(text) > EXTRACT_MAX_CHARS:
            thousands = len(text) // 1000
            raise ContributionError(
                "The extracted text is about "
                f"{thousands}k characters, above the "
                f"{EXTRACT_MAX_CHARS:,} character extraction limit."
            )

    return {
        "text": text,
        "page_count": page_count,
        "character_count": len(text),
        "detected_title": detect_title(text, filename),
        "paragraphs": [part for part in text.split("\n\n") if part],
    }
