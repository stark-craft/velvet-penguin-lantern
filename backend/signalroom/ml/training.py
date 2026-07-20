"""Offline gatekeeper training and atomic, versioned artifact promotion."""

from __future__ import annotations

import hashlib
import json
import math
import os
import pickle
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .embeddings import EmbeddingService
from .gatekeeper import (
    DEFAULT_HARD_DROP_THRESHOLD,
    DEFAULT_PREFETCH_DROP_THRESHOLD,
    DEFAULT_REVIEW_THRESHOLD,
    MANIFEST_SCHEMA_VERSION,
    build_gatekeeper_text,
    normalize_profile,
)


_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")

_DROP_LABELS = {
    "drop",
    "hide",
    "hidden",
    "irrelevant",
    "not_interested",
    "not-interesting",
    "not interesting",
    "reject",
    "rejected",
    "dislike",
}
_KEEP_LABELS = {
    "keep",
    "interesting",
    "interested",
    "approve",
    "approved",
    "restore",
    "restored",
    "save",
    "saved",
    "select",
    "selected",
}


class TrainingDataError(ValueError):
    pass


def _normalize_vector(values: Iterable[float]) -> List[float]:
    vector = [float(value) for value in values]
    magnitude = math.sqrt(sum(value * value for value in vector))
    if magnitude <= 0.0:
        return vector
    return [value / magnitude for value in vector]


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    return sum(float(a) * float(b) for a, b in zip(left, right))


class CentroidClassifier:
    """Small, pickle-friendly fallback when scikit-learn is unavailable."""

    classes_ = (0, 1)

    def __init__(
        self,
        keep_centroid: Sequence[float],
        drop_centroid: Sequence[float],
        *,
        temperature: float = 5.0,
    ) -> None:
        self.keep_centroid = _normalize_vector(keep_centroid)
        self.drop_centroid = _normalize_vector(drop_centroid)
        self.temperature = float(temperature)

    @classmethod
    def fit(cls, vectors: Sequence[Sequence[float]], labels: Sequence[int]) -> "CentroidClassifier":
        if not vectors or len(vectors) != len(labels):
            raise TrainingDataError("vectors and labels must be non-empty and aligned")
        dimensions = len(vectors[0])
        groups: Dict[int, List[List[float]]] = {0: [], 1: []}
        for vector, label in zip(vectors, labels):
            if label not in groups:
                raise TrainingDataError("centroid classifier supports only labels 0 and 1")
            if len(vector) != dimensions:
                raise TrainingDataError("all embedding vectors must have equal dimensions")
            groups[label].append([float(value) for value in vector])
        if not groups[0] or not groups[1]:
            raise TrainingDataError("both keep and drop examples are required")

        def centroid(rows: Sequence[Sequence[float]]) -> List[float]:
            return _normalize_vector(
                [sum(row[index] for row in rows) / len(rows) for index in range(dimensions)]
            )

        return cls(centroid(groups[0]), centroid(groups[1]))

    def predict_proba(self, vectors: Sequence[Sequence[float]]) -> List[List[float]]:
        output = []
        for vector in vectors:
            normalized = _normalize_vector(vector)
            delta = (
                _cosine(normalized, self.drop_centroid)
                - _cosine(normalized, self.keep_centroid)
            ) * self.temperature
            probability = 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, delta))))
            output.append([1.0 - probability, probability])
        return output

    def predict(self, vectors: Sequence[Sequence[float]]) -> List[int]:
        return [
            1 if probabilities[1] >= 0.5 else 0
            for probabilities in self.predict_proba(vectors)
        ]


def _feedback_label(record: Mapping[str, Any]) -> Optional[int]:
    raw = next(
        (
            record.get(field)
            for field in ("label", "feedback", "action", "decision", "outcome")
            if record.get(field) is not None
        ),
        None,
    )
    if isinstance(raw, bool):
        return 1 if raw else 0
    if isinstance(raw, (int, float)) and raw in (0, 1):
        # The training contract is explicit: 1 means drop/not interested.
        return int(raw)
    normalized = str(raw or "").strip().casefold().replace("-", "_")
    if normalized in {label.replace("-", "_") for label in _DROP_LABELS}:
        return 1
    if normalized in {label.replace("-", "_") for label in _KEEP_LABELS}:
        return 0
    if record.get("not_interested") is True:
        return 1
    if record.get("interesting") is True:
        return 0
    return None


def _feedback_article(record: Mapping[str, Any]) -> Mapping[str, Any]:
    nested = record.get("article")
    if isinstance(nested, Mapping):
        return nested
    return record


def prepare_training_examples(
    feedback: Sequence[Mapping[str, Any]], *, profile: str
) -> Dict[str, Any]:
    normalized_profile = normalize_profile(profile)
    texts: List[str] = []
    labels: List[int] = []
    ignored = 0
    for record in feedback:
        record_profile = str(record.get("profile") or normalized_profile).strip().casefold()
        if record_profile != normalized_profile:
            ignored += 1
            continue
        label = _feedback_label(record)
        article = _feedback_article(record)
        text = str(record.get("text") or "").strip() or build_gatekeeper_text(article)
        meaningful = re.sub(r"(?:Title|Keywords|Summary):\s*", "", text).strip()
        if label is None or not meaningful:
            ignored += 1
            continue
        texts.append(text)
        labels.append(label)
    return {
        "profile": normalized_profile,
        "texts": texts,
        "labels": labels,
        "ignored": ignored,
        "class_counts": {
            "keep": sum(label == 0 for label in labels),
            "drop": sum(label == 1 for label in labels),
        },
    }


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".%s." % path.name,
        suffix=".tmp",
        dir=str(path.parent),
    )
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def _training_accuracy(
    model: Any, vectors: Sequence[Sequence[float]], labels: Sequence[int]
) -> float:
    predictions = list(model.predict([list(vector) for vector in vectors]))
    correct = sum(int(prediction) == int(label) for prediction, label in zip(predictions, labels))
    return correct / max(1, len(labels))


