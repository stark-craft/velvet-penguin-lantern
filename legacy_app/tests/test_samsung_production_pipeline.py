import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.storage import JsonStore
from news_scrapper import application


class SamsungProductionPipelineTests(unittest.TestCase):
    def test_preflight_selects_all_four_safe_pipeline_modes(self):
        cases = [
            (True, True, "samsung_web_search_and_chat", True),
            (True, False, "samsung_web_search_local_bart", True),
            (False, True, "scrapy_extraction_samsung_chat", False),
            (False, False, "local_scrapy_bart", False),
        ]
        for web_available, chat_available, expected_mode, discovery_only in cases:
            with self.subTest(expected_mode):
                application.pipeline_health_cache.update(
                    {"checked_at": 0.0, "result": None}
                )
                with (
                    patch.object(application, "SAMSUNG_PIPELINE_ENABLED", True),
                    patch.object(application, "SAMSUNG_DISCOVERY_ONLY", True),
                    patch.object(
                        application,
                        "check_samsung_web_search",
                        return_value={
                            "available": web_available,
                            "latency_ms": 10,
                            "error": None if web_available else "web down",
                        },
                    ),
                    patch.object(
                        application,
                        "check_samsung_chat",
                        return_value={
                            "available": chat_available,
                            "latency_ms": 20,
                            "error": None if chat_available else "chat down",
                        },
                    ),
                ):
                    result = application.resolve_pipeline_capabilities(
                        force=True
                    )
                self.assertEqual(result["mode"], expected_mode)
                self.assertEqual(result["discovery_only"], discovery_only)

    def test_web_search_success_is_keyword_validated_and_cached(self):
        calls = []

        def enrich(item, keywords=None):
            calls.append(item["link"])
            return {
                **item,
                "full_contents": "Samsung introduced a new artificial intelligence platform.",
                "web_search_content": "Samsung introduced a new artificial intelligence platform.",
                "enrichment_status": "success",
            }

        with tempfile.TemporaryDirectory() as directory:
            cache = JsonStore(Path(directory) / "web.json", dict)
            with (
                patch.object(application, "WEB_SEARCH_CACHE", cache),
                patch.object(application, "WEB_SEARCH_ENRICHMENT_ENABLED", True),
                patch.object(application, "SAMSUNG_PIPELINE_ENABLED", True),
                patch.object(application, "WEB_SEARCH_REQUIRE_SUCCESS", True),
                patch.object(
                    application, "WEB_SEARCH_REQUIRE_KEYWORD_MATCH", True
                ),
                patch.object(
                    application, "enrich_article_with_web_search", enrich
                ),
            ):
                source = [{
                    "title": "Samsung platform update",
                    "link": "https://example.test/story",
                    "date": "2026-07-27",
                }]
                first = application.enrich_raw_articles(
                    source, "Artificial Intelligence, Robotics"
                )
                second = application.enrich_raw_articles(
                    source, "Artificial Intelligence, Robotics"
                )

        self.assertEqual(calls, ["https://example.test/story"])
        self.assertEqual(first[0]["keywords_found"], ["Artificial Intelligence"])
        self.assertEqual(second[0]["enrichment_cache"], "hit")

    def test_strict_samsung_mode_rejects_failed_or_mismatched_extraction(self):
        def failed(item, keywords=None):
            return {
                **item,
                "enrichment_status": "failed",
                "enrichment_error": "service unavailable",
            }

        with tempfile.TemporaryDirectory() as directory:
            cache = JsonStore(Path(directory) / "web.json", dict)
            with (
                patch.object(application, "WEB_SEARCH_CACHE", cache),
                patch.object(application, "WEB_SEARCH_ENRICHMENT_ENABLED", True),
                patch.object(application, "SAMSUNG_PIPELINE_ENABLED", True),
                patch.object(application, "WEB_SEARCH_REQUIRE_SUCCESS", False),
                patch.object(
                    application, "enrich_article_with_web_search", failed
                ),
            ):
                result = application.enrich_raw_articles(
                    [{
                        "title": "Candidate",
                        "link": "https://example.test/story",
                    }],
                    "AI",
                )
        self.assertEqual(result, [])

    def test_chat_success_is_cached_by_cluster_content(self):
        calls = []

        def summarize(item):
            calls.append(item["title"])
            return {
                **item,
                "summary": "Lead.",
                "summary_lead": "Lead.",
                "summary_points": ["Point one.", "Point two.", "Point three."],
                "master_summary": "Lead. • Point one. • Point two. • Point three.",
                "why_it_matters": "Strategic effect.",
                "chat_summary_status": "success",
                "summarized_by": "samsung_chat",
            }

        with tempfile.TemporaryDirectory() as directory:
            cache = JsonStore(Path(directory) / "chat.json", dict)
            with (
                patch.object(application, "CHAT_SUMMARY_CACHE", cache),
                patch.object(application, "FINAL_CHAT_SUMMARY_ENABLED", True),
                patch.object(application, "enrich_article_image_metadata", None),
                patch.object(application, "summarize_article_with_chat", summarize),
            ):
                source = [{
                    "title": "Cluster",
                    "link": "https://example.test/story",
                    "date": "2026-07-27",
                    "full_contents": "Extracted article facts.",
                    "sources": [{
                        "name": "Example",
                        "link": "https://example.test/story",
                    }],
                }]
                first = application.enrich_final_articles(source)
                second = application.enrich_final_articles(source)

        self.assertEqual(calls, ["Cluster"])
        self.assertEqual(first[0]["summary_lead"], "Lead.")
        self.assertEqual(second[0]["chat_summary_cache"], "hit")

    def test_local_summary_uses_same_lead_and_bullet_contract(self):
        result = application.structure_summary_for_dossier(
            {
                "title": "Local fallback",
                "master_summary": (
                    "Samsung announced a new platform. The service launches "
                    "this quarter. It supports enterprise integrations. "
                    "Partners will receive migration tools."
                ),
                "full_contents": (
                    "The platform uses a new architecture. Pricing will be "
                    "published before launch."
                ),
            }
        )
        self.assertEqual(
            result["summary_lead"],
            "Samsung announced a new platform. The service launches this quarter.",
        )
        self.assertGreaterEqual(len(result["summary_points"]), 2)
        self.assertEqual(result["summary_format"], "lead_and_bullets")
        self.assertEqual(result["summarized_by"], "local_bart")


if __name__ == "__main__":
    unittest.main()
