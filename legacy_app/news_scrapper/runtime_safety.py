"""Strict runtime artifact cleanup and single-scheduler ownership."""

from __future__ import annotations

import json
import os
import re
import secrets
import time
from pathlib import Path


_JOB_FILE = re.compile(
    r"^(?:ui_results|clustered_results)_(?:scheduler_[A-Za-z0-9_-]+|[0-9a-f]{16})\.json$"
)
_ATOMIC_TEMP = re.compile(r"^\..+\.json\.[0-9a-f]{32}\.tmp$")
_DIRECT_TEMP = re.compile(
    r"^(?:workflow_store|dropped_articles|gatekeeper_restore_queue|"
    r"viewer_[A-Za-z0-9_]+|not_interested_store|region_learning)\.json\.tmp$"
)


def _eligible(path: Path) -> bool:
    return bool(
        _JOB_FILE.fullmatch(path.name)
        or _ATOMIC_TEMP.fullmatch(path.name)
        or _DIRECT_TEMP.fullmatch(path.name)
    )


def sweep_orphan_runtime_files(
    runtime_dir: Path | str,
    *,
    active_job_ids: set[str] | None = None,
    older_than_seconds: int = 12 * 60 * 60,
    now: float | None = None,
) -> dict:
    """Remove only allowlisted stale temp files; canonical state never matches."""

    root = Path(runtime_dir)
    active = {str(value) for value in (active_job_ids or set()) if str(value)}
    current = time.time() if now is None else now
    removed: list[str] = []
    bytes_reclaimed = 0
    if not root.exists():
        return {"removed": 0, "bytes": 0, "files": []}
    for path in root.rglob("*"):
        if not path.is_file() or not _eligible(path):
            continue
        if any(job_id in path.name for job_id in active):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        if current - stat.st_mtime < max(0, older_than_seconds):
            continue
        try:
            path.unlink()
        except OSError:
            continue
        removed.append(str(path.relative_to(root)))
        bytes_reclaimed += stat.st_size
    if removed:
        print(
            f"[RUNTIME CLEANUP] Removed {len(removed)} orphan files, "
            f"reclaimed {bytes_reclaimed / (1024 * 1024):.1f} MB",
            flush=True,
        )
    return {"removed": len(removed), "bytes": bytes_reclaimed, "files": removed}


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


class SchedulerOwnership:
    """Cross-process lock preventing duplicate APScheduler ownership."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.token = secrets.token_hex(16)
        self.owned = False

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            {"pid": os.getpid(), "token": self.token, "created_at": time.time()}
        ).encode("utf-8")
        for _ in range(2):
            try:
                descriptor = os.open(
                    self.path,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o600,
                )
            except FileExistsError:
                try:
                    existing = json.loads(self.path.read_text(encoding="utf-8"))
                    if _pid_alive(int(existing.get("pid") or 0)):
                        return False
                    self.path.unlink(missing_ok=True)
                    continue
                except (OSError, ValueError, TypeError, json.JSONDecodeError):
                    try:
                        if time.time() - self.path.stat().st_mtime < 60:
                            return False
                        self.path.unlink(missing_ok=True)
                        continue
                    except OSError:
                        return False
            else:
                with os.fdopen(descriptor, "wb") as handle:
                    handle.write(payload)
                    handle.flush()
                    os.fsync(handle.fileno())
                self.owned = True
                return True
        return False

    def release(self) -> None:
        if not self.owned:
            return
        try:
            existing = json.loads(self.path.read_text(encoding="utf-8"))
            if secrets.compare_digest(str(existing.get("token") or ""), self.token):
                self.path.unlink(missing_ok=True)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            pass
        self.owned = False


def enforce_single_worker_configuration() -> None:
    """Fail closed in production when a launcher explicitly asks for workers >1."""

    configured = []
    for name in ("WEB_CONCURRENCY", "UVICORN_WORKERS"):
        value = os.environ.get(name, "").strip()
        if value:
            try:
                configured.append(int(value))
            except ValueError:
                configured.append(2)
    gunicorn = os.environ.get("GUNICORN_CMD_ARGS", "")
    match = re.search(r"(?:--workers|-w)\s+(\d+)", gunicorn)
    if match:
        configured.append(int(match.group(1)))
    if configured and max(configured) > 1:
        message = (
            "TechScout currently requires exactly one backend worker because "
            "its scheduler and JSON locks are process-local."
        )
        environment = os.environ.get("NEWSSCRAPPER_ENV", "development").strip().lower()
        if environment in {"production", "prod"}:
            raise RuntimeError(message)
        print(f"[PROCESS SAFETY] WARNING: {message}", flush=True)
