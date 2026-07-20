from __future__ import annotations

import hashlib
import json
import math
import pickle
import tempfile
import unittest
from pathlib import Path

from signalroom.ml.clustering import SemanticClusterer, cosine_similarity
from signalroom.ml.embeddings import DEFAULT_EMBEDDING_MODEL, EmbeddingService
from signalroom.ml.gatekeeper import Gatekeeper, load_verified_artifact
from signalroom.ml.summarizer import SummarizationService
from signalroom.ml.training import train_gatekeeper


class FixedProbabilityClassifier:
    """Module-level test fixture so its pickle can be loaded normally."""

    classes_ = (0, 1)

    def __init__(self, drop_probability: float) -> None:
        self.drop_probability = drop_probability

    def predict_proba(self, vectors):
        return [
            [1.0 - self.drop_probability, self.drop_probability]
            for _vector in vectors
        ]


def _write_fixed_artifact(root: Path, probability: float = 0.70) -> Path:
    profile_directory = root / "default"
    profile_directory.mkdir(parents=True)
    artifact_path = profile_directory / "gatekeeper-unit.pkl"
    artifact_bytes = pickle.dumps(FixedProbabilityClassifier(probability))
    artifact_path.write_bytes(artifact_bytes)
    manifest = {
        "schema_version": 1,
        "profile": "default",
        "version": "unit",
        "artifact": artifact_path.name,
        "sha256": hashlib.sha256(artifact_bytes).hexdigest(),
        "positive_label": 1,
        "embedding_backend": "hashing_fallback",
        "embedding_model": DEFAULT_EMBEDDING_MODEL,
        "embedding_dimensions": 64,
    }
    (profile_directory / "manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    return artifact_path


class EmbeddingFallbackTests(unittest.TestCase):
    def test_model_identity_is_independent_of_local_load_path(self) -> None:
        service = EmbeddingService(
            "/portable/backend/model_weights/minilm",
            model_identity=DEFAULT_EMBEDDING_MODEL,
            force_fallback=True,
            fallback_dimensions=64,
        )
        status = service.status()
        self.assertEqual(status["model"], DEFAULT_EMBEDDING_MODEL)
        self.assertEqual(
            status["load_reference"],
            "/portable/backend/model_weights/minilm",
        )

    def test_hashing_fallback_is_deterministic_and_normalized(self) -> None:
        service = EmbeddingService(force_fallback=True, fallback_dimensions=64)
        first, second, different = service.encode(
            ["Samsung launches an AI television", "Samsung launches an AI television", "Recipe"]
        )
        self.assertEqual(first, second)
        self.assertNotEqual(first, different)
        self.assertAlmostEqual(math.sqrt(sum(value * value for value in first)), 1.0, places=7)
        self.assertEqual(service.status()["backend"], "hashing_fallback")
        self.assertTrue(service.status()["degraded"])

    def test_embed_articles_is_dict_based_and_does_not_mutate_input(self) -> None:
        source = [{"id": "one", "title": "A signal", "summary": "Useful context."}]
        output = EmbeddingService(
            force_fallback=True, fallback_dimensions=32
        ).embed_articles(source)
        self.assertNotIn("embedding", source[0])
        self.assertEqual(output[0]["id"], "one")
        self.assertEqual(len(output[0]["embedding"]), 32)


class SummarizationFallbackTests(unittest.TestCase):
    def test_extractive_fallback_requires_no_model_download(self) -> None:
        service = SummarizationService(force_fallback=True)
        text = (
            "Samsung announced a new AI television platform for its 2026 lineup. "
            "The platform runs more inference on the device and reduces cloud latency. "
            "Executives said the change affects premium display strategy across regions. "
            "A launch schedule will be shared later."
        )
        result = service.summarize(text, max_words=45, max_sentences=2)
        self.assertTrue(result["summary"])
        self.assertLessEqual(len(result["summary"].split()), 45)
        self.assertEqual(result["metadata"]["backend"], "extractive_fallback")
        self.assertTrue(result["metadata"]["degraded"])

    def test_article_summary_returns_a_copied_dictionary(self) -> None:
        article = {"id": "a", "title": "Headline", "content": "First fact. Second fact."}
        result = SummarizationService(force_fallback=True).summarize_article(article)
        self.assertNotIn("master_summary", article)
        self.assertIn("master_summary", result)
        self.assertIn("summary_metadata", result)


class ClusteringTests(unittest.TestCase):
    def test_clustering_is_transitive_and_cluster_ids_are_stable(self) -> None:
        # A-B and B-C exceed 0.8, while A-C does not. Single-linkage must still
        # place A, B, and C in one connected component.
        articles = [
            {"id": "a", "title": "A", "embedding": [1.0, 0.0]},
            {"id": "b", "title": "B", "embedding": [0.8660254, 0.5]},
            {"id": "c", "title": "C", "embedding": [0.5, 0.8660254]},
            {"id": "d", "title": "D", "embedding": [-1.0, 0.0]},
        ]
        self.assertGreater(
            cosine_similarity(articles[0]["embedding"], articles[1]["embedding"]), 0.8
        )
        self.assertLess(cosine_similarity(articles[0]["embedding"], articles[2]["embedding"]), 0.8)
        clusterer = SemanticClusterer(
            threshold=0.8,
            embedder=EmbeddingService(force_fallback=True, fallback_dimensions=32),
        )
        first = clusterer.cluster(articles, profile="default")
        second = clusterer.cluster(list(reversed(articles)), profile="default")
        first_membership = {
            tuple(member["id"] for member in cluster["articles"]): cluster["cluster_id"]
            for cluster in first
        }
        second_membership = {
            tuple(member["id"] for member in cluster["articles"]): cluster["cluster_id"]
            for cluster in second
        }
        self.assertEqual(first_membership, second_membership)
        self.assertIn(("a", "b", "c"), first_membership)
        self.assertIn(("d",), first_membership)


class GatekeeperTests(unittest.TestCase):
    def test_missing_artifact_fails_open_with_degraded_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            gatekeeper = Gatekeeper(
                Path(directory),
                embedder=EmbeddingService(force_fallback=True, fallback_dimensions=64),
            )
            decision = gatekeeper.decide({"title": "Any story"}, profile="default")
            self.assertEqual(decision["decision"], "keep")
            self.assertTrue(decision["keep"])
            self.assertIsNone(decision["score"])
            self.assertTrue(decision["degraded"])
            self.assertIn("artifact_unavailable", decision["reason"])

    def test_prefetch_uses_a_safer_threshold_than_final_filtering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _write_fixed_artifact(root, probability=0.70)
            gatekeeper = Gatekeeper(
                root,
                embedder=EmbeddingService(force_fallback=True, fallback_dimensions=64),
            )
            final = gatekeeper.decide({"title": "Story"}, stage="final")
            prefetch = gatekeeper.decide({"title": "Story"}, stage="prefetch")
            self.assertEqual(final["decision"], "drop")
            self.assertFalse(final["keep"])
            self.assertEqual(prefetch["decision"], "review")
            self.assertTrue(prefetch["keep"])
            self.assertGreater(prefetch["thresholds"]["prefetch_drop"], 0.60)

    def test_hash_mismatch_is_rejected_before_inference(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_path = _write_fixed_artifact(root)
            artifact_path.write_bytes(artifact_path.read_bytes() + b"tampered")
            gatekeeper = Gatekeeper(
                root,
                embedder=EmbeddingService(force_fallback=True, fallback_dimensions=64),
            )
            decision = gatekeeper.decide({"title": "Story"})
            self.assertEqual(decision["decision"], "keep")
            self.assertIsNone(decision["score"])
            self.assertIn("SHA-256", decision["reason"])


class OfflineTrainingTests(unittest.TestCase):
    def test_centroid_fallback_training_promotes_a_verified_artifact(self) -> None:
        feedback = [
            {"action": "interesting", "title": "Samsung launches an AI television"},
            {"action": "approve", "title": "OpenAI releases a new enterprise model"},
            {"action": "selected", "title": "Robotics lab demonstrates a humanoid"},
            {"action": "not_interested", "title": "Celebrity red carpet gossip"},
            {"action": "hide", "title": "Football transfer rumors"},
            {"action": "reject", "title": "A recipe for chocolate cake"},
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            embedder = EmbeddingService(force_fallback=True, fallback_dimensions=64)
            result = train_gatekeeper(
                feedback,
                profile="default",
                artifact_root=root,
                embedder=embedder,
                prefer_sklearn=False,
                version="unit-v1",
            )
            self.assertEqual(result["status"], "trained")
            self.assertEqual(
                result["manifest"]["model_type"],
                "signalroom.ml.training.CentroidClassifier",
            )
            self.assertEqual(result["manifest"]["sample_count"], 6)
            loaded = load_verified_artifact(root, "default")
            self.assertEqual(loaded["manifest"]["version"], "unit-v1")

            decision = Gatekeeper(root, embedder=embedder).decide(
                {"title": "Celebrity red carpet gossip"}, profile="default"
            )
            self.assertIsNotNone(decision["score"])
            self.assertEqual(decision["model_version"], "unit-v1")
            self.assertIn(decision["decision"], {"review", "drop"})


if __name__ == "__main__":
    unittest.main()
