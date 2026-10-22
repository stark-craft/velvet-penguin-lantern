#!/usr/bin/env python3
"""Sampark PDF diagnosis V3: independent parsers, optional OCR, reproducible logs.

Standalone ONLY. It does not modify Sampark, use the Samsung Chat API, upload
files, decrypt enterprise DRM, or change the original PDF.

Run with your real NewsScrapper venv (from C:\\scrappyV3):

    & ".\\venv\\Scripts\\python.exe" -u ".\\scripts\\sampark_pdf_extraction_diagnostic.py" "C:\\path\\problem.pdf"

If Docling and pdfplumber are installed in .docling-venv, that is discovered
and used ONLY for those engines, avoiding changes to NewsScrapper's venv.
Add --ocr to attempt OCR if regular extraction is inadequate.
Add --ask-password only for a PDF you are authorized to open.
See --help for all options.
"""
from __future__ import annotations

import argparse
import datetime as dt
import getpass
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

LOG = logging.getLogger("sampark_pdf_diagnostic")
MIN_USEFUL_CHARS = 60


def _safe_error(error: BaseException) -> str:
    """Do not expose credentials that might be embedded in an exception."""
    msg = f"{type(error).__name__}: {str(error)}"
    msg = re.sub(r"(?i)(token|password|api_key|secret)=([^\s&]+)", r"\1=[REDACTED]", msg)
    msg = re.sub(r"(?i)(Authorization: Bearer\s+)[^\s]+", r"\1[REDACTED]", msg)
    return msg[:2500]


def _truncate_for_preview(value: str, limit: int = 500) -> str:
    # The command line and shared logs should never print document text.
    return str(value or "")[:limit]


def _log_setup(directory: Path) -> None:
    LOG.setLevel(logging.INFO)
    LOG.handlers.clear()
    formatter = logging.Formatter("%(asctime)s | %(levelname)-7s | %(message)s")
    file_handle = logging.FileHandler(directory / "diagnostic.log", encoding="utf-8")
    file_handle.setFormatter(formatter)
    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(formatter)
    LOG.addHandler(file_handle)
    LOG.addHandler(stream)


def _modules_check(python: str, modules: list[str]) -> list[str]:
    # This test does not import heavy model weights; find_spec only.
    snippet = (
        "import importlib.util,json;"
        "print(json.dumps({x:importlib.util.find_spec(x) is not None "
        "for x in " + repr(modules) + "}))"
    )
    try:
        result = subprocess.run(
            [python, "-c", snippet], capture_output=True, text=True,
            timeout=25, encoding="utf-8", errors="replace",
        )
        # Some libraries may output ancillary startup info; consume last JSON line.
        for line in reversed(result.stdout.splitlines()):
            try:
                parsed = json.loads(line)
            except ValueError:
                continue
            return [x for x in modules if parsed.get(x)]
    except Exception as exc:
        LOG.warning("Module check for %s failed: %s", python, _safe_error(exc))
    return []


def _python_path(value: str | None) -> str | None:
    if not value:
        return None
    candidate = Path(value).expanduser()
    if candidate.is_file():
        return str(candidate.resolve())
    return shutil.which(value)


def _venv_python(root: Path, env: str) -> str | None:
    return _python_path(str(root / env / "Scripts" / "python.exe")) or _python_path(
        str(root / env / "bin" / "python")
    )


def _project_root(script: Path) -> Path:
    parent = script.parent
    if parent.name.casefold() == "scripts":
        return parent.parent
    return parent


def _pdf_header(path: Path) -> dict:
    # Hash the exact same original bytes the child extractors will read.
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        first = stream.read(1024 * 1024)
        stream.seek(0)
        while True:
            block = stream.read(4 * 1024 * 1024)
            if not block:
                break
            digest.update(block)
    pos = first.find(b"%PDF-")
    pdf_header_at_start = first.startswith(b"%PDF-")
    return {
        "filename": path.name,
        "bytes": path.stat().st_size,
        "sha256": digest.hexdigest(),
        "first_16_bytes_hex": first[:16].hex(),
        "pdf_header_offset_first_megabyte": pos,
        "header_at_byte_zero": pdf_header_at_start,
        "looks_like_pdf": pos >= 0,
        "has_eof_marker_in_first_megabyte": b"%%EOF" in first,
        "zero_byte_count_first_4096": first[:4096].count(b"\x00"),
    }


