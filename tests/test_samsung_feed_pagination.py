"""Samsung retained-archive pagination regression.

Run:
    python -m unittest discover -s tests -p "test_samsung_feed_pagination.py"
"""
import json
import tempfile
import unittest
from pathlib import Path

from news_scrapper.samsung_internal_feed import build_samsung_internal_feed


class SamsungFeedPaginationTests(unittest.TestCase):
    def test_legacy_top_100_and_uncapped_projection_keep_all_unique_stories(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "briefing_2026-11-17_10-00-00.json"
            articles = [
                {
                    "title": f"Galaxy newsroom story {index}",
                    "link": f"https://news.samsung.com/kr/story-{index}",
                    "source": "Samsung Newsroom Korea",
                    "date": "2026-11-17",
                    "source_count": 1,
                }
                for index in range(137)
            ]
            articles += [
                {
                    "title": f"Samsung India update {index}",
                    "link": f"https://news.samsung.com/in/update-{index}",
                    "source": "Samsung Newsroom India",
                    "date": "2026-11-17",
                }
                for index in range(5)
            ]
            articles.append(dict(articles[0]))  # duplicate across an archive
            path.write_text(json.dumps(articles), encoding="utf-8")

            legacy = build_samsung_internal_feed([path], limit=100)
            full = build_samsung_internal_feed([path], limit=None)
            self.assertEqual(len(legacy["global"]), 100)
            self.assertEqual(len(full["global"]), 137)
            self.assertEqual(len(full["local"]), 5)
            self.assertEqual(full["counts"]["global"], 137)
            self.assertEqual(len({item["link"] for item in full["global"]}), 137)
            self.assertEqual(full["archive"]["files_scanned"], 1)

    def test_empty_archive_full_projection_is_supported(self):
        full = build_samsung_internal_feed([], limit=None)
        self.assertEqual(full["global"], [])
        self.assertEqual(full["local"], [])
        self.assertEqual(full["sampark"], [])


if __name__ == "__main__":
    unittest.main()
