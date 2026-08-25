import os
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import requests

from core.storage import JsonStore
from venture_lens.discovery import (
    PROVIDER_TTLS,
    VentureDiscoveryService,
    deduplicate_papers,
    normalize_huggingface,
    normalize_openalex_paper,
)
from venture_lens.service import VentureLensService
from venture_lens.providers import huggingface, openalex, patents, social


class FakeResponse:
    def __init__(self, payload=None, content=b"", error=None):
        self.payload = payload
        self.content = content
        self.error = error

    def json(self):
        return self.payload

    def raise_for_status(self):
        if self.error:
            raise self.error


class VentureDiscoveryTests(unittest.TestCase):
    def services_for(self, directory):
        root = Path(directory)
        venture = VentureLensService()
        venture.github_store = JsonStore(root / "github.json", dict)
        venture.research_store = JsonStore(root / "research.json", dict)
        discovery = VentureDiscoveryService()
        discovery.openalex_store = JsonStore(root / "openalex.json", dict)
        discovery.models_store = JsonStore(root / "models.json", dict)
        discovery.datasets_store = JsonStore(root / "datasets.json", dict)
        discovery.patents_store = JsonStore(root / "patents.json", dict)
        discovery.social_store = JsonStore(root / "social.json", dict)
        discovery.snapshot_store = JsonStore(root / "snapshots.json", dict)
        return venture, discovery

    def test_provider_ttls_are_independent_from_the_news_scheduler(self):
        self.assertEqual(PROVIDER_TTLS["github"], timedelta(hours=6))
        self.assertEqual(PROVIDER_TTLS["huggingface"], timedelta(hours=6))
        self.assertEqual(PROVIDER_TTLS["arxiv"], timedelta(hours=12))
        self.assertEqual(PROVIDER_TTLS["openalex"], timedelta(hours=12))
        self.assertEqual(PROVIDER_TTLS["epo"], timedelta(hours=24))
        self.assertEqual(PROVIDER_TTLS["x"], timedelta(minutes=30))

    def test_discovery_contract_diversifies_featured_artifacts_and_hides_unconfigured_providers(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "EPO_OPS_CLIENT_ID": "",
            "EPO_OPS_CLIENT_SECRET": "",
            "X_BEARER_TOKEN": "",
        }, clear=False):
            venture, discovery = self.services_for(directory)
            discovery.models_store.write(discovery._store_payload([
                normalize_huggingface({"id": "team/model", "downloads": 500, "likes": 20}, "model")
            ], "Hugging Face models"))
            discovery.datasets_store.write(discovery._store_payload([
                normalize_huggingface({"id": "team/data", "downloads": 400, "likes": 10}, "dataset")
            ], "Hugging Face datasets"))
            with patch("venture_lens.discovery.venture_lens_service", venture):
                payload = discovery.discovery()
            self.assertEqual(payload["status"], "success")
            self.assertLessEqual(len(payload["featured"]), 6)
            self.assertLessEqual(len(payload["stream"]), 12)
            self.assertEqual(len({item["kind"] for item in payload["featured"]}), len(payload["featured"]))
            self.assertIn("models", payload["lanes"])
            self.assertIn("datasets", payload["lanes"])
            self.assertFalse(payload["providers"]["epo"]["available"])
            self.assertFalse(payload["providers"]["x"]["available"])
            required = {"id", "kind", "title", "summary", "url", "source", "published_at", "updated_at", "category", "metrics", "momentum", "starter_snapshot"}
            self.assertTrue(required.issubset(payload["featured"][0]))

    def test_openalex_refresh_preserves_healthy_cache_on_timeout_rate_limit_or_malformed_data(self):
        sample = {
            "id": "W1", "title": "Evidence paper", "summary": "A useful result.",
            "url": "https://openalex.org/W1", "citations": 9,
        }
        with tempfile.TemporaryDirectory() as directory:
            _venture, discovery = self.services_for(directory)
            with patch("venture_lens.discovery.fetch_openalex_works", return_value=[sample]):
                live = discovery.refresh_provider("openalex", force=True)
            self.assertEqual(live["status"], "live")
            for failure in (
                requests.Timeout("provider timeout"),
                requests.HTTPError("429 rate limited"),
                None,
            ):
                mocked = patch("venture_lens.discovery.fetch_openalex_works", side_effect=failure) if failure else patch("venture_lens.discovery.fetch_openalex_works", return_value=[{}])
                with mocked:
                    retained = discovery.refresh_provider("openalex", force=True)
                self.assertTrue(retained["refresh_failed"])
                self.assertEqual(retained["items"][0]["id"], "W1")

    def test_huggingface_models_and_datasets_refresh_independently_and_keep_last_success(self):
        model = {"id": "org/model", "downloads": 1000, "likes": 12}
        dataset = {"id": "org/dataset", "downloads": 800, "likes": 8}
        with tempfile.TemporaryDirectory() as directory:
            _venture, discovery = self.services_for(directory)
            with patch("venture_lens.discovery.fetch_models", return_value=[model]), patch("venture_lens.discovery.fetch_datasets", return_value=[dataset]):
                result = discovery.refresh_provider("huggingface", force=True)
            self.assertEqual(result["models"]["items"][0]["kind"], "model")
            self.assertEqual(result["datasets"]["items"][0]["kind"], "dataset")
            with patch("venture_lens.discovery.fetch_models", side_effect=requests.Timeout()), patch("venture_lens.discovery.fetch_datasets", return_value=[dataset]):
                retained = discovery.refresh_provider("huggingface", force=True)
            self.assertTrue(retained["models"]["refresh_failed"])
            self.assertEqual(retained["models"]["items"][0]["id"], "org/model")
            self.assertFalse(retained["datasets"].get("refresh_failed", False))

    def test_paper_deduplication_merges_openalex_evidence_without_double_counting(self):
        arxiv = {"id": "2401.1", "kind": "paper", "title": "A Shared Title", "source": "arXiv", "doi": "10.1/demo", "metrics": {"authors": 2}}
        openalex = normalize_openalex_paper({"id": "W1", "title": "A Shared Title", "doi": "10.1/demo", "citations": 42, "venue": "Journal"})
        merged = deduplicate_papers([arxiv, openalex])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["metrics"]["citations"], 42)
        self.assertEqual(merged[0]["source"], "arXiv + OpenAlex")

    def test_momentum_is_only_calculated_after_two_metric_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            _venture, discovery = self.services_for(directory)
            artifact = normalize_huggingface({"id": "org/model", "downloads": 100, "likes": 0}, "model")
            discovery._record_snapshots([artifact])
            self.assertIsNone(discovery._with_momentum([artifact])[0]["momentum"])
            updated = {**artifact, "metrics": {"downloads": 150, "likes": 0}}
            discovery._record_snapshots([updated])
            self.assertEqual(discovery._with_momentum([updated])[0]["momentum"], 50.0)


