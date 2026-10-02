import errno
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from news_scrapper.runtime_safety import (
    SchedulerOwnership,
    _pid_alive,
    _windows_pid_alive,
    enforce_single_worker_configuration,
    sweep_orphan_runtime_files,
)


class RuntimeSafetyTests(unittest.TestCase):
    def test_invalid_pids_never_probe_a_process(self):
        with patch("news_scrapper.runtime_safety.os.kill") as kill:
            for pid in (0, -1):
                self.assertFalse(_pid_alive(pid))
            kill.assert_not_called()
        with patch("news_scrapper.runtime_safety.ctypes.WinDLL", create=True) as dll:
            for pid in (0, -1, 0x100000000):
                self.assertFalse(_windows_pid_alive(pid))
            dll.assert_not_called()

    def test_posix_pid_probe_uses_signal_zero_and_preserves_inaccessible_owner(self):
        with patch("news_scrapper.runtime_safety.os.name", "posix"):
            with patch("news_scrapper.runtime_safety.os.kill") as kill:
                self.assertTrue(_pid_alive(1234))
                kill.assert_called_once_with(1234, 0)
            for error, expected in (
                (ProcessLookupError(errno.ESRCH, "missing"), False),
                (PermissionError(errno.EPERM, "denied"), True),
                (OSError(errno.EIO, "unknown"), True),
                (OverflowError("invalid pid"), False),
            ):
                with self.subTest(error=type(error).__name__):
                    with patch("news_scrapper.runtime_safety.os.kill", side_effect=error):
                        self.assertEqual(_pid_alive(1234), expected)

    def test_windows_pid_probe_is_nonblocking_and_closes_pointer_sized_handle(self):
        from ctypes import wintypes

        kernel = MagicMock()
        handle = 0x100000008  # A truncated 32-bit HANDLE would lose this value.
        kernel.OpenProcess.return_value = handle
        with patch("news_scrapper.runtime_safety.os.name", "nt"), patch(
            "news_scrapper.runtime_safety.ctypes.WinDLL", return_value=kernel, create=True
        ) as dll, patch("news_scrapper.runtime_safety.os.kill") as kill:
            for wait_result, expected in ((0, False), (0x102, True), (0xFFFFFFFF, True)):
                with self.subTest(wait_result=wait_result):
                    kernel.WaitForSingleObject.return_value = wait_result
                    self.assertEqual(_pid_alive(1234), expected)
                    kernel.WaitForSingleObject.assert_called_with(handle, 0)
                    kernel.CloseHandle.assert_called_with(handle)
            kernel.OpenProcess.assert_called_with(0x00100000, False, 1234)
            self.assertEqual(kernel.CloseHandle.call_count, 3)
            self.assertIs(kernel.OpenProcess.restype, wintypes.HANDLE)
            self.assertEqual(kernel.WaitForSingleObject.argtypes, [wintypes.HANDLE, wintypes.DWORD])
            dll.assert_called_with("kernel32", use_last_error=True)
            kill.assert_not_called()

    def test_windows_open_process_failure_only_marks_absent_pid_dead(self):
        kernel = MagicMock()
        kernel.OpenProcess.return_value = None
        with patch(
            "news_scrapper.runtime_safety.ctypes.WinDLL", return_value=kernel, create=True
        ), patch("news_scrapper.runtime_safety.ctypes.get_last_error", create=True) as last_error:
            for code, expected in ((87, False), (5, True), (0, True), (8, True)):
                with self.subTest(error_code=code):
                    last_error.return_value = code
                    self.assertEqual(_windows_pid_alive(1234), expected)
            kernel.WaitForSingleObject.assert_not_called()
            kernel.CloseHandle.assert_not_called()

    def test_windows_probe_failure_retains_owner_and_still_closes_handle(self):
        kernel = MagicMock()
        kernel.OpenProcess.return_value = 123
        kernel.WaitForSingleObject.side_effect = OSError("probe failed")
        with patch(
            "news_scrapper.runtime_safety.ctypes.WinDLL", return_value=kernel, create=True
        ):
            self.assertTrue(_windows_pid_alive(1234))
            kernel.CloseHandle.assert_called_once_with(123)
        for error in (OSError("unavailable"), SystemError("embedded runtime error")):
            with self.subTest(error=type(error).__name__):
                with patch(
                    "news_scrapper.runtime_safety.ctypes.WinDLL", side_effect=error, create=True
                ):
                    self.assertTrue(_windows_pid_alive(1234))

    def test_windows_scheduler_lock_preserves_unknown_owner_and_recovers_dead_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "scheduler_owner.lock"
            original = json.dumps({"pid": 1234, "token": "old-owner", "created_at": 1})
            path.write_text(original, encoding="utf-8")
            os.utime(path, (time.time() - 90_000, time.time() - 90_000))
            ownership = SchedulerOwnership(path)
            kernel = MagicMock()
            kernel.OpenProcess.return_value = 123
            kernel.WaitForSingleObject.return_value = 0x102
            with patch("news_scrapper.runtime_safety.os.name", "nt"), patch(
                "news_scrapper.runtime_safety.ctypes.WinDLL", return_value=kernel, create=True
            ), patch(
                "news_scrapper.runtime_safety.ctypes.get_last_error", return_value=5, create=True
            ) as last_error, patch("news_scrapper.runtime_safety.os.kill") as kill:
                self.assertFalse(ownership.acquire())
                self.assertEqual(path.read_text(encoding="utf-8"), original)
                kernel.WaitForSingleObject.return_value = 0xFFFFFFFF
                self.assertFalse(ownership.acquire())
                self.assertEqual(path.read_text(encoding="utf-8"), original)
                kernel.OpenProcess.return_value = None
                self.assertFalse(ownership.acquire())
                self.assertEqual(path.read_text(encoding="utf-8"), original)
                last_error.return_value = 87
                self.assertTrue(ownership.acquire())
                self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["token"], ownership.token)
                ownership.release()
                self.assertFalse(path.exists())
                kill.assert_not_called()

    def test_sweeper_removes_only_stale_allowlisted_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stale = root / "ui_results_scheduler_unified_old.json"
            active = root / "clustered_results_aaaaaaaaaaaaaaaa.json"
            canonical = root / "briefing_2026-08-28_10-00-00.json"
            training = root / "trainingData.json"
            for path in (stale, active, canonical, training):
                path.write_text("{}", encoding="utf-8")
                os.utime(path, (time.time() - 90_000, time.time() - 90_000))

            result = sweep_orphan_runtime_files(
                root,
                active_job_ids={"aaaaaaaaaaaaaaaa"},
                older_than_seconds=3600,
            )

            self.assertEqual(result["removed"], 1)
            self.assertFalse(stale.exists())
            self.assertTrue(active.exists())
            self.assertTrue(canonical.exists())
            self.assertTrue(training.exists())

    def test_scheduler_lock_allows_one_owner_and_releases_cleanly(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "scheduler_owner.lock"
            first = SchedulerOwnership(path)
            second = SchedulerOwnership(path)
            self.assertTrue(first.acquire())
            self.assertFalse(second.acquire())
            first.release()
            self.assertTrue(second.acquire())
            second.release()
            self.assertFalse(path.exists())

    def test_production_rejects_explicit_multi_worker_configuration(self):
        with patch.dict(
            os.environ,
            {"NEWSSCRAPPER_ENV": "production", "WEB_CONCURRENCY": "2"},
            clear=False,
        ):
            with self.assertRaises(RuntimeError):
                enforce_single_worker_configuration()


if __name__ == "__main__":
    unittest.main()
