import os
import unittest
from unittest.mock import Mock, patch

from news_scrapper.adapters import article_metadata
from news_scrapper.adapters import samsung_chat
from news_scrapper.adapters import samsung_web_search


class AdapterContractTests(unittest.TestCase):
    def test_web_search_uses_legacy_headers_and_enriches_matching_reference(self):
        response = Mock()
        response.status_code = 200
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "references": [{
                "title": "DTH operator launches new broadcast service",
                "link": "https://publisher.example/dth-service",
                "publisher": "Publisher",
                "description": "A DTH operator launched a new television broadcast service in India.",
                "content": "The platform includes new set top box software and channel discovery features.",
            }]
        }
        env = {"SAMSUNG_WEB_SEARCH_TOKEN": "secret-token", "SAMSUNG_WEB_SEARCH_CLIENT": "client-name"}
        with patch.dict(os.environ, env, clear=False), patch.object(samsung_web_search.RATE_LIMITER, "acquire"), patch.object(samsung_web_search, "tls_verify", return_value=True), patch.object(samsung_web_search.requests, "post", return_value=response) as post:
            item = samsung_web_search.enrich_article_with_web_search({
                "title": "DTH operator launches new broadcast service",
                "link": "https://publisher.example/dth-service",
                "snippet": "DTH broadcast launch",
            })
        self.assertEqual(item["enrichment_status"], "success")
        request = post.call_args.kwargs
        self.assertEqual(request["headers"]["x-generative-ai-client"], "client-name")
        self.assertEqual(request["headers"]["x-openapi-token"], "Bearer secret-token")
        self.assertTrue(request["json"]["data_source"]["web_search"])
        self.assertIs(request["verify"], True)

    def test_web_search_parses_proven_reference_shape_and_rejects_noise(self):
        with (
            patch.object(
                samsung_web_search,
                "call_samsung_web_search_api",
                return_value={
                "status": "SUCCESS",
                "event_status": "RESPONSE",
                "content": "Conversational answer that must not replace the reference.",
                "content_references": [{
                    "plugin": "external-knowledge-search",
                    "references": [
                        {
                            "query": "Samsung AI TV latest news",
                            "publisher": "",
                            "published_time": "",
                            "title": "[1] Unrelated video",
                            "description": [""],
                            "scraping": False,
                            "link": "https://www.youtube.com/watch?v=noise",
                            "similarity": 0.05,
                            "content": "Unrelated video snippet.",
                        },
                        {
                            "query": "Samsung AI TV latest news",
                            "publisher": "The Verge",
                            "published_time": "2026-07-27",
                            "title": "[2] Samsung display update | The Verge",
                            "description": [""],
                            "scraping": False,
                            "link": "https://www.theverge.com/news/samsung-display",
                            "similarity": 0.51,
                            "content": "Samsung announced a display technology update.",
                        },
                    ],
                }],
                },
            ),
            patch.object(
                samsung_web_search,
                "fetch_exact_article_content",
                return_value={
                    "content": (
                        "Samsung announced a complete display technology "
                        "article body with product, timing, and market details."
                    ),
                    "date": "2026-07-27",
                    "top_image": "https://www.theverge.com/image.jpg",
                },
            ),
        ):
            item = samsung_web_search.enrich_article_with_web_search({
                "title": "Samsung display update",
                "link": "https://www.theverge.com/news/samsung-display",
            })

        self.assertEqual(item["enrichment_status"], "success")
        self.assertEqual(item["source"], "The Verge")
        self.assertEqual(item["date"], "2026-07-27")
        self.assertEqual(item["web_search_similarity"], 0.51)
        self.assertTrue(item["web_search_scraping"])
        self.assertEqual(
            item["web_search_content_scope"], "targeted_article_fetch"
        )
        self.assertNotIn("False", item["full_contents"])
        self.assertNotIn("Conversational answer", item["full_contents"])
        self.assertIn("complete display technology", item["full_contents"])

    def test_web_search_will_not_substitute_same_domain_article(self):
        with patch.object(
            samsung_web_search,
            "call_samsung_web_search_api",
            return_value={
                "status": "SUCCESS",
                "content_references": [{
                    "references": [{
                        "title": "Different Samsung story",
                        "link": "https://www.theverge.com/news/different-story",
                        "content": "A detailed but different Samsung story.",
                    }],
                }],
            },
        ):
            item = samsung_web_search.enrich_article_with_web_search({
                "title": "Requested Samsung story",
                "link": "https://www.theverge.com/news/requested-story",
            })

        self.assertEqual(item["enrichment_status"], "failed")
        self.assertIn("exact discovered article URL", item["enrichment_error"])

    def test_chat_uses_legacy_contract_and_applies_summary(self):
        response = Mock()
        response.status_code = 200
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "status": "SUCCESS",
            "content": '{"title":"Broadcast update","summary_lead":"Executive summary.","key_points":["The operator launched a new service.","The rollout covers connected television devices.","The announcement affects distribution partners."],"ppt_summary":"Slide summary.","why_it_matters":"Strategic impact.","article_intent":"Product Launch","category":"Broadcasting","region":"Local","importance_score":8}',
        }
        with patch.object(samsung_chat, "CLIENT", "client-name"), patch.object(samsung_chat, "TOKEN", "secret-token"), patch.object(samsung_chat, "MODEL_ID", "model-id"), patch.object(samsung_chat.RATE_LIMITER, "acquire"), patch.object(samsung_chat, "tls_verify", return_value=True), patch.object(samsung_chat.requests, "post", return_value=response) as post:
            item = samsung_chat.summarize_article_with_chat({"title": "Old title", "full_contents": "Broadcast article facts."})
        self.assertEqual(item["chat_summary_status"], "success")
        self.assertEqual(item["summary_lead"], "Executive summary.")
        self.assertEqual(len(item["summary_points"]), 3)
        self.assertEqual(item["article_intent"], "Product Launch")
        self.assertEqual(item["importance_score"], 80)
        request = post.call_args.kwargs
        self.assertEqual(request["json"]["modelIds"], ["model-id"])
        self.assertIsNone(request["json"]["llmConfig"]["seed"])
        self.assertFalse(request["json"]["isStream"])
        self.assertFalse(request["stream"])
        self.assertEqual(request["headers"]["x-openapi-token"], "Bearer secret-token")

    def test_chat_normalizes_legacy_base_url_to_messages_route(self):
        self.assertEqual(
            samsung_chat.normalize_chat_url(
                "https://example.test/swahq/trial/api-chat/"
            ),
            "https://example.test/swahq/trial/api-chat/openapi/chat/v1/messages",
        )
        self.assertEqual(
            samsung_chat.normalize_chat_url(
                "https://example.test/openapi/chat/v1/messages"
            ),
            "https://example.test/openapi/chat/v1/messages",
        )

    def test_chat_404_diagnostic_is_specific_and_redacts_tokens(self):
        response = Mock()
        response.status_code = 404
        response.text = (
            "route failed with Bearer "
            "eyJabcdefghijklmnopqrstuvwxyz.abcdefghijklmnopqrstuvwxyz.signaturevalue123456789"
        )
        with (
            patch.object(samsung_chat, "CLIENT", "client-name"),
            patch.object(samsung_chat, "TOKEN", "secret-token"),
            patch.object(samsung_chat, "MODEL_ID", "model-id"),
            patch.object(samsung_chat.RATE_LIMITER, "acquire"),
            patch.object(
                samsung_chat.requests, "post", return_value=response
            ),
        ):
            with self.assertRaises(RuntimeError) as raised:
                samsung_chat.call_samsung_chat("health")
        message = str(raised.exception)
        self.assertIn("HTTP 404", message)
        self.assertIn("/openapi/chat/v1/messages", message)
        self.assertNotIn("eyJabcdefghijklmnopqrstuvwxyz", message)

    def test_chat_rejects_unstructured_summary_without_key_points(self):
        with patch.object(
            samsung_chat,
            "call_samsung_chat",
            return_value={
                "status": "SUCCESS",
                "content": '{"summary_lead":"Only a paragraph."}',
            },
        ):
            item = samsung_chat.summarize_article_with_chat(
                {"title": "Incomplete", "full_contents": "Article facts."}
            )
        self.assertEqual(item["chat_summary_status"], "failed")
        self.assertIn("key_points", item["chat_summary_error"])

    def test_chat_prompt_keeps_complete_extracted_article(self):
        long_content = ("A" * 13000) + " UNIQUE_END_OF_ARTICLE"
        captured = {}

        def call(prompt):
            captured["prompt"] = prompt
            return {
                "status": "SUCCESS",
                "content": (
                    '{"summary_lead":"Complete article summary.",'
                    '"key_points":["First complete factual point.",'
                    '"Second complete factual point.",'
                    '"Third complete factual point."],'
                    '"why_it_matters":"Strategic impact."}'
                ),
            }

        with patch.object(samsung_chat, "call_samsung_chat", side_effect=call):
            result = samsung_chat.summarize_article_with_chat(
                {"title": "Long article", "full_contents": long_content}
            )

        self.assertEqual(result["chat_summary_status"], "success")
        self.assertIn("UNIQUE_END_OF_ARTICLE", captured["prompt"])

    def test_image_metadata_reads_open_graph_without_disabling_tls(self):
        response = Mock()
        response.url = "https://publisher.example/story"
        response.content = b'<html><head><meta property="og:image" content="/image.jpg"></head></html>'
        response.raise_for_status.return_value = None
        with patch.object(article_metadata, "tls_verify", return_value=True), patch.object(article_metadata.requests, "get", return_value=response) as get:
            item = article_metadata.enrich_article_image_metadata({"link": response.url})
        self.assertEqual(item["top_image"], "https://publisher.example/image.jpg")
        self.assertIs(get.call_args.kwargs["verify"], True)


if __name__ == "__main__":
    unittest.main()
