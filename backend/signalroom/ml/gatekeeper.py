"""Profile-aware gatekeeper inference with verified local model artifacts."""

from __future__ import annotations

import hashlib
import json
import math
import pickle
import re
import threading
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple

from .embeddings import EmbeddingService


DEFAULT_REVIEW_THRESHOLD = 0.45
DEFAULT_HARD_DROP_THRESHOLD = 0.60
DEFAULT_PREFETCH_DROP_THRESHOLD = 0.90
MANIFEST_SCHEMA_VERSION = 1

_PROFILE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class ArtifactVerificationError(RuntimeError):
    """Raised before deserialization when a local artifact cannot be trusted."""


def normalize_profile(profile: str) -> str:
    normalized = str(profile or "default").strip().casefold()
    if not _PROFILE_RE.fullmatch(normalized):
        raise ValueError("profile must contain only lowercase letters, numbers, _ or -")
    return normalized


def build_gatekeeper_text(article: Mapping[str, Any]) -> str:
    keywords = article.get("keywords_found") or article.get("keywords") or []
    if isinstance(keywords, (list, tuple, set)):
        keyword_text = ", ".join(str(item).strip() for item in keywords if str(item).strip())
    else:
        keyword_text = str(keywords or "").strip()
    summary = next(
        (
            str(article.get(field) or "").strip()
            for field in (
                "master_summary",
                "summary",
                "snippet",
                "content",
                "body_text",
                "full_text",
                "full_content",
                "full_contents",
            )
            if str(article.get(field) or "").strip()
        ),
        "",
    )
    return "Title: %s\nKeywords: %s\nSummary: %s" % (
        str(article.get("title") or "").strip(),
        keyword_text,
        summary,
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_artifact_path(profile_directory: Path, filename: str) -> Path:
    if not filename or Path(filename).name != filename or not filename.endswith(".pkl"):
        raise ArtifactVerificationError("manifest contains an invalid artifact filename")
    directory = profile_directory.resolve()
    candidate = (directory / filename).resolve()
    if candidate.parent != directory:
        raise ArtifactVerificationError("artifact path escapes its trusted profile directory")
    if not candidate.is_file():
        raise ArtifactVerificationError("artifact file is missing")
    return candidate


def load_verified_artifact(artifact_root: Path, profile: str) -> Dict[str, Any]:
    """Verify a trusted local manifest and hash before invoking pickle.

    SHA-256 supplies integrity, not authorship.  ``artifact_root`` must therefore
    be local, administrator-controlled, and never writable through an API route.
    """

    normalized_profile = normalize_profile(profile)
    profile_directory = Path(artifact_root).expanduser().resolve() / normalized_profile
    manifest_path = profile_directory / "manifest.json"
    if not manifest_path.is_file():
        raise ArtifactVerificationError("profile manifest is missing")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArtifactVerificationError("profile manifest is unreadable") from exc
    if not isinstance(manifest, dict):
        raise ArtifactVerificationError("profile manifest must be an object")
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise ArtifactVerificationError("unsupported manifest schema")
    if manifest.get("profile") != normalized_profile:
        raise ArtifactVerificationError("manifest profile does not match requested profile")
    version = str(manifest.get("version") or "").strip()
    if not version:
        raise ArtifactVerificationError("manifest version is missing")
    expected_sha = str(manifest.get("sha256") or "").strip().casefold()
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha):
        raise ArtifactVerificationError("manifest SHA-256 is invalid")
    artifact_path = _safe_artifact_path(profile_directory, str(manifest.get("artifact") or ""))
    actual_sha = _sha256_file(artifact_path)
    if actual_sha != expected_sha:
        raise ArtifactVerificationError("artifact SHA-256 does not match manifest")
    try:
        with artifact_path.open("rb") as handle:
            model = pickle.load(handle)
    except Exception as exc:
        raise ArtifactVerificationError("verified artifact could not be deserialized") from exc
    supported_methods = ("predict_proba", "decision_function", "predict")
    if not any(hasattr(model, method) for method in supported_methods):
        raise ArtifactVerificationError("artifact does not expose a supported classifier interface")
    return {
        "model": model,
        "manifest": manifest,
        "artifact_path": str(artifact_path),
        "manifest_path": str(manifest_path),
    }


