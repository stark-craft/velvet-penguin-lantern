import os
import json
import tempfile
import unittest
import datetime
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from starlette.requests import Request

from news_scrapper import application as main


def request_from(ip="127.0.0.1", forwarded_for=""):
    headers = []
    if forwarded_for:
        headers.append((b"x-forwarded-for", forwarded_for.encode("latin1")))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "path": "/workflow/select",
            "raw_path": b"/workflow/select",
            "query_string": b"",
            "headers": headers,
            "client": (ip, 50000),
            "server": ("testserver", 80),
        }
    )


class SchedulerResilienceTests(unittest.TestCase):
    def setUp(self):
        self.original_status = dict(main.SCHEDULER_STATUS)
        self.original_jobs = dict(main.active_jobs)
        self.original_pending = main.scheduler_pending_run
        self.original_shutdown = main.scheduler_shutdown_event.is_set()
        main.active_jobs.clear()
        main.scheduler_shutdown_event.clear()

    def tearDown(self):
        main.SCHEDULER_STATUS.clear()
        main.SCHEDULER_STATUS.update(self.original_status)
        main.active_jobs.clear()
        main.active_jobs.update(self.original_jobs)
        main.scheduler_pending_run = self.original_pending
        if self.original_shutdown:
            main.scheduler_shutdown_event.set()
        else:
            main.scheduler_shutdown_event.clear()

    def test_due_tick_is_retained_while_scheduler_is_active(self):
        main.SCHEDULER_STATUS["is_active"] = True
        with patch.object(main, "_schedule_scheduler_retry") as retry:
            main.run_morning_briefing()
        self.assertTrue(main.scheduler_pending_run)
        retry.assert_not_called()

    def test_manual_scan_deferral_schedules_one_retry(self):
        main.active_jobs["manual"] = {"status": "running"}
        with patch.object(main, "_schedule_scheduler_retry") as retry:
            main.run_morning_briefing()
        self.assertTrue(main.scheduler_pending_run)
        retry.assert_called_once_with()

    def test_failed_profile_run_schedules_recovery_retry(self):
        with patch.object(main, "ensure_profile_storage"), patch.object(
            main, "run_scheduler_for_profile", return_value=False
        ), patch.object(main, "_schedule_scheduler_retry") as retry:
            main.run_morning_briefing()
        retry.assert_called_once_with(main.SCHEDULER_RETRY_DELAY_SECONDS)
        self.assertEqual(
            main.SCHEDULER_STATUS["last_failed_profiles"],
            [main.DEFAULT_PROFILE],
        )
        next_run = datetime.datetime.fromisoformat(main.SCHEDULER_STATUS["next_run"])
        completed = datetime.datetime.fromisoformat(main.SCHEDULER_STATUS["last_completed_at"])
        self.assertEqual(
            int((next_run - completed).total_seconds()),
            main.SCHEDULER_RETRY_DELAY_SECONDS,
        )


class TrainingQueueResilienceTests(unittest.TestCase):
    def setUp(self):
        with main.training_queue_lock:
            main.training_running_profiles.clear()
            main.training_queued_profiles.clear()
            main.training_dirty_profiles.clear()

    def test_votes_during_training_are_coalesced_not_dropped(self):
        with main.training_queue_lock:
            main.training_running_profiles.add(main.DEFAULT_PROFILE)
        try:
            with patch.object(main, "_ensure_training_worker"):
                first = main.enqueue_bouncer_retrain(main.DEFAULT_PROFILE)
                second = main.enqueue_bouncer_retrain(main.DEFAULT_PROFILE)
            self.assertTrue(first["coalesced"])
            self.assertTrue(second["coalesced"])
            self.assertIn(main.DEFAULT_PROFILE, main.training_dirty_profiles)
        finally:
            with main.training_queue_lock:
                main.training_running_profiles.clear()
                main.training_dirty_profiles.clear()


class ProfileConfigurationTests(unittest.TestCase):
    def test_profile_ip_lists_normalize_ipv4_mapped_ipv6(self):
        with patch.dict(os.environ, {"TEST_PROFILE_IPS": "::ffff:192.0.2.10, 10.0.0.1"}):
            self.assertEqual(
                main.env_ip_set("TEST_PROFILE_IPS"),
                {"192.0.2.10", "10.0.0.1"},
            )


class ConcurrentJsonStoreTests(unittest.TestCase):
    def test_fifty_training_votes_are_all_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            training_file = Path(directory) / "training.json"
            training_file.write_text("[]", encoding="utf-8")
            with patch.object(
                main,
                "TRAINING_FILES",
                {main.DEFAULT_PROFILE: str(training_file)},
            ):
                with ThreadPoolExecutor(max_workers=20) as executor:
                    list(
                        executor.map(
                            lambda index: main.save_training_vote(
                                ["AI"],
                                f"Unique summary {index}",
                                "interested",
                                f"Unique title {index}",
                                main.DEFAULT_PROFILE,
                            ),
                            range(50),
                        )
                    )
            self.assertEqual(len(json.loads(training_file.read_text(encoding="utf-8"))), 50)

    def test_concurrent_selections_converge_on_the_unified_workflow(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            default_file = root / "default.json"
            broadcast_file = root / "broadcast.json"
            profiles_file = root / "profiles.json"
            for target in (default_file, broadcast_file):
                target.write_text('{"selected": [], "approved": []}', encoding="utf-8")
            profiles_file.write_text("{}", encoding="utf-8")

            patches = (
                patch.object(
                    main,
                    "WORKFLOW_FILES",
                    {
                        main.DEFAULT_PROFILE: str(default_file),
                        main.BROADCAST_PROFILE: str(broadcast_file),
                    },
                ),
                patch.object(main, "VIEWER_PROFILES_FILE", str(profiles_file)),
                patch.object(main, "TRUSTED_PROXY_IPS", {"127.0.0.1"}),
                patch.object(main, "BROADCAST_SPECIAL_IPS", {"192.0.2.10"}),
                patch.object(main, "PROFILE_SETTINGS_ALLOWED_IPS", set()),
                patch.dict(
                    os.environ,
                    {"REVIEW_NEWS_ALLOWED_IPS": "10.0.0.25,192.0.2.10"},
                    clear=False,
                ),
            )
            for active_patch in patches:
                active_patch.start()
            try:
                work = [
                    (index, "192.0.2.10" if index % 2 else "10.0.0.25")
                    for index in range(100)
                ]

                def select(entry):
                    index, forwarded = entry
                    return main.select_news(
                        request_from(forwarded_for=forwarded),
                        {"title": f"Signal {index}"},
                    )

                with ThreadPoolExecutor(max_workers=25) as executor:
                    results = list(executor.map(select, work))
            finally:
                for active_patch in reversed(patches):
                    active_patch.stop()

            self.assertTrue(all(result["status"] == "success" for result in results))
            default = json.loads(default_file.read_text(encoding="utf-8"))
            broadcast = json.loads(broadcast_file.read_text(encoding="utf-8"))
            self.assertEqual(len(default["selected"]), 100)
            self.assertEqual(len(broadcast["selected"]), 0)


if __name__ == "__main__":
    unittest.main()
