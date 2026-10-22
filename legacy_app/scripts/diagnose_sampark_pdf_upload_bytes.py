#!/usr/bin/env python3
r"""Compare EXACT PDF bytes uploaded to Sampark with the CLI test file.

READ-ONLY. File contents are only inspected locally, never uploaded,
printed, or included in logs. This script changes no source files.

Run from C:\scrappyV3:
  .\venv\Scripts\python.exe -u .\scripts\diagnose_sampark_pdf_upload_bytes.py --source "C:\Users\s.vineet\Downloads\MD Message.pdf" --saved-name "31767c0aa97a40f5aa4072eb103ac004.pdf"
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path


def fingerprint(label: str, path: Path) -> bytes | None:
    print(f"\n=== {label} ===", flush=True)
    print("Path:", path, flush=True)
    try:
        data = path.read_bytes()
    except OSError as exc:
        print("ERROR: Cannot read bytes:", type(exc).__name__, str(exc), flush=True)
        return None
    print("Size:", len(data), "bytes", flush=True)
    print("SHA-256:", hashlib.sha256(data).hexdigest(), flush=True)
    print("First 24 bytes (HEX):", data[:24].hex(" "), flush=True)
    first_header = data.find(b"%PDF-")
    print("Starts with %PDF-:", data.startswith(b"%PDF-"), flush=True)
    print("%PDF- offset in full file:", first_header, flush=True)
    print("%PDF- within first 1 MiB:", 0 <= first_header < 1024 * 1024, flush=True)
    print("Contains %%EOF:", b"%%EOF" in data, flush=True)
    try:
        from news_scrapper.internal_content.document_parser import _signature_matches
        print("ACTUAL Sampark PDF signature check:", _signature_matches("pdf", data),
              flush=True)
    except Exception as exc:
        print("Cannot import Sampark's signature validator:", type(exc).__name__,
              str(exc)[:200], flush=True)
    return data


def comparison(left: bytes, right: bytes) -> None:
    print("\n=== Byte-for-byte comparison ===", flush=True)
    same = left == right
    print("Identical bytes:", same, flush=True)
    print("Size delta (saved minus source):", len(right) - len(left), "bytes",
          flush=True)
    if same:
        return
    same_prefix = 0
    for x, y in zip(left, right):
        if x != y:
            break
        same_prefix += 1
    same_suffix = 0
    for x, y in zip(reversed(left), reversed(right)):
        if x != y or same_suffix >= min(len(left), len(right)) - same_prefix:
            break
        same_suffix += 1
    print("Identical starting bytes:", same_prefix, flush=True)
    print("Identical ending bytes:", same_suffix, flush=True)
    print("First different byte offset:", same_prefix, flush=True)
    if same_prefix == 0:
        print("The two files differ at the first byte, including the header.", flush=True)
    elif len(right) != len(left) and same_prefix == len(left):
        print("The saved file contains additional trailing bytes.", flush=True)
    elif len(right) != len(left) and same_prefix == len(right):
        print("The saved file is truncated relative to the source.", flush=True)
    else:
        print("The source and saved PDF differ internally; do not assume same file.",
              flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True,
                        help="Original file used by the successful CLI extraction test")
    parser.add_argument("--saved-name", required=True,
                        help="source_document.file from failing Sampark import JSON")
    args = parser.parse_args()
    if not args.saved_name.endswith(".pdf") or Path(args.saved_name).name != args.saved_name:
        parser.error("--saved-name must be a bare PDF filename, not a path")

    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    try:
        from news_scrapper.internal_content import storage
    except Exception as exc:
        print("ERROR: Cannot resolve Sampark originals directory:",
              type(exc).__name__, str(exc), flush=True)
        return 2
    stored_path = storage.ORIGINALS_DIR / args.saved_name
    print("Sampark originals folder:", storage.ORIGINALS_DIR, flush=True)
    print("Script is read-only. PDF contents are not printed or sent anywhere.",
          flush=True)

    source = fingerprint("Original CLI file", args.source.expanduser().absolute())
    saved = fingerprint("Saved Sampark upload", stored_path)
    if source is None or saved is None:
        print("\nOne or both files were not readable. Check server storage paths "
              "and enterprise access permissions.", flush=True)
        return 2
    comparison(source, saved)
    source_signature = b"%PDF-" in source[:1024 * 1024]
    saved_signature = b"%PDF-" in saved[:1024 * 1024]
    print("\n=== Diagnostic conclusion ===", flush=True)
    if source_signature and not saved_signature:
        print("The original is a recognizable PDF, but the saved upload is NOT. "
              "The uploaded bytes were different from the successful CLI test. "
              "Inspect the browser's selected file and any enterprise file "
              "wrapping before altering Docling.", flush=True)
    elif source_signature and saved_signature:
        print("Both are recognizable PDFs. If Sampark said the signature was "
              "missing, investigate the actual running server/parser versions "
              "and the route's request bytes.", flush=True)
    elif not source_signature:
        print("The current source path also lacks a recognizable PDF header; "
              "it may have changed since the earlier successful CLI run.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
