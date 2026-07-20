from __future__ import annotations

import ctypes
import errno
import os
import threading
from ctypes import wintypes
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Optional
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger

from signalroom.models import (
    CrawlJobEventCreate,
    CrawlJobEventType,
    CrawlJobStatus,
    CrawlJobUpdate,
    PageParams,
)


class SchedulerAlreadyRunning(RuntimeError):
    """Raised when another process already owns the scheduler lock."""


_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_STILL_ACTIVE = 259
_ERROR_INVALID_PARAMETER = 87


def _windows_process_is_running(
    process_id: int,
    *,
    kernel32: Optional[Any] = None,
    get_last_error: Optional[Callable[[], int]] = None,
) -> bool:
    """Probe a Windows PID without sending it a signal.

    On Windows, ``os.kill(pid, 0)`` is not a harmless POSIX-style liveness
    check: Python delegates non-control signals to ``TerminateProcess``. Use a
    query-only process handle instead and treat access/probe failures
    conservatively so an active scheduler lock is never deleted on uncertainty.

    The injectable API arguments keep the native branch testable on non-Windows
    development machines.
    """

    if process_id <= 0:
        return False
    if kernel32 is None:  # pragma: no cover - exercised on the Windows host
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    if get_last_error is None:
        get_last_error = ctypes.get_last_error

    open_process = kernel32.OpenProcess
    open_process.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    open_process.restype = wintypes.HANDLE
    get_exit_code = kernel32.GetExitCodeProcess
    get_exit_code.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
    get_exit_code.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL

    handle = open_process(_PROCESS_QUERY_LIMITED_INFORMATION, False, process_id)
    if not handle:
        # ERROR_INVALID_PARAMETER is returned for a PID that no longer exists.
        # Access denied and all other failures are treated as "possibly alive".
        return int(get_last_error()) != _ERROR_INVALID_PARAMETER

    try:
        exit_code = wintypes.DWORD()
        if not get_exit_code(handle, ctypes.byref(exit_code)):
            return True
        return exit_code.value == _STILL_ACTIVE
    finally:
        close_handle(handle)


def _process_is_running(process_id: int) -> bool:
    """Return process liveness without mutating the target process."""

    if process_id <= 0:
        return False
    if os.name == "nt":
        return _windows_process_is_running(process_id)
    try:
        os.kill(process_id, 0)
        return True
    except PermissionError:
        return True
    except ProcessLookupError:
        return False
    except OSError as exc:
        if exc.errno == errno.ESRCH:
            return False
        # Unknown probe failures must not authorize deletion of another
        # scheduler's lock.
        return True


def _profile_value(profile: Any, key: str, default: Any = None) -> Any:
    if isinstance(profile, Mapping):
        return profile.get(key, default)
    return getattr(profile, key, default)


