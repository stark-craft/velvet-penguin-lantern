import unittest
from unittest.mock import patch

from core.network_safety import assert_public_http_url
from news_scrapper import application
from news_scrapper.adapters import article_metadata


class SecurityHardeningTests(unittest.TestCase):
    def test_public_url_validation_rejects_private_and_local_targets(self):
        for url in (
            "http://127.0.0.1/admin",
            "http://[::1]/admin",
            "http://localhost/admin",
            "http://service.internal/admin",
            "file:///etc/passwd",
            "http://example.com:8080/admin",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                assert_public_http_url(url)

    def test_export_image_fetch_never_contacts_private_network(self):
        with patch.object(application.requests, "get") as get:
            result = application.download_image_for_export(
                "http://127.0.0.1/private-image.png"
            )
        self.assertIsNone(result)
        get.assert_not_called()

    def test_metadata_enrichment_rejects_private_article_url(self):
        with patch.object(article_metadata.requests, "get") as get:
            result = article_metadata.enrich_article_image_metadata(
                {"link": "http://127.0.0.1/private-article"}
            )
        self.assertEqual(result["image_metadata_status"], "failed")
        get.assert_not_called()


if __name__ == "__main__":
    unittest.main()
