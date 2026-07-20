"""Lazy article embeddings with a deterministic, dependency-free fallback."""

from __future__ import annotations

import hashlib
import math
import re
import threading
from collections import Counter
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence


DEFAULT_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_FALLBACK_DIMENSIONS = 384

_TOKEN_RE = re.compile(r"[\w]+", flags=re.UNICODE)
_DEFAULT_TEXT_FIELDS = (
    "title",
    "master_summary",
    "summary",
    "snippet",
    "content",
    "body_text",
    "full_text",
    "full_content",
    "full_contents",
)


def _l2_normalize(values: Iterable[float]) -> List[float]:
    vector = [float(value) for value in values]
    magnitude = math.sqrt(sum(value * value for value in vector))
    if magnitude <= 0.0:
        return vector
    return [value / magnitude for value in vector]


def article_embedding_text(
    article: Mapping[str, Any],
    fields: Sequence[str] = _DEFAULT_TEXT_FIELDS,
) -> str:
    """Build a stable embedding input from an article-like dictionary."""

    parts: List[str] = []
    seen = set()
    for field in fields:
        value = article.get(field)
        if isinstance(value, (list, tuple, set)):
            text = ", ".join(str(item).strip() for item in value if str(item).strip())
        else:
            text = str(value or "").strip()
        normalized = re.sub(r"\s+", " ", text)
        if normalized and normalized not in seen:
            seen.add(normalized)
            parts.append(normalized)
    return "\n".join(parts)


class EmbeddingService:
    """Load MiniLM on first use and fall back to normalized feature hashing.

    ``force_fallback`` exists for offline deployments and deterministic tests.  A
    custom ``model_factory`` may be supplied by an application composition root;
    importing this module itself never imports sentence-transformers or downloads
    model files.
    """

    def __init__(
        self,
        model_name: str = DEFAULT_EMBEDDING_MODEL,
        *,
        model_identity: Optional[str] = None,
        fallback_dimensions: int = DEFAULT_FALLBACK_DIMENSIONS,
        force_fallback: bool = False,
        local_files_only: Optional[bool] = None,
        model_factory: Optional[Callable[..., Any]] = None,
    ) -> None:
        if fallback_dimensions < 16:
            raise ValueError("fallback_dimensions must be at least 16")
        self.model_name = model_name
        self.model_identity = model_identity or model_name
        self.fallback_dimensions = int(fallback_dimensions)
        self.force_fallback = bool(force_fallback)
        self.local_files_only = local_files_only
        self._model_factory = model_factory
        self._model: Any = None
        self._load_attempted = False
        self._backend = "uninitialized"
        self._load_error: Optional[str] = None
        self._load_lock = threading.Lock()
        self._inference_lock = threading.Lock()

    def _activate_fallback(self, reason: str) -> None:
        self._model = None
        self._backend = "hashing_fallback"
        self._load_error = reason

    def _ensure_backend(self) -> None:
        if self._load_attempted:
            return
        with self._load_lock:
            if self._load_attempted:
                return
            self._load_attempted = True
            if self.force_fallback:
                self._activate_fallback("fallback_forced")
                return
            try:
                if self._model_factory is not None:
                    factory = self._model_factory
                else:
                    from sentence_transformers import SentenceTransformer

                    factory = SentenceTransformer

                kwargs: Dict[str, Any] = {}
                if self.local_files_only is not None:
                    kwargs["local_files_only"] = self.local_files_only
                self._model = factory(self.model_name, **kwargs)
                self._backend = "sentence_transformers"
                self._load_error = None
            except Exception as exc:  # Optional dependency/model cache may be absent.
                self._activate_fallback(
                    "minilm_unavailable:%s:%s" % (type(exc).__name__, str(exc)[:240])
                )

    def _hashing_embedding(self, text: str) -> List[float]:
        tokens = [token.casefold() for token in _TOKEN_RE.findall(str(text or ""))]
        weighted_features: Counter[str] = Counter()
        if not tokens:
            weighted_features["u:<empty>"] = 1.0
        else:
            for token in tokens:
                weighted_features["u:" + token] += 1.0
                # Character features preserve some similarity across inflections.
                padded = "^" + token + "$"
                for index in range(max(0, len(padded) - 2)):
                    weighted_features["c:" + padded[index : index + 3]] += 0.18
            for left, right in zip(tokens, tokens[1:]):
                weighted_features["b:" + left + " " + right] += 0.45

        vector = [0.0] * self.fallback_dimensions
        for feature, count in weighted_features.items():
            digest = hashlib.sha256(feature.encode("utf-8")).digest()
            index = int.from_bytes(digest[:8], "big") % self.fallback_dimensions
            sign = 1.0 if digest[8] & 1 else -1.0
            vector[index] += sign * math.sqrt(float(count))
        return _l2_normalize(vector)

    def encode(self, texts: Sequence[str]) -> List[List[float]]:
        """Return L2-normalized vectors in the same order as ``texts``."""

        normalized_texts = [str(text or "") for text in texts]
        if not normalized_texts:
            return []
        self._ensure_backend()
        if self._model is not None:
            try:
                with self._inference_lock:
                    encoded = self._model.encode(
                        normalized_texts,
                        normalize_embeddings=True,
                        show_progress_bar=False,
                    )
                return [_l2_normalize(row) for row in encoded]
            except Exception as exc:
                # A runtime/model-device error must not stop ingestion.
                self._activate_fallback(
                    "minilm_inference_failed:%s:%s"
                    % (type(exc).__name__, str(exc)[:240])
                )
        return [self._hashing_embedding(text) for text in normalized_texts]

    def encode_one(self, text: str) -> List[float]:
        return self.encode([text])[0]

    def status(self) -> Dict[str, Any]:
        self._ensure_backend()
        return {
            "backend": self._backend,
            "model": self.model_identity,
            "load_reference": self.model_name,
            "dimensions": (
                self.fallback_dimensions if self._backend == "hashing_fallback" else None
            ),
            "degraded": self._backend != "sentence_transformers",
            "reason": self._load_error,
        }

    def embed_articles(
        self,
        articles: Sequence[Mapping[str, Any]],
        *,
        fields: Sequence[str] = _DEFAULT_TEXT_FIELDS,
    ) -> List[Dict[str, Any]]:
        """Copy article dictionaries and attach an embedding plus provenance."""

        copies = [dict(article) for article in articles]
        vectors = self.encode([article_embedding_text(item, fields) for item in copies])
        metadata = self.status()
        for item, vector in zip(copies, vectors):
            item["embedding"] = vector
            item["embedding_metadata"] = dict(metadata)
        return copies


def embed_articles(
    articles: Sequence[Mapping[str, Any]],
    *,
    service: Optional[EmbeddingService] = None,
    fields: Sequence[str] = _DEFAULT_TEXT_FIELDS,
) -> List[Dict[str, Any]]:
    """Functional convenience wrapper for pipeline composition."""

    return (service or EmbeddingService()).embed_articles(articles, fields=fields)
