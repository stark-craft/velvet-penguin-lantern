"""Private English-to-Korean translation service for the Sense.AI UI.

The service is deliberately lazy: Uvicorn can start without spending memory on
the translation model, and the model is loaded only when one browser switches
to Korean.  Language preference is never stored here; it remains in that
browser's local storage, so one user's choice cannot change another user's UI.
"""

from __future__ import annotations

import os
import json
import re
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Iterable

import torch
import sentencepiece as sentencepiece
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, MarianTokenizer

from core.settings import MODEL_ROOT, NEWS_RUNTIME_DIR


MODEL_ID = os.environ.get(
    "KOREAN_TRANSLATION_MODEL_ID",
    "Helsinki-NLP/opus-mt-tc-big-en-ko",
).strip()
MODEL_PATH = Path(
    os.environ.get(
        "KOREAN_TRANSLATION_MODEL_PATH",
        MODEL_ROOT / "opus-mt-tc-big-en-ko",
    )
).expanduser()
LOCAL_ONLY = os.environ.get("KOREAN_TRANSLATION_LOCAL_ONLY", "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
ENABLED = os.environ.get("KOREAN_TRANSLATION_ENABLED", "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
MAX_ITEMS = max(1, min(100, int(os.environ.get("KOREAN_TRANSLATION_MAX_ITEMS", "100"))))
MAX_TEXT_CHARS = max(
    256,
    min(50_000, int(os.environ.get("KOREAN_TRANSLATION_MAX_TEXT_CHARS", "20000"))),
)
CACHE_SIZE = max(100, int(os.environ.get("KOREAN_TRANSLATION_CACHE_SIZE", "5000")))
DEVICE_SETTING = os.environ.get("KOREAN_TRANSLATION_DEVICE", "auto").strip().lower()
INFERENCE_BATCH_SIZE = max(
    1,
    min(16, int(os.environ.get("KOREAN_TRANSLATION_BATCH_SIZE", "8"))),
)
GENERATION_BEAMS = max(
    1,
    min(4, int(os.environ.get("KOREAN_TRANSLATION_NUM_BEAMS", "1"))),
)

LATIN_RE = re.compile(r"[A-Za-z]")
SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])")


class TranslationRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=MAX_ITEMS)
    source_language: str = "en"
    target_language: str = "ko"


class TranslationResult(BaseModel):
    source: str
    translated: str


class TranslationResponse(BaseModel):
    translations: list[TranslationResult]
    engine: str
    model: str
    input_items: int = 0
    unique_items: int = 0
    cache_hits: int = 0
    translated_items: int = 0
    duration_ms: int = 0


def _local_model_available() -> bool:
    required = ("config.json", "source.spm", "target.spm")
    has_weights = any(
        (MODEL_PATH / filename).exists()
        for filename in ("model.safetensors", "pytorch_model.bin")
    )
    return has_weights and all((MODEL_PATH / filename).exists() for filename in required)


def _device() -> str:
    if DEVICE_SETTING != "auto":
        return DEVICE_SETTING
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _split_text(text: str, target_chars: int = 900) -> list[str]:
    """Split long UI/article prose without dropping or shortening content."""

    normalized = str(text or "").strip()
    if len(normalized) <= target_chars:
        return [normalized] if normalized else []

    sentences = SENTENCE_BOUNDARY_RE.split(normalized)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) > target_chars:
            if current:
                chunks.append(current)
                current = ""
            for start in range(0, len(sentence), target_chars):
                chunks.append(sentence[start : start + target_chars])
            continue
        candidate = f"{current} {sentence}".strip()
        if current and len(candidate) > target_chars:
            chunks.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def _marian_tokenizer(model_dir: Path):
    """Load OPUS separate vocabularies correctly.

    The upstream en-ko repository ships distinct source/target SentencePiece
    models but marks them as a shared vocabulary. That silently maps ordinary
    English tokens to ``<unk>`` and produces fluent-looking nonsense. Build the
    two deterministic vocabulary files from the supplied SentencePiece models
    and opt into Marian's separate-vocabulary mode.
    """

    source_spm = model_dir / "source.spm"
    target_spm = model_dir / "target.spm"
    if not source_spm.exists() or not target_spm.exists():
        return AutoTokenizer.from_pretrained(model_dir, local_files_only=True)

    cache_dir = NEWS_RUNTIME_DIR / "translation_tokenizer_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    source_vocab_path = cache_dir / "source_vocab.json"
    target_vocab_path = cache_dir / "target_vocab.json"

    for spm_path, vocab_path in (
        (source_spm, source_vocab_path),
        (target_spm, target_vocab_path),
    ):
        if (
            vocab_path.exists()
            and vocab_path.stat().st_mtime_ns >= spm_path.stat().st_mtime_ns
        ):
            continue
        processor = sentencepiece.SentencePieceProcessor(model_file=str(spm_path))
        vocabulary = {
            processor.id_to_piece(index): index
            for index in range(processor.get_piece_size())
        }
        vocabulary["<pad>"] = processor.get_piece_size()
        temporary = vocab_path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(vocabulary, ensure_ascii=False),
            encoding="utf-8",
        )
        temporary.replace(vocab_path)

    return MarianTokenizer(
        source_spm=str(source_spm),
        target_spm=str(target_spm),
        vocab=str(source_vocab_path),
        target_vocab_file=str(target_vocab_path),
        source_lang="en",
        target_lang="ko",
        separate_vocabs=True,
        model_max_length=512,
    )


