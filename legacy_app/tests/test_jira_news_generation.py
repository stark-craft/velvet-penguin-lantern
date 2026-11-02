"""Offline Tech Sensing Jira regression tests. No real Jira or Samsung API calls."""
from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from news_scrapper.jira_integration import generation, jobs, service

ARTICLE = {
    "title": "AI <Chip> launch",
    "summary": "Company A launched a new chip with a neural accelerator.",
    "source": "Source One",
    "source_url": "https://example.com/ai-chip",
    "date": "2026-10-30",
    "category": "Technology / Market",
    "image_url": "",
    "sources": [
        {"name": "Source One", "url": "https://example.com/ai-chip", "date": "2026-10-30"},
        {"name": "Source Two", "url": "https://example.org/other", "date": "2026-10-29"},
    ],
}
INSIGHT = (
    "Samsung should monitor this processor development because its efficiency and "
    "accelerator choices could influence future device and semiconductor workloads. "
    "The announcement provides a useful comparison point for engineering teams "
    "studying performance, power consumption, and supplier ecosystems. In India, "
    "Samsung could review whether the design reveals opportunities for local "
    "research collaboration or new product capabilities. These possibilities are "
    "strategic considerations rather than confirmed Samsung plans. The next step "
    "would be to track independent benchmarks, actual availability, and evidence "
    "of adoption before making any investment decision."
)
REPORT = {
    **ARTICLE,
    "original_title": ARTICLE["title"],
    "key_facts": [
        "Company A announced the new AI processor in October.",
        "The announced processor contains a neural accelerator.",
        "Company A described two intended device workloads.",
    ],
    "insight": INSIGHT,
    "image_caption": "Example chip with accelerator",
}


class ReportTests(unittest.TestCase):
    def test_three_facts_original_sources_html_escape_and_image_attachment(self):
        self.assertTrue(60 <= len(INSIGHT.split()) <= 100)
        markup = service.build_article_status_report(
            REPORT, {0: {"id": "454", "filename": "chip.png"}}
        )
        self.assertIn("[Tech Sensing]", markup)
        self.assertIn("font-size:16pt", markup)
        self.assertIn("font-size:14pt", markup)
        self.assertIn("AI &lt;Chip&gt; launch", markup)
        self.assertNotIn("<Chip>", markup)
        self.assertIn("https://example.org/other", markup)
        self.assertIn("/secure/attachment/454/chip.png", markup)
        self.assertIn("Our Insights", markup)
        # Only the three Key Facts remain list items; sources are inline links.
        self.assertEqual(markup.count("<li>"), 3)
        self.assertIn(
            '<a href="https://example.com/ai-chip">Source One (2026-10-30)</a>, '
            '<a href="https://example.org/other">Source Two (2026-10-29)</a>',
            markup,
        )
        self.assertNotIn('>https://example.com/ai-chip</a>', markup)

    def test_source_name_and_date_are_clickable_and_escaped(self):
        article = {
            **REPORT,
            "sources": [
                {
                    "name": "<Publisher & Partners>",
                    "date": "2026-11-02",
                    "url": "https://example.com/story?a=1&b=2",
                },
                {
                    "name": "Not Safe",
                    "date": "2026-11-02",
                    "url": "javascript:alert(1)",
                },
            ],
        }
        markup = service.build_article_status_report(article)
        self.assertIn(
            '<a href="https://example.com/story?a=1&amp;b=2">'
            '&lt;Publisher &amp; Partners&gt; (2026-11-02)</a>',
            markup,
        )
        self.assertNotIn("javascript:", markup)
        self.assertNotIn("<Publisher & Partners>", markup)

    def test_primary_source_fallback_uses_clickable_name_and_date(self):
        article = {**REPORT, "sources": []}
        markup = service.build_article_status_report(article)
        self.assertIn(
            '<a href="https://example.com/ai-chip">Source One (2026-10-30)</a>',
            markup,
        )
        self.assertNotIn("Original source link not available", markup)

    def test_facts_must_be_exactly_three(self):
        with self.assertRaises(ValueError):
            service.build_article_status_report({**REPORT, "key_facts": ["one"]})

    def test_one_tech_sensing_issue_has_original_headline_in_summary(self):
        edited = {**REPORT, "title": "Edited preview headline"}
        self.assertEqual(service._summary([edited]), "[Tech Sensing] AI <Chip> launch")

    def test_sso_jira_contract_preserves_assignee_blank_description_and_field(self):
        calls = []

        class Jira:
            base_url = "https://jira.example.com"

            def _make_request(self, method, url):
                self_check = Mock(ok=True)
                self_check.json.return_value = {"name": "real-user", "active": True}
                return self_check

            def create_ticket(self, **kwargs):
                calls.append(kwargs)
                return {"key": "SRI-42"}

        with patch.object(service, "_load_jira_ops", return_value=Jira):
            result = service.create_news_ticket([REPORT], "SRI")
        self.assertEqual(result["key"], "SRI-42")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["assignee"], "real-user")
        self.assertEqual(calls[0]["description"], "")
        self.assertEqual(calls[0]["summary"], "[Tech Sensing] AI <Chip> launch")
        self.assertIn("Key Facts", calls[0]["status_report"])

    def test_old_status_report_path_is_retained(self):
        old = service.build_status_report([ARTICLE])
        self.assertIn("TechScout", old)
        self.assertIn("Artifacts Overview", old)


