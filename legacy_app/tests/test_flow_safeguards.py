import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from core import settings
from news_scrapper import application as app


class FlowSafeguardTests(unittest.TestCase):
    def test_saved_viewer_state_is_included_in_legacy_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / "runtime"
            source = root / "viewer_saved_store.json"
            source.write_text('{"viewer": {"default": []}}', encoding="utf-8")

            with patch.object(settings, "PROJECT_ROOT", root), patch.object(
                settings, "NEWS_RUNTIME_DIR", runtime
            ), patch.object(
                settings, "VENTURE_LENS_RUNTIME_DIR", root / "venture"
            ):
                settings.migrate_legacy_news_runtime()

            self.assertEqual(
                json.loads((runtime / "viewer_saved_store.json").read_text(encoding="utf-8")),
                {"viewer": {"default": []}},
            )

    def test_nonzero_clustering_exit_fails_profile_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sites = root / "sites.json"
            sites.write_text('{"sites": []}', encoding="utf-8")
            process = SimpleNamespace(
                wait=lambda timeout: 0,
                poll=lambda: 0,
                terminate=lambda: None,
                kill=lambda: None,
            )

            def create_scrapy_output(command, cwd=None):
                output_path = Path(command[command.index("-O") + 1])
                output_path.write_text("[]", encoding="utf-8")
                return process

            with patch.object(app, "ROOT_DIR", str(root)), patch.object(
                app, "get_profile_history_dir", return_value=str(root / "history")
            ), patch.object(
                app,
                "get_profile_config",
                return_value={
                    "sites_file": str(sites),
                    "keywords": "AI",
                    "use_bouncer": False,
                },
            ), patch.object(
                app.subprocess, "Popen", side_effect=create_scrapy_output
            ), patch.object(
                app.subprocess,
                "run",
                return_value=SimpleNamespace(returncode=9),
            ):
                result = app.run_scheduler_for_profile(
                    app.DEFAULT_PROFILE,
                    {
                        "mode": "local_scrapy_bart",
                        "web_search": False,
                        "chat": False,
                        "discovery_only": False,
                    },
                )

            self.assertFalse(result)

    def test_usage_schema_counts_saved_actions(self):
        day = app.get_empty_day()
        self.assertEqual(day["saved_for_later"], 0)
        self.assertEqual(day["removed_from_saved"], 0)

    def test_usage_tracker_accepts_every_frontend_action(self):
        actions = [
            "add_source",
            "approve",
            "batch_select",
            "dossier_open",
            "draft_export",
            "export",
            "heartbeat",
            "hide_personal",
            "page_load",
            "remove_approved",
            "remove_selected",
            "restore_personal_hidden",
            "search",
            "select",
            "voc_feedback",
            "vote",
            "vote_interested",
            "vote_not_interested",
        ]
        with tempfile.TemporaryDirectory() as directory:
            tracker_file = Path(directory) / "usage.json"
            tracker_file.write_text("{}", encoding="utf-8")
            with (
                patch.object(app, "USAGE_TRACKER_FILE", str(tracker_file)),
                patch.object(app, "VIEWER_PROFILES_FILE", str(Path(directory) / "profiles.json")),
            ):
                for action in actions:
                    detail = (
                        '{"item_count": 3}'
                        if action == "batch_select"
                        else "down:Example"
                        if action == "vote"
                        else "Example"
                    )
                    self.assertTrue(
                        app.record_usage_activity(
                            "10.0.0.25",
                            app.DEFAULT_PROFILE,
                            "browser",
                            action,
                            detail,
                        ),
                        action,
                    )

            tracker = json.loads(tracker_file.read_text(encoding="utf-8"))
            day = next(iter(tracker.values()))["activity"][app.get_today()]
            self.assertEqual(day["articles_clicked"], 1)
            self.assertEqual(day["selections"], 4)
            self.assertEqual(day["approvals"], 1)
            self.assertEqual(day["personal_hides"], 1)
            self.assertEqual(day["workflow_removals"], 3)
            self.assertEqual(day["sources_added"], 1)
            self.assertEqual(day["votes_not_interested"], 2)
            self.assertEqual(len(day["events"]), len(actions))
            self.assertEqual(set(day["action_counts"]), set(actions))

    def test_weak_cached_insight_is_replaced_with_strategic_fallback(self):
        item = {
            "title": "See all latest",
            "master_summary": (
                "Samsung launches a new premium display for global home "
                "entertainment customers this week."
            ),
            "category": "Display Tech",
            "source_count": 2,
        }
        cache_key = app.hashlib.sha256(
            (
                f"{app.DEFAULT_PROFILE}|{item['title']}|"
                f"{item['master_summary'][:1000]}"
            ).encode("utf-8")
        ).hexdigest()
        with app.insight_cache_lock:
            app.insight_cache[cache_key] = (
                item["master_summary"],
                "flan-t5-local",
            )
        with patch.object(app, "ensure_local_opinion_model", return_value=False):
            insight, source = app.generate_why_it_matters(item)

        self.assertNotEqual(insight, item["master_summary"])
        self.assertIn("product roadmaps", insight)
        self.assertEqual(source, "fallback")

    def test_bouncer_thresholds_keep_deprioritize_and_drop(self):
        cases = [
            (0.20, True, "keep"),
            (0.50, True, "low_priority"),
            (0.60, False, "drop"),
            (0.95, False, "drop"),
        ]
        for score, expected_keep, expected_decision in cases:
            with self.subTest(score=score), patch.object(
                app,
                "get_bouncer_not_interested_score",
                return_value=score,
            ):
                decision = app.bouncer_decision(
                    "Signal",
                    "Summary",
                    ["AI"],
                    app.DEFAULT_PROFILE,
                )
            self.assertEqual(decision["keep"], expected_keep)
            self.assertEqual(decision["decision"], expected_decision)


if __name__ == "__main__":
    unittest.main()
