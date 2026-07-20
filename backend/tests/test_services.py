import tempfile
import unittest
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from signalroom.services import scheduler as scheduler_module
from signalroom.services.classification import assign_category, enrich_editorial_fields
from signalroom.services.normalization import (
    canonicalize_url,
    deduplicate_articles,
    normalize_article,
)
from signalroom.services.scheduler import MorningScheduler, SchedulerAlreadyRunning


class NormalizationTests(unittest.TestCase):
    def test_canonical_url_preserves_path_case_and_removes_tracking(self):
        actual = canonicalize_url(
            "HTTPS://Example.COM:443/News/Case-Sensitive/?utm_source=test&b=2&a=1#top"
        )
        self.assertEqual(actual, "https://example.com/News/Case-Sensitive?a=1&b=2")

    def test_normalized_article_gets_stable_identity(self):
        payload = {
            "title": "  A new   display  ",
            "link": "https://example.com/a?utm_medium=email",
            "body_text": "Detailed body.",
            "date": "2026-07-20T08:30:00+05:30",
            "keywords_found": ["Display", "Display"],
            "source_category": "Display & TV Competitors",
        }
        first = normalize_article(payload, "default", "run-a")
        second = normalize_article(payload, "default", "run-b")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["keywords"], ["Display"])
        self.assertEqual(first["published_at"], "2026-07-20T03:00:00+00:00")
        self.assertEqual(
            first["metadata"]["source_category"], "Display & TV Competitors"
        )

    def test_deduplication_keeps_richer_body_and_provenance(self):
        common = {
            "id": "a",
            "canonical_url": "https://example.com/story",
            "content_hash": "hash",
            "keywords": ["AI"],
        }
        items = [
            {**common, "source": "One", "source_id": "one", "body_text": "short"},
            {
                **common,
                "source": "Two",
                "source_id": "two",
                "body_text": "a substantially longer body",
                "keywords": ["Robotics"],
            },
        ]
        deduped = deduplicate_articles(items)
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["source"], "Two")
        self.assertEqual(set(deduped[0]["keywords"]), {"AI", "Robotics"})
        self.assertEqual(len(deduped[0]["source_provenance"]), 2)


class ClassificationTests(unittest.TestCase):
    def test_broadcast_category_wins_for_broadcast_terms(self):
        article = {"title": "DVB-I rollout expands connected TV broadcast", "body_text": ""}
        self.assertEqual(assign_category(article), "Broadcasting")
        enriched = enrich_editorial_fields(article, source_count=3)
        self.assertEqual(enriched["team"], "Broadcast")
        self.assertGreaterEqual(enriched["importance_score"], 60)


