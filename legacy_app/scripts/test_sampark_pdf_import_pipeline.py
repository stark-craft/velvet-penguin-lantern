#!/usr/bin/env python3
r"""Local smoke test for the *actual* Sampark PDF parser + summary pipeline.

This does not import or store a draft and does not modify existing UI data.

From C:\scrappyV3 after copying the integration files:
    & ".\venv\Scripts\python.exe" -u ".\scripts\test_sampark_pdf_import_pipeline.py" ".\docling_tests\sampark_ocr_scan_test.pdf"
    & ".\venv\Scripts\python.exe" -u ".\scripts\test_sampark_pdf_import_pipeline.py" "C:\Users\...\Downloads\MD Message.pdf" --with-summary

--with-summary sends extracted text to the already-configured internal
Samsung Chat API; local BART is used only if that API fails.
Without --with-summary, NO text is sent to any network service.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--with-summary", action="store_true",
                        help="Call EXISTING Samsung Chat -> BART for a real 300-char Description")
    parser.add_argument("--expected-ocr", action="store_true",
                        help="Fail if Docling RapidOCR did not produce the extracted text")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    path = args.pdf.expanduser().absolute()
    if not path.is_file():
        print("ERROR: PDF not found:", path, flush=True)
        return 2

    # Match production startup before importing Samsung Chat's configuration.
    from dotenv import load_dotenv
    load_dotenv(root / ".env", override=False)

    from news_scrapper.internal_content.document_parser import parse_document

    data = path.read_bytes()
    print("Input:", path.name, flush=True)
    print("Bytes:", len(data), flush=True)
    print("Extraction mode: offline only", flush=True)
    try:
        parsed = parse_document(path.name, "application/pdf", data)
    except Exception as error:
        print("PARSER FAILED:", type(error).__name__, str(error)[:350], flush=True)
        print("An unreadable PDF can still be saved through service.import_document.",
              flush=True)
        return 1

    text = str(parsed.get("text") or "")
    method = parsed.get("extraction_method", "unknown")
    print("Pages:", parsed.get("page_count"), flush=True)
    print("Extraction method:", method, flush=True)
    print("Extracted characters:", len(text), flush=True)
    if parsed.get("extraction_warning"):
        print("Extraction warning:", parsed["extraction_warning"], flush=True)

    if len(text.strip()) < 60:
        print("FAILED: PDF produced insufficient extractable text.", flush=True)
        return 1
    if args.expected_ocr and method != "docling_rapidocr":
        print("FAILED: Expected local Docling RapidOCR, got:", method, flush=True)
        return 1

    # Text only written on user PC, not printed to terminal.
    outdir = root / "pdf_diagnostics" / "pipeline_smoke"
    outdir.mkdir(parents=True, exist_ok=True)
    output = outdir / (path.stem + "_extracted.txt")
    output.write_text(text, encoding="utf-8")
    print("Extracted text saved locally:", output, flush=True)

    if args.with_summary:
        from news_scrapper.internal_content.document_summarizer import summarize_document
        from news_scrapper.adapters import samsung_chat as chat
        configured = all((chat.URL, chat.CLIENT, chat.TOKEN, chat.MODEL_ID))
        print("Samsung Chat configured:", bool(configured), flush=True)
        print("Summarizing through Samsung Chat -> local BART...", flush=True)
        try:
            summary, engine = summarize_document(text, 300)
        except Exception as error:
            print("SUMMARY FAILED:", type(error).__name__, str(error)[:350], flush=True)
            return 1
        print("SUMMARY ENGINE:", engine, flush=True)
        print(f"DESCRIPTION ({len(summary)} / 300 characters):", summary, flush=True)
        if len(summary) > 300 or engine not in ("samsung_chat", "bart"):
            return 1
        (outdir / (path.stem + "_summary.json")).write_text(
            json.dumps({"engine": engine, "description": summary}, indent=2),
            encoding="utf-8",
        )
    print("PASS: Sampark parser pipeline succeeded.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
