import json
import os
import tempfile
import unittest
from unittest.mock import patch

from starlette.requests import Request

import main


def request_from(ip="127.0.0.1", profile="default"):
    headers = [(b"x-sense-profile", profile.encode("latin1"))]
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "http",
            "path": "/archive/search",
            "raw_path": b"/archive/search",
            "query_string": b"",
            "headers": headers,
            "client": (ip, 50000),
            "server": ("testserver", 80),
        }
    )


class ExtractedArchiveSearchTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.archive_path = os.path.join(
            self.temp_dir.name,
            "briefing_2026-07-23_08-00-00.json",
        )
        with open(self.archive_path, "w", encoding="utf-8") as file_obj:
            json.dump(
                [
                    {
                        "title": "Samsung expands OLED production in India",
                        "date": "2026-07-23",
                        "master_summary": "The company announced a new display investment.",
                        "keywords_found": ["Samsung", "OLED"],
                        "source": "Display Daily",
                        "source_count": 2,
                        "importance_score": 84,
                        "link": "https://example.test/samsung-oled",
                    },
                    {
                        "title": "Broadcast policy consultation opens",
                        "date": "2026-07-22",
                        "master_summary": "A regulator requested industry feedback.",
                        "keywords_found": ["Broadcast"],
                        "source": "Media Desk",
                        "link": "https://example.test/broadcast-policy",
                    },
                ],
                file_obj,
            )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_search_reads_extracted_json_and_never_starts_crawler(self):
        with (
            patch.object(main, "get_profile_history_files", return_value=[self.archive_path]),
            patch.object(main.subprocess, "Popen", side_effect=AssertionError("crawler must not start")) as popen,
        ):
            result = main.search_archive(
                request_from(),
                query="Samsung OLED",
                from_date="2026-07-23",
                to_date="2026-07-23",
                target_sites=None,
                limit=50,
            )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["results"][0]["title"], "Samsung expands OLED production in India")
        self.assertEqual(result["search_scope"], "extracted_archives_only")
        self.assertFalse(result["crawler_started"])
        popen.assert_not_called()

    def test_source_and_date_filters_apply_to_stored_results(self):
        with patch.object(main, "get_profile_history_files", return_value=[self.archive_path]):
            wrong_source = main.search_extracted_intelligence(
                "default",
                "Samsung",
                "2026-07-20",
                "2026-07-24",
                "Media Desk",
            )
            correct_source = main.search_extracted_intelligence(
                "default",
                "Broadcast",
                "2026-07-22",
                "2026-07-22",
                "Media Desk",
            )

        self.assertEqual(wrong_source["count"], 0)
        self.assertEqual(correct_source["count"], 1)
        self.assertEqual(correct_source["results"][0]["source"], "Media Desk")

    def test_invalid_date_returns_clear_error_without_reading_files(self):
        with patch.object(main, "get_profile_history_files") as history_files:
            result = main.search_extracted_intelligence(
                "default",
                "OLED",
                "23-07-2026",
                "2026-07-23",
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("YYYY-MM-DD", result["message"])
        self.assertFalse(result["crawler_started"])
        history_files.assert_not_called()


if __name__ == "__main__":
    unittest.main()
