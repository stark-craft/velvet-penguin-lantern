"""Offline tests for Tech Sensing HTML, source safety, retry pacing and deduplication."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from news_scrapper.jira_integration import generation, jobs, service


ARTICLE = {
    "title": "AI <Chip> launch",
    "summary": "Company announced an AI chip with two new features.",
    "source": "Source One",
    "source_url": "https://example.com/ai-chip",
    "date": "2026-10-30",
    "category": "Technology",
    "image_url": "https://example.com/chip.png",
    "sources": [
        {"url": "https://example.com/ai-chip", "name": "Source One", "date": "2026-10-30"},
        {"url": "https://example.org/chip", "name": "Source Two", "date": "2026-10-30"},
    ],
}


class GenerationTests(unittest.TestCase):
    def test_all_attached_sources_retained_without_duplicate(self):
        sources = generation.article_sources(ARTICLE)
        self.assertEqual(len(sources), 2)
        self.assertEqual(sources[1]["name"], "Source Two")

    def test_requires_exactly_three_ai_facts(self):
        payload = {
            "category": "Technology / Market",
            "key_facts": ["Company released a chip."],
            "insight": "Samsung could consider the implications of emerging chip designs for its roadmap.",
        }
        with patch.object(generation.chat, "URL", "https://example.com"), \
             patch.object(generation.chat, "CLIENT", "test"), \
             patch.object(generation.chat, "TOKEN", "test"), \
             patch.object(generation.chat, "MODEL_ID", "test"), \
             patch.object(generation.search, "ENDPOINT", ""), \
             patch.object(generation.chat, "call_samsung_chat", return_value={"content": json.dumps(payload)}):
            with self.assertRaises(generation.GenerationError):
                generation.generate_draft(ARTICLE)

    def test_rate_limit_automatically_retries_read_only_calls(self):
        calls = []
        def invoke():
            calls.append(True)
            if len(calls) == 1:
                raise RuntimeError("Samsung Chat HTTP 429")
            return {"ok": True}
        pauses = []
        with patch.object(generation.time, "sleep") as sleeping:
            result = generation._limited_call("Samsung Chat", invoke, lambda op, seconds, attempt: pauses.append((seconds, attempt)))
        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(calls), 2)
        self.assertEqual(pauses, [(60, 1)])
        sleeping.assert_called_once_with(60)

    def test_tech_sensing_html_escapes_and_embeds_original_sources(self):
        article = {
            **ARTICLE,
            "key_facts": [
                "The company announced a new AI processor.",
                "The design targets machine learning workloads.",
                "The announcement details two new features.",
            ],
            "insight": "Samsung could assess these developments for relevant chip research and partnerships.",
            "image_caption": "Example chip",
        }
        rendered = service.build_status_report([article], {0: {"id": "454", "filename": "chip.png"}})
        self.assertIn("[Tech Sensing] AI &lt;Chip&gt; launch", rendered)
        self.assertIn("font-size:16pt", rendered)
        self.assertIn("font-size:14pt", rendered)
        self.assertEqual(rendered.count("<li style=\"margin-bottom:11px\">"), 8)
        self.assertIn("https://example.org/chip", rendered)
        self.assertIn("/secure/attachment/454/chip.png", rendered)
        self.assertIn("Our Insights:", rendered)
        self.assertNotIn("<Chip>", rendered)


class JobTests(unittest.TestCase):
    def test_identity_and_sqlite_mapping_stop_duplicate_writes(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"JIRA_NEWS_DB_PATH": str(Path(directory) / "issues.db")}):
            created = {"key": "SRIDRDSG-1", "url": "https://jira.sec.samsung.net/browse/SRIDRDSG-1"}
            self.assertIsNone(jobs._previous(ARTICLE))
            jobs._remember(ARTICLE, created)
            self.assertEqual(jobs._previous(ARTICLE), created)
            self.assertEqual(jobs.identity(ARTICLE), jobs.identity({**ARTICLE, "title": "Edited title"}))

    def test_job_details_are_isolated_by_viewer(self):
        identifier = jobs._new_job("actor-one", "draft", [ARTICLE])
        self.assertIsNotNone(jobs.get_job(identifier, "actor-one"))
        self.assertIsNone(jobs.get_job(identifier, "actor-two"))


if __name__ == "__main__":
    unittest.main()
