import json
import os
import tempfile
import unittest
from unittest.mock import patch

from starlette.requests import Request

from news_scrapper import application as main


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

    def test_date_pages_include_all_matches_after_private_hidden_filter(self):
        records = [
            {"title": "OLED older", "date": "2026-07-20", "link": "https://test/old"},
            {"title": "OLED newest", "date": "2026-07-24", "link": "https://test/new"},
            {"title": "OLED hidden", "date": "2026-07-25", "link": "https://test/hidden"},
        ]
        with open(self.archive_path, "w") as file_obj:
            json.dump(records, file_obj)
        with (
            patch.object(main, "get_profile_history_files", return_value=[self.archive_path]),
            patch.object(main, "filter_viewer_hidden", side_effect=lambda items, *_: [a for a in items if a["title"] != "OLED hidden"]),
        ):
            first = main.search_archive(request_from(), query="OLED", from_date=None, to_date=None, target_sites=None, limit=1, offset=0, sort="date_desc")
            second = main.search_archive(request_from(), query="OLED", from_date=None, to_date=None, target_sites=None, limit=1, offset=1, sort="date_desc")
        self.assertEqual(first["total"], 2)
        self.assertTrue(first["has_more"])
        self.assertEqual(first["results"][0]["title"], "OLED newest")
        self.assertEqual(second["results"][0]["title"], "OLED older")
        self.assertFalse(second["has_more"])

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

    def test_warm_local_query_measures_request_count_and_elapsed_time(self):
        import time
        # First cold query (parses file), second warm (cached) should be faster and not re-parse
        with patch.object(main, "get_profile_history_files", return_value=[self.archive_path]):
            # Clear cache
            main._archive_search_cache.clear()
            start_cold = time.perf_counter()
            r1 = main.search_extracted_intelligence("default", "Samsung", None, None, None, limit=10)
            elapsed_cold = (time.perf_counter() - start_cold) * 1000
            # Record request count: we count via cache hits/misses
            misses_before = main._archive_search_cache_misses
            hits_before = main._archive_search_cache_hits
            start_warm = time.perf_counter()
            r2 = main.search_extracted_intelligence("default", "Samsung", None, None, None, limit=10)
            elapsed_warm = (time.perf_counter() - start_warm) * 1000
            self.assertEqual(r1["count"], r2["count"])
            self.assertEqual(r1["results"][0]["title"], r2["results"][0]["title"])
            # Warm should be faster or at least not slower than cold by large margin, and should hit cache
            self.assertGreater(main._archive_search_cache_hits, hits_before)
            # Record request count and elapsed time (for manual verification, not strict threshold due to CI variance)
            # We assert warm is reasonably fast (<50ms) and request count is 1 archive file
            self.assertLess(elapsed_warm, 50, f"warm query took {elapsed_warm:.1f}ms, expected <50ms")
            self.assertEqual(r2["archive_files_searched"], 1)


if __name__ == "__main__":
    unittest.main()
