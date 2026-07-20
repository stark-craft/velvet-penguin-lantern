"""Lazy DistilBART summarization with an extractive offline fallback."""

from __future__ import annotations

import re
import threading
from collections import Counter
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence


DEFAULT_SUMMARIZATION_MODEL = "sshleifer/distilbart-cnn-12-6"

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_WORD_RE = re.compile(r"[\w'-]+", flags=re.UNICODE)
_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "by",
    "for",
    "from",
    "has",
    "have",
    "he",
    "her",
    "his",
    "in",
    "is",
    "it",
    "its",
    "of",
    "on",
    "or",
    "she",
    "that",
    "the",
    "their",
    "they",
    "this",
    "to",
    "was",
    "were",
    "will",
    "with",
}
_ARTICLE_TEXT_FIELDS = (
    "content",
    "body_text",
    "full_text",
    "full_content",
    "full_contents",
    "body",
    "web_search_content",
    "rss_snippet",
    "snippet",
    "summary",
    "title",
)


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _truncate_words(text: str, max_words: int) -> str:
    words = str(text or "").split()
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]).rstrip(" ,;:") + "…"


def extractive_summary(
    text: str,
    *,
    max_words: int = 120,
    max_sentences: int = 3,
) -> str:
    """Select informative sentences deterministically and preserve source order."""

    cleaned = _clean_text(text)
    if not cleaned:
        return ""
    sentences = [
        sentence.strip()
        for sentence in _SENTENCE_SPLIT_RE.split(cleaned)
        if sentence.strip()
    ]
    if len(sentences) <= 1:
        return _truncate_words(cleaned, max_words)

    sentence_tokens: List[List[str]] = []
    frequencies: Counter[str] = Counter()
    for sentence in sentences:
        tokens = [
            token.casefold()
            for token in _WORD_RE.findall(sentence)
            if token.casefold() not in _STOP_WORDS and len(token) > 1
        ]
        sentence_tokens.append(tokens)
        frequencies.update(tokens)

    scored = []
    for index, tokens in enumerate(sentence_tokens):
        if tokens:
            score = sum(frequencies[token] for token in tokens) / len(tokens)
        else:
            score = 0.0
        # The opening sentence normally establishes the event and wins close ties.
        if index == 0:
            score += 0.35
        scored.append((score, -index, index))

    selected_indices = sorted(
        candidate[2]
        for candidate in sorted(scored, reverse=True)[: max(1, max_sentences)]
    )
    selected = " ".join(sentences[index] for index in selected_indices)
    return _truncate_words(selected, max_words)


def article_summary_text(
    article: Mapping[str, Any],
    fields: Sequence[str] = _ARTICLE_TEXT_FIELDS,
) -> str:
    """Choose the richest available text without requiring an application model."""

    candidates: List[str] = []
    for field in fields:
        text = _clean_text(str(article.get(field) or ""))
        if text and text not in candidates:
            candidates.append(text)
    if not candidates:
        return ""
    # Prefer the richest content field; a title remains a final fallback.
    return max(candidates, key=lambda value: (len(value.split()), len(value)))


