"""Create a 300-character description from the document's *overall* contents.

No PDF bytes leave this module. The local extractive mode reads/scans the full
provided text; an optional, explicitly configured OpenAI-compatible chat
endpoint can rewrite the globally selected evidence into an abstractive summary.

External model use is OFF by default. Internal/company documents must never
be sent to an unapproved AI service.

Environment (opt-in):
    SAMPARK_SUMMARY_API_URL=https://approved-service.example/v1/chat/completions
    SAMPARK_SUMMARY_MODEL=your-approved-model
    SAMPARK_SUMMARY_API_KEY=...  # optional for a local model

Without these settings the dependency-free, local extractive summary is used.
The caller decides what text to pass; current document_parser.py caps extracted
text at 200,000 characters, so longer documents require a separate extraction
cap review.
"""

from __future__ import annotations

import json
import math
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter

DESCRIPTION_MAX = 300
MAX_CANDIDATES = 4000
MODEL_EVIDENCE_MAX = 13000

STOPWORDS = frozenset(
    """the a an and or to of in on by from for with as at is are was were
    be been being that this these those their its it they them he she we our
    you your into within without throughout where when while which who what
    how about not can may will would should must has have had do does did
    all any some one two three under over than then just each every other
    also such due per via through using use used make made many few
    including include included according report document page pages
    information provided section sections following introduction overview
    sampark stress test synthetic paragraph continued""".split()
)
IMPORTANT_PHRASES = (
    "final recommendation", "conclusion", "recommendation",
    "key finding", "key takeaway", "decision", "approved",
    "resolved", "outcome", "next step", "result", "summary",
    "action required", "priority", "critical", "risk",
)


def _normalize(text: str) -> str:
    normalized = str(text or "").replace("\x00", " ")
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"[\t ]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def _words(sentence: str) -> list[str]:
    return [
        w.casefold() for w in re.findall(r"[^\W_]+(?:['-][^\W_]+)*", sentence, re.UNICODE)
        if len(w) > 2 and w.casefold() not in STOPWORDS
    ]


def _candidates(text: str) -> list[str]:
    # Keeps paragraph lines (including terminal recommendation headers) while
    # splitting flowing prose into sentence-like spans.
    chunks = re.split(r"(?<=[.!?。！？])\s+|\n+", text)
    lines = []
    seen = Counter()
    for part in chunks:
        clean = re.sub(r"\s+", " ", part).strip(" \t-•*")
        if len(clean) < 22:
            continue
        if len(clean) > 650:
            clean = clean[:650].rsplit(" ", 1)[0]
        if not clean:
            continue
        fingerprint = re.sub(r"\W+", " ", clean.casefold()).strip()
        seen[fingerprint] += 1
        # Repeated banners should not crowd out actual findings.
        if seen[fingerprint] > 2 and not any(p in clean.casefold() for p in IMPORTANT_PHRASES):
            continue
        lines.append(clean)
        if len(lines) >= MAX_CANDIDATES:
            break
    return lines


