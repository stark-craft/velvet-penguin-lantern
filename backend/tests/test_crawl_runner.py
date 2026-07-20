import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from signalroom.services.crawl_runner import CrawlRunError, ScrapyRunner


class CrawlRunnerHealthTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.sites_dir = self.root / "sites"
        self.output_dir = self.root / "crawls"
        self.sites_dir.mkdir()
        self.output_dir.mkdir()
        (self.sites_dir / "default.json").write_text("[]", encoding="utf-8")
        self.runner = ScrapyRunner(
            SimpleNamespace(
                sites_dir=self.sites_dir,
                crawl_output_dir=self.output_dir,
                crawler_timeout_seconds=30,
                keep_crawl_artifacts=False,
                timezone_name="UTC",
                scrapy_log_level="WARNING",
            )
        )
        self.profile = SimpleNamespace(
            id="default", sources_file="default.json", keywords=("AI",)
        )

    def tearDown(self):
        self.temporary.cleanup()

    @staticmethod
    def _artifact_paths(command):
        output = Path(command[command.index("-O") + 1])
        stats_argument = next(
            value for value in command if str(value).startswith("stats_file=")
        )
        return output, Path(stats_argument.split("=", 1)[1])

    def _completed_crawl(self, source_health):
        def run(command, **_kwargs):
            output, stats = self._artifact_paths(command)
            output.write_text("[]", encoding="utf-8")
            stats.write_text(
                json.dumps(
                    {
                        "stats": {"signalroom/sites_loaded": 1},
                        "source_health": source_health,
                    }
                ),
                encoding="utf-8",
            )
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        return run

    def test_source_health_is_returned_for_a_reachable_empty_run(self):
        health = {
            "configured": 1,
            "attempted": 1,
            "responded": 1,
            "failed": 0,
            "all_sources_failed": False,
            "no_sources_attempted": False,
        }
        with patch(
            "signalroom.services.crawl_runner.subprocess.run",
            side_effect=self._completed_crawl(health),
        ):
            result = self.runner.run(
                self.profile,
                date(2026, 7, 19),
                date(2026, 7, 20),
                run_id="health-ok",
            )

        self.assertEqual(result.articles, [])
        self.assertEqual(result.source_health["responded"], 1)
        self.assertEqual(result.stats["signalroom/sites_loaded"], 1)
        self.assertFalse(result.output_file.exists())

    def test_all_source_failure_fails_the_crawl(self):
        health = {
            "configured": 2,
            "attempted": 2,
            "responded": 0,
            "failed": 2,
            "all_sources_failed": True,
            "no_sources_attempted": False,
        }
        with patch(
            "signalroom.services.crawl_runner.subprocess.run",
            side_effect=self._completed_crawl(health),
        ):
            with self.assertRaisesRegex(CrawlRunError, "could not reach any configured source"):
                self.runner.run(
                    self.profile,
                    date(2026, 7, 19),
                    date(2026, 7, 20),
                    run_id="health-failed",
                )


if __name__ == "__main__":
    unittest.main()
