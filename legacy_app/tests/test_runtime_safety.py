import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from news_scrapper.runtime_safety import (
    SchedulerOwnership,
    enforce_single_worker_configuration,
    sweep_orphan_runtime_files,
)


class RuntimeSafetyTests(unittest.TestCase):
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
