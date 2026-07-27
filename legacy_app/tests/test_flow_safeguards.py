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


if __name__ == "__main__":
    unittest.main()
