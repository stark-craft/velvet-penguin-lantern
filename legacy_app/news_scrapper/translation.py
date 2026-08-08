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
MAX_ITEMS = max(1, min(100, int(os.environ.get("KOREAN_TRANSLATION_MAX_ITEMS", "80"))))
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
    min(4, int(os.environ.get("KOREAN_TRANSLATION_NUM_BEAMS", "2"))),
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
    return "cuda" if torch.cuda.is_available() else "cpu"


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
        self._cache: OrderedDict[str, str] = OrderedDict()
        self._cache_lock = threading.Lock()

    @property
    def source(self) -> str:
        if _local_model_available():
            return str(MODEL_PATH)
        return MODEL_ID

    def status(self) -> dict:
        return {
            "enabled": ENABLED,
            "ready": self._model is not None,
            "installed": _local_model_available(),
            "model": MODEL_ID,
            "model_path": str(MODEL_PATH),
            "local_only": LOCAL_ONLY,
            "device": self._device,
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

    def _translate_chunks(self, chunks: list[str]) -> list[str]:
        if not chunks:
            return []
        self._ensure_loaded()
        assert self._tokenizer is not None and self._model is not None
        translated: list[str] = []
        batch_size = INFERENCE_BATCH_SIZE
        with self._inference_lock, torch.inference_mode():
            for start in range(0, len(chunks), batch_size):
                batch = chunks[start : start + batch_size]
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
                translated.extend(
                    self._tokenizer.batch_decode(generated, skip_special_tokens=True)
                )
        return [value.strip() for value in translated]

    def translate_many(self, texts: Iterable[str]) -> list[str]:
        values = [str(value or "") for value in texts]
        results: list[str | None] = [None] * len(values)
        pending: list[tuple[int, str, list[str]]] = []
        all_chunks: list[str] = []

        for index, text in enumerate(values):
            stripped = text.strip()
            if not stripped or not LATIN_RE.search(stripped):
                results[index] = text
                continue
            cached = self._cache_get(stripped)
            if cached is not None:
                results[index] = cached
                continue
            chunks = _split_text(stripped)
            pending.append((index, stripped, chunks))
            all_chunks.extend(chunks)

        chunk_translations = iter(self._translate_chunks(all_chunks))
        for index, source, chunks in pending:
            translated = " ".join(next(chunk_translations) for _ in chunks).strip()
            translated = translated or source
            self._cache_put(source, translated)
            results[index] = translated

        return [str(value if value is not None else values[index]) for index, value in enumerate(results)]


translator = KoreanTranslator()
router = APIRouter(prefix="/translation", tags=["translation"])


@router.get("/status")
def translation_status():
    return translator.status()


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
        translated = translator.translate_many(payload.texts)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return TranslationResponse(
        translations=[
            TranslationResult(source=source, translated=target)
            for source, target in zip(payload.texts, translated)
        ],
        engine="local-marian",
        model=MODEL_ID,
    )
