import json
import tempfile
import unittest
from pathlib import Path

from news_scrapper.samsung_internal_feed import build_samsung_internal_feed


class SamsungInternalFeedTests(unittest.TestCase):
    def write_archive(self, root, date, suffix, records):
        path = Path(root) / f"briefing_{date}_{suffix}.json"
        path.write_text(json.dumps(records), encoding="utf-8")
        return path

    def test_explicit_sources_route_to_local_and_sampark(self):
        with tempfile.TemporaryDirectory() as root:
            archive = self.write_archive(root, "2026-08-23", "080000", [
                {"id": "global", "title": "Samsung launches a display", "source": "Reuters", "date": "2026-08-23"},
                {"id": "local", "title": "Retail update", "source": "Samsung India", "date": "2026-08-23"},
                {"id": "inside", "title": "Town hall notes", "source": "Sampark", "date": "2026-08-23"},
                {"id": "not-local", "title": "Samsung phone review", "source": "Indian Express", "region": "India", "date": "2026-08-23"},
            ])
            feed = build_samsung_internal_feed([archive])
            self.assertEqual([item["id"] for item in feed["local"]], ["local"])
            self.assertEqual([item["id"] for item in feed["sampark"]], ["inside"])
            self.assertCountEqual([item["id"] for item in feed["global"]], ["global", "not-local"])

    def test_retained_history_fills_to_100(self):
        with tempfile.TemporaryDirectory() as root:
            paths = []
            for day in range(1, 4):
                records = [{
                    "id": f"day-{day}-{index}",
                    "title": f"Samsung retained story {day}-{index}",
                    "link": f"https://example.com/{day}/{index}",
                    "source": "Global Desk",
                    "date": f"2026-08-0{day}",
                } for index in range(50)]
                paths.append(self.write_archive(root, f"2026-08-0{day}", "080000", records))
            feed = build_samsung_internal_feed(paths)
            self.assertEqual(len(feed["global"]), 100)
            self.assertEqual(feed["limit_per_channel"], 100)
            self.assertEqual(feed["archive"]["files_scanned"], 3)

    def test_multi_source_cluster_ranks_before_newer_single_source(self):
        with tempfile.TemporaryDirectory() as root:
            archive = self.write_archive(root, "2026-08-23", "080000", [
                {"id": "new", "title": "Samsung newest", "link": "https://x/new", "source": "A", "source_count": 1, "date": "2026-08-23"},
                {"id": "cluster", "title": "Samsung cluster", "link": "https://x/cluster", "source": "A", "source_count": 4, "date": "2026-08-20"},
            ])
            feed = build_samsung_internal_feed([archive])
            self.assertEqual(feed["global"][0]["id"], "cluster")

    def test_incidental_full_text_or_keyword_match_is_not_global_news(self):
        with tempfile.TemporaryDirectory() as root:
            archive = self.write_archive(root, "2026-08-23", "080000", [
                {
                    "id": "football",
                    "title": "How to watch the weekend football",
                    "summary": "A guide to this weekend's fixtures.",
                    "full_contents": "Supported televisions include Samsung Smart TVs.",
                    "keywords_found": ["samsung", "tv", "broadcast"],
                    "source": "Tech press",
                },
                {
                    "id": "galaxy",
                    "title": "Galaxy roadmap leaks ahead of launch",
                    "summary": "A new flagship handset is expected soon.",
                    "source": "Tech press",
                },
                {
                    "id": "category-page",
                    "title": "See all latest",
                    "summary": "Samsung Galaxy launches are listed here.",
                    "source": "Tech press",
                },
            ])
            feed = build_samsung_internal_feed([archive])
            self.assertEqual([item["id"] for item in feed["global"]], ["galaxy"])

    def test_same_url_across_archives_is_returned_once(self):
        with tempfile.TemporaryDirectory() as root:
            older = self.write_archive(root, "2026-08-20", "080000", [
                {"id": "old", "title": "Samsung duplicate", "link": "https://x/duplicate", "source": "A", "source_count": 1, "date": "2026-08-20"},
            ])
            newer = self.write_archive(root, "2026-08-23", "080000", [
                {"id": "new", "title": "Samsung duplicate", "link": "https://x/duplicate", "source": "A", "source_count": 3, "date": "2026-08-23"},
            ])
            feed = build_samsung_internal_feed([older, newer])
            self.assertEqual(len(feed["global"]), 1)
            self.assertEqual(feed["global"][0]["id"], "new")


if __name__ == "__main__":
    unittest.main()