def train_gatekeeper(
    feedback: Sequence[Mapping[str, Any]],
    *,
    profile: str,
    artifact_root: Path,
    embedder: Optional[EmbeddingService] = None,
    min_samples: int = 4,
    prefer_sklearn: bool = True,
    version: Optional[str] = None,
    review_threshold: float = DEFAULT_REVIEW_THRESHOLD,
    hard_drop_threshold: float = DEFAULT_HARD_DROP_THRESHOLD,
    prefetch_drop_threshold: float = DEFAULT_PREFETCH_DROP_THRESHOLD,
) -> Dict[str, Any]:
    """Train offline and promote only a complete, hash-addressed artifact.

    Promotion writes the immutable versioned model and manifest first, then
    atomically replaces ``manifest.json`` as the current pointer.
    """

    if min_samples < 2:
        raise ValueError("min_samples must be at least 2")
    if not 0.0 <= review_threshold < hard_drop_threshold < prefetch_drop_threshold <= 1.0:
        raise ValueError("invalid gatekeeper threshold ordering")
    examples = prepare_training_examples(feedback, profile=profile)
    labels = examples["labels"]
    if len(labels) < min_samples:
        raise TrainingDataError(
            "at least %d labeled examples are required; received %d"
            % (min_samples, len(labels))
        )
    if not examples["class_counts"]["keep"] or not examples["class_counts"]["drop"]:
        raise TrainingDataError("training requires both keep and drop feedback")

    active_embedder = embedder or EmbeddingService()
    vectors = active_embedder.encode(examples["texts"])
    embedding_status = active_embedder.status()
    if not vectors or not vectors[0]:
        raise TrainingDataError("embedding service returned no usable vectors")

    model: Any
    model_type: str
    if prefer_sklearn:
        try:
            from sklearn.linear_model import LogisticRegression

            model = LogisticRegression(
                class_weight="balanced",
                max_iter=1000,
                random_state=0,
                solver="liblinear",
            )
            model.fit(vectors, labels)
            model_type = "sklearn.linear_model.LogisticRegression"
        except ImportError:
            model = CentroidClassifier.fit(vectors, labels)
            model_type = "signalroom.ml.training.CentroidClassifier"
    else:
        model = CentroidClassifier.fit(vectors, labels)
        model_type = "signalroom.ml.training.CentroidClassifier"

    training_accuracy = _training_accuracy(model, vectors, labels)
    feedback_digest = hashlib.sha256(
        json.dumps(
            {"profile": examples["profile"], "texts": examples["texts"], "labels": labels},
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    if version is None:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        version = "%s-%s" % (timestamp, feedback_digest[:10])
    if not _VERSION_RE.fullmatch(str(version)):
        raise ValueError("version contains unsupported characters")

    artifact_bytes = pickle.dumps(model, protocol=pickle.HIGHEST_PROTOCOL)
    artifact_sha = hashlib.sha256(artifact_bytes).hexdigest()
    artifact_filename = "gatekeeper-%s.pkl" % version
    versioned_manifest_filename = "gatekeeper-%s.manifest.json" % version
    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    manifest: Dict[str, Any] = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "profile": examples["profile"],
        "version": version,
        "created_at": created_at,
        "artifact": artifact_filename,
        "sha256": artifact_sha,
        "model_type": model_type,
        "positive_label": 1,
        "label_contract": {"0": "keep", "1": "drop_not_interested"},
        "feature_schema": "gatekeeper_text_v1",
        "embedding_backend": embedding_status.get("backend"),
        "embedding_model": embedding_status.get("model"),
        "embedding_dimensions": len(vectors[0]),
        "sample_count": len(labels),
        "ignored_feedback_count": examples["ignored"],
        "class_counts": examples["class_counts"],
        "feedback_sha256": feedback_digest,
        "metrics": {"training_accuracy": round(training_accuracy, 6)},
        "thresholds": {
            "review": review_threshold,
            "hard_drop": hard_drop_threshold,
            "prefetch_drop": prefetch_drop_threshold,
        },
    }
    manifest_bytes = (
        json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    ).encode("utf-8")
    profile_directory = Path(artifact_root).expanduser().resolve() / examples["profile"]
    profile_directory.mkdir(parents=True, exist_ok=True)
    artifact_path = profile_directory / artifact_filename
    versioned_manifest_path = profile_directory / versioned_manifest_filename
    current_manifest_path = profile_directory / "manifest.json"

    _atomic_write(artifact_path, artifact_bytes)
    _atomic_write(versioned_manifest_path, manifest_bytes)
    _atomic_write(current_manifest_path, manifest_bytes)
    return {
        "status": "trained",
        "profile": examples["profile"],
        "version": version,
        "artifact_path": str(artifact_path),
        "manifest_path": str(current_manifest_path),
        "manifest": manifest,
    }
