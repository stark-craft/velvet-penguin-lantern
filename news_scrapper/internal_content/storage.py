"""Runtime persistence for internal contributions.

Records live in one atomic JSON file; original documents and normalized
covers live as UUID-named files beside it. Raw viewer filenames are never
used as storage filenames — they are metadata only. All paths derive from the
shared NewsScrapper runtime directory and are created on demand.
"""

from __future__ import annotations

import threading
import uuid
from pathlib import Path

from core.settings import NEWS_RUNTIME_DIR
from core.storage import JsonStore

RUNTIME_DIR = NEWS_RUNTIME_DIR / "internal_content"
ORIGINALS_DIR = RUNTIME_DIR / "originals"
COVERS_DIR = RUNTIME_DIR / "covers"
CONTRIBUTIONS_FILE = RUNTIME_DIR / "contributions.json"
NOTIFICATIONS_FILE = RUNTIME_DIR / "internal_notifications.json"

# Per-author inbox cap so long-lived pilots cannot grow one JSON file forever.
NOTIFICATION_LIMIT_PER_OWNER = 50

# Guards read-modify-write sequences that span the JSON store and file moves.
mutation_lock = threading.RLock()

DOCUMENT_MIME_BY_EXTENSION = {"pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
COVER_MIME_BY_EXTENSION = {"webp": "image/webp", "jpg": "image/jpeg"}


def ensure_directories() -> None:
    for path in (RUNTIME_DIR, ORIGINALS_DIR, COVERS_DIR):
        path.mkdir(parents=True, exist_ok=True)


def _records_store() -> JsonStore:
    return JsonStore(Path(CONTRIBUTIONS_FILE), default_factory=dict)


def load_records() -> dict[str, dict]:
    data = _records_store().read()
    items = data.get("items") if isinstance(data, dict) else None
    return items if isinstance(items, dict) else {}


def write_records(items: dict[str, dict]) -> None:
    _records_store().write({"version": 1, "items": items})


def _notifications_store() -> JsonStore:
    return JsonStore(Path(NOTIFICATIONS_FILE), default_factory=dict)


def load_notifications() -> dict[str, list[dict]]:
    data = _notifications_store().read()
    owners = data.get("owners") if isinstance(data, dict) else None
    return owners if isinstance(owners, dict) else {}


def write_notifications(owners: dict[str, list[dict]]) -> None:
    _notifications_store().write({"version": 1, "owners": owners})


def new_id(prefix: str = "ic") -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def new_file_id() -> str:
    return uuid.uuid4().hex


def original_path(file_id: str, extension: str) -> Path:
    suffix = f".{extension.lower()}" if extension else ""
    return Path(ORIGINALS_DIR) / f"{file_id}{suffix}"


def cover_path(file_id: str, extension: str) -> Path:
    return Path(COVERS_DIR) / f"{file_id}.{extension.lower()}"


def remove_quietly(path: Path | str) -> None:
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass
