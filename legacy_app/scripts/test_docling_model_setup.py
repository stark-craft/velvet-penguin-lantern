#!/usr/bin/env python3
r"""Test Docling PDF extraction with cached or freshly downloaded local models.

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
import shutil
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



def discover_tesseract(explicit: str | None) -> str | None:
    """Find system Tesseract, not Python package pytesseract."""
    locations = [
        explicit,
        os.environ.get("TESSERACT_CMD"),
        shutil.which("tesseract"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        str(project_root() / "tools" / "Tesseract-OCR" / "tesseract.exe"),
    ]
    for item in locations:
        if not item:
            continue
        candidate = shutil.which(item) or (str(Path(item)) if Path(item).is_file() else None)
        if candidate:
            return candidate
    return None


def tesseract_check(executable: str, langs: list[str]) -> bool:
    """Show installed executable and OCR languages; never download anything."""
    try:
        version = subprocess.run(
            [executable, "--version"], capture_output=True, text=True, timeout=15
        )
        print("Tesseract:", version.stdout.splitlines()[0] if version.stdout else executable,
              flush=True)
        if version.returncode != 0:
            print("ERROR: Tesseract --version returned", version.returncode, flush=True)
            return False
        probe = subprocess.run(
            [executable, "--list-langs"], capture_output=True, text=True, timeout=15
        )
        installed = {
            line.strip() for line in (probe.stdout + "\n" + probe.stderr).splitlines()
            if line.strip() and not line.startswith("List of available languages")
        }
        print("Tesseract languages:", ", ".join(sorted(installed)) or "[none]", flush=True)
        missing = [lang for lang in langs if lang not in installed]
        if missing:
            print("ERROR: Missing Tesseract language data:", ", ".join(missing), flush=True)
            print("Check the Tesseract tessdata folder and TESSDATA_PREFIX.", flush=True)
            return False
        return True
    except (OSError, subprocess.TimeoutExpired) as error:
        print("ERROR: Cannot execute Tesseract:", type(error).__name__, error, flush=True)
        return False


def generate_scanned_test_pdf(output_dir: Path) -> Path:
    """Create a genuine image-only PDF to verify OCR, not PDF text extraction."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as error:
        raise RuntimeError("Pillow is required to make the OCR test PDF") from error
    img = Image.new("RGB", (1654, 2339), "white")
    draw = ImageDraw.Draw(img)
    font = None
    for location in [
        r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\segoeui.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        if Path(location).is_file():
            font = ImageFont.truetype(location, size=56)
            break
    if font is None:
        font = ImageFont.load_default()

    lines = [
        "SAMPARK OCR VALIDATION",
        "",
        "THIS IS AN IMAGE ONLY SCANNED PDF.",
        "THERE IS NO SEARCHABLE TEXT LAYER.",
        "",
        "NEWS SCRAPPER PDF EXTRACTION TEST.",
        "DOCLING SHOULD RECOGNIZE THESE WORDS.",
        "",
        "SAMSUNG CHAT SUMMARIZES EXTRACTED TEXT.",
        "LOCAL BART IS ONLY THE FALLBACK.",
        "",
        "FINAL RECOMMENDATION:",
        "PRESERVE SOURCE PROVENANCE.",
    ]
    top = 170
    for line in lines:
        draw.text((95, top), line, font=font, fill="black")
        top += 105
    pdf = output_dir / "sampark_ocr_scan_test.pdf"
    img.save(pdf, "PDF", resolution=200.0)
    print("Generated IMAGE-ONLY OCR test PDF:", pdf, flush=True)
    return pdf



def find_rapidocr_onnx_weights(root: Path, explicit_dir: Path | None, size: str) -> dict:
    """Find compatible, locally present RapidOCR ONNX det/rec weights.

    Only accepts exact PP-OCRv6 checkpoints; do not silently pair different
    architectures or select an arbitrary .onnx file. No networking.
    """
    candidates = [
        explicit_dir,
        root / ".docling-models" / "RapidOcr",
        root / "models" / "RapidOcr",
        Path(sys.prefix) / "Lib" / "site-packages" / "rapidocr" / "models",
    ]
    found = {}
    looked = []
    for folder in candidates:
        if not folder or not folder.is_dir():
            continue
        looked.append(str(folder))
        # A cache may have an extra version/backend subdirectory.
        try:
            paths = list(folder.rglob("*.onnx"))
        except OSError:
            continue
        for kind, basename in (
            ("det", f"PP-OCRv6_det_{size}.onnx"),
            ("rec", f"PP-OCRv6_rec_{size}.onnx"),
        ):
            options = [p for p in paths if p.name.casefold() == basename.casefold()
                       and p.is_file() and p.stat().st_size > 1024]
            if options and kind not in found:
                found[kind] = str(options[0])
    print("RapidOCR model search directories:", flush=True)
    for folder in looked or ["No existing model directories found"]:
        print(" ", folder, flush=True)
    for kind in ("det", "rec"):
        print(f"RapidOCR {kind}:", found.get(kind, "MISSING"), flush=True)
    if len(found) != 2:
        print("RapidOCR needs BOTH matching PP-OCRv6 ONNX files.", flush=True)
        print("Approved prefetch command (from C:\\scrappyV3):", flush=True)
        print('  & ".\\.docling-venv\\Scripts\\docling-tools.exe" models download rapidocr '
              f'--rapidocr-backend-lang onnxruntime:en --rapidocr-model-size {size} '
              '-o ".\\.docling-models"', flush=True)
        print("The command may fail while ModelScope access is blocked; if it does, "
              "obtain the weights using an approved internal distribution.", flush=True)
    return found


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
                        help="Backward-compatible: disable OCR")
    parser.add_argument("--ocr-engine", choices=["none", "tesseract", "rapidocr"],
                        default="none",
                        help="none (default): no OCR/download; tesseract: local CLI OCR; rapidocr: may require separate models")
    parser.add_argument("--ocr-lang", default="eng",
                        help="Installed Tesseract language codes, comma-separated (default: eng)")
    parser.add_argument("--tesseract-exe", help="Full path to local tesseract.exe, if not on PATH")
    parser.add_argument("--tessdata-dir", type=Path, help="Folder containing eng.traineddata, etc.")
    parser.add_argument("--full-page-ocr", action="store_true",
                        help="OCR every page, needed to verify image-only scans")
    parser.add_argument("--rapidocr-weights-dir", type=Path,
                        help="Local directory holding BOTH RapidOCR PP-OCRv6 .onnx weights")
    parser.add_argument("--rapidocr-size", choices=["tiny", "small", "medium"],
                        default="small", help="RapidOCR detection/recognition model size")
    parser.add_argument("--make-scan", action="store_true",
                        help="Create an IMAGE-ONLY sample PDF and run OCR on it (no private documents)")
    args = parser.parse_args()

    if args.use_public_hf and not args.download:
        parser.error("--use-public-hf requires --download")
    if not args.pdf and not args.inspect and not args.make_scan:
        parser.error("Provide --pdf, --make-scan for an OCR test, or --inspect")
    if args.no_ocr and args.ocr_engine != "none":
        parser.error("Use either --no-ocr or --ocr-engine tesseract/rapidocr, not both")
    if args.make_scan and args.ocr_engine == "none":
        parser.error("--make-scan requires --ocr-engine tesseract (or rapidocr)")

    root = project_root()
    output = root / "docling_tests"
    output.mkdir(parents=True, exist_ok=True)
    # Detect an existing copied Hugging Face cache under C:\scrappyV3\models\hub
    # automatically. A Hugging Face cache MUST point HF_HOME at the parent of hub.
    local_hf_home = root / "models"
    use_local_cache = (not args.hf_home and (local_hf_home / "hub").is_dir())
    hf_home = (args.hf_home.expanduser().absolute() if args.hf_home
               else local_hf_home if use_local_cache
               else Path(os.environ.get("HF_HOME",
                                      str(Path.home() / ".cache" / "huggingface")))))
    # Set environment before importing Docling or huggingface_hub.
    if args.hf_home or use_local_cache:
        os.environ["HF_HOME"] = str(hf_home)
        os.environ.pop("HF_HUB_CACHE", None)
        os.environ.pop("HUGGINGFACE_HUB_CACHE", None)
    if use_local_cache:
        print("Found copied model cache inside scrappyV3/models/hub.", flush=True)

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

    if args.make_scan:
        try:
            pdf = generate_scanned_test_pdf(output)
        except Exception as error:
            print("Cannot generate OCR sample:", type(error).__name__, error, flush=True)
            return 2
    elif args.pdf:
        pdf = args.pdf.expanduser().absolute()
    else:
        return 0

    ocr_command = None
    languages = [x.strip() for x in args.ocr_lang.split(",") if x.strip()]
    if args.tessdata_dir:
        data_dir = args.tessdata_dir.expanduser().absolute()
        if not data_dir.is_dir():
            print("ERROR: Tesseract language data folder missing:", data_dir, flush=True)
            return 2
        os.environ["TESSDATA_PREFIX"] = str(data_dir)
    if args.ocr_engine == "tesseract":
        ocr_command = discover_tesseract(args.tesseract_exe)
        if not ocr_command:
            print("ERROR: Tesseract CLI is not installed or not found.", flush=True)
            print("Check: Get-Command tesseract; or use --tesseract-exe with the full path.", flush=True)
            print("The Python package pytesseract alone is not the Tesseract OCR engine.", flush=True)
            return 2
        if not tesseract_check(ocr_command, languages):
            return 2

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
        # Explicit selection avoids AutoOCR silently initializing RapidOCR and
        # trying the blocked modelscope.cn download.
        options.do_ocr = (args.ocr_engine != "none") and not args.no_ocr
        if args.ocr_engine == "tesseract":
            from docling.datamodel.pipeline_options import TesseractCliOcrOptions
            mode = "full_page" if (args.full_page_ocr or args.make_scan) else "default"
            options.ocr_options = TesseractCliOcrOptions(
                lang=languages,
                tesseract_cmd=ocr_command,
                mode=mode,
                path=str(args.tessdata_dir.expanduser().absolute()) if args.tessdata_dir else None,
            )
            print("Selected OCR: Tesseract CLI / mode:", mode, flush=True)
        elif args.ocr_engine == "rapidocr":
            from docling.datamodel.pipeline_options import RapidOcrOptions
            local_weights = find_rapidocr_onnx_weights(
                root,
                args.rapidocr_weights_dir.expanduser().absolute()
                if args.rapidocr_weights_dir else None,
                args.rapidocr_size,
            )
            if "det" not in local_weights or "rec" not in local_weights:
                print("STOP: RapidOCR weights missing; do NOT try an external download "
                      "during PDF conversion.", flush=True)
                return 2
            # Explicitly use the Docling RapidOCR engine, not system Tesseract.
            # Pin both model paths so RapidOCR cannot attempt a ModelScope
            # request for the models that were missing in the user's logs.
            options.ocr_options = RapidOcrOptions(
                backend="onnxruntime",
                lang=["en"],
                model_size=args.rapidocr_size,
                det_model_path=local_weights["det"],
                rec_model_path=local_weights["rec"],
                use_cls=False,
                mode="full_page" if (args.full_page_ocr or args.make_scan) else "default",
            )
            print("Selected OCR: Docling + RapidOCR (local ONNX models, no Tesseract)",
                  flush=True)
        else:
            print("Selected OCR: disabled (offline layout/text only)", flush=True)
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
        if args.make_scan:
            upper = extracted.upper()
            found = [word for word in ["SAMPARK", "OCR", "SCANNED"] if word in upper]
            print("Scanned test keywords found:", ", ".join(found), flush=True)
            if len(found) != 3:
                print("FAIL: OCR ran but did not recover all expected image-only words.", flush=True)
                return 1
            print(f"PASS: Docling + {args.ocr_engine} recovered words from an image-only PDF.", flush=True)
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
