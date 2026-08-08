import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from starlette.requests import Request

from core.storage import JsonStore
from news_scrapper import application


def request_from(ip="10.0.0.25"):
    return Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "path": "/viewer/briefings",
            "raw_path": b"/viewer/briefings",
            "query_string": b"",
            "headers": [],
            "client": (ip, 50000),
            "server": ("testserver", 80),
        }
    )


class PersonalBriefingTests(unittest.TestCase):
    def test_private_network_urls_are_rejected(self):
        with patch.object(
            application.socket,
            "getaddrinfo",
            return_value=[(None, None, None, None, ("127.0.0.1", 443))],
        ):
            with self.assertRaisesRegex(ValueError, "Private or local"):
                application.assert_public_article_url("https://example.com/story")

        with self.assertRaisesRegex(ValueError, "Private or local"):
            application.assert_public_article_url("http://localhost/story")

    def test_create_is_private_and_reuses_duplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JsonStore(Path(directory) / "briefings.json", dict)
            executor = Mock()
            with (
                patch.object(application, "PERSONAL_BRIEFING_STORE", store),
                patch.object(application, "personal_briefing_executor", executor),
                patch.object(
                    application,
                    "assert_public_article_url",
                    side_effect=lambda value: value,
                ),
                patch.object(application, "record_usage_activity", return_value=True),
            ):
                first = application.create_personal_url_briefings(
                    request_from(),
                    {"urls": ["https://example.com/story"]},
                )
                duplicate = application.create_personal_url_briefings(
                    request_from(),
                    {"urls": ["https://example.com/story"]},
                )
                other_viewer = application.get_personal_url_briefings(
                    request_from("10.0.0.26")
                )

        self.assertEqual(len(first["accepted"]), 1)
        self.assertEqual(len(duplicate["accepted"]), 0)
        self.assertEqual(len(duplicate["duplicates"]), 1)
        self.assertEqual(other_viewer["items"], [])
        self.assertEqual(executor.submit.call_count, 1)

    def test_processing_uses_direct_extraction_when_web_search_fails(self):
        updates = []
        extracted = {
            "title": "A useful signal",
            "link": "https://example.com/story",
            "source": "example.com",
            "full_contents": "A sufficiently long article body. " * 20,
            "summary": "A useful signal changes the market.",
        }
        with (
            patch.object(
                application,
                "update_personal_briefing_job",
                side_effect=lambda *args, **kwargs: updates.append(kwargs),
            ),
            patch.object(
                application,
                "resolve_pipeline_capabilities",
                return_value={"web_search": True, "chat": False},
            ),
            patch.object(
                application,
                "enrich_article_with_web_search",
                return_value={"enrichment_status": "failed"},
            ),
            patch.object(
                application,
                "fetch_personal_article",
                return_value=extracted,
            ) as direct_fetch,
            patch.object(application, "enrich_article_image_metadata", None),
            patch.object(
                application,
                "apply_local_bart_fallback",
                side_effect=lambda items, profile: [
                    {
                        **items[0],
                        "summary_lead": "A concise lead.",
                        "summary_points": ["One point."],
                    }
                ],
            ),
            patch.object(
                application,
                "generate_why_it_matters",
                return_value=("Strategic consequence.", "fallback"),
            ),
            patch.object(
                application,
                "cluster_personal_briefing_article",
                side_effect=lambda viewer, profile, item: item,
            ),
        ):
            application.process_personal_briefing_job(
                "viewer",
                "default",
                "job",
                "https://example.com/story",
            )

        direct_fetch.assert_called_once()
        self.assertEqual(updates[-1]["status"], "complete")
        self.assertEqual(
            updates[-1]["article"]["why_matters"],
            "Strategic consequence.",
        )
        self.assertEqual(
            updates[-1]["article"]["private_scope"],
            "current_viewer_only",
        )

    def test_resume_requeues_interrupted_jobs(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JsonStore(Path(directory) / "briefings.json", dict)
            store.write(
                {
                    "viewer": {
                        "default": [
                            {
                                "id": "job",
                                "url": "https://example.com/story",
                                "status": "processing",
                            }
                        ]
                    }
                }
            )
            executor = Mock()
            with (
                patch.object(application, "PERSONAL_BRIEFING_STORE", store),
                patch.object(application, "personal_briefing_executor", executor),
            ):
                application.resume_personal_briefing_jobs()
                resumed = store.read()["viewer"]["default"][0]

        self.assertEqual(resumed["status"], "queued")
        executor.submit.assert_called_once()

    def test_semantic_grouping_is_scoped_to_current_viewer(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JsonStore(Path(directory) / "briefings.json", dict)
            store.write(
                {
                    "viewer-a": {
                        "default": [
                            {
                                "id": "old-job",
                                "status": "complete",
                                "article": {
                                    "id": "personal-old-job",
                                    "title": "Related AI story",
                                },
                            }
                        ]
                    },
                    "viewer-b": {
                        "default": [
                            {
                                "id": "other-job",
                                "status": "complete",
                                "article": {
                                    "id": "personal-other-job",
                                    "title": "Must remain private",
                                },
                            }
                        ]
                    },
                }
            )
            engine = Mock()
            engine.semantic_cluster.return_value = [
                [
                    {"id": "personal-old-job", "title": "Related AI story"},
                    {"id": "personal-new-job", "title": "Related AI update"},
                ]
            ]
            with (
                patch.object(application, "PERSONAL_BRIEFING_STORE", store),
                patch.object(
                    application,
                    "MinimalSemanticEngine",
                    create=True,
                ),
                patch(
                    "news_scrapper.semantic_clustering.MinimalSemanticEngine",
                    return_value=engine,
                ),
            ):
                current = application.cluster_personal_briefing_article(
                    "viewer-a",
                    "default",
                    {"id": "personal-new-job", "title": "Related AI update"},
                )
                persisted = store.read()

        self.assertEqual(current["related_private_count"], 1)
        self.assertEqual(
            persisted["viewer-a"]["default"][0]["article"]["related_private_count"],
            1,
        )
        self.assertNotIn(
            "related_private_count",
            persisted["viewer-b"]["default"][0]["article"],
        )

    def test_clear_finished_is_private_and_preserves_active_jobs(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JsonStore(Path(directory) / "briefings.json", dict)
            viewer_key = application.get_viewer_key("10.0.0.25")
            other_key = application.get_viewer_key("10.0.0.26")
            store.write(
                {
                    viewer_key: {
                        "default": [
                            {"id": "ready", "status": "complete"},
                            {"id": "bad", "status": "failed"},
                            {"id": "active", "status": "processing"},
                        ]
                    },
                    other_key: {
                        "default": [{"id": "other", "status": "complete"}]
                    },
                }
            )
            with (
                patch.object(application, "PERSONAL_BRIEFING_STORE", store),
                patch.object(application, "record_usage_activity", return_value=True),
            ):
                result = application.clear_personal_url_briefings(
                    request_from(), {"scope": "finished"}
                )
                persisted = store.read()

        self.assertEqual(result["removed"], 2)
        self.assertTrue(result["active_jobs_preserved"])
        self.assertEqual(
            [job["id"] for job in persisted[viewer_key]["default"]],
            ["active"],
        )
        self.assertEqual(
            [job["id"] for job in persisted[other_key]["default"]],
            ["other"],
        )


if __name__ == "__main__":
    unittest.main()
