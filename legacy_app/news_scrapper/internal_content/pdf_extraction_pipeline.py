"""Resilient, LOCAL PDF text extraction for Sampark Create News.

Docling + local RapidOCR first, PyMuPDF and existing pypdf next, pdfplumber
as the final alternate. The source PDF bytes are never sent to an external API.
Samsung Chat and local BART remain entirely in document_summarizer.py.

Requires scripts/sampark_docling_worker.py and a separate .docling-venv.
Missing Docling / ONNX / cache never prevents legacy extraction.
No bypass of enterprise DRM or missing input bytes.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

LOG = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "scripts" / "sampark_docling_worker.py"
HF_HOME = ROOT / "models"
DOCLING_PYTHON = (
    ROOT / ".docling-venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
)
MIN_USEFUL = 60


def _short_error(exc: BaseException) -> str:
    # Don't log extracted text or vendor exception bodies that might contain it.
    return type(exc).__name__


def _usable(text: str) -> int:
    return sum(ch.isalnum() for ch in text or "")


def _trim(text: str, limit: int) -> str:
    value = (text or "").strip()
    if len(value) <= limit:
        return value
    # Keep the conclusion when an unusually large PDF exceeds the configured
    # extraction limit; Samsung Chat's document_evidence() samples throughout.
    tail = min(limit // 4, 45_000)
    return (
        value[:limit - tail - 40]
        + "\n\n[EXTRACTION OMITTED MIDDLE SECTION]\n\n"
        + value[-tail:]
    )[:limit]


def _pymupdf_extract(data: bytes, max_pages: int, max_chars: int) -> tuple[str, int | None, int]:
    """Fast per-page extraction, including empty-page count for OCR decision."""
    try:
        import pymupdf
    except ImportError:
        import fitz as pymupdf

    with pymupdf.open(stream=data, filetype="pdf") as document:
        if document.needs_pass:
            if not document.authenticate(""):
                raise PermissionError("PDF password required")
        count = len(document)
        if count > max_pages:
            return "", count, 0
        sections = []
        textless = 0
        for page in document:
            try:
                text = (page.get_text("text", sort=True) or "").strip()
            except Exception:
                text = ""
            if _usable(text) < 8:
                textless += 1
            if text:
                sections.append(text)
        return _trim("\n\n".join(sections), max_chars), count, textless


def _worker_run(
    engine: str, data_file: Path, output_dir: Path, *,
    use_ocr: bool, timeout_seconds: int, max_pages: int, max_chars: int,
) -> tuple[str, int | None] | None:
    if not DOCLING_PYTHON.is_file() or not WORKER.is_file():
        LOG.info("Sampark %s skipped: optional Docling environment/worker missing.", engine)
        return None
    text_out = output_dir / (engine + ("_ocr" if use_ocr else "") + ".txt")
    status_out = output_dir / (engine + ("_ocr" if use_ocr else "") + ".json")
    cmd = [
        str(DOCLING_PYTHON), "-u", str(WORKER),
        "--input", str(data_file), "--output", str(text_out),
        "--status", str(status_out), "--engine", engine,
        "--hf-home", str(HF_HOME),
        "--max-pages", str(max_pages), "--max-chars", str(max_chars),
    ]
    if use_ocr:
        cmd.append("--ocr")
    env = os.environ.copy()
    # Worker configures model loading as offline. Also avoid inheriting paths
    # from NewsScrapper's own BART / HF cache.
    env["HF_HOME"] = str(HF_HOME)
    env["HF_HUB_OFFLINE"] = "1"
    env["TRANSFORMERS_OFFLINE"] = "1"
    env["HF_HUB_DISABLE_XET"] = "1"
    try:
        proc = subprocess.run(
            cmd, capture_output=True, env=env, cwd=str(output_dir),
            timeout=timeout_seconds, check=False,
        )
    except subprocess.TimeoutExpired:
        LOG.warning("Sampark %s (OCR=%s) timed out after %ss; trying fallback.",
                    engine, use_ocr, timeout_seconds)
        return None
    except OSError as error:
        LOG.warning("Sampark %s cannot launch: %s", engine, _short_error(error))
        return None
    if proc.returncode != 0:
        status = {}
        if status_out.exists():
            try:
                status = json.loads(status_out.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
        LOG.warning(
            "Sampark %s (OCR=%s) unavailable: %s %s",
            engine, use_ocr, status.get("error_type", f"exit={proc.returncode}"),
            str(status.get("error", ""))[:200],
        )
        return None
    if not text_out.is_file():
        return None
    try:
        status = json.loads(status_out.read_text(encoding="utf-8"))
        text = text_out.read_text(encoding="utf-8")
        return _trim(text, max_chars), status.get("pages")
    except (OSError, ValueError) as error:
        LOG.warning("Sampark %s result invalid: %s", engine, _short_error(error))
        return None


def extract_pdf_with_fallbacks(
    data: bytes,
    filename: str,
    *,
    legacy_extract: Callable[[bytes, str], tuple[str, int | None]],
    max_pages: int = 500,
    max_chars: int = 200_000,
) -> tuple[str, int | None, str]:
    """Return (best_text, page_count, extraction_method) without leaking file bytes.

    A legitimate but image-only PDF can return empty text when the OCR
    dependency is absent; the importer stores the source with an honest warning.
    """
    if not data:
        return "", None, "unavailable"

    # PyMuPDF is a lightweight coverage check for scanned/mixed documents,
    # independent of Docling's ML inference. It also acts as a fallback.
    alternatives: list[tuple[str, str]] = []
    page_count = None
    missing_text_pages = 0
    try:
        pymupdf_text, page_count, missing_text_pages = _pymupdf_extract(
            data, max_pages, max_chars
        )
        if pymupdf_text:
            alternatives.append(("pymupdf", pymupdf_text))
    except Exception as error:
        LOG.warning("Sampark PyMuPDF preflight failed: %s", _short_error(error))
    if page_count is not None and page_count > max_pages:
        LOG.warning("Sampark PDF exceeds %s-page limit (%s pages).", max_pages, page_count)
        return "", page_count, "too_many_pages"

    # Keep the existing pypdf path, including its per-page PyMuPDF fallback.
    try:
        old_text, old_count = legacy_extract(data, filename)
        if page_count is None:
            page_count = old_count
        if old_text:
            alternatives.append(("pypdf", _trim(old_text, max_chars)))
    except Exception as error:
        LOG.warning("Sampark pypdf fallback failed: %s", _short_error(error))

    if page_count is not None and page_count > max_pages:
        return "", page_count, "too_many_pages"

    # First Docling pass uses OCR when there are image-only or nearly empty pages.
    # This runs entirely offline with the verified local ONNX det+rec weights.
    want_ocr = (page_count is None or missing_text_pages > 0
                or not alternatives or max(_usable(t) for _, t in alternatives) < MIN_USEFUL)
    with tempfile.TemporaryDirectory(prefix="sampark-pdf-") as folder:
        temp = Path(folder)
        upload = temp / "input.pdf"
        upload.write_bytes(data)
        docling = _worker_run(
            "docling", upload, temp, use_ocr=want_ocr,
            timeout_seconds=180 if want_ocr else 120,
            max_pages=max_pages, max_chars=max_chars,
        )
        if docling and _usable(docling[0]) >= MIN_USEFUL:
            alternatives.append(("docling_rapidocr" if want_ocr else "docling", docling[0]))
            if page_count is None:
                page_count = docling[1]
        elif want_ocr:
            # RapidOCR can be missing or fail; still try layout/text extraction
            # without OCR to retain any available PDF text.
            regular = _worker_run(
                "docling", upload, temp, use_ocr=False,
                timeout_seconds=120, max_pages=max_pages, max_chars=max_chars,
            )
            if regular and regular[0]:
                alternatives.append(("docling", regular[0]))
                if page_count is None:
                    page_count = regular[1]

        current_best = max((_usable(t) for _, t in alternatives), default=0)
        if current_best < MIN_USEFUL:
            # pdfplumber lives in the alternate venv, so keep it isolated too.
            alternate = _worker_run(
                "pdfplumber", upload, temp, use_ocr=False,
                timeout_seconds=90, max_pages=max_pages, max_chars=max_chars,
            )
            if alternate and alternate[0]:
                alternatives.append(("pdfplumber", alternate[0]))
                if page_count is None:
                    page_count = alternate[1]

    if not alternatives:
        LOG.warning("Sampark PDF extraction: no readable text; %s", filename)
        return "", page_count, "unavailable"

    # Prefer Docling's semantic Markdown when it covers at least ~85% of the
    # useful content recovered by another engine. This prevents naive selection
    # of artificially longer text that contains layout/spacing artifacts.
    best_coverage = max(_usable(t) for _, t in alternatives)
    docling_options = [
        (name, text) for name, text in alternatives
        if name.startswith("docling") and _usable(text) >= max(MIN_USEFUL, best_coverage * .85)
    ]
    if docling_options:
        best_name, best_text = max(docling_options, key=lambda pair: _usable(pair[1]))
    else:
        best_name, best_text = max(alternatives, key=lambda pair: _usable(pair[1]))
    LOG.info(
        "Sampark PDF extraction complete: method=%s pages=%s chars=%s alternatives=%s",
        best_name, page_count, len(best_text), [name for name, _ in alternatives],
    )
    return _trim(best_text, max_chars), page_count, best_name
