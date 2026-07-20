"""Deterministic transitive cosine clustering for article dictionaries."""

from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .embeddings import EmbeddingService, article_embedding_text


DEFAULT_CLUSTER_SIMILARITY_THRESHOLD = 0.78


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    numerator = sum(float(a) * float(b) for a, b in zip(left, right))
    left_norm = math.sqrt(sum(float(value) ** 2 for value in left))
    right_norm = math.sqrt(sum(float(value) ** 2 for value in right))
    if left_norm <= 0.0 or right_norm <= 0.0:
        return 0.0
    return max(-1.0, min(1.0, numerator / (left_norm * right_norm)))


def _normalized_identity_value(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().casefold())


def article_identity(article: Mapping[str, Any]) -> str:
    """Return a stable identity without depending on a database model."""

    for field in ("id", "article_id", "canonical_url", "canonical_link", "url", "link"):
        value = _normalized_identity_value(article.get(field))
        if value:
            return field + ":" + value.split("#", 1)[0].rstrip("/")
    payload = {
        "profile": _normalized_identity_value(article.get("profile")),
        "source": _normalized_identity_value(article.get("source")),
        "title": _normalized_identity_value(article.get("title")),
        "published_at": _normalized_identity_value(
            article.get("published_at") or article.get("date")
        ),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "content:" + hashlib.sha256(encoded).hexdigest()


def stable_cluster_id(
    articles: Sequence[Mapping[str, Any]], *, profile: Optional[str] = None
) -> str:
    identities = sorted(article_identity(article) for article in articles)
    inferred_profile = profile or next(
        (str(article.get("profile")) for article in articles if article.get("profile")),
        "default",
    )
    payload = inferred_profile.casefold() + "\n" + "\n".join(identities)
    return "clu_" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


class _UnionFind:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))
        self.rank = [0] * size

    def find(self, index: int) -> int:
        while self.parent[index] != index:
            self.parent[index] = self.parent[self.parent[index]]
            index = self.parent[index]
        return index

    def union(self, left: int, right: int) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root == right_root:
            return
        if self.rank[left_root] < self.rank[right_root]:
            left_root, right_root = right_root, left_root
        self.parent[right_root] = left_root
        if self.rank[left_root] == self.rank[right_root]:
            self.rank[left_root] += 1


class SemanticClusterer:
    """Single-linkage clustering expressed as transitive graph components."""

    def __init__(
        self,
        *,
        threshold: float = DEFAULT_CLUSTER_SIMILARITY_THRESHOLD,
        embedder: Optional[EmbeddingService] = None,
    ) -> None:
        if not 0.0 <= threshold <= 1.0:
            raise ValueError("threshold must be between 0 and 1")
        self.threshold = float(threshold)
        self.embedder = embedder or EmbeddingService()

    def _prepare(
        self, articles: Sequence[Mapping[str, Any]]
    ) -> Tuple[List[Dict[str, Any]], List[List[float]], Dict[str, Any]]:
        # Sorting before pairwise work makes membership, representative selection,
        # cluster IDs, and output order independent of crawler completion order.
        items = sorted(
            (dict(article) for article in articles),
            key=lambda item: (
                article_identity(item),
                json.dumps(item, sort_keys=True, default=str, separators=(",", ":")),
            ),
        )
        missing_indices = []
        missing_texts = []
        vectors: List[Optional[List[float]]] = []
        for index, item in enumerate(items):
            supplied = item.get("embedding")
            if isinstance(supplied, (list, tuple)) and supplied:
                try:
                    vectors.append([float(value) for value in supplied])
                    continue
                except (TypeError, ValueError):
                    pass
            vectors.append(None)
            missing_indices.append(index)
            missing_texts.append(article_embedding_text(item))

        if missing_indices:
            generated = self.embedder.encode(missing_texts)
            for index, vector in zip(missing_indices, generated):
                vectors[index] = vector
            embedding_metadata = self.embedder.status()
        else:
            dimensions = len(vectors[0] or []) if vectors else 0
            embedding_metadata = {
                "backend": "provided",
                "model": None,
                "dimensions": dimensions,
                "degraded": False,
                "reason": None,
            }
        return items, [vector or [] for vector in vectors], embedding_metadata

    @staticmethod
    def _representative_index(indices: Sequence[int], vectors: Sequence[Sequence[float]]) -> int:
        if len(indices) == 1:
            return indices[0]
        scored = []
        for index in indices:
            average = sum(
                cosine_similarity(vectors[index], vectors[other])
                for other in indices
                if other != index
            ) / max(1, len(indices) - 1)
            scored.append((average, -index, index))
        return max(scored)[2]

    def cluster_with_metadata(
        self,
        articles: Sequence[Mapping[str, Any]],
        *,
        profile: Optional[str] = None,
    ) -> Dict[str, Any]:
        items, vectors, embedding_metadata = self._prepare(articles)
        union_find = _UnionFind(len(items))
        edge_count = 0
        for left in range(len(items)):
            for right in range(left + 1, len(items)):
                if cosine_similarity(vectors[left], vectors[right]) >= self.threshold:
                    union_find.union(left, right)
                    edge_count += 1

        components: Dict[int, List[int]] = {}
        for index in range(len(items)):
            components.setdefault(union_find.find(index), []).append(index)

        clusters: List[Dict[str, Any]] = []
        for indices in components.values():
            member_items = [items[index] for index in indices]
            cluster_id = stable_cluster_id(member_items, profile=profile)
            representative_index = self._representative_index(indices, vectors)
            representative = items[representative_index]
            output_members: List[Dict[str, Any]] = []
            for index in indices:
                member = dict(items[index])
                member["cluster_id"] = cluster_id
                member["cluster_similarity"] = round(
                    cosine_similarity(vectors[index], vectors[representative_index]), 6
                )
                output_members.append(member)
            source_names = {
                str(member.get("source") or "").strip()
                for member in output_members
                if str(member.get("source") or "").strip()
            }
            clusters.append(
                {
                    "cluster_id": cluster_id,
                    "profile": profile or representative.get("profile") or "default",
                    "threshold": self.threshold,
                    "title": representative.get("title") or "Untitled signal",
                    "size": len(output_members),
                    "source_count": len(source_names) or len(output_members),
                    "representative": dict(
                        next(
                            member
                            for member in output_members
                            if article_identity(member) == article_identity(representative)
                        )
                    ),
                    "articles": output_members,
                }
            )
        clusters.sort(key=lambda cluster: cluster["cluster_id"])
        return {
            "clusters": clusters,
            "metadata": {
                "algorithm": "transitive_cosine_single_linkage",
                "threshold": self.threshold,
                "article_count": len(items),
                "cluster_count": len(clusters),
                "similarity_edges": edge_count,
                "embedding": embedding_metadata,
            },
        }

    def cluster(
        self,
        articles: Sequence[Mapping[str, Any]],
        *,
        profile: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return self.cluster_with_metadata(articles, profile=profile)["clusters"]


def cluster_articles(
    articles: Sequence[Mapping[str, Any]],
    *,
    threshold: float = DEFAULT_CLUSTER_SIMILARITY_THRESHOLD,
    profile: Optional[str] = None,
    embedder: Optional[EmbeddingService] = None,
) -> List[Dict[str, Any]]:
    return SemanticClusterer(threshold=threshold, embedder=embedder).cluster(
        articles, profile=profile
    )
