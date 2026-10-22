#!/usr/bin/env python3
r"""Safely merge the tested Sampark PDF extractor into a newer local PC tree.

Does not overwrite entire parser/service/router files with older GitHub copies.
Checks anchors, checks Python syntax, and creates backups before modifications.

Copy these NEW files into C:\scrappyV3 first:
  news_scrapper/internal_content/pdf_extraction_pipeline.py
  scripts/sampark_docling_worker.py
  scripts/test_sampark_pdf_import_pipeline.py

Preview without writing:
  & ".\venv\Scripts\python.exe" ".\scripts\apply_sampark_pdf_extraction_upgrade.py"

Apply with backups:
  & ".\venv\Scripts\python.exe" ".\scripts\apply_sampark_pdf_extraction_upgrade.py" --apply

This helper NEVER changes .env, Samsung Chat, local BART, or the frontend.
If your local files have evolved beyond these known anchors, it fails closed
rather than guessing. It only edits three expected backend functions/files.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path


def require_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError("Cannot safely merge " + label + " (expected code not present).")
    if text.count(old) != 1:
        raise RuntimeError("Cannot safely merge " + label + " (anchor appears more than once).")
    return text.replace(old, new, 1)


def patch_parser(original: str) -> str:
    if "def extract_pdf_details(" in original:
        print("  document_parser.py: integration already present", flush=True)
        return original

    changed = require_replace(
        original,
        "def extract_pdf(data: bytes, filename: str) -> tuple[str, int | None]:",
        "def _extract_pdf_legacy(data: bytes, filename: str) -> tuple[str, int | None]:",
        "document_parser.py: legacy function name",
    )
    wrapper = '''def extract_pdf_details(data: bytes, filename: str) -> tuple[str, int | None, str]:
    """Offline Docling/RapidOCR, then PyMuPDF/pypdf/pdfplumber fallbacks."""
    from .pdf_extraction_pipeline import extract_pdf_with_fallbacks
    return extract_pdf_with_fallbacks(
        data, filename,
        legacy_extract=_extract_pdf_legacy,
        max_pages=PDF_MAX_PAGES,
        max_chars=EXTRACT_MAX_CHARS,
    )


def extract_pdf(data: bytes, filename: str) -> tuple[str, int | None]:
    """Keep the existing two-item return contract for other callers."""
    text, page_count, _method = extract_pdf_details(data, filename)
    return text, page_count


'''
    changed = require_replace(
        changed, "\ndef extract_docx(", "\n" + wrapper + "def extract_docx(",
        "document_parser.py: insertion point",
    )
    changed = require_replace(
        changed,
        "        text, page_count = extract_pdf(data, filename)\n",
        '''        text, page_count, extraction_method = extract_pdf_details(data, filename)
        if sum(char.isalnum() for char in text) < MIN_READABLE_CHARS:
            text = ""
            if extraction_method != "too_many_pages":
                extraction_method = "unavailable"
''',
        "document_parser.py: PDF parse call",
    )
    changed = require_replace(
        changed,
        "        text, page_count = extract_docx(data, filename)\n",
        "        text, page_count = extract_docx(data, filename)\n        extraction_method = \"python-docx\"\n",
        "document_parser.py: DOCX parse call",
    )
    marker = re.search(r'(?m)^([ \t]{8}"paragraphs":\s*\[part for part in text.split\([^\n]+\],\n)', changed)
    if marker is None:
        raise RuntimeError("Cannot safely merge document_parser.py: parsed response shape differs.")
    extra = '''        "extraction_method": extraction_method,
        "extraction_warning": (
            "The document exceeds the 500-page automatic extraction limit."
            if extraction_method == "too_many_pages"
            else "No readable text could be extracted; the original PDF was preserved."
            if kind == "pdf" and not text else None
        ),
'''
    changed = changed[:marker.end()] + extra + changed[marker.end():]
    return changed


def patch_service(original: str) -> str:
    # The service might already contain error-preserving PDF logic; don't
    # overwrite it without a careful manual merge in that situation.
    if ('"extraction_method": parsed.get(' in original
            and 'parsed = parse_document(' in original
            and '"extraction_warning":' in original):
        print("  service.py: extraction metadata already present", flush=True)
        return original
    changed = require_replace(
        original,
        "    parse_document,\n)",
        "    parse_document,\n    validate_document_upload,\n    detect_title,\n)",
        "service.py: import list",
    )
    changed = require_replace(
        changed,
        "    parsed = parse_document(filename, declared_type, data)\n",
        '''    kind = validate_document_upload(filename, declared_type, len(data))
    try:
        parsed = parse_document(filename, declared_type, data)
    except ContributionError as error:
        if kind != "pdf":
            raise
        # Preserve an unreadable ORIGINAL PDF without misreporting extraction.
        parsed = {
            "text": "", "page_count": None, "character_count": 0,
            "detected_title": detect_title("", filename),
            "paragraphs": [], "extraction_method": "unavailable",
            "extraction_warning": str(error)[:300],
        }
''',
        "service.py: import parser call",
    )
    changed = require_replace(
        changed,
        '                "extracted_characters": parsed["character_count"],\n',
        '''                "extracted_characters": parsed["character_count"],
                "extraction_method": parsed.get("extraction_method", "unknown"),
                "extraction_status": "available" if parsed["text"].strip() else "unavailable",
                "extraction_warning": parsed.get("extraction_warning"),
''',
        "service.py: source_document metadata",
    )
    return changed


def patch_router(original: str) -> str:
    if "from .document_summarizer import summarize_document" not in original:
        raise RuntimeError(
            "Your newer router.py does not contain the tested Samsung Chat/BART "
            "summary import. We cannot safely infer its structure; preserve "
            "the PC copy and compare it manually."
        )
    if "await asyncio.to_thread(\n            service.import_document" in original:
        print("  router.py: extraction already runs off the event loop", flush=True)
        return original
    target = '''        record = service.import_document(
            owner_id,
            filename,
            declared_type,
            data,
            {"owner_name": owner_name, "content_type": content_type},
        )'''
    replacement = '''        record = await asyncio.to_thread(
            service.import_document,
            owner_id,
            filename,
            declared_type,
            data,
            {"owner_name": owner_name, "content_type": content_type},
        )'''
    return require_replace(original, target, replacement, "router.py: import call")


def main() -> int:
    args_parser = argparse.ArgumentParser(description=__doc__)
    args_parser.add_argument("--apply", action="store_true",
                             help="Modify local PC files after preflight checks + backups")
    args = args_parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    checks = [
        root / "news_scrapper" / "internal_content" / "pdf_extraction_pipeline.py",
        root / "scripts" / "sampark_docling_worker.py",
        root / "scripts" / "test_sampark_pdf_import_pipeline.py",
    ]
    missing = [str(p) for p in checks if not p.is_file()]
    if missing:
        print("STOP: copy all three NEW files before running this patch:\n  "
              + "\n  ".join(missing))
        return 2
    targets = {
        root / "news_scrapper" / "internal_content" / "document_parser.py": patch_parser,
        root / "news_scrapper" / "internal_content" / "service.py": patch_service,
        root / "news_scrapper" / "internal_content" / "router.py": patch_router,
    }
    planned = {}
    print("Sampark PDF upgrade:", "APPLY" if args.apply else "DRY RUN")
    for file, patch in targets.items():
        try:
            source = file.read_text(encoding="utf-8")
            result = patch(source)
            compile(result, str(file), "exec")
            planned[file] = (source, result)
            print("CHECK", file.relative_to(root),
                  ": CHANGE" if result != source else ": unchanged")
        except (OSError, SyntaxError, RuntimeError) as error:
            print("STOP: local files were NOT modified:", error)
            return 2
    changed = [(file, old, new) for file, (old, new) in planned.items() if old != new]
    if not changed:
        print("No additional patch required.")
        return 0
    if not args.apply:
        print("\nPreflight passed; originals untouched. Run again with --apply.")
        return 0

    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = root / "pdf_upgrade_backups" / stamp
    try:
        backup.mkdir(parents=True, exist_ok=False)
        for file, _old, _new in changed:
            rel = file.relative_to(root)
            target = backup / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)
        print("Backups saved:", backup)
    except OSError as error:
        print("STOP: could not create backups:", error)
        return 2

    updated = []
    try:
        for file, _old, new in changed:
            temp_name = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w", encoding="utf-8", newline="",
                    suffix=".py", prefix=".sampark-upgrade-",
                    dir=file.parent, delete=False,
                ) as stream:
                    temp_name = stream.name
                    stream.write(new)
                os.replace(temp_name, file)
                updated.append(file)
            finally:
                if temp_name and Path(temp_name).exists():
                    Path(temp_name).unlink(missing_ok=True)
    except OSError as error:
        print("ERROR while writing; restoring touched files:", error)
        for file in updated:
            shutil.copy2(backup / file.relative_to(root), file)
        return 2

    print("\nUpgrade applied with backups. Run:")
    print(r'  & ".\venv\Scripts\python.exe" -m compileall -q news_scrapper\internal_content')
    print(r'  & ".\venv\Scripts\python.exe" -u ".\scripts\test_sampark_pdf_import_pipeline.py" ".\docling_tests\sampark_ocr_scan_test.pdf" --expected-ocr')
    print("Restart Uvicorn only AFTER both checks pass.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