class SchedulerTests(unittest.TestCase):
    @staticmethod
    def windows_kernel(*, handle=101, exit_code=259):
        kernel = Mock()
        kernel.OpenProcess.return_value = handle

        def write_exit_code(_handle, pointer):
            pointer._obj.value = exit_code
            return True

        kernel.GetExitCodeProcess.side_effect = write_exit_code
        kernel.CloseHandle.return_value = True
        return kernel

    def test_windows_liveness_probe_uses_query_handle_and_closes_it(self):
        kernel = self.windows_kernel()

        running = scheduler_module._windows_process_is_running(
            4242,
            kernel32=kernel,
            get_last_error=lambda: 0,
        )

        self.assertTrue(running)
        kernel.OpenProcess.assert_called_once_with(0x1000, False, 4242)
        kernel.GetExitCodeProcess.assert_called_once()
        kernel.CloseHandle.assert_called_once_with(101)

    def test_windows_liveness_probe_recognizes_exited_and_unknown_processes(self):
        exited = self.windows_kernel(exit_code=0)
        self.assertFalse(
            scheduler_module._windows_process_is_running(
                4242, kernel32=exited, get_last_error=lambda: 0
            )
        )

        missing = self.windows_kernel(handle=0)
        self.assertFalse(
            scheduler_module._windows_process_is_running(
                4242, kernel32=missing, get_last_error=lambda: 87
            )
        )
        denied = self.windows_kernel(handle=0)
        self.assertTrue(
            scheduler_module._windows_process_is_running(
                4242, kernel32=denied, get_last_error=lambda: 5
            )
        )

    def test_windows_branch_never_uses_os_kill(self):
        with ExitStack() as stack:
            stack.enter_context(patch.object(scheduler_module.os, "name", "nt"))
            windows_probe = stack.enter_context(
                patch.object(
                    scheduler_module, "_windows_process_is_running", return_value=True
                )
            )
            kill = stack.enter_context(patch.object(scheduler_module.os, "kill"))
            self.assertTrue(scheduler_module._process_is_running(4242))

        windows_probe.assert_called_once_with(4242)
        kill.assert_not_called()

    def test_profiles_run_in_declared_order(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            settings = SimpleNamespace(runtime_dir=Path(directory))
            scheduler = MorningScheduler(
                settings,
                profiles_provider=lambda: [
                    {"id": "broadcast", "enabled": True, "schedule_order": 2},
                    {"id": "default", "enabled": True, "schedule_order": 1},
                ],
                run_profile=lambda **kwargs: calls.append(kwargs["profile_id"]),
            )
            results = scheduler.run_morning_briefing()
            self.assertEqual(calls, ["default", "broadcast"])
            self.assertEqual([item["status"] for item in results], ["succeeded", "succeeded"])

    def test_scheduler_lock_is_single_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = SimpleNamespace(runtime_dir=Path(directory))
            first = MorningScheduler(settings, lambda: [], lambda **_: None)
            second = MorningScheduler(settings, lambda: [], lambda **_: None)
            first.lock.acquire()
            try:
                with self.assertRaises(SchedulerAlreadyRunning):
                    second.lock.acquire()
            finally:
                first.lock.release()

    def test_scheduler_uses_four_hour_interval_and_coalesces_misfires(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = SimpleNamespace(
                runtime_dir=Path(directory),
                timezone_name="UTC",
                schedule_interval_hours=4,
                scheduler_run_on_start=False,
                scheduler_misfire_grace_seconds=900,
            )
            scheduler = MorningScheduler(settings, lambda: [], lambda **_: None)
            scheduler.start(blocking=False)
            try:
                job = scheduler.scheduler.get_job("signalroom-briefing-cycle")
                self.assertEqual(job.trigger.interval.total_seconds(), 4 * 60 * 60)
                self.assertTrue(job.coalesce)
                self.assertEqual(job.max_instances, 1)
                self.assertEqual(job.misfire_grace_time, 900)
            finally:
                scheduler.shutdown(wait=False)

    def test_scheduler_recovers_only_stale_non_terminal_jobs(self):
        old = datetime.now(timezone.utc) - timedelta(hours=10)
        recent = datetime.now(timezone.utc) - timedelta(minutes=10)
        stale_job = SimpleNamespace(
            id=uuid4(), created_at=old, started_at=None, counters={"discovered": 3}
        )
        recent_job = SimpleNamespace(
            id=uuid4(), created_at=recent, started_at=None, counters={}
        )

        class FakeRepository:
            def __init__(self):
                self.updated = []
                self.events = []

            def list_jobs(self, *, status, page):
                items = [stale_job, recent_job] if status.value == "queued" else []
                return SimpleNamespace(
                    items=items,
                    page=SimpleNamespace(has_more=False, next_cursor=None),
                )

            def update_job(self, job_id, update):
                self.updated.append((job_id, update))
                return SimpleNamespace(id=job_id)

            def add_job_event(self, event):
                self.events.append(event)

        with tempfile.TemporaryDirectory() as directory:
            repository = FakeRepository()
            settings = SimpleNamespace(
                runtime_dir=Path(directory), scheduler_stale_job_hours=8
            )
            scheduler = MorningScheduler(
                settings, lambda: [], lambda **_: None, repository=repository
            )
            recovered = scheduler.recover_stale_jobs()

        self.assertEqual([item.id for item in recovered], [stale_job.id])
        self.assertEqual(repository.updated[0][1].status.value, "failed")
        self.assertEqual(repository.updated[0][1].counters, {"discovered": 3})
        self.assertEqual(len(repository.events), 1)


if __name__ == "__main__":
    unittest.main()