class VentureProviderAdapterTests(unittest.TestCase):
    def test_openalex_normalizes_citations_institutions_and_abstract(self):
        payload = {"results": [{
            "id": "https://openalex.org/W1",
            "title": "Grounded agents",
            "doi": "https://doi.org/10.1/demo",
            "publication_date": "2026-08-20",
            "cited_by_count": 12,
            "abstract_inverted_index": {"Agent": [0], "evidence": [1]},
            "authorships": [{"author": {"display_name": "A. Researcher"}, "institutions": [{"display_name": "Lab"}]}],
            "primary_topic": {"display_name": "Artificial Intelligence"},
            "primary_location": {"landing_page_url": "https://example.test/paper", "source": {"display_name": "Journal"}},
        }]}
        with patch.object(openalex.requests, "get", return_value=FakeResponse(payload)):
            items = openalex.fetch_openalex_works()
        self.assertEqual(items[0]["citations"], 12)
        self.assertEqual(items[0]["institutions"], ["Lab"])
        self.assertEqual(items[0]["summary"], "Agent evidence")

    def test_huggingface_public_adapter_uses_optional_auth_and_native_metrics(self):
        payload = [{"id": "org/model", "downloads": 100, "likes": 4, "tags": ["text-generation"], "createdAt": "2026-01-01"}]
        with patch.dict(os.environ, {"HUGGINGFACE_TOKEN": ""}, clear=False), patch.object(huggingface.requests, "get", return_value=FakeResponse(payload)) as request:
            items = huggingface.fetch_models()
        self.assertNotIn("Authorization", request.call_args.kwargs["headers"])
        self.assertEqual(items[0]["downloads"], 100)
        self.assertEqual(items[0]["likes"], 4)

    def test_epo_stays_dormant_without_credentials_and_parses_configured_results(self):
        with patch.dict(os.environ, {"EPO_OPS_CLIENT_ID": "", "EPO_OPS_CLIENT_SECRET": ""}, clear=False):
            self.assertFalse(patents.configured())
            self.assertEqual(patents.fetch_patents(), [])
        xml = b'''<ops:world-patent-data xmlns:ops="urn:ops" xmlns:ex="urn:ex"><ops:search-result><ex:exchange-documents><ex:exchange-document country="EP" doc-number="123" kind="A1"><ex:invention-title>Machine system</ex:invention-title><ex:abstract><ex:p>Patent abstract</ex:p></ex:abstract><ex:publication-reference><ex:date>20260820</ex:date></ex:publication-reference></ex:exchange-document></ex:exchange-documents></ops:search-result></ops:world-patent-data>'''
        with patch.dict(os.environ, {"EPO_OPS_CLIENT_ID": "client", "EPO_OPS_CLIENT_SECRET": "secret"}, clear=False), patch.object(patents.requests, "post", return_value=FakeResponse({"access_token": "token"})), patch.object(patents.requests, "get", return_value=FakeResponse(content=xml)):
            items = patents.fetch_patents()
        self.assertEqual(items[0]["id"], "EP123A1")
        self.assertEqual(items[0]["title"], "Machine system")

    def test_x_is_optional_and_never_required_for_discovery(self):
        with patch.dict(os.environ, {"X_BEARER_TOKEN": ""}, clear=False):
            self.assertFalse(social.configured())
            self.assertEqual(social.fetch_social_signals(), [])
        payload = {"data": [{"id": "1", "text": "New open model", "created_at": "2026-08-20T00:00:00Z", "public_metrics": {"like_count": 5, "repost_count": 2}}]}
        with patch.dict(os.environ, {"X_BEARER_TOKEN": "token"}, clear=False), patch.object(social.requests, "get", return_value=FakeResponse(payload)):
            items = social.fetch_social_signals()
        self.assertEqual(items[0]["engagement"], 7)


if __name__ == "__main__":
    unittest.main()
