"""Offline checks for Jira article formatting and create/attach/update behavior."""
from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from news_scrapper.jira_integration import service


ARTICLES = [
    {
        "title": "News <script>alert(1)</script>",
        "summary": "Research & development\nSecond paragraph",
        "image_url": "https://example.com/image.png",
        "source_url": "https://example.com/story?a=1&b=2",
        "source": "Company <Internal>",
        "date": "2026-10-29",
    },
    {
        "title": "Second news",
        "summary": "Summary two",
        "image_url": "",
        "source_url": "",
        "source": "Second source",
        "date": "",
    },
]


class FakeJira:
    instances = []

    def __init__(self):
        self.base_url = "https://jira.sec.samsung.net"
        self.created = []
        self.attached = []
        self.updated = []
        FakeJira.instances.append(self)

    def create_ticket(self, **kwargs):
        self.created.append(kwargs)
        return {"key": "SRIDRDSG-123", "id": "1234"}

    def attach_file_to_jira(self, issue_key, path):
        self.attached.append((issue_key, path))
        return {"id": "9876", "filename": Path(path).name}

    def update_ticket(self, issue_key, field, html):
        self.updated.append((issue_key, field, html))


class JiraNewsTests(unittest.TestCase):
    def test_status_report_escapes_untrusted_article_content(self):
        html = service.build_status_report(ARTICLES)
        self.assertIn("News &lt;script&gt;alert(1)&lt;/script&gt;", html)
        self.assertIn("Research &amp; development", html)
        self.assertIn('href="https://example.com/story?a=1&amp;b=2"', html)
        self.assertNotIn("<script>", html)
        self.assertIn("Second news", html)

    def test_create_one_ticket_for_multiple_cards(self):
        FakeJira.instances.clear()
        with patch.object(service, "_load_jira_ops", return_value=FakeJira), \
             patch.object(service, "_download_image") as download:
            def write_test_image(_url, directory, _index):
                path = Path(directory) / "news-01.png"
                path.write_bytes(b"fake-image")
                return path

            download.side_effect = write_test_image
            result = service.create_news_ticket(ARTICLES, "SRIDRDSG", "Task")

        jira = FakeJira.instances[-1]
        self.assertEqual(len(jira.created), 1)
        self.assertEqual(jira.created[0]["description"], "")
        self.assertEqual(result["article_count"], 2)
        self.assertEqual(result["image_count"], 1)
        self.assertEqual(result["key"], "SRIDRDSG-123")
        self.assertEqual(len(jira.attached), 1)
        self.assertEqual(len(jira.updated), 1)
        self.assertIn("/secure/attachment/9876/news-01.png", jira.updated[0][2])

    def test_failed_image_preserves_created_issue(self):
        FakeJira.instances.clear()
        with patch.object(service, "_load_jira_ops", return_value=FakeJira), \
             patch.object(service, "_download_image", side_effect=ValueError("blocked")):
            result = service.create_news_ticket(ARTICLES, "SRIDRDSG", "Task")
        self.assertEqual(result["key"], "SRIDRDSG-123")
        self.assertEqual(result["image_count"], 0)
        self.assertEqual(len(result["warnings"]), 1)
        self.assertEqual(len(FakeJira.instances[-1].updated), 0)

    def test_reject_invalid_project(self):
        with self.assertRaises(service.JiraNotReady):
            service.create_news_ticket(ARTICLES, "NOT A PROJECT")


if __name__ == "__main__":
    unittest.main()