def _candidate_pages(count: int, max_pages: int) -> list[int]:
    if max_pages <= 0 or max_pages >= count:
        return list(range(count))
    # Include first, middle, and last even when sample OCR is limited.
    picks = {0, count - 1, count // 2}
    if max_pages == 1:
        return [0]
    if max_pages == 2:
        return sorted({0, count - 1})
    for i in range(max_pages):
        picks.add(round(i * (count - 1) / max(1, max_pages - 1)))
    return sorted(picks)[:max_pages]


def _useful_text(text: str) -> bool:
    return len(re.findall(r"[^\W_]", text, flags=re.UNICODE)) >= MIN_USEFUL_CHARS


def _worker(args: argparse.Namespace) -> int:
    """Child process: one engine per process, to isolate bad PDFs and timeouts."""
    source = Path(args.pdf)
    out = Path(args.worker_out)
    status_file = Path(args.worker_status)
    kind = args.worker
    password = os.environ.get("SAMPARK_PDF_TEST_PASSWORD") or None
    report = {"engine": kind, "status": "failed", "elapsed_sec": 0.0}
    t0 = time.monotonic()
    chunks: list[str] = []
    seen_pages = 0
    page_count = None
    encrypted = None
    authenticated = False

    def _append(text: str, number: int | None = None) -> None:
        nonlocal seen_pages
        if text and text.strip():
            prefix = f"\n\n--- PAGE {number} ---\n" if number is not None else "\n"
            chunks.append(prefix + text)
            seen_pages += 1

    def _auth_fitz(document):
        nonlocal encrypted, authenticated
        encrypted = bool(document.needs_pass)
        if document.needs_pass:
            if not password or not document.authenticate(password):
                raise PermissionError("ENCRYPTED_OR_PASSWORD_REQUIRED: authorized PDF password needed")
            authenticated = True

    try:
        if kind == "docling":
            from docling.document_converter import DocumentConverter
            converter = DocumentConverter()
            result = converter.convert(str(source))
            text = result.document.export_to_markdown()
            _append(text)
            try:
                page_count = len(result.document.pages)
            except Exception:
                pass
        elif kind == "pymupdf":
            try:
                import pymupdf as fitz
            except ImportError:
                import fitz
            doc = fitz.open(str(source))
            try:
                _auth_fitz(doc)
                page_count = len(doc)
                for i in range(min(len(doc), args.max_pages)):
                    _append(doc[i].get_text("text", sort=True), i + 1)
            finally:
                doc.close()
        elif kind == "pdfplumber":
            import pdfplumber
            with pdfplumber.open(str(source), password=password) as doc:
                page_count = len(doc.pages)
                for i, page in enumerate(doc.pages):
                    if i >= args.max_pages:
                        break
                    _append(page.extract_text(layout=False) or "", i + 1)
        elif kind == "pypdf":
            from pypdf import PdfReader
            reader = PdfReader(str(source), strict=False)
            encrypted = bool(reader.is_encrypted)
            if reader.is_encrypted:
                if not password or not reader.decrypt(password):
                    raise PermissionError("ENCRYPTED_OR_PASSWORD_REQUIRED: authorized PDF password needed")
                authenticated = True
            page_count = len(reader.pages)
            for i in range(min(page_count, args.max_pages)):
                _append(reader.pages[i].extract_text(extraction_mode="plain") or "", i + 1)
        elif kind == "pypdfium2":
            import pypdfium2 as pdfium
            doc = pdfium.PdfDocument(str(source), password=password)
            try:
                page_count = len(doc)
                for i in range(min(len(doc), args.max_pages)):
                    page = doc[i]
                    try:
                        page_text = page.get_textpage()
                        try:
                            _append(page_text.get_text_range() or "", i + 1)
                        finally:
                            page_text.close()
                    finally:
                        page.close()
            finally:
                doc.close()
        elif kind == "pdftotext-cli":
            program = shutil.which("pdftotext")
            if not program:
                raise FileNotFoundError("pdftotext command is not on PATH")
            if password:
                raise RuntimeError("Skipping pdftotext for protected PDF: password must not appear in process arguments")
            # Invoke stdout mode: '-' prevents confusing output path inference.
            result = subprocess.run(
                [program, "-enc", "UTF-8", "-layout", "-f", "1",
                 "-l", str(args.max_pages), str(source), "-"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=args.internal_timeout,
            )
            if result.returncode != 0:
                raise RuntimeError("pdftotext exited nonzero: " + result.stderr.decode("utf-8", "replace")[:800])
            _append(result.stdout.decode("utf-8", "replace"))
        elif kind in ("pymupdf-ocr", "tesseract-ocr"):
            try:
                import pymupdf as fitz
            except ImportError:
                import fitz
            doc = fitz.open(str(source))
            try:
                _auth_fitz(doc)
                page_count = len(doc)
                indices = _candidate_pages(page_count, args.ocr_max_pages)
                report["ocr_page_numbers"] = [p + 1 for p in indices]
                report["partial_ocr"] = len(indices) < page_count
                if kind == "tesseract-ocr":
                    import pytesseract
                    from PIL import Image
                    if not shutil.which("tesseract") and not Path(pytesseract.pytesseract.tesseract_cmd).is_file():
                        raise FileNotFoundError("Tesseract executable not installed / not on PATH")
                for i in indices:
                    page = doc[i]
                    if kind == "pymupdf-ocr":
                        tp = page.get_textpage_ocr(language=args.ocr_language, dpi=args.ocr_dpi, full=True)
                        text = page.get_text("text", textpage=tp)
                    else:
                        pix = page.get_pixmap(matrix=fitz.Matrix(args.ocr_dpi / 72, args.ocr_dpi / 72), alpha=False)
                        image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                        text = pytesseract.image_to_string(image, lang=args.ocr_language, config="--psm 3")
                    _append(text, i + 1)
                    print(f"OCR_PROGRESS: page {i + 1}/{page_count}; chars={len(text)}", flush=True)
            finally:
                doc.close()
        else:
            raise ValueError("Unknown extraction worker: " + kind)

        text = "\n".join(chunks).strip()
        # This file contains confidential document text; never print it.
        out.write_text(text, encoding="utf-8", errors="replace")
        useful_chars = len(re.findall(r"[^\W_]", text, flags=re.UNICODE))
        report.update({
            "status": "success" if _useful_text(text) else "low_or_empty_text",
            "characters": len(text), "useful_characters": useful_chars,
            "pages": page_count, "pages_with_text": seen_pages,
            "encrypted": encrypted, "password_authenticated": authenticated,
            "words": len(text.split()),
            "source_output": out.name,
        })
    except Exception as exc:
        report.update({"status": "failed", "error": _safe_error(exc),
                       "error_type": type(exc).__name__, "encrypted": encrypted,
                       "password_authenticated": authenticated})
        print("WORKER_ERROR:", _safe_error(exc), file=sys.stderr, flush=True)
        # A truncated traceback helps diagnose library internals without dumping documents.
        print("TRACEBACK_TAIL:\n" + "".join(traceback.format_exception(exc))[-3500:],
              file=sys.stderr, flush=True)
    finally:
        report["elapsed_sec"] = round(time.monotonic() - t0, 2)
        status_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if report["status"] == "success" else 2


def _run_stage(
    name: str, interpreter: str, source: Path, base: Path,
    timeout: int, args: argparse.Namespace, password: str | None,
) -> dict:
    out_text = base / f"engine_{name}.txt"
    out_json = base / f"engine_{name}.json"
    env = os.environ.copy()
    if password:
        # Avoid exposing an authorized password in process arguments or logs.
        env["SAMPARK_PDF_TEST_PASSWORD"] = password
    # Avoid 24-hour HF retries from the original script.
    env.setdefault("HF_HUB_ETAG_TIMEOUT", "20")
    env.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "30")
    command = [interpreter, "-u", str(Path(__file__).resolve()), str(source),
               "--worker", name, "--worker-out", str(out_text),
               "--worker-status", str(out_json),
               "--max-pages", str(args.max_pages),
               "--ocr-max-pages", str(args.ocr_max_pages),
               "--ocr-dpi", str(args.ocr_dpi), "--ocr-language", args.ocr_language,
               "--internal-timeout", str(timeout - 8 if timeout > 12 else timeout)]
    LOG.info("START %-17s | python=%s | timeout=%ss", name, interpreter, timeout)
    begin = time.monotonic()
    try:
        p = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env=env, cwd=str(base))
        try:
            stdout, stderr = p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            p.kill()
            stdout, stderr = p.communicate()
            result = {"engine": name, "status": "timeout", "elapsed_sec": round(time.monotonic()-begin, 1),
                      "error": f"Worker exceeded {timeout}s; killed; next extractor will be tried"}
            LOG.warning("TIMEOUT %s after %ss", name, timeout)
            (base / f"engine_{name}_stderr_tail.log").write_bytes(stderr[-8192:])
            return result
        stdout_text = stdout.decode("utf-8", "replace")
        stderr_text = stderr.decode("utf-8", "replace")
        (base / f"engine_{name}_stdout_tail.log").write_text(stdout_text[-16000:], encoding="utf-8")
        (base / f"engine_{name}_stderr_tail.log").write_text(stderr_text[-16000:], encoding="utf-8")
        for line in stdout_text.splitlines():
            if line.startswith("OCR_PROGRESS:"):
                LOG.info("%s | %s", name, line)
        if out_json.exists():
            try:
                result = json.loads(out_json.read_text(encoding="utf-8"))
            except ValueError as exc:
                result = {"engine": name, "status": "crashed", "error": _safe_error(exc)}
        else:
            result = {"engine": name, "status": "crashed", "error": f"No JSON result; exit={p.returncode}"}
        result["return_code"] = p.returncode
        status = result.get("status", "unknown")
        if status == "success":
            LOG.info("PASS  %-17s | chars=%s words=%s pages=%s elapsed=%ss",
                     name, result.get("characters"), result.get("words"),
                     result.get("pages"), result.get("elapsed_sec"))
        else:
            message = str(result.get("error", "not enough readable text"))
            if name == "docling" and ("xet-read-token" in message or "404" in message):
                message += " | Likely Docling model mirror/artifact issue, not proof PDF is unreadable."
            LOG.warning("FAIL  %-17s | %s", name, _truncate_for_preview(message))
        return result
    except Exception as exc:
        LOG.warning("PROCESS %-17s | %s", name, _safe_error(exc))
        return {"engine": name, "status": "launcher_error", "error": _safe_error(exc)}