def _setting_int(settings: Any, name: str, default: int, minimum: int = 0) -> int:
    try:
        value = int(getattr(settings, name, default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, value)


class SchedulerProcessLock:
    """A small cross-process guard for the local single-host deployment."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._owned = False

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(2):
            try:
                descriptor = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                    handle.write(str(os.getpid()))
                self._owned = True
                return
            except FileExistsError:
                if attempt == 0 and self._remove_if_stale():
                    continue
                raise SchedulerAlreadyRunning(
                    f"Another Signalroom scheduler owns {self.path}"
                )

    def _remove_if_stale(self) -> bool:
        try:
            owner = int(self.path.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            owner = -1
        if owner > 0 and _process_is_running(owner):
            return False
        try:
            self.path.unlink()
            return True
        except OSError:
            return False

    def release(self) -> None:
        if not self._owned:
            return
        try:
            current = int(self.path.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            current = None
        if current == os.getpid():
            try:
                self.path.unlink()
            except OSError:
                pass
        self._owned = False


class MorningScheduler:
    """Run the enabled profiles, in order, on a configurable interval.

    The historical class name is kept as a compatibility alias for existing
    imports. A cycle is Default followed by Broadcast according to each
    profile's ``schedule_order``. The profile provider is called for every
    cycle, so a long-running scheduler does not cache JSON configuration.
    """

    def __init__(
        self,
        settings: Any,
        profiles_provider: Callable[[], Iterable[Any]],
        run_profile: Callable[..., Any],
        *,
        repository: Optional[Any] = None,
    ) -> None:
        self.settings = settings
        self.profiles_provider = profiles_provider
        self.run_profile = run_profile
        self.repository = repository
        storage_path = getattr(settings, "storage_path", None)
        legacy_database = Path(
            getattr(settings, "database_path", Path.cwd() / "runtime" / "state.db")
        )
        default_runtime = (
            Path(storage_path).parent if storage_path is not None else legacy_database.parent
        )
        runtime_dir = Path(getattr(settings, "runtime_dir", default_runtime))
        self.lock = SchedulerProcessLock(runtime_dir / "scheduler.lock")
        self.scheduler: Optional[Any] = None
        self._run_lock = threading.Lock()

    def _scheduled_profiles(self) -> Iterable[Any]:
        """Load profile/source JSON again when the settings expose its roots."""

        if bool(getattr(self.settings, "scheduler_reload_profiles", True)) and hasattr(
            self.settings, "profile_dir"
        ):
            # Imported lazily to keep this service usable with lightweight test
            # settings and alternate repository implementations.
            from signalroom.profiles import ProfileRegistry

            return ProfileRegistry.from_settings(self.settings).scheduled()
        return self.profiles_provider()

    def run_cycle(self) -> list:
        if not self._run_lock.acquire(blocking=False):
            return [{"status": "skipped", "reason": "a scheduled run is already active"}]
        results = []
        try:
            profiles = sorted(
                (
                    profile
                    for profile in self._scheduled_profiles()
                    if _profile_value(profile, "enabled", True)
                ),
                key=lambda profile: int(_profile_value(profile, "schedule_order", 999)),
            )
            for profile in profiles:
                profile_value = _profile_value(profile, "id", "default")
                profile_id = str(getattr(profile_value, "value", profile_value))
                try:
                    outcome = self.run_profile(profile_id=profile_id, trigger="scheduler")
                    results.append({"profile": profile_id, "status": "succeeded", "result": outcome})
                except Exception as exc:  # The next profile should still receive its run.
                    results.append({"profile": profile_id, "status": "failed", "error": str(exc)})
            return results
        finally:
            self._run_lock.release()

    def run_morning_briefing(self) -> list:
        """Backward-compatible name for one interval cycle."""

        return self.run_cycle()

    @staticmethod
    def _job_timestamp(job: Any) -> Optional[datetime]:
        value = getattr(job, "started_at", None) or getattr(job, "created_at", None)
        if value is None:
            return None
        if isinstance(value, datetime):
            parsed = value
        else:
            try:
                parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except ValueError:
                return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def recover_stale_jobs(self, *, now: Optional[datetime] = None) -> list:
        """Fail orphaned queued/running jobs through the public repository API.

        A generous age threshold avoids interfering with a legitimate manual
        crawl running in the API process. Recovery is best-effort: a malformed
        or concurrently completed job never prevents the scheduler starting.
        """

        if self.repository is None:
            return []
        stale_hours = _setting_int(self.settings, "scheduler_stale_job_hours", 8, 1)
        current = now or datetime.now(timezone.utc)
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        cutoff = current.astimezone(timezone.utc) - timedelta(hours=stale_hours)
        recovered = []
        for status in (CrawlJobStatus.QUEUED, CrawlJobStatus.RUNNING):
            cursor = None
            while True:
                try:
                    page = self.repository.list_jobs(
                        status=status,
                        page=PageParams(limit=100, cursor=cursor),
                    )
                except Exception:
                    break
                for job in page.items:
                    timestamp = self._job_timestamp(job)
                    if timestamp is None or timestamp > cutoff:
                        continue
                    error = (
                        "Recovered as failed after scheduler startup: "
                        f"job remained {status.value} for more than {stale_hours} hours"
                    )
                    try:
                        failed = self.repository.update_job(
                            job.id,
                            CrawlJobUpdate(
                                status=CrawlJobStatus.FAILED,
                                counters=dict(getattr(job, "counters", {}) or {}),
                                error=error,
                            ),
                        )
                        self.repository.add_job_event(
                            CrawlJobEventCreate(
                                job_id=failed.id,
                                event_type=CrawlJobEventType.ERROR,
                                message="Stale job recovered during scheduler startup",
                                payload={"previous_status": status.value},
                            )
                        )
                        recovered.append(failed)
                    except Exception:
                        # The API may have completed the same job after it was
                        # listed. Its terminal state must win that race.
                        continue
                if not page.page.has_more or not page.page.next_cursor:
                    break
                cursor = page.page.next_cursor
        return recovered

    def start(self, blocking: bool = False) -> None:
        self.lock.acquire()
        try:
            self.recover_stale_jobs()
            scheduler_class = BlockingScheduler if blocking else BackgroundScheduler
            timezone_name = str(getattr(self.settings, "timezone_name", "Asia/Kolkata"))
            self.scheduler = scheduler_class(timezone=timezone_name)
            interval_hours = _setting_int(
                self.settings, "schedule_interval_hours", 4, 1
            )
            trigger = IntervalTrigger(hours=interval_hours, timezone=timezone_name)
            job_options = {
                "trigger": trigger,
                "id": "signalroom-briefing-cycle",
                "name": "Signalroom Default then Broadcast briefing",
                "replace_existing": True,
                "coalesce": True,
                "max_instances": 1,
                "misfire_grace_time": _setting_int(
                    self.settings, "scheduler_misfire_grace_seconds", 3600, 1
                ),
            }
            if bool(getattr(self.settings, "scheduler_run_on_start", True)):
                delay = _setting_int(
                    self.settings, "scheduler_startup_delay_seconds", 10, 0
                )
                job_options["next_run_time"] = datetime.now(
                    ZoneInfo(timezone_name)
                ) + timedelta(seconds=delay)
            self.scheduler.add_job(self.run_cycle, **job_options)
            self.scheduler.start()
        except Exception:
            self.lock.release()
            raise

    def shutdown(self, wait: bool = False) -> None:
        try:
            if self.scheduler and self.scheduler.running:
                self.scheduler.shutdown(wait=wait)
        finally:
            self.scheduler = None
            self.lock.release()


SignalroomScheduler = MorningScheduler