class SummarizationService:
    """Load DistilBART on first use and provide structured summary metadata."""

    def __init__(
        self,
        model_name: str = DEFAULT_SUMMARIZATION_MODEL,
        *,
        model_identity: Optional[str] = None,
        force_fallback: bool = False,
        local_files_only: Optional[bool] = None,
        tokenizer_factory: Optional[Callable[..., Any]] = None,
        model_factory: Optional[Callable[..., Any]] = None,
    ) -> None:
        self.model_name = model_name
        self.model_identity = model_identity or model_name
        self.force_fallback = bool(force_fallback)
        self.local_files_only = local_files_only
        self._tokenizer_factory = tokenizer_factory
        self._model_factory = model_factory
        self._tokenizer: Any = None
        self._model: Any = None
        self._load_attempted = False
        self._backend = "uninitialized"
        self._load_error: Optional[str] = None
        self._load_lock = threading.Lock()
        self._inference_lock = threading.Lock()

    def _activate_fallback(self, reason: str) -> None:
        self._tokenizer = None
        self._model = None
        self._backend = "extractive_fallback"
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
                if self._tokenizer_factory is None or self._model_factory is None:
                    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

                    tokenizer_factory = self._tokenizer_factory or AutoTokenizer.from_pretrained
                    model_factory = self._model_factory or AutoModelForSeq2SeqLM.from_pretrained
                else:
                    tokenizer_factory = self._tokenizer_factory
                    model_factory = self._model_factory
                kwargs: Dict[str, Any] = {}
                if self.local_files_only is not None:
                    kwargs["local_files_only"] = self.local_files_only
                self._tokenizer = tokenizer_factory(self.model_name, **kwargs)
                self._model = model_factory(self.model_name, **kwargs)
                if hasattr(self._model, "eval"):
                    self._model.eval()
                self._backend = "distilbart"
                self._load_error = None
            except Exception as exc:  # Optional package or model cache may be absent.
                self._activate_fallback(
                    "distilbart_unavailable:%s:%s" % (type(exc).__name__, str(exc)[:240])
                )

    def status(self) -> Dict[str, Any]:
        self._ensure_backend()
        return {
            "backend": self._backend,
            "model": self.model_identity,
            "load_reference": self.model_name,
            "degraded": self._backend != "distilbart",
            "reason": self._load_error,
        }

    def summarize(
        self,
        text: str,
        *,
        max_words: int = 120,
        max_sentences: int = 3,
        max_input_tokens: int = 1024,
        max_new_tokens: int = 160,
        min_new_tokens: int = 24,
    ) -> Dict[str, Any]:
        """Return ``summary`` and provenance rather than an application model."""

        cleaned = _clean_text(text)
        self._ensure_backend()
        runtime_error: Optional[str] = None
        summary = ""
        if cleaned and self._model is not None and self._tokenizer is not None:
            try:
                inputs = self._tokenizer(
                    cleaned,
                    return_tensors="pt",
                    max_length=max_input_tokens,
                    truncation=True,
                )
                with self._inference_lock:
                    output = self._model.generate(
                        **inputs,
                        max_new_tokens=max_new_tokens,
                        min_new_tokens=min_new_tokens,
                        do_sample=False,
                        num_beams=4,
                        length_penalty=2.0,
                        early_stopping=True,
                    )
                summary = _clean_text(
                    self._tokenizer.decode(output[0], skip_special_tokens=True)
                )
                summary = _truncate_words(summary, max_words)
                if not summary:
                    runtime_error = "distilbart_returned_empty_summary"
            except Exception as exc:
                runtime_error = "distilbart_inference_failed:%s:%s" % (
                    type(exc).__name__,
                    str(exc)[:240],
                )

        if not summary:
            summary = extractive_summary(
                cleaned,
                max_words=max_words,
                max_sentences=max_sentences,
            )

        status = self.status()
        used_fallback = status["backend"] != "distilbart" or runtime_error is not None
        return {
            "summary": summary,
            "metadata": {
                **status,
                "backend": "extractive_fallback" if used_fallback else status["backend"],
                "degraded": used_fallback,
                "reason": runtime_error or status.get("reason"),
                "input_characters": len(cleaned),
                "summary_words": len(summary.split()),
            },
        }

    def summarize_article(self, article: Mapping[str, Any]) -> Dict[str, Any]:
        item = dict(article)
        result = self.summarize(article_summary_text(item))
        item["master_summary"] = result["summary"]
        item["summary_metadata"] = result["metadata"]
        return item

    def summarize_articles(
        self, articles: Sequence[Mapping[str, Any]]
    ) -> List[Dict[str, Any]]:
        return [self.summarize_article(article) for article in articles]


DistilBartSummarizer = SummarizationService


def summarize_article(
    article: Mapping[str, Any],
    *,
    service: Optional[SummarizationService] = None,
) -> Dict[str, Any]:
    return (service or SummarizationService()).summarize_article(article)
