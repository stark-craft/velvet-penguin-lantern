"""Smoke test the document-wide 300-character Sampark summary.

Run from C:\scrappyV3:
    python scripts\test_document_summarizer.py

No AI key needed; tests explicitly clear external-provider settings.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

target = (
    Path(__file__).resolve().parents[1]
    / "news_scrapper" / "internal_content" / "document_summarizer.py"
)
spec = importlib.util.spec_from_file_location("sampark_document_summarizer", target)
module = importlib.util.module_from_spec(spec)
assert spec is not None and spec.loader is not None
spec.loader.exec_module(module)

os.environ.pop("SAMPARK_SUMMARY_API_URL", None)
os.environ.pop("SAMPARK_SUMMARY_MODEL", None)
os.environ.pop("SAMPARK_SUMMARY_API_KEY", None)

opening = (
    "Opening context only: the team held several preliminary meetings "
    "to discuss timelines, ownership and reporting structures. "
) * 30
middle = (
    "Key finding: inconsistent documentation caused delayed handoffs "
    "and required stronger validation across teams. "
) * 15
ending = (
    "Final recommendation: prioritize accessible documentation and "
    "verified import validation before the next rollout."
)
text = opening + "\n" + middle + "\n" + ending
summary, method = module.summarize_document(text)
print("METHOD:", method)
print("SUMMARY:", summary)
print("CHARACTERS:", len(summary))
assert method == "extractive", method
assert 30 < len(summary) <= 300
assert "final recommendation" in summary.casefold(), "End-of-document finding was ignored."
assert "opening context only" not in summary.casefold()[:30], "Looks like an opening excerpt."

huge = (
    opening + middle + ("This supplementary analysis reviews a procedural "
    "exception in the queue and records the chosen mitigation. " * 1200)
    + "\n" + ending
)
big_summary, _ = module.summarize_document(huge)
assert 30 < len(big_summary) <= 300
assert "final recommendation" in big_summary.casefold()
assert module.summarize_document("")[1] == "none"
assert len(module.summarize_document("A short but meaningful test document.")[0]) <= 300
print("PASS: Global selection, tail outcome, 300-character limit, long text and empty input.")
