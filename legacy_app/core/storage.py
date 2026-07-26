"""Thread-safe, atomic JSON persistence for the JSON-first deployment."""

from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path
from typing import Any, Callable


class JsonStore:
    """Small repository abstraction that prevents partial JSON writes."""

    def __init__(self, path: Path, default_factory: Callable[[], Any] = dict):
        self.path = Path(path)
        self.default_factory = default_factory
        self._lock = threading.RLock()

    def read(self) -> Any:
        with self._lock:
            if not self.path.exists():
                return self.default_factory()
            try:
                with self.path.open("r", encoding="utf-8") as handle:
                    return json.load(handle)
            except (OSError, json.JSONDecodeError):
                backup = self.path.with_suffix(self.path.suffix + ".bak")
                if backup.exists():
                    try:
                        with backup.open("r", encoding="utf-8") as handle:
                            return json.load(handle)
                    except (OSError, json.JSONDecodeError):
                        pass
                return self.default_factory()

    def write(self, value: Any) -> Any:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_name(
                f".{self.path.name}.{uuid.uuid4().hex}.tmp"
            )
            with temporary.open("w", encoding="utf-8") as handle:
                json.dump(value, handle, indent=2, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            if self.path.exists():
                backup = self.path.with_suffix(self.path.suffix + ".bak")
                try:
                    backup.write_bytes(self.path.read_bytes())
                except OSError:
                    pass
            os.replace(temporary, self.path)
            return value

    def update(self, updater: Callable[[Any], Any]) -> Any:
        with self._lock:
            current = self.read()
            updated = updater(current)
            return self.write(current if updated is None else updated)