class GenerationTests(unittest.TestCase):
    def test_sources_keep_original_publisher_links(self):
        sources = generation.article_sources(ARTICLE)
        self.assertEqual(len(sources), 2)
        self.assertEqual(sources[1]["name"], "Source Two")

    def test_manual_draft_does_not_fabricate_facts_or_insight(self):
        draft = generation.editable_fallback(ARTICLE)
        self.assertEqual(draft["key_facts"], ["", "", ""])
        self.assertEqual(draft["insight"], "")
        self.assertEqual(draft["sources"], generation.article_sources(ARTICLE))

    def test_429_retries_after_server_wait(self):
        calls = []

        def invoke():
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("Samsung Chat HTTP 429. Retry-After: 120;")
            return {"ok": True}

        with patch.object(generation.time, "sleep") as sleeping:
            result = generation._limited_call("Samsung Chat", invoke, lambda *_: None)
        self.assertEqual(result, {"ok": True})
        sleeping.assert_called_once_with(120)

    def test_invalid_ai_facts_are_rejected(self):
        invalid = {"category": "Tech", "key_facts": ["Only one"], "insight": INSIGHT}
        with (
            patch.object(generation.chat, "URL", "https://example.com"),
            patch.object(generation.chat, "CLIENT", "test"),
            patch.object(generation.chat, "TOKEN", "test"),
            patch.object(generation.chat, "MODEL_ID", "test"),
            patch.object(generation.search, "ENDPOINT", ""),
            patch.object(
                generation.chat,
                "call_samsung_chat",
                return_value={"content": json.dumps(invalid)},
            ),
        ):
            with self.assertRaises(generation.GenerationError):
                generation.generate_draft(ARTICLE)


class JobTests(unittest.TestCase):
    def test_one_issue_for_each_article_and_persisted_idempotence(self):
        other = {**REPORT, "title": "Another story", "original_title": "Another story",
                 "source_url": "https://example.org/second"}
        calls = []

        def create_ticket(articles, project, issue_type):
            calls.append((copy.deepcopy(articles), project, issue_type))
            i = len(calls)
            return {"key": f"SRI-{i}", "url": f"https://jira.example.com/browse/SRI-{i}",
                    "warnings": [], "article_count": 1, "image_count": 0}

        with (
            tempfile.TemporaryDirectory() as root,
            patch.dict("os.environ", {
                "JIRA_NEWS_DB_PATH": str(Path(root) / "jira.sqlite"),
                "JIRA_NEWS_PROJECT": "SRI",
            }),
            patch.object(jobs.service, "create_news_ticket", side_effect=create_ticket),
        ):
            jid = jobs._new_job("reviewer", "publish", [REPORT, other])
            jobs._run_publish(jid)
            data = jobs.get_job(jid, "reviewer")
            self.assertEqual([x["status"] for x in data["entries"]], ["created", "created"])
            self.assertEqual(len(calls), 2)
            self.assertTrue(all(len(x[0]) == 1 for x in calls))
            self.assertEqual(jobs._previous(REPORT)["key"], "SRI-1")
            another = jobs._new_job("reviewer", "publish", [REPORT])
            jobs._run_publish(another)
            self.assertEqual(len(calls), 2)
            self.assertEqual(jobs.get_job(another, "reviewer")["entries"][0]["status"], "existing")

    def test_jobs_are_scoped_to_authenticated_actor(self):
        jid = jobs._new_job("actor-one", "draft", [ARTICLE])
        self.assertIsNotNone(jobs.get_job(jid, "actor-one"))
        self.assertIsNone(jobs.get_job(jid, "actor-two"))


if __name__ == "__main__":
    unittest.main()
