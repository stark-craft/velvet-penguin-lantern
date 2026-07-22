import os
import unittest
from unittest.mock import Mock, patch

import article_metadata_adapter
import samsung_chat_adapter
import samsung_web_search_adapter


class AdapterContractTests(unittest.TestCase):
    def test_web_search_uses_legacy_headers_and_enriches_matching_reference(self):
        response = Mock()
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
        with patch.dict(os.environ, env, clear=False), patch.object(samsung_web_search_adapter, "tls_verify", return_value=True), patch.object(samsung_web_search_adapter.requests, "post", return_value=response) as post:
            item = samsung_web_search_adapter.enrich_article_with_web_search({
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

    def test_chat_uses_legacy_contract_and_applies_summary(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "status": "SUCCESS",
            "content": '{"title":"Broadcast update","summary":"Executive summary.","ppt_summary":"Slide summary.","why_it_matters":"Strategic impact.","category":"Broadcasting","region":"Local","importance_score":8}',
        }
        with patch.object(samsung_chat_adapter, "CLIENT", "client-name"), patch.object(samsung_chat_adapter, "TOKEN", "secret-token"), patch.object(samsung_chat_adapter, "MODEL_ID", "model-id"), patch.object(samsung_chat_adapter, "tls_verify", return_value=True), patch.object(samsung_chat_adapter.requests, "post", return_value=response) as post:
            item = samsung_chat_adapter.summarize_article_with_chat({"title": "Old title", "full_contents": "Broadcast article facts."})
        self.assertEqual(item["chat_summary_status"], "success")
        self.assertEqual(item["importance_score"], 80)
        request = post.call_args.kwargs
        self.assertEqual(request["json"]["modelIds"], ["model-id"])
        self.assertEqual(request["headers"]["x-openapi-token"], "Bearer secret-token")

    def test_image_metadata_reads_open_graph_without_disabling_tls(self):
        response = Mock()
        response.url = "https://publisher.example/story"
        response.content = b'<html><head><meta property="og:image" content="/image.jpg"></head></html>'
        response.raise_for_status.return_value = None
        with patch.object(article_metadata_adapter, "tls_verify", return_value=True), patch.object(article_metadata_adapter.requests, "get", return_value=response) as get:
            item = article_metadata_adapter.enrich_article_image_metadata({"link": response.url})
        self.assertEqual(item["top_image"], "https://publisher.example/image.jpg")
        self.assertIs(get.call_args.kwargs["verify"], True)


if __name__ == "__main__":
    unittest.main()
