import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request

from news_scrapper import application as app


def request_for(ip="127.0.0.1"):
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "query_string": b"",
            "client": (ip, 12345),
            "server": ("testserver", 80),
            "scheme": "http",
        }
    )


class NotInterestedAtomicityTests(unittest.TestCase):
    def article(self):
        return {
            "title": "A global signal",
            "master_summary": "A concise summary.",
            "keywords_found": ["AI"],
            "date": "2026-08-15",
            "link": "https://example.test/signal",
        }

    def patches(self, root, briefing):
        store = root / "not_interested.json"
        return (
            patch.object(app, "get_active_profile_name", return_value=app.DEFAULT_PROFILE),
            patch.object(app, "get_profile_for_request", return_value=app.DEFAULT_PROFILE),
            patch.object(app, "get_not_interested_file_for_profile", return_value=str(store)),
            patch.object(app, "get_latest_briefing_file_for_profile", return_value=str(briefing)),
            patch.object(app, "get_profile_history_dir", return_value=str(root)),
            patch.object(app, "save_training_vote", return_value=1),
            patch.object(app, "apply_learned_region", side_effect=lambda item, profile=None: item),
        )

    def test_reject_commits_store_and_shared_briefing_together(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            briefing = root / "briefing.json"
            other = {"title": "Another signal"}
            briefing.write_text(json.dumps([self.article(), other]), encoding="utf-8")
            contexts = self.patches(root, briefing)
            with contexts[0], contexts[1], contexts[2], contexts[3], contexts[4], contexts[5], contexts[6]:
                result = app.add_not_interested(request_for(), BackgroundTasks(), self.article())

            stored = json.loads((root / "not_interested.json").read_text(encoding="utf-8"))
            remaining = json.loads(briefing.read_text(encoding="utf-8"))
            self.assertEqual(result["status"], "success")
            self.assertEqual([item["title"] for item in stored], ["A global signal"])
            self.assertEqual(remaining, [other])

    def test_reject_rolls_back_store_when_briefing_write_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            briefing = root / "briefing.json"
            original = [self.article()]
            briefing.write_text(json.dumps(original), encoding="utf-8")
            contexts = self.patches(root, briefing)
            with contexts[0], contexts[1], contexts[2], contexts[3], contexts[4], contexts[5], contexts[6], patch.object(
                app, "_save_briefing_items", side_effect=OSError("disk full")
            ):
                with self.assertRaises(HTTPException) as raised:
                    app.add_not_interested(request_for(), BackgroundTasks(), self.article())

            self.assertEqual(raised.exception.status_code, 503)
            self.assertEqual(raised.exception.detail["state"], "rolled_back")
            self.assertEqual(
                json.loads((root / "not_interested.json").read_text(encoding="utf-8")),
                [],
            )
            self.assertEqual(json.loads(briefing.read_text(encoding="utf-8")), original)

    def test_restore_commits_store_and_shared_briefing_together(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            briefing = root / "briefing.json"
            briefing.write_text("[]", encoding="utf-8")
            rejected = {
                **self.article(),
                "rejected_at": "2026-08-15 12:00:00",
                "rejected_by": "test",
            }
            (root / "not_interested.json").write_text(json.dumps([rejected]), encoding="utf-8")
            contexts = self.patches(root, briefing)
            with contexts[0], contexts[1], contexts[2], contexts[3], contexts[4], contexts[5], contexts[6]:
                result = app.restore_from_not_interested(
                    request_for(), BackgroundTasks(), {"title": rejected["title"]}
                )

            self.assertEqual(result["status"], "success")
            self.assertEqual(
                json.loads((root / "not_interested.json").read_text(encoding="utf-8")),
                [],
            )
            restored = json.loads(briefing.read_text(encoding="utf-8"))
            self.assertEqual(restored[0]["title"], rejected["title"])
            self.assertNotIn("rejected_at", restored[0])

    def test_legacy_briefing_errors_use_http_failure_status(self):
        with patch.object(app, "get_profile_for_request", return_value=app.DEFAULT_PROFILE):
            with self.assertRaises(HTTPException) as missing_title:
                app.remove_from_briefing(request_for(), {"title": ""})
            with patch.object(app, "get_latest_briefing_file_for_profile", return_value=None):
                with self.assertRaises(HTTPException) as missing_file:
                    app.remove_from_briefing(request_for(), {"title": "Signal"})
        self.assertEqual(missing_title.exception.status_code, 400)
        self.assertEqual(missing_file.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
