#!/usr/bin/env python3
r"""Local, isolated Docling/pdfplumber worker for Sampark PDF import.

Runs ONLY in .docling-venv. Does not call Samsung Chat or local BART.
Requires a normal readable PDF; cannot bypass encrypted enterprise DRM.
All model resolution is offline. Do not print PDF text or credentials.

Input/output files are created in a private TemporaryDirectory by the
parent process and deleted afterwards.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path


def _fit(text: str, limit: int) -> str:
    text = str(text or "").strip()
    if len(text) <= limit:
        return text
    # Keep the actual document conclusion so Samsung Chat can see it.
    tail = min(limit // 4, 45_000)
    return text[: limit - tail] + "\n\n[EXTRACTION OMITTED MIDDLE SECTION]\n\n" + text[-tail:]


def _rapidocr_options():
    from docling.datamodel.pipeline_options import RapidOcrOptions

    model_dir = Path(sys.prefix) / "Lib" / "site-packages" / "rapidocr" / "models"
    det = model_dir / "PP-OCRv6_det_small.onnx"
    rec = model_dir / "PP-OCRv6_rec_small.onnx"
    if not all(p.is_file() and p.stat().st_size > 1024 for p in (det, rec)):
        raise RuntimeError("RapidOCR det/rec ONNX models are not present locally")
    import onnxruntime  # noqa: F401
    return RapidOcrOptions(
        backend="onnxruntime",
        lang=["en"],
        model_size="small",
        det_model_path=str(det),
        rec_model_path=str(rec),
        use_cls=False,
        # Matched to the image-only RapidOCR validation that passed on Windows.
        mode="full_page",
    )


def _docling(pdf: Path, ocr: bool, max_chars: int) -> tuple[str, int | None]:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    options = PdfPipelineOptions()
    options.do_ocr = ocr
    if ocr:
        options.ocr_options = _rapidocr_options()
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )
    result = converter.convert(str(pdf))
    text = result.document.export_to_markdown()
    page_count = getattr(result.document, "num_pages", None)
    if not isinstance(page_count, int):
        pages = getattr(result.document, "pages", None)
        try:
            page_count = len(pages) if pages is not None else None
        except (TypeError, AttributeError):
            page_count = None
    return _fit(text, max_chars), page_count


def _pdfplumber(pdf: Path, max_pages: int, max_chars: int) -> tuple[str, int]:
    import pdfplumber

    pieces = []
    with pdfplumber.open(str(pdf)) as doc:
        page_count = len(doc.pages)
        if page_count > max_pages:
            raise ValueError(f"PDF has {page_count} pages; limit {max_pages}")
        for page in doc.pages:
            try:
                part = page.extract_text() or ""
                if part.strip():
                    pieces.append(part)
            except Exception as exc:
                print(f"Warning: pdfplumber page extraction failed: {type(exc).__name__}",
                      file=sys.stderr)
    return _fit("\n\n".join(pieces), max_chars), page_count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--status", type=Path, required=True)
    parser.add_argument("--engine", choices=["docling", "pdfplumber"], required=True)
    parser.add_argument("--ocr", action="store_true")
    parser.add_argument("--hf-home", type=Path, required=True)
    parser.add_argument("--max-pages", type=int, default=500)
    parser.add_argument("--max-chars", type=int, default=200000)
    args = parser.parse_args()

    # Set these before importing Hugging Face/Docling, and NEVER use remote models.
    os.environ["HF_HOME"] = str(args.hf_home)
    os.environ.pop("HF_HUB_CACHE", None)
    os.environ.pop("HUGGINGFACE_HUB_CACHE", None)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_XET"] = "1"

    status = {"engine": args.engine, "ocr": args.ocr, "status": "failed"}
    try:
        if args.engine == "docling":
            text, pages = _docling(args.input, args.ocr, args.max_chars)
        else:
            text, pages = _pdfplumber(args.input, args.max_pages, args.max_chars)
        if pages is not None and pages > args.max_pages:
            raise ValueError(f"PDF has {pages} pages; limit {args.max_pages}")
        args.output.write_text(text, encoding="utf-8")
        status.update(status="success" if text.strip() else "no_text",
                      characters=len(text), pages=pages)
    except Exception as exc:
        status.update(error_type=type(exc).__name__, error=str(exc)[:500])
        print(
            f"Worker {args.engine} failed ({type(exc).__name__}); "
            "parent process will try another extractor.",
            file=sys.stderr, flush=True,
        )
        # No tracebacks printed: document paths / vendor internals may be sensitive.
    finally:
        args.status.write_text(json.dumps(status, indent=2), encoding="utf-8")
    return 0 if status["status"] == "success" else 2


if __name__ == "__main__":
    raise SystemExit(main())
