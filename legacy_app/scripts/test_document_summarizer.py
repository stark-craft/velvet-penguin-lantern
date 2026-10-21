"""Regression smoke tests: Samsung Chat first, local DistilBART fallback.

Run from C:\\scrappyV3 with:
    .\\venv\\Scripts\\python.exe scripts\\test_document_summarizer.py

Mock all model calls so test runs offline without credentials/weights.
"""
import importlib.util
from pathlib import Path
from unittest.mock import patch

target = (
    Path(__file__).resolve().parents[1]
    / "news_scrapper" / "internal_content" / "document_summarizer.py"
)
spec = importlib.util.spec_from_file_location("sampark_summarizer", target)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

opening = (
    "Opening: NewsScrapper is an integrated digital experience that allows "
    "people to read and explore technology news. "
) * 32
middle = (
    "Observation: The application combines Scrapy crawling, Samsung Web Search "
    "enrichment, profile scoring and Bouncer classification. "
) * 26
ending = (
    "FINAL RECOMMENDATION: Preserve source provenance, generate concise summaries "
    "grounded in evidence and enforce backend access control. "
) * 5
full_text = opening + "\n" + middle + "\n" + ending
evidence = module.document_evidence(full_text)
assert len(evidence) >= 8
assert "FINAL RECOMMENDATION" in evidence[-1], "Last section must be represented."
assert "Opening:" in evidence[0], "Document opening should be represented."
assert len("".join(evidence)) < len(full_text), "Long docs need bounded evidence."

with patch.object(module, "_samsung_summary", return_value="Samsung Chat synthesized the overall NewsScrapper architecture and recommended preserving provenance.") as chat:
    with patch.object(module, "_bart_summary", side_effect=AssertionError("BART should not run")):
        summary, method = module.summarize_document(full_text)
assert method == "samsung_chat", method
assert len(summary) <= 300
assert chat.call_count == 1

with patch.object(module, "_samsung_summary", side_effect=RuntimeError("chat unavailable")):
    with patch.object(module, "_bart_summary", return_value="BART summarized the document's architecture and its final recommendations.") as bart:
        summary, method = module.summarize_document(full_text)
assert method == "bart", method
assert len(summary) <= 300
assert bart.call_count == 1

with patch.object(module, "_samsung_summary", side_effect=RuntimeError("chat unavailable")):
    with patch.object(module, "_bart_summary", side_effect=RuntimeError("local model missing")):
        try:
            module.summarize_document(full_text)
            raise AssertionError("Must report failures, not return first 300 characters")
        except module.DocumentSummaryUnavailable:
            pass

assert module.summarize_document("") == ("", "none")
assert len(module._fit("Very important conclusion. " * 100, 300)) <= 300
print("PASS: full-document evidence, last-page result, Samsung primary, BART fallback, honest errors, 300-character cap.")