class KoreanTranslator:
    """Thread-safe, lazily loaded Marian translator with an in-memory LRU."""

    def __init__(self) -> None:
        self._load_lock = threading.Lock()
        self._inference_lock = threading.Lock()
        self._tokenizer = None
        self._model = None
        self._device = _device()
        self._load_error: str | None = None
        self._loading = False
        self._cache: OrderedDict[str, str] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._stats_lock = threading.Lock()
        self._request_count = 0
        self._cache_hit_count = 0
        self._inference_item_count = 0

    @property
    def source(self) -> str:
        if _local_model_available():
            return str(MODEL_PATH)
        return MODEL_ID

    def status(self) -> dict:
        with self._cache_lock:
            cache_entries = len(self._cache)
        with self._stats_lock:
            requests = self._request_count
            cache_hits = self._cache_hit_count
            inference_items = self._inference_item_count
        return {
            "enabled": ENABLED,
            "ready": self._model is not None,
            "loading": self._loading,
            "installed": _local_model_available(),
            "model": MODEL_ID,
            "model_path": str(MODEL_PATH),
            "local_only": LOCAL_ONLY,
            "device": self._device,
            "max_items": MAX_ITEMS,
            "cache_entries": cache_entries,
            "requests": requests,
            "cache_hits": cache_hits,
            "inference_items": inference_items,
            "error": self._load_error,
        }

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        if not ENABLED:
            raise RuntimeError("Korean translation is disabled by configuration")
        with self._load_lock:
            if self._model is not None:
                return
            source = self.source
            if LOCAL_ONLY and not _local_model_available():
                raise RuntimeError(
                    "Korean model is missing or incomplete. Expected config, "
                    "SentencePiece, and model-weight files at "
                    f"{MODEL_PATH}"
                )
            self._loading = True
            try:
                print(
                    f"[TRANSLATION] Loading English→Korean model from {source} "
                    f"on {self._device}...",
                    flush=True,
                )
                tokenizer = (
                    _marian_tokenizer(MODEL_PATH)
                    if _local_model_available()
                    else AutoTokenizer.from_pretrained(
                        source,
                        local_files_only=LOCAL_ONLY,
                    )
                )
                model = AutoModelForSeq2SeqLM.from_pretrained(
                    source,
                    local_files_only=LOCAL_ONLY,
                )
                model.to(self._device)
                model.eval()
                self._tokenizer = tokenizer
                self._model = model
                self._load_error = None
                print("[TRANSLATION] Korean translation model is ready.", flush=True)
            except Exception as error:
                self._load_error = f"{type(error).__name__}: {error}"[:800]
                print(
                    f"[TRANSLATION] Model load failed: {self._load_error}",
                    flush=True,
                )
                raise RuntimeError(self._load_error) from error
            finally:
                self._loading = False

    def warmup(self) -> dict:
        """Load the model once without translating or retaining user content."""

        self._ensure_loaded()
        return self.status()

    def _cache_get(self, text: str) -> str | None:
        with self._cache_lock:
            translated = self._cache.get(text)
            if translated is not None:
                self._cache.move_to_end(text)
            return translated

    def _cache_put(self, text: str, translated: str) -> None:
        with self._cache_lock:
            self._cache[text] = translated
            self._cache.move_to_end(text)
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)

    def _translate_chunks_unlocked(self, chunks: list[str]) -> list[str]:
        if not chunks:
            return []
        self._ensure_loaded()
        assert self._tokenizer is not None and self._model is not None
        # Similar-length batches waste substantially less work on padding. Keep
        # positions so the public response remains byte-for-byte ordered.
        indexed_chunks = sorted(enumerate(chunks), key=lambda item: len(item[1]))
        translated: list[str | None] = [None] * len(chunks)
        batch_size = INFERENCE_BATCH_SIZE
        with torch.inference_mode():
            for start in range(0, len(indexed_chunks), batch_size):
                indexed_batch = indexed_chunks[start : start + batch_size]
                batch = [value for _, value in indexed_batch]
                encoded = self._tokenizer(
                    batch,
                    return_tensors="pt",
                    padding=True,
                    truncation=True,
                    max_length=512,
                )
                encoded = {key: value.to(self._device) for key, value in encoded.items()}
                generated = self._model.generate(
                    **encoded,
                    max_new_tokens=512,
                    num_beams=GENERATION_BEAMS,
                    early_stopping=True,
                )
                decoded = self._tokenizer.batch_decode(generated, skip_special_tokens=True)
                for (original_index, _), value in zip(indexed_batch, decoded):
                    translated[original_index] = value.strip()
        return [str(value or "") for value in translated]

    def _translate_chunks(self, chunks: list[str]) -> list[str]:
        """Compatibility wrapper used by diagnostics and older callers."""

        with self._inference_lock:
            return self._translate_chunks_unlocked(chunks)

    def translate_many_with_stats(self, texts: Iterable[str]) -> tuple[list[str], dict]:
        started = time.perf_counter()
        values = [str(value or "") for value in texts]
        sources: list[str | None] = []
        unique_sources: list[str] = []
        seen: set[str] = set()
        for text in values:
            stripped = text.strip()
            if not stripped or not LATIN_RE.search(stripped):
                sources.append(None)
                continue
            sources.append(stripped)
            if stripped in seen:
                continue
            seen.add(stripped)
            unique_sources.append(stripped)

        translated_by_source: dict[str, str] = {}
        cache_hits = 0
        pending_sources: list[str] = []
        for source in unique_sources:
            cached = self._cache_get(source)
            if cached is None:
                pending_sources.append(source)
            else:
                cache_hits += 1
                translated_by_source[source] = cached

        inferred_sources = 0
        if pending_sources:
            # One inference owner at a time. Recheck after entering the lock so
            # simultaneous browser requests never translate the same text twice.
            with self._inference_lock:
                truly_missing: list[str] = []
                for source in pending_sources:
                    cached = self._cache_get(source)
                    if cached is None:
                        truly_missing.append(source)
                    else:
                        cache_hits += 1
                        translated_by_source[source] = cached

                if truly_missing:
                    chunks_by_source = [(_split_text(source), source) for source in truly_missing]
                    all_chunks = [
                        chunk
                        for chunks, _source in chunks_by_source
                        for chunk in chunks
                    ]
                    chunk_translations = iter(self._translate_chunks_unlocked(all_chunks))
                    for chunks, source in chunks_by_source:
                        translated = " ".join(
                            next(chunk_translations) for _ in chunks
                        ).strip() or source
                        self._cache_put(source, translated)
                        translated_by_source[source] = translated
                    inferred_sources = len(truly_missing)

        results = [
            values[index] if source is None else translated_by_source.get(source, values[index])
            for index, source in enumerate(sources)
        ]
        stats = {
            "input_items": len(values),
            "unique_items": len(unique_sources),
            "cache_hits": cache_hits,
            "translated_items": inferred_sources,
            "duration_ms": max(0, round((time.perf_counter() - started) * 1000)),
        }
        with self._stats_lock:
            self._request_count += 1
            self._cache_hit_count += cache_hits
            self._inference_item_count += inferred_sources
        return results, stats

    def translate_many(self, texts: Iterable[str]) -> list[str]:
        translated, _stats = self.translate_many_with_stats(texts)
        return translated


translator = KoreanTranslator()
router = APIRouter(prefix="/translation", tags=["translation"])


@router.get("/status")
def translation_status():
    return translator.status()


@router.post("/warmup")
def warmup_korean_translation():
    try:
        return translator.warmup()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post("/korean", response_model=TranslationResponse)
def translate_to_korean(payload: TranslationRequest):
    if payload.source_language.lower() != "en" or payload.target_language.lower() != "ko":
        raise HTTPException(
            status_code=400,
            detail="This endpoint currently supports English to Korean only.",
        )
    oversized = [index for index, text in enumerate(payload.texts) if len(text) > MAX_TEXT_CHARS]
    if oversized:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Translation item exceeds {MAX_TEXT_CHARS} characters "
                f"at index {oversized[0]}."
            ),
        )
    try:
        translated, stats = translator.translate_many_with_stats(payload.texts)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return TranslationResponse(
        translations=[
            TranslationResult(source=source, translated=target)
            for source, target in zip(payload.texts, translated)
        ],
        engine="local-marian",
        model=MODEL_ID,
        **stats,
    )
