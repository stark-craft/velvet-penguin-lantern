"""Strict runtime artifact cleanup and single-scheduler ownership."""

from __future__ import annotations

import ctypes
import errno
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
    if os.name == "nt":
        return _windows_pid_alive(pid)
    try:
        os.kill(pid, 0)
    except OverflowError:
        return False
    except OSError as exc:
        # Permission denial is evidence of an existing process, not a stale lock.
        return exc.errno != errno.ESRCH
    return True


def _windows_pid_alive(pid: int) -> bool:
    """Probe without signalling; uncertain/inaccessible owners retain the lock."""

    if not 0 < pid <= 0xFFFFFFFF:
        return False  # Win32 PIDs are DWORDs; do not wrap a corrupt lock value.
    try:
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel32.WaitForSingleObject.restype = wintypes.DWORD
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL

        # SYNCHRONIZE is sufficient to inspect the process' signalled state.
        handle = kernel32.OpenProcess(0x00100000, False, pid)
        if not handle:
            # OpenProcess reports an absent PID as ERROR_INVALID_PARAMETER.
            # Access denied and every other failure must fail closed.
            return ctypes.get_last_error() != 87
        try:
            # Zero timeout is non-blocking; only a signalled process is dead.
            return kernel32.WaitForSingleObject(handle, 0) != 0
        finally:
            kernel32.CloseHandle(handle)
    except (AttributeError, OSError, SystemError):
        return True


class SchedulerOwnership:
    """Crash-safe single scheduler ownership using an operating-system file lock.

    The permanent ``scheduler_owner.lock.oslock`` file is only an anchor:
    ownership is determined by the OS lock, not by its contents or a PID.
    Windows and Unix release the lock automatically when a process exits.
    The existing ``scheduler_owner.lock`` remains readable JSON metadata.

    IMPORTANT: Stop all backend instances using the older PID-based code
    before the first rollout. They do not coordinate using this new OS lock.
    """

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.lock_path = self.path.with_name(self.path.name + ".oslock")
        self.token = secrets.token_hex(16)
        self.owned = False
        self._handle = None

    @staticmethod
    def _try_lock(handle) -> bool:
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError as exc:
            # A contender must never take over an active scheduler. Unknown
            # errors propagate and fail startup instead of bypassing the lock.
            if exc.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                return False
            raise

    @staticmethod
    def _unlock(handle) -> None:
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def acquire(self) -> bool:
        if self.owned:
            return True
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self.lock_path, "a+b")
        locked = False
        temporary = None
        try:
            # Windows msvcrt locks a byte from the file's current position.
            # Never remove the anchor, even when its previous owner crashed.
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
                os.fsync(handle.fileno())

            locked = self._try_lock(handle)
            if not locked:
                return False

            # Replace old PID-only metadata after obtaining the OS lock.
            # It can refer to an unrelated process due to Windows PID reuse.
            payload = {
                "pid": os.getpid(),
                "token": self.token,
                "created_at": time.time(),
            }
            temporary = self.path.with_name(
                self.path.name + "." + self.token + ".tmp"
            )
            with open(temporary, "x", encoding="utf-8") as output:
                json.dump(payload, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.path)
            temporary = None
            self._handle = handle
            self.owned = True
            return True
        finally:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
            if not self.owned:
                if locked:
                    try:
                        self._unlock(handle)
                    except OSError:
                        pass
                handle.close()

    def release(self) -> None:
        if not self.owned:
            return
        try:
            try:
                existing = json.loads(self.path.read_text(encoding="utf-8"))
                if secrets.compare_digest(
                    str(existing.get("token") or ""), self.token
                ):
                    self.path.unlink(missing_ok=True)
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                pass
        finally:
            handle = self._handle
            self._handle = None
            self.owned = False
            if handle is not None:
                try:
                    self._unlock(handle)
                finally:
                    handle.close()


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
