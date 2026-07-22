import unittest

import numpy as np

from semantic_clustering import MinimalSemanticEngine


class SemanticClusteringSafeguardTests(unittest.TestCase):
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