def _ranked_evidence(text: str, limit: int = MODEL_EVIDENCE_MAX) -> list[str]:
    lines = _candidates(text)
    if not lines:
        return []
    tokenized = [_words(line) for line in lines]
    terms = Counter(word for tokens in tokenized for word in set(tokens))
    n = max(1, len(lines))
    scores = []
    for i, (line, tokens) in enumerate(zip(lines, tokenized)):
        significant = set(tokens)
        if not significant:
            lexical = 0.0
        else:
            lexical = sum(
                min(4.0, 1.0 + math.log(1 + terms[w]))
                for w in significant
            ) / max(1.0, math.sqrt(len(significant)))
        lower = line.casefold()
        important = any(phrase in lower for phrase in IMPORTANT_PHRASES)
        finding = any(phrase in lower for phrase in ("final recommendation", "conclusion", "key finding"))
        tail = i / max(1, n - 1)
        # Prefer a finding/conclusion late in the report instead of its opening.
        bonus = (9.0 if finding else (5.0 if important else 0.0))
        bonus += (1.75 * tail if important else 0)
        # Dampen oversized, vague paragraphs.
        penalty = 0.7 if len(line) > 440 else 1.0
        scores.append((lexical * penalty + bonus, i))
    selected = []
    used = set()
    max_chars = 0
    # Evidence is intentionally selected from *all* document sections.
    # One top-quality candidate from the first, middle, and final thirds
    # reduces the tendency to paraphrase only the first page.
    for lo, hi in ((0, n // 3), (n // 3, 2 * n // 3), (2 * n // 3, n)):
        candidates = [(score, i) for score, i in scores if lo <= i < max(hi, lo + 1)]
        if candidates:
            _, best = max(candidates)
            if best not in used:
                selected.append(best)
                used.add(best)
                max_chars += len(lines[best])
    for _, i in sorted(scores, reverse=True):
        if i in used:
            continue
        selected.append(i)
        used.add(i)
        max_chars += len(lines[i])
        if max_chars >= limit:
            break
    return [lines[i] for i in selected]


def _fit(text: str, max_chars: int) -> str:
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip(" \t\n\"'")
    if len(cleaned) <= max_chars:
        return cleaned
    clipped = cleaned[: max(0, max_chars - 1)]
    boundary = clipped.rfind(" ")
    if boundary >= max(25, int(max_chars * 0.65)):
        clipped = clipped[:boundary]
    return clipped.rstrip(" ,;:.-") + "…"


def _local_summary(text: str, max_chars: int) -> str:
    ranked = _ranked_evidence(text, limit=4600)
    if not ranked:
        return ""
    # The first item in each third is ranked globally; find the most relevant
    # conclusion, then complement it with another nonduplicate point.
    conclusions = [
        (i, sentence) for i, sentence in enumerate(ranked)
        if any(p in sentence.casefold() for p in IMPORTANT_PHRASES)
    ]
    main = next(
        (s for _, s in conclusions if "final recommendation" in s.casefold()
         or "conclusion" in s.casefold()),
        None,
    ) or (conclusions[0][1] if conclusions else ranked[0])
    others = []
    base = set(_words(main))
    for sentence in ranked:
        if sentence == main:
            continue
        tokens = set(_words(sentence))
        overlap = len(base & tokens) / max(1, len(base | tokens))
        if overlap < 0.63:
            others.append(sentence)
        if len(others) >= 2:
            break
    primary_budget = min(190, max(80, max_chars - 80))
    summary = _fit(main.rstrip(". ") + ".", primary_budget)
    for sentence in others:
        remaining = max_chars - len(summary) - 2
        if remaining < 45:
            break
        fragment = _fit(sentence.rstrip(". ") + ".", remaining)
        if fragment:
            summary += " " + fragment
    return _fit(summary, max_chars)


def _maybe_llm(text: str, max_chars: int) -> str | None:
    endpoint = os.environ.get("SAMPARK_SUMMARY_API_URL", "").strip()
    model = os.environ.get("SAMPARK_SUMMARY_MODEL", "").strip()
    if not (endpoint and model):
        return None
    parsed = urllib.parse.urlsplit(endpoint)
    is_loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and is_loopback):
        return None

    # Small documents are submitted as-is; larger documents first pass
    # through a full-text evidence selector for predictable token cost.
    context = text if len(text) <= MODEL_EVIDENCE_MAX else "\n".join(
        _ranked_evidence(text, limit=MODEL_EVIDENCE_MAX)
    )
    prompt = (
        "Summarize the ENTIRE document using only the evidence provided. "
        f"Write ONE concise, faithful, natural-language summary at most {max_chars} "
        "characters long. Include the actual outcome or final recommendation "
        "where present. Don't copy the first paragraph blindly. "
        "No headings, bullets, markdown, filler, unsupported claims, or quotes. "
        "Return only the description."
    )
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": "Document text/evidence:\n" + context},
        ],
        "temperature": 0.1,
        "max_tokens": 160,
    }).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get("SAMPARK_SUMMARY_API_KEY", "").strip()
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    request = urllib.request.Request(endpoint, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.load(response)
        choices = body.get("choices") or []
        message = choices[0].get("message") if choices else None
        answer = (message or {}).get("content")
        if isinstance(answer, str) and len(answer.strip()) > 15:
            return _fit(answer, max_chars)
    except (urllib.error.URLError, ValueError, KeyError, IndexError, TimeoutError, OSError):
        # A slow/unreachable optional model must never break uploading.
        return None
    return None


def summarize_document(text: str, max_chars: int = DESCRIPTION_MAX) -> tuple[str, str]:
    """Return (summary, method) from all supplied extracted text.

    'ai' is a model-produced summary when an explicitly configured approved
    endpoint succeeds; 'extractive' is a deterministic global-text fallback.
    An empty input returns ('', 'none').
    """
    limit = max(40, min(DESCRIPTION_MAX, int(max_chars)))
    cleaned = _normalize(text)
    if not cleaned:
        return "", "none"
    ai_summary = _maybe_llm(cleaned, limit)
    if ai_summary:
        return ai_summary, "ai"
    summary = _local_summary(cleaned, limit)
    return summary, "extractive" if summary else "none"
