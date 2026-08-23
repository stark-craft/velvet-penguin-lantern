"""Server-side cover image validation and normalization.

Covers are normalized to an exact 1600x900 16:9 asset so the future Samsung
Internal card can render predictably. The viewer's chosen focal point (a
normalized 0..1 position) decides which part of the source stays visible.
EXIF orientation is applied before cropping. Output prefers WebP and falls
back to JPEG when a Pillow build lacks WebP support.
"""

from __future__ import annotations

import io
import logging

from PIL import Image, ImageOps

from .document_parser import ContributionError

logger = logging.getLogger(__name__)

COVER_MAX_BYTES = 10 * 1024 * 1024
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MIN_CROP_WIDTH = 960
MIN_CROP_HEIGHT = 540
OUTPUT_WIDTH = 1600
OUTPUT_HEIGHT = 900
QUALITY = 85


def validate_cover_upload(filename: str, size_bytes: int) -> None:
    if size_bytes > COVER_MAX_BYTES:
        readable = COVER_MAX_BYTES / (1024 * 1024)
        raise ContributionError(
            f"{filename} is larger than the {readable:.0f} MB cover limit. Choose a smaller image."
        )


def normalize_cover(data: bytes, filename: str, focal_x: float = 0.5, focal_y: float = 0.5) -> dict:
    """Validate and normalize one cover upload to a 1600x900 RGB asset.

    Returns {data, extension, format_name, width, height}.
    """

    try:
        image = Image.open(io.BytesIO(data))
        image_format = (image.format or "").upper()
    except Exception as error:  # noqa: BLE001 - Pillow raises many internal types
        logger.warning("[internal-content] cover open failed for %s: %s", filename, error)
        raise ContributionError(
            "This image could not be read. Choose a JPG, PNG, or WebP file."
        ) from error

    if image_format == "GIF":
        raise ContributionError(
            "GIF covers are not accepted. Export the frame as JPG, PNG, or WebP and try again."
        )
    if image_format not in ALLOWED_FORMATS:
        raise ContributionError(
            "Choose a JPG, PNG, or WebP image for the cover. SVG, HEIC, and other formats "
            "are not supported yet."
        )

    try:
        image = ImageOps.exif_transpose(image)
        width, height = image.size
    except Exception as error:  # noqa: BLE001
        logger.warning("[internal-content] cover decode failed for %s: %s", filename, error)
        raise ContributionError(
            "This image could not be decoded. Choose a different JPG, PNG, or WebP file."
        ) from error

    crop_width = min(width, (height * 16) / 9)
    crop_height = (crop_width * 9) / 16
    if crop_width < MIN_CROP_WIDTH or crop_height < MIN_CROP_HEIGHT:
        raise ContributionError(
            f"This image is too small for an internal story card. Its usable 16:9 area is "
            f"{round(crop_width)} x {round(crop_height)}, but at least {MIN_CROP_WIDTH} x "
            f"{MIN_CROP_HEIGHT} is needed. Choose a larger image — around 1600 x 900 works best."
        )

    focal_x = min(1.0, max(0.0, float(focal_x)))
    focal_y = min(1.0, max(0.0, float(focal_y)))
    crop_width = int(round(crop_width))
    crop_height = int(round(crop_height))
    max_left = width - crop_width
    max_top = height - crop_height
    left = max(0, min(int(round(max_left * focal_x)), max_left))
    top = max(0, min(int(round(max_top * focal_y)), max_top))
    cropped = image.crop((left, top, left + crop_width, top + crop_height))
    cropped = cropped.resize((OUTPUT_WIDTH, OUTPUT_HEIGHT), Image.LANCZOS).convert("RGB")

    encode_attempts = (
        ("WEBP", "webp", {"quality": QUALITY, "method": 6}),
        ("JPEG", "jpg", {"quality": QUALITY}),
    )
    for target_format, extension, options in encode_attempts:
        buffer = io.BytesIO()
        try:
            cropped.save(buffer, format=target_format, **options)
        except (ValueError, OSError, KeyError) as error:
            logger.warning("[internal-content] %s cover encode failed: %s", target_format, error)
            continue
        return {
            "data": buffer.getvalue(),
            "extension": extension,
            "format_name": target_format,
            "width": OUTPUT_WIDTH,
            "height": OUTPUT_HEIGHT,
        }

    raise ContributionError("The cover could not be processed by this server. Try a different image.")
