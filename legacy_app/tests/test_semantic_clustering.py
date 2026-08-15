import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import numpy as np

from news_scrapper import semantic_clustering
from news_scrapper.semantic_clustering import MinimalSemanticEngine


class SemanticClusteringSafeguardTests(unittest.TestCase):
    def test_documented_true_value_enables_offline_mode(self):
        with patch.dict(os.environ, {"SENSE_OFFLINE_ONLY": "true"}):
            self.assertTrue(semantic_clustering.env_flag("SENSE_OFFLINE_ONLY"))

    def test_local_sentiment_model_loads_in_offline_mode(self):
        with TemporaryDirectory() as temporary_directory:
            local_model = Path(temporary_directory) / "distilbert-sst-2"
            local_model.mkdir()
            fake_pipeline = object()
            with (
                patch.object(semantic_clustering, "CLUSTERING_AVAILABLE", False),
                patch.object(semantic_clustering, "SENTIMENT_AVAILABLE", True),
                patch.object(semantic_clustering, "OFFLINE_ONLY", True),
                patch.object(
                    semantic_clustering, "SENTIMENT_MODEL_DIR", local_model
                ),
                patch.object(
                    semantic_clustering,
                    "pipeline",
                    return_value=fake_pipeline,
                ) as pipeline_mock,
            ):
                engine = MinimalSemanticEngine(load_summarizer=False)

            self.assertIs(engine.sentiment_analyzer, fake_pipeline)
            pipeline_mock.assert_called_once_with(
                "sentiment-analysis",
                model=str(local_model),
                tokenizer=str(local_model),
                device=-1,
            )

    def test_same_publisher_cannot_inflate_one_event(self):
        engine = MinimalSemanticEngine.__new__(MinimalSemanticEngine)
        articles = [
            {"source": "Publisher A", "link": "https://a.example/one"},
            {"source": "Publisher A", "link": "https://a.example/two"},
            {"source": "Publisher B", "link": "https://b.example/one"},
        ]
        embeddings = np.array([
            [1.0, 0.0],
            [0.99, 0.01],
            [0.98, 0.02],
        ])
        clusters = engine.enforce_source_diversity([[0, 1, 2]], articles, embeddings)
        self.assertEqual(len(clusters), 2)
        for cluster in clusters:
            identities = [engine.source_identity(articles[index]) for index in cluster]
            self.assertEqual(len(identities), len(set(identities)))

    def test_fused_event_preserves_broadcast_scope_metadata(self):
        article = {
            "title": "Broadcast platform policy update",
            "summary": "A broadcast platform announced a policy update for cable operators today.",
            "link": "https://broadcast.example/policy",
            "source": "Broadcast Trade",
            "date": "2026-08-15",
            "source_id": "broadcast-trade",
            "vertical": "broadcast",
            "verticals": ["broadcast"],
            "audiences": ["all", "broadcast"],
            "source_family": "industry_trade",
            "keyword_pack": "broadcast",
            "legacy_profile": "broadcast",
            "keywords_found": ["cable", "broadcast"],
        }
        engine = MinimalSemanticEngine.__new__(MinimalSemanticEngine)
        engine.semantic_model = None
        engine.sentiment_analyzer = None

        with TemporaryDirectory() as temporary_directory:
            runtime = Path(temporary_directory)
            (runtime / "ui_results_scope.json").write_text(
                json.dumps([article]), encoding="utf-8"
            )
            with (
                patch.object(semantic_clustering, "BASE_DIR", runtime),
                patch.object(semantic_clustering, "SEEN_REGISTRY_FILE", runtime / "seen_registry.json"),
            ):
                engine.fuse(job_id="scope", fast_mode=True)

            output = json.loads(
                (runtime / "clustered_results_scope.json").read_text(encoding="utf-8")
            )

        self.assertEqual(output[0]["vertical"], "broadcast")
        self.assertEqual(output[0]["verticals"], ["broadcast"])
        self.assertEqual(output[0]["legacy_profile"], "broadcast")
        self.assertEqual(output[0]["source_id"], "broadcast-trade")
        self.assertEqual(output[0]["source_family"], "industry_trade")
        self.assertIn("broadcast", output[0]["keywords_found"])

    def test_mixed_cluster_keeps_broadcast_visibility_metadata(self):
        engine = MinimalSemanticEngine.__new__(MinimalSemanticEngine)
        technology = {
            "vertical": "technology",
            "legacy_profile": "default",
            "source_id": "tech-source",
        }
        broadcast = {
            "vertical": "broadcast",
            "legacy_profile": "broadcast",
            "source_id": "broadcast-source",
            "keyword_pack": "broadcast",
        }

        metadata = engine.cluster_scope_metadata([technology, broadcast], technology)

        self.assertEqual(metadata["vertical"], "technology")
        self.assertEqual(metadata["legacy_profile"], "unified")
        self.assertEqual(metadata["verticals"], ["technology", "broadcast"])
        self.assertIn("broadcast-source", metadata["source_ids"])


if __name__ == "__main__":
    unittest.main()
