import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import numpy as np

from news_scrapper import semantic_clustering
from news_scrapper.semantic_clustering import MinimalSemanticEngine


class SemanticClusteringSafeguardTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
