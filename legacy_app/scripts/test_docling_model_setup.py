#!/usr/bin/env python3
"""Test Docling PDF extraction with cached or freshly downloaded local models.

READ-ONLY with respect to the input PDF and existing model caches.
Does not use Samsung Chat, BART, or the Sampark backend.

Run with C:\scrappyV3\.docling-venv\Scripts\python.exe

Examples (PowerShell, from C:\scrappyV3):
  & ".\.docling-venv\Scripts\python.exe" ".\scripts\test_docling_model_setup.py" --inspect --hf-home "C:\Users\s.vineet\.cache\huggingface"
  & ".\.docling-venv\Scripts\python.exe" ".\scripts\test_docling_model_setup.py" --pdf ".\MD Message.pdf" --hf-home "C:\Users\s.vineet\.cache\huggingface"
  & ".\.docling-venv\Scripts\python.exe" ".\scripts\test_docling_model_setup.py" --pdf ".\MD Message.pdf" --download
  & ".\.docling-venv\Scripts\python.exe" ".\scripts\test_docling_model_setup.py" --pdf ".\MD Message.pdf" --download --use-public-hf

--download attempts Docling's official model prefetch via the currently
configured Hugging Face endpoint (Samsung mirror, if HF_ENDPOINT is set).
--use-public-hf removes the mirror setting; ONLY use when your company
permits downloading from public Hugging Face. No DRM bypass is attempted.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import subprocess
import sys
import traceback
from pathlib import Path


def project_root() -> Path:
    parent = Path(__file__).resolve().parent
    return parent.parent if parent.name.lower() == "scripts" else parent


def inspect_cache(hf_home: Path) -> None:
    print("\nHugging Face cache parent:", hf_home, flush=True)
    hub = Path(os.environ.get("HF_HUB_CACHE", str(hf_home / "hub")))
    print("Hugging Face hub:", hub, flush=True)
    if not hub.is_dir():
        print("No hub directory found at that path.", flush=True)
        return
    folders = sorted(hub.glob("models--*"))
    print("Model repository folders:", len(folders), flush=True)
    for folder in folders[:40]:
        snaps = folder / "snapshots"
        snapshots = [p for p in snaps.iterdir() if p.is_dir()] if snaps.is_dir() else []
        # Count readable files, not just placeholder names.
        candidates = [p for snap in snapshots for p in snap.rglob("*")
                      if p.is_file() and p.suffix in {".safetensors", ".bin", ".onnx"}]
        print(f"  {folder.name}: snapshots={len(snapshots)}, weight_files={len(candidates)}",
              flush=True)
    if len(folders) > 40:
        print(f"  ... {len(folders) - 40} more folders", flush=True)
    print("Folder names alone do NOT confirm all Docling artifacts are present.",
          flush=True)


def prefetch_models(directory: Path, output: Path, use_public_hf: bool) -> bool:
    command_tool = Path(sys.executable).with_name("docling-tools.exe")
    if not command_tool.is_file():
        print("ERROR: docling-tools.exe is missing from:", command_tool.parent)
        return False
    directory.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.pop("HF_HUB_OFFLINE", None)
    env["HF_HUB_DISABLE_XET"] = "1"  # Try normal HTTP instead of Xet token route.
    if use_public_hf:
        env.pop("HF_ENDPOINT", None)
        print("Download source: public Hugging Face (explicitly selected)", flush=True)
    else:
        print("Download source:",
              env.get("HF_ENDPOINT", "default Hugging Face endpoint"), flush=True)
    cmd = [str(command_tool), "models", "download",
           "layout", "tableformer", "rapidocr", "-o", str(directory)]
    log = output / "model_download.log"
    print("Downloading selected Docling models to:", directory, flush=True)
    print("The model download can be large; details will be logged to:", log,
          flush=True)
    with log.open("w", encoding="utf-8") as stream:
        stream.write("Command: docling-tools models download layout tableformer rapidocr\n")
        stream.write("HF_HUB_DISABLE_XET=1\n")
        stream.write("Source: " + ("public" if use_public_hf else "configured endpoint") + "\n")
        stream.flush()
        try:
            completed = subprocess.run(cmd, stdout=stream, stderr=subprocess.STDOUT,
                                       env=env, cwd=str(project_root()), check=False)
        except OSError as error:
            print("Download command could not start:", type(error).__name__, str(error))
            return False
    if completed.returncode:
        print("Model download failed, exit code:", completed.returncode, flush=True)
        try:
            tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-15:]
            print("Recent error output:\n" + "\n".join(tail), flush=True)
        except OSError:
            pass
        return False
    print("Model downloader exited successfully.", flush=True)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pdf", type=Path, help="Readable local PDF to test")
    parser.add_argument("--hf-home", type=Path,
                        help="PARENT of your 'hub' folder; never the hub folder itself")
    parser.add_argument("--artifacts-dir", type=Path,
                        help="Docling artifacts directory created by docling-tools")
    parser.add_argument("--inspect", action="store_true",
                        help="Print cached model folder names without running Docling")
    parser.add_argument("--download", action="store_true",
                        help="Download Docling layout/table/OCR models before test")
    parser.add_argument("--use-public-hf", action="store_true",
                        help="Use public Hugging Face instead of configured corporate mirror")
    parser.add_argument("--no-ocr", action="store_true",
                        help="Test layout extraction without OCR models")
    args = parser.parse_args()

    if args.use_public_hf and not args.download:
        parser.error("--use-public-hf requires --download")
    if not args.pdf and not args.inspect:
        parser.error("Provide --pdf for extraction or --inspect for cache inspection")

    root = project_root()
    output = root / "docling_tests"
    output.mkdir(parents=True, exist_ok=True)
    hf_home = (args.hf_home.expanduser().absolute() if args.hf_home
               else Path(os.environ.get("HF_HOME",
                                      str(Path.home() / ".cache" / "huggingface"))))
    # Set environment before importing Docling or huggingface_hub.
    if args.hf_home:
        os.environ["HF_HOME"] = str(hf_home)
        os.environ.pop("HF_HUB_CACHE", None)
        os.environ.pop("HUGGINGFACE_HUB_CACHE", None)

    print("Python:", sys.executable, flush=True)
    print("HF_ENDPOINT:", os.environ.get("HF_ENDPOINT", "[default]"), flush=True)
    inspect_cache(hf_home)

    if args.inspect and not args.pdf and not args.download:
        return 0

    artifacts = (args.artifacts_dir.expanduser().absolute() if args.artifacts_dir
                 else root / ".docling-models")
    if args.download:
        if not prefetch_models(artifacts, output, args.use_public_hf):
            print("No PDF conversion attempted because prefetch did not finish.",
                  flush=True)
            return 2

    if not args.pdf:
        return 0
    pdf = args.pdf.expanduser().absolute()
    if not pdf.is_file():
        print("ERROR: PDF missing:", pdf, flush=True)
        return 2

    # Cached-only conversion: no model download requests, including mirror.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    print("\nDocling conversion is OFFLINE: no model download request.", flush=True)
    print("PDF:", pdf, flush=True)

    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption

        # A docling-tools artifacts folder is NOT the same as HF_HOME/hub.
        # If none was supplied and nothing was downloaded, leave the path
        # unset so Docling can try its normal (offline) cached model lookup.
        explicit_artifacts = bool(args.artifacts_dir or args.download)
        options = (PdfPipelineOptions(artifacts_path=artifacts)
                   if explicit_artifacts else PdfPipelineOptions())
        if args.no_ocr:
            options.do_ocr = False
        if explicit_artifacts:
            print("Docling artifacts_path:", artifacts, flush=True)
        else:
            print("Docling artifacts_path: default (HF/Docling caches)", flush=True)

        converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
        )
        result = converter.convert(str(pdf))
        extracted = result.document.export_to_markdown()
        if not extracted.strip():
            print("FAILED: Docling returned empty text.", flush=True)
            return 1
        filename = "".join(c if c.isalnum() or c in "-_" else "_" for c in pdf.stem)
        destination = output / (filename[:70] + "_docling_extracted.md")
        destination.write_text(extracted, encoding="utf-8")
        print("\nSUCCESS: Docling extracted", f"{len(extracted):,}", "characters.",
              flush=True)
        print("Text file:", destination, flush=True)
        return 0
    except Exception as error:
        stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        failure_log = output / ("docling_failure_" + stamp + ".log")
        failure_log.write_text(traceback.format_exc(), encoding="utf-8")
        print("\nDOCLING FAILED:", type(error).__name__, str(error), flush=True)
        print("Detailed error:", failure_log, flush=True)
        print("If the error is a missing model, use --download; if it is an",
              "Artifactory 404, inspect model_download.log.", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
