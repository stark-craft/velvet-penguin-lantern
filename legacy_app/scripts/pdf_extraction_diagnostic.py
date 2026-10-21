"""Read-only diagnostic for PDF text extraction.

Usage:
    py pdf_extraction_diagnostic.py "C:\path\to\report.pdf"

This script does NOT upload, save, print, or modify document contents.
It reports aggregate text-character counts and reader errors only.
It does NOT use OCR, network APIs, or AI services.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

MAX_BYTES = 150 * 1024 * 1024
MAX_PAGES = 500
CURRENT_IMPORT_CHARACTER_LIMIT = 200_000
SAMPLE_PAGES = 15


def safe_error(exc: Exception) -> str:
    # Exceptions generally identify structural failures; do not output page text.
    return f"{type(exc).__name__}: {str(exc)[:180]}"


def read_with_pypdf(data: bytes) -> dict:
    result = {"available": False}
    try:
        from pypdf import PdfReader
    except ImportError:
        result["reason"] = "pypdf is not installed in this Python environment"
        return result

    result["available"] = True
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted and not reader.decrypt(""):
            result["error"] = "Password protection prevents extraction"
            return result
        count = len(reader.pages)
        result["page_count"] = count
        if count > MAX_PAGES:
            result["error"] = f"Page limit exceeded: {count} > {MAX_PAGES}"
            return result

        counts = []
        failed = []
        for i in range(count):
            try:
                text = (reader.pages[i].extract_text() or "").strip()
                counts.append(len(text))
            except Exception as exc:
                counts.append(0)
                failed.append({"page": i + 1, "error": safe_error(exc)})
        result.update({
            "characters": sum(counts),
            "pages_with_text": sum(1 for value in counts if value > 0),
            "page_errors": failed[:10],
            "page_error_count": len(failed),
            "first_page_character_counts": counts[:SAMPLE_PAGES],
            "text_found_pages": [
                i + 1 for i, value in enumerate(counts) if value > 0
            ][:SAMPLE_PAGES],
            "over_current_import_character_limit": (
                sum(counts) > CURRENT_IMPORT_CHARACTER_LIMIT
            ),
        })
        # Used only internally to compare the engines; never printed.
        result["_counts"] = counts
    except Exception as exc:
        result["error"] = safe_error(exc)
    return result


def read_with_pymupdf(data: bytes) -> dict:
    result = {"available": False}
    try:
        import pymupdf
    except ImportError:
        try:
            import fitz as pymupdf
        except ImportError:
            result["reason"] = (
                "PyMuPDF is not installed; optional comparison is unavailable"
            )
            return result

    result["available"] = True
    try:
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            if doc.needs_pass and not doc.authenticate(""):
                result["error"] = "Password protection prevents extraction"
                return result
            count = len(doc)
            result["page_count"] = count
            if count > MAX_PAGES:
                result["error"] = f"Page limit exceeded: {count} > {MAX_PAGES}"
                return result

            counts = []
            failed = []
            for i in range(count):
                try:
                    text = (doc[i].get_text("text", sort=True) or "").strip()
                    counts.append(len(text))
                except Exception as exc:
                    counts.append(0)
                    failed.append({"page": i + 1, "error": safe_error(exc)})
            total_chars = sum(counts)
            result.update({
                "characters": total_chars,
                "pages_with_text": sum(1 for value in counts if value > 0),
                "page_errors": failed[:10],
                "page_error_count": len(failed),
                "first_page_character_counts": counts[:SAMPLE_PAGES],
                "text_found_pages": [
                    i + 1 for i, value in enumerate(counts) if value > 0
                ][:SAMPLE_PAGES],
                "over_current_import_character_limit": (
                    total_chars > CURRENT_IMPORT_CHARACTER_LIMIT
                ),
            })
            result["_counts"] = counts
    except Exception as exc:
        result["error"] = safe_error(exc)
    return result



def check_actual_backend_parser(data: bytes, file_name: str) -> dict:
    """Run the app's real parser directly, exposing swallowed error messages.

    Script is designed to run from C:\scrappyV3 in PowerShell.
    No document contents, paragraphs, or extracted text are printed.
    """
    result = {}
    # Running from the app root lets Python find news_scrapper.
    sys.path.insert(0, str(Path.cwd()))
    try:
        from news_scrapper.internal_content import document_parser as parser
        result["module_path"] = str(Path(parser.__file__).resolve())
        result["module_has_optional_fallback"] = hasattr(parser, "_open_pymupdf")
        result["document_max_bytes"] = parser.DOCUMENT_MAX_BYTES
        result["pdf_max_pages"] = parser.PDF_MAX_PAGES
    except Exception as exc:
        result["import_error"] = safe_error(exc)
        return result

    try:
        parsed = parser.parse_document(file_name, "application/pdf", data)
        result["status"] = "returned"
        result["page_count"] = parsed.get("page_count")
        result["character_count"] = parsed.get("character_count")
        result["summary_possible"] = bool(str(parsed.get("text") or "").strip())
    except Exception as exc:
        result["status"] = "raised"
        result["error"] = safe_error(exc)
    return result

def diagnose(path: Path) -> dict:
    # Path and PDF text deliberately do not appear in the result.
    size = path.stat().st_size
    result = {
        "file_bytes": size,
        "max_file_bytes": MAX_BYTES,
        "max_pages": MAX_PAGES,
        "current_import_character_limit": CURRENT_IMPORT_CHARACTER_LIMIT,
    }
    if size == 0 or size > MAX_BYTES:
        result["error"] = (
            "Empty input" if size == 0 else "File exceeds 150 MB test limit"
        )
        return result

    data = path.read_bytes()
    result["actual_backend_parser"] = check_actual_backend_parser(data, path.name)
    header_offset = data.find(b"%PDF-", 0, 1024 * 1024)
    result["pdf_header_offset"] = header_offset
    if header_offset < 0:
        result["warning"] = "No PDF header found within the first 1 MB"

    pypdf = read_with_pypdf(data)
    pymupdf = read_with_pymupdf(data)
    a = pypdf.pop("_counts", None)
    b = pymupdf.pop("_counts", None)
    result["pypdf"] = pypdf
    result["pymupdf"] = pymupdf

    if a is not None and b is not None:
        limit = min(len(a), len(b))
        result["pymupdf_text_when_pypdf_empty"] = [
            i + 1 for i in range(limit) if a[i] == 0 and b[i] > 0
        ][:50]
        result["engine_page_counts_match"] = len(a) == len(b)

    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Read-only PDF extraction comparison; no OCR or network"
    )
    parser.add_argument("pdf", type=Path, help="Local PDF filename")
    args = parser.parse_args()

    try:
        data = diagnose(args.pdf)
        print(json.dumps(data, ensure_ascii=False, indent=2))
    except (OSError, ValueError) as exc:
        print(json.dumps({
            "error": safe_error(exc),
        }, indent=2))
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