def _choose_best(results: list[dict], base: Path) -> dict | None:
    successes = [r for r in results if r.get("status") in ("success", "low_or_empty_text")
                 and (base / f"engine_{r['engine']}.txt").exists()]
    if not successes:
        return None
    # Prefer usable extracted text, then content coverage. Docling Markdown may
    # carry extra formatting; we still preserve each engine's raw output.
    best = max(successes, key=lambda r: (r["status"] == "success",
                                         r.get("useful_characters", 0),
                                         r.get("pages_with_text", 0)))
    shutil.copyfile(base / f"engine_{best['engine']}.txt", base / "BEST_EXTRACTED_TEXT.txt")
    return best


def _run(args: argparse.Namespace) -> int:
    pdf = Path(args.pdf).expanduser().resolve()
    if not pdf.is_file():
        print(f"ERROR: File does not exist: {pdf}", file=sys.stderr)
        return 2
    if pdf.suffix.casefold() != ".pdf":
        print("WARNING: File extension isn't .pdf; diagnostic still attempts PDF parsers.")
    project = _project_root(Path(__file__).resolve())
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    simple_stem = re.sub(r"[^\w-]+", "_", pdf.stem, flags=re.UNICODE)[:45]
    base = Path(args.output_dir).expanduser().resolve() if args.output_dir else (
        project / "pdf_diagnostics" / (simple_stem + "_" + stamp)
    )
    base.mkdir(parents=True, exist_ok=True)
    _log_setup(base)
    LOG.info("SAMPARK PDF extraction diagnostic V3 / WITHOUT Sampark backend changes")
    LOG.info("Original PDF: %s", pdf)
    LOG.info("Results directory: %s", base)
    LOG.info("Original PDF will NOT be modified; no remote PDF upload will occur")
    LOG.info("Main Python: %s", sys.executable)
    LOG.info("PDF file size: %.2f MiB", pdf.stat().st_size / (1024*1024))
    preflight = _pdf_header(pdf)
    LOG.info("Signature: PDF marker offset=%s; first 16 bytes (hex)=%s",
             preflight["pdf_header_offset_first_megabyte"],
             preflight["first_16_bytes_hex"])
    LOG.info("SHA256: %s", preflight["sha256"])
    if preflight["pdf_header_offset_first_megabyte"] < 0:
        LOG.warning("No %%PDF- signature in first MiB. File may be wrapped, corrupt, protected, or not a PDF.")
    elif not preflight["header_at_byte_zero"]:
        LOG.warning("PDF marker found after byte 0: a header/preamble may confuse strict parsers.")
    if pdf.stat().st_size > 150 * 1024 * 1024:
        LOG.warning("Larger than Sampark's 150 MiB upload limit; local diagnostic can still try it.")
    (base / "file_preflight.json").write_text(json.dumps(preflight, indent=2), encoding="utf-8")
    password = getpass.getpass("Authorized PDF open password (hidden): ") if args.ask_password else None
    docling_python = _python_path(args.docling_python) or _venv_python(project, ".docling-venv")
    alt_python = _python_path(args.pdfplumber_python) or docling_python
    engine_list = [
        ("docling", docling_python or sys.executable, args.docling_timeout),
        ("pymupdf", sys.executable, args.engine_timeout),
        ("pdfplumber", alt_python or sys.executable, args.engine_timeout),
        ("pypdf", sys.executable, args.engine_timeout),
        ("pypdfium2", alt_python or sys.executable, args.engine_timeout),
        ("pdftotext-cli", sys.executable, args.engine_timeout),
    ]
    results = []
    for name, interpreter, timeout in engine_list:
        if name == "docling" and args.skip_docling:
            LOG.info("SKIP  docling | --skip-docling selected")
            continue
        if name == "pdftotext-cli" and not shutil.which("pdftotext"):
            LOG.info("SKIP  pdftotext-cli | executable not installed or not on PATH")
            continue
        module = {"docling": "docling", "pymupdf": "fitz", "pdfplumber": "pdfplumber",
                  "pypdf": "pypdf", "pypdfium2": "pypdfium2"}.get(name)
        if module and module not in _modules_check(interpreter, [module]):
            if name == "pymupdf" and "pymupdf" in _modules_check(interpreter, ["pymupdf"]):
                pass
            else:
                LOG.warning("SKIP  %-17s | package missing in %s", name, interpreter)
                results.append({"engine": name, "status": "not_installed", "python": interpreter})
                continue
        result = _run_stage(name, interpreter, pdf, base, timeout, args, password)
        result["python"] = interpreter
        results.append(result)
    adequate = any(r.get("status") == "success" for r in results)
    if args.ocr != "off" and (args.ocr == "always" or not adequate):
        LOG.info("OCR fallback needed (%s). Tesseract/recognition may require separate installation.", args.ocr)
        for name in ("pymupdf-ocr", "tesseract-ocr"):
            result = _run_stage(name, sys.executable, pdf, base, args.ocr_timeout, args, password)
            result["python"] = sys.executable
            results.append(result)
    else:
        LOG.info("OCR not required or disabled. Use --ocr always to explicitly compare OCR output.")
    best = _choose_best(results, base)
    report = {
        "file": preflight,
        "engines": results,
        "chosen_engine": best["engine"] if best else None,
        "best_output": "BEST_EXTRACTED_TEXT.txt" if best else None,
        "note": "All output stays local; original PDF unchanged; no Samsung Chat call performed.",
        "limits": {"page_limit_per_engine": args.max_pages,
                   "ocr_page_limit": args.ocr_max_pages,
                   "ocr_partial_if_more_pages": args.ocr_max_pages > 0},
    }
    (base / "SUMMARY_REPORT.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    LOG.info("---------------------------------------------")
    if best:
        LOG.info("EXTRACTION RESULT: %s", "SUCCEEDED" if best.get("status") == "success" else "PARTIAL/LOW TEXT")
        LOG.info("Best engine: %s", best["engine"])
        LOG.info("Text characters: %s", best.get("characters"))
        LOG.info("Main extracted text file: %s", base / "BEST_EXTRACTED_TEXT.txt")
    else:
        LOG.error("NO PARSER COULD EXTRACT USABLE TEXT. See logs and engine errors.")
        LOG.error("Encrypted/enterprise rights-managed PDFs may require authorized access; no bypass is attempted.")
    LOG.info("Diagnostic log: %s", base / "diagnostic.log")
    LOG.info("Structured results: %s", base / "SUMMARY_REPORT.json")
    LOG.info("Share diagnostic.log + SUMMARY_REPORT.json (review for sensitive paths), NOT PDF text or secrets.")
    return 0 if best and best.get("status") == "success" else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf", help="Local path to original failing PDF")
    parser.add_argument("--output-dir", help="Optional diagnostics output directory")
    parser.add_argument("--skip-docling", action="store_true", help="Run fallbacks without Docling")
    parser.add_argument("--docling-python", help="Python.exe from the virtual environment with Docling installed")
    parser.add_argument("--pdfplumber-python", help="Python.exe from environment with pdfplumber and pypdfium2")
    parser.add_argument("--ask-password", action="store_true", help="Prompt securely for an AUTHORIZED PDF password; never logged")
    parser.add_argument("--ocr", choices=["auto", "always", "off"], default="auto",
                        help="auto: OCR only if conventional text missing; always: compare; off: disable")
    parser.add_argument("--ocr-max-pages", type=int, default=24,
                        help="OCR first/middle/last representative pages, default 24; 0=ALL PAGES (slow)")
    parser.add_argument("--ocr-dpi", type=int, default=160, help="Rendering resolution for OCR, default 160 DPI")
    parser.add_argument("--ocr-language", default="eng", help="Tesseract language, e.g. eng or eng+kor")
    parser.add_argument("--max-pages", type=int, default=500, help="Extraction cap per parser, default 500 pages")
    parser.add_argument("--engine-timeout", type=int, default=90, help="Each regular fallback timeout seconds")
    parser.add_argument("--docling-timeout", type=int, default=180, help="Docling timeout seconds")
    parser.add_argument("--ocr-timeout", type=int, default=600, help="Each OCR engine timeout seconds")
    parser.add_argument("--worker", help=argparse.SUPPRESS)
    parser.add_argument("--worker-out", help=argparse.SUPPRESS)
    parser.add_argument("--worker-status", help=argparse.SUPPRESS)
    parser.add_argument("--internal-timeout", type=int, default=80, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.max_pages < 1 or args.ocr_max_pages < 0 or not 72 <= args.ocr_dpi <= 350:
        parser.error("max-pages >= 1, ocr-max-pages >= 0, and ocr-dpi 72..350 required")
    if min(args.engine_timeout, args.docling_timeout, args.ocr_timeout) < 10:
        parser.error("Engine timeouts must be >= 10 seconds")
    return args


if __name__ == "__main__":
    a = parse_args()
    try:
        if a.worker:
            raise SystemExit(_worker(a))
        raise SystemExit(_run(a))
    except KeyboardInterrupt:
        print("Interrupted. Existing report files, if any, remain in pdf_diagnostics.", file=sys.stderr)
        raise SystemExit(130)