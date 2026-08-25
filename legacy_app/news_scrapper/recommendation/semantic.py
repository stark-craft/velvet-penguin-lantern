"""Optional lazy MiniLM affinity for private recommendation behavior."""

from __future__ import annotations

import threading
from functools import lru_cache
from typing import Any


_model = None
_model_failed = False
_lock = threading.RLock()


def _load_model():
    global _model, _model_failed
    if _model is not None or _model_failed:
        return _model
    with _lock:
        if _model is not None or _model_failed:
            return _model
        try:
            from sentence_transformers import SentenceTransformer
            from core.settings import model_path

            _model = SentenceTransformer(
                str(model_path("all-MiniLM-L6-v2", "local_miniLM_model"))
            )
        except Exception as error:
            _model_failed = True
            print(
                f"[FOR YOU] Semantic affinity unavailable; exact V1 scoring remains active: {error}",
                flush=True,
            )
    return _model


@lru_cache(maxsize=4096)
def _embedding(text: str):
    model = _load_model()
    if model is None or not text:
        return None
    return model.encode(text, normalize_embeddings=True)


def _similarity(left: str, right: str) -> float:
    left_vector = _embedding(left[:4000])
    right_vector = _embedding(right[:4000])
    if left_vector is None or right_vector is None:
        return 0.0
    try:
        return max(0.0, min(1.0, float(left_vector @ right_vector)))
    except Exception:
        return 0.0


def semantic_similarity(left: str, right: str) -> float:
    """Public bounded similarity helper for private followed-story threads."""

    return _similarity(str(left or ""), str(right or ""))


def semantic_affinity(article_text: str, events: list[dict[str, Any]]) -> tuple[float, float]:
    positives = []
    negatives = []
    for event in events[-80:]:
        detail = event.get("detail") if isinstance(event.get("detail"), dict) else {}
        title = str(detail.get("title") or "").strip()
        if not title:
            continue
        action = str(event.get("action") or "")
        if action in {"save", "select", "interested", "dossier_dwell", "source_open"}:
            positives.append(title)
        elif action in {"hide", "not_interested", "less_like_this"}:
            negatives.append(title)
    positive = max((_similarity(article_text, value) for value in positives), default=0.0)
    negative = max((_similarity(article_text, value) for value in negatives), default=0.0)
    return positive, negative
