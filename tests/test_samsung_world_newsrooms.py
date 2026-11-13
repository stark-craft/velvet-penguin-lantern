"""Regression checks for the Samsung worldwide newsroom expansion.

Run from the project root:
    python -m unittest discover -s tests -p "test_samsung_world_newsrooms.py"
"""

import json
import tempfile
import unittest
from pathlib import Path

from news_scrapper.samsung_internal_feed import (
    build_samsung_internal_feed,
    is_samsung_global_source,
    is_samsung_local_source,
)


class SamsungWorldwideNewsroomsTests(unittest.TestCase):
    def test_source_registry_contains_distinct_official_destinations(self):
        sites_path = Path(__file__).resolve().parents[1] / "news_scrapper" / "config" / "sites.json"
        sites = json.loads(sites_path.read_text(encoding="utf-8"))
        official = [site for site in sites if site.get("samsung_official_newsroom")]

        self.assertEqual(len(official), 51)  # Global + two India + 44 international + four businesses
        self.assertEqual(len({site["id"] for site in sites}), len(sites))
        self.assertEqual(len({site["url"].rstrip("/") for site in official}), len(official))
        self.assertEqual(sum(site.get("newsroom_type") == "business" for site in official), 4)
        self.assertTrue(all(site.get("enabled") for site in official))
        self.assertTrue(all(site.get("newsroom_language") for site in official))

    def test_regional_and_business_newsrooms_are_global_but_india_remains_local(self):
        for name in (
            "Samsung Newsroom Korea",
            "Samsung Newsroom Germany",
            "Samsung Newsroom Middle East & North Africa",
            "Samsung Semiconductor Newsroom",
            "Samsung Display Newsroom",
            "Samsung SDI Newsroom",
            "Samsung Electro-Mechanics Newsroom",
        ):
            with self.subTest(name=name):
                article = {"source": name, "title": "Regional technology announcement"}
                self.assertTrue(is_samsung_global_source(article))

        local = {"source": "Samsung India Newsroom (Hindi)", "title": "Regional announcement"}
        self.assertTrue(is_samsung_local_source(local))

    def test_classic_projection_accepts_official_business_and_non_english_titles(self):
        stories = [
            {"source": "Samsung Newsroom Korea", "title": "삼성전자 소식", "link": "https://news.samsung.com/kr/korea-story", "date": "2026-11-13"},
            {"source": "Samsung Newsroom Germany", "title": "Neue Entwicklungen", "link": "https://news.samsung.com/de/germany-story", "date": "2026-11-13"},
            {"source": "Samsung Semiconductor Newsroom", "title": "Next generation memory", "link": "https://news.samsungsemiconductor.com/global/memory", "date": "2026-11-13"},
            {"source": "Samsung Display Newsroom", "title": "OLED technology announcement", "link": "https://global.samsungdisplay.com/oled", "date": "2026-11-13"},
            {"source": "Samsung India Newsroom (Hindi)", "title": "नया समाचार", "link": "https://news.samsung.com/bharat/india-story", "date": "2026-11-13"},
            {"source": "Unrelated Technology Blog", "title": "Samsung is mentioned in passing", "link": "https://example.com/other", "date": "2026-11-13"},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "briefing_2026-11-13_12-00-00.json"
            path.write_text(json.dumps(stories, ensure_ascii=False), encoding="utf-8")
            result = build_samsung_internal_feed([path], limit=100)

        global_sources = {item["source"] for item in result["global"]}
        self.assertIn("Samsung Newsroom Korea", global_sources)
        self.assertIn("Samsung Newsroom Germany", global_sources)
        self.assertIn("Samsung Semiconductor Newsroom", global_sources)
        self.assertIn("Samsung Display Newsroom", global_sources)
        self.assertNotIn("Unrelated Technology Blog", global_sources)
        self.assertEqual([item["source"] for item in result["local"]], ["Samsung India Newsroom (Hindi)"])


if __name__ == "__main__":
    unittest.main()
