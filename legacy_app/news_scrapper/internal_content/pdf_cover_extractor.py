"""Best-effort, fully local thumbnail extraction for SRI-D PDF imports.

Returns a JPEG preview and its origin, or None. Does not change the PDF,
its text-extraction pipeline, or record storage. Safe to ignore failures.
"""
from __future__ import annotations

import io
import logging
import warnings

from PIL import Image, ImageOps

LOG = logging.getLogger(__name__)
WIDTH = 1600
HEIGHT = 900
MAX_SCAN_PAGES = 8
MAX_CANDIDATES = 10
MAX_IMAGE_PIXELS = 40_000_000
MAX_EMBEDDED_BYTES = 25 * 1024 * 1024


def _jpeg_preview(source: Image.Image) -> bytes:
    """Fit an image into a landscape card without clipping its contents."""
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        w, h = source.size
        if w < 1 or h < 1 or w * h > MAX_IMAGE_PIXELS:
            raise ValueError("PDF image dimensions are unsupported")
        source.load()
        rgb = ImageOps.exif_transpose(source).convert("RGB")
    # Keep charts, diagrams, page content and labels fully visible.
    fitted = ImageOps.contain(rgb, (WIDTH, HEIGHT), Image.LANCZOS)
    canvas = Image.new("RGB", (WIDTH, HEIGHT), (241, 244, 249))
    canvas.paste(fitted, ((WIDTH - fitted.width) // 2, (HEIGHT - fitted.height) // 2))
    result = io.BytesIO()
    canvas.save(result, "JPEG", quality=86, optimize=True)
    return result.getvalue()


def _embedded_candidates(document) -> list[tuple[float, int, int]]:
    """Rank *displayed* PDF images, excluding likely icons and tiny logos."""
    found = set()
    ranked = []
    for page_idx in range(min(len(document), MAX_SCAN_PAGES)):
        try:
            page = document.load_page(page_idx)
            page_area = max(float(page.rect.width * page.rect.height), 1.0)
            infos = page.get_image_info(xrefs=True)
        except Exception as error:
            LOG.debug("PDF cover image scan skipped page %s: %s", page_idx + 1, type(error).__name__)
            continue
        for info in infos:
            try:
                xref = int(info.get("xref") or 0)
                iw, ih = int(info.get("width") or 0), int(info.get("height") or 0)
                if xref <= 0 or xref in found:
                    continue
                found.add(xref)
                if iw < 600 or ih < 300 or iw * ih < 350_000 or iw * ih > MAX_IMAGE_PIXELS:
                    continue
                bbox = info.get("bbox")
                if not bbox:
                    continue
                display_w = max(float(bbox[2]) - float(bbox[0]), 0.0)
                display_h = max(float(bbox[3]) - float(bbox[1]), 0.0)
                coverage = (display_w * display_h) / page_area
                if coverage < 0.065:
                    continue
                aspect = iw / ih
                score = (
                    min(coverage, 1.0) * 3.0
                    + min((iw * ih) / 2_000_000, 2.0) * 0.25
                    + (0.28 if 1.2 <= aspect <= 2.4 else 0.0)
                    + (0.30 if page_idx == 0 else 0.0)
                    - page_idx * 0.08
                )
                ranked.append((score, xref, page_idx + 1))
            except (TypeError, ValueError, IndexError):
                continue
    ranked.sort(reverse=True)
    return ranked[:MAX_CANDIDATES]


def _first_page_preview(document, pymupdf) -> bytes | None:
    """Fallback for text-only PDFs, scanned pages, or unsupported image formats."""
    if not len(document):
        return None
    page = document.load_page(0)
    w, h = max(float(page.rect.width), 1.0), max(float(page.rect.height), 1.0)
    scale = min(2.0, 1500.0 / w, 850.0 / h)
    if scale <= 0:
        return None
    pix = page.get_pixmap(
        matrix=pymupdf.Matrix(scale, scale),
        colorspace=pymupdf.csRGB,
        alpha=False,
        annots=False,
    )
    if pix.width * pix.height > MAX_IMAGE_PIXELS:
        return None
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return _jpeg_preview(image)


def extract_pdf_cover(pdf_bytes: bytes) -> dict | None:
    """Return {'data': JPEG bytes, 'origin': ..., 'page': ...} or None.

    Does not use Docling, Torch, OCR, network access, or external services.
    """
    if not pdf_bytes:
        return None
    try:
        try:
            import pymupdf
        except ImportError:
            import fitz as pymupdf
        with pymupdf.open(stream=pdf_bytes, filetype="pdf") as document:
            if document.needs_pass and document.authenticate("") <= 0:
                return None
            for _, xref, page_number in _embedded_candidates(document):
                try:
                    extracted = document.extract_image(xref)
                    image_bytes = extracted.get("image", b"") if extracted else b""
                    if not image_bytes or len(image_bytes) > MAX_EMBEDDED_BYTES:
                        continue
                    with Image.open(io.BytesIO(image_bytes)) as candidate:
                        data = _jpeg_preview(candidate)
                    return {"data": data, "origin": "pdf_embedded", "page": page_number}
                except Exception as error:
                    LOG.debug("PDF cover candidate ignored: %s", type(error).__name__)
            data = _first_page_preview(document, pymupdf)
            if data:
                return {"data": data, "origin": "pdf_page_preview", "page": 1}
    except Exception as error:
        LOG.warning("PDF cover extraction unavailable: %s", type(error).__name__)
    return None