def _class_index(classes: Sequence[Any], positive_label: Any) -> Optional[int]:
    for index, candidate in enumerate(classes):
        if candidate == positive_label or str(candidate) == str(positive_label):
            return index
    return None


def _drop_score(model: Any, vector: Sequence[float], manifest: Mapping[str, Any]) -> float:
    positive_label = manifest.get("positive_label", 1)
    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba([list(vector)])[0]
        classes = list(getattr(model, "classes_", []))
        index = _class_index(classes, positive_label)
        if index is None:
            raise ValueError("positive label is absent from classifier classes")
        score = float(probabilities[index])
    elif hasattr(model, "decision_function"):
        raw = model.decision_function([list(vector)])
        margin = float(raw[0] if hasattr(raw, "__len__") else raw)
        score = 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, margin))))
    else:
        predicted = model.predict([list(vector)])[0]
        score = 1.0 if str(predicted) == str(positive_label) else 0.0
    if not math.isfinite(score):
        raise ValueError("classifier returned a non-finite score")
    return max(0.0, min(1.0, score))


class Gatekeeper:
    """Lazily load one verified gatekeeper artifact for each profile."""

    def __init__(
        self,
        artifact_root: Path,
        *,
        embedder: Optional[EmbeddingService] = None,
        review_threshold: float = DEFAULT_REVIEW_THRESHOLD,
        hard_drop_threshold: float = DEFAULT_HARD_DROP_THRESHOLD,
        prefetch_drop_threshold: float = DEFAULT_PREFETCH_DROP_THRESHOLD,
    ) -> None:
        if not 0.0 <= review_threshold < hard_drop_threshold < prefetch_drop_threshold <= 1.0:
            raise ValueError(
                "thresholds must satisfy 0 <= review < hard drop < prefetch drop <= 1"
            )
        self.artifact_root = Path(artifact_root)
        self.embedder = embedder or EmbeddingService()
        self.review_threshold = float(review_threshold)
        self.hard_drop_threshold = float(hard_drop_threshold)
        self.prefetch_drop_threshold = float(prefetch_drop_threshold)
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._cache_lock = threading.Lock()

    def _manifest_signature(self, profile: str) -> Optional[Tuple[int, int]]:
        path = self.artifact_root / profile / "manifest.json"
        try:
            stat = path.stat()
            return stat.st_mtime_ns, stat.st_size
        except OSError:
            return None

    def _artifact_state(self, profile: str) -> Dict[str, Any]:
        signature = self._manifest_signature(profile)
        with self._cache_lock:
            cached = self._cache.get(profile)
            if cached is not None and cached.get("signature") == signature:
                return cached
            try:
                loaded = load_verified_artifact(self.artifact_root, profile)
                state = {**loaded, "signature": signature, "error": None}
            except (ArtifactVerificationError, OSError, ValueError) as exc:
                state = {
                    "model": None,
                    "manifest": None,
                    "signature": signature,
                    "error": "%s:%s" % (type(exc).__name__, str(exc)),
                }
            self._cache[profile] = state
            return state

    def invalidate(self, profile: Optional[str] = None) -> None:
        with self._cache_lock:
            if profile is None:
                self._cache.clear()
            else:
                self._cache.pop(normalize_profile(profile), None)

    def _fail_open(
        self,
        *,
        profile: str,
        stage: str,
        reason: str,
        model_version: Optional[str] = None,
        embedding: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, Any]:
        return {
            "decision": "keep",
            "keep": True,
            "score": None,
            "profile": profile,
            "stage": stage,
            "degraded": True,
            "reason": reason,
            "model_version": model_version,
            "thresholds": {
                "review": self.review_threshold,
                "hard_drop": self.hard_drop_threshold,
                "prefetch_drop": self.prefetch_drop_threshold,
            },
            "embedding": dict(embedding or {}),
        }

    def decide(
        self,
        article: Mapping[str, Any],
        *,
        profile: str = "default",
        stage: str = "final",
    ) -> Dict[str, Any]:
        normalized_profile = normalize_profile(profile)
        normalized_stage = str(stage or "final").strip().casefold()
        state = self._artifact_state(normalized_profile)
        manifest = state.get("manifest") or {}
        model_version = manifest.get("version")
        if state.get("model") is None:
            return self._fail_open(
                profile=normalized_profile,
                stage=normalized_stage,
                reason="gatekeeper_artifact_unavailable:" + str(state.get("error")),
                model_version=model_version,
            )

        try:
            vector = self.embedder.encode_one(build_gatekeeper_text(article))
            embedding_status = self.embedder.status()
            expected_backend = manifest.get("embedding_backend")
            expected_model = manifest.get("embedding_model")
            expected_dimensions = manifest.get("embedding_dimensions")
            if expected_backend and embedding_status.get("backend") != expected_backend:
                return self._fail_open(
                    profile=normalized_profile,
                    stage=normalized_stage,
                    reason="embedding_backend_mismatch",
                    model_version=model_version,
                    embedding=embedding_status,
                )
            if expected_model and embedding_status.get("model") != expected_model:
                return self._fail_open(
                    profile=normalized_profile,
                    stage=normalized_stage,
                    reason="embedding_model_mismatch",
                    model_version=model_version,
                    embedding=embedding_status,
                )
            if expected_dimensions is not None and int(expected_dimensions) != len(vector):
                return self._fail_open(
                    profile=normalized_profile,
                    stage=normalized_stage,
                    reason="embedding_dimensions_mismatch",
                    model_version=model_version,
                    embedding=embedding_status,
                )
            score = _drop_score(state["model"], vector, manifest)
        except Exception as exc:
            return self._fail_open(
                profile=normalized_profile,
                stage=normalized_stage,
                reason="gatekeeper_inference_failed:%s:%s"
                % (type(exc).__name__, str(exc)[:240]),
                model_version=model_version,
            )

        is_prefetch = normalized_stage in {"prefetch", "pre_fetch", "discovery", "rss"}
        drop_threshold = (
            self.prefetch_drop_threshold if is_prefetch else self.hard_drop_threshold
        )
        if score >= drop_threshold:
            decision = "drop"
            keep = False
            reason = "not_interested_probability_above_drop_threshold"
        elif score >= self.review_threshold:
            decision = "review"
            keep = True
            reason = "not_interested_probability_in_review_band"
        else:
            decision = "keep"
            keep = True
            reason = "likely_interesting"
        return {
            "decision": decision,
            "keep": keep,
            "score": round(score, 6),
            "profile": normalized_profile,
            "stage": normalized_stage,
            "degraded": bool(embedding_status.get("degraded")),
            "reason": reason,
            "model_version": model_version,
            "thresholds": {
                "review": self.review_threshold,
                "drop": drop_threshold,
                "hard_drop": self.hard_drop_threshold,
                "prefetch_drop": self.prefetch_drop_threshold,
            },
            "embedding": embedding_status,
        }

    def filter(
        self,
        articles: Sequence[Mapping[str, Any]],
        *,
        profile: str = "default",
        stage: str = "final",
    ) -> Dict[str, Any]:
        kept = []
        dropped = []
        counts = {"keep": 0, "review": 0, "drop": 0}
        for article in articles:
            item = dict(article)
            decision = self.decide(item, profile=profile, stage=stage)
            item["gatekeeper"] = decision
            counts[decision["decision"]] += 1
            (kept if decision["keep"] else dropped).append(item)
        return {"kept": kept, "dropped": dropped, "counts": counts}


def gatekeeper_decision(
    article: Mapping[str, Any],
    *,
    artifact_root: Path,
    profile: str = "default",
    stage: str = "final",
    embedder: Optional[EmbeddingService] = None,
) -> Dict[str, Any]:
    return Gatekeeper(artifact_root, embedder=embedder).decide(
        article, profile=profile, stage=stage
    )
