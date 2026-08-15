import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
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

    def test_runtime_web_search_failure_requests_full_scrapy_retry(self):
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
                patch.object(application, "WEB_SEARCH_REQUIRE_SUCCESS", True),
                patch.object(
                    application,
                    "enrich_article_with_web_search",
                    failed,
                ),
            ):
                with self.assertRaises(application.WebSearchRuntimeFailure):
                    application.enrich_raw_articles(
                        [{
                            "title": "Candidate",
                            "link": "https://example.test/story",
                        }],
                        "AI",
                        raise_on_service_failure=True,
                    )

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

    def test_chat_cache_never_replaces_private_article_metadata_or_full_text(self):
        def summarize(item):
            return {
                **item,
                "summary": "Generated lead.",
                "summary_lead": "Generated lead.",
                "summary_points": ["Generated point."],
                "chat_summary_status": "success",
                "summarized_by": "samsung_chat",
            }

        common = {
            "title": "Shared source story",
            "link": "https://example.test/story",
            "date": "2026-07-27",
            "full_contents": "The same extracted article body.",
            "sources": [{
                "name": "Example",
                "link": "https://example.test/story",
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            cache = JsonStore(Path(directory) / "chat.json", dict)
            with (
                patch.object(application, "CHAT_SUMMARY_CACHE", cache),
                patch.object(application, "FINAL_CHAT_SUMMARY_ENABLED", True),
                patch.object(application, "enrich_article_image_metadata", None),
                patch.object(application, "summarize_article_with_chat", summarize),
            ):
                application.enrich_final_articles([
                    {
                        **common,
                        "id": "private-a",
                        "submitted_url": "https://private.test/a",
                        "private_scope": "viewer-a",
                    }
                ])
                second = application.enrich_final_articles([
                    {
                        **common,
                        "id": "private-b",
                        "submitted_url": "https://private.test/b",
                        "private_scope": "viewer-b",
                    }
                ])[0]
                cached_payload = next(iter(cache.read().values()))

        self.assertEqual(second["chat_summary_cache"], "hit")
        self.assertEqual(second["id"], "private-b")
        self.assertEqual(second["submitted_url"], "https://private.test/b")
        self.assertEqual(second["private_scope"], "viewer-b")
        self.assertEqual(second["full_contents"], common["full_contents"])
        for forbidden in (
            "id",
            "submitted_url",
            "private_scope",
            "full_contents",
            "link",
            "sources",
        ):
            self.assertNotIn(forbidden, cached_payload)

    def test_chat_item_failure_uses_local_summary_fallback(self):
        def failed(item):
            return {
                **item,
                "chat_summary_status": "failed",
                "chat_summary_error": "service unavailable",
            }

        def local_fallback(items, profile):
            return [
                application.structure_summary_for_dossier(
                    item,
                    "local_bart",
                )
                for item in items
            ]

        with (
            patch.object(application, "enrich_article_image_metadata", None),
            patch.object(application, "summarize_article_with_chat", failed),
            patch.object(
                application,
                "apply_local_bart_fallback",
                side_effect=local_fallback,
            ),
        ):
            result = application.enrich_final_articles(
                [{
                    "title": "Fallback signal",
                    "master_summary": (
                        "Samsung announced a new system. It launches today. "
                        "The system supports enterprise users."
                    ),
                }],
                use_chat=True,
            )

        self.assertEqual(result[0]["chat_summary_status"], "fallback")
        self.assertEqual(result[0]["summarized_by"], "local_bart")
        self.assertTrue(result[0]["summary_points"])

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

    def test_scheduler_restarts_full_scrapy_if_web_search_dies_after_preflight(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sites = root / "sites.json"
            sites.write_text(
                '{"sites": [{"name": "Example", "url": "https://example.test"}]}',
                encoding="utf-8",
            )
            history = root / "history"
            history.mkdir()
            crawl_commands = []

            class Process:
                def __init__(self, command):
                    self.command = command

                def wait(self, timeout=None):
                    output_path = Path(self.command[self.command.index("-O") + 1])
                    discovery_only = "discovery_only=true" in self.command
                    payload = [{
                        "title": "Samsung AI update",
                        "link": "https://example.test/story",
                        "date": "2026-07-27",
                        "keywords_found": ["Samsung"],
                    }]
                    if not discovery_only:
                        payload[0]["full_contents"] = (
                            "Samsung released an AI update with complete "
                            "article text extracted by Scrapy."
                        )
                    output_path.write_text(json.dumps(payload), encoding="utf-8")
                    return 0

                def poll(self):
                    return 0

                def terminate(self):
                    return None

                def kill(self):
                    return None

            def popen(command, cwd=None):
                crawl_commands.append(command)
                return Process(command)

            def clustering(command, cwd=None, timeout=None, check=None):
                job_id = command[command.index("--job-id") + 1]
                (root / f"clustered_results_{job_id}.json").write_text(
                    json.dumps([{
                        "title": "Samsung AI update",
                        "link": "https://example.test/story",
                        "master_summary": "Samsung released an AI update.",
                        "full_contents": "Complete Scrapy article text.",
                    }]),
                    encoding="utf-8",
                )
                return SimpleNamespace(returncode=0)

            def enrich_or_fail(
                items,
                keywords,
                profile,
                use_web_search,
                **kwargs,
            ):
                if use_web_search:
                    raise application.WebSearchRuntimeFailure("API down")
                return items

            with (
                patch.object(application, "ROOT_DIR", str(root)),
                patch.object(application, "NEWS_CRAWLER_DIR", root),
                patch.object(
                    application,
                    "get_profile_history_dir",
                    return_value=str(history),
                ),
                patch.object(application, "purge_expired_history"),
                patch.object(application.learner, "log_search_data"),
                patch.object(
                    application,
                    "get_profile_config",
                    return_value={
                        "sites_file": str(sites),
                        "keywords": "Samsung",
                        "use_bouncer": False,
                    },
                ),
                patch.object(application.subprocess, "Popen", side_effect=popen),
                patch.object(application.subprocess, "run", side_effect=clustering),
                patch.object(
                    application,
                    "enrich_raw_articles",
                    side_effect=enrich_or_fail,
                ),
                patch.object(
                    application,
                    "enrich_final_articles",
                    side_effect=lambda items, profile, use_chat: items,
                ),
            ):
                result = application.run_scheduler_for_profile(
                    application.DEFAULT_PROFILE,
                    {
                        "mode": "samsung_web_search_and_chat",
                        "web_search": True,
                        "chat": True,
                        "discovery_only": True,
                    },
                )

            self.assertTrue(result)
            self.assertEqual(len(crawl_commands), 2)
            self.assertIn("discovery_only=true", crawl_commands[0])
            self.assertIn("discovery_only=false", crawl_commands[1])
            self.assertEqual(len(list(history.glob("briefing_*.json"))), 1)


if __name__ == "__main__":
    unittest.main()
