import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

import main


def request_from(ip="10.0.0.25"):
    return Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "path": "/viewer/profile",
            "raw_path": b"/viewer/profile",
            "query_string": b"",
            "headers": [],
            "client": (ip, 50000),
            "server": ("testserver", 80),
        }
    )


class ViewerIdentityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.profiles = root / "viewer_profiles.json"
        self.tracker = root / "usage_tracker.json"
        self.hidden = root / "viewer_hidden_store.json"
        self.default_workflow = root / "workflow_default.json"
        self.broadcast_workflow = root / "workflow_broadcast.json"
        self.profiles.write_text("{}", encoding="utf-8")
        self.tracker.write_text("{}", encoding="utf-8")
        self.hidden.write_text("{}", encoding="utf-8")
        self.default_workflow.write_text('{"selected": [], "approved": []}', encoding="utf-8")
        self.broadcast_workflow.write_text('{"selected": [], "approved": []}', encoding="utf-8")
        self.patches = [
            patch.object(main, "VIEWER_PROFILES_FILE", str(self.profiles)),
            patch.object(main, "USAGE_TRACKER_FILE", str(self.tracker)),
            patch.object(main, "VIEWER_HIDDEN_FILE", str(self.hidden)),
            patch.object(
                main,
                "WORKFLOW_FILES",
                {
                    "default": str(self.default_workflow),
                    "broadcast": str(self.broadcast_workflow),
                },
            ),
            patch.object(main, "BROADCAST_SPECIAL_IPS", set()),
            patch.object(main, "PROFILE_SETTINGS_ALLOWED_IPS", set()),
        ]
        for active_patch in self.patches:
            active_patch.start()

    def tearDown(self):
        for active_patch in reversed(self.patches):
            active_patch.stop()
        self.directory.cleanup()

    def test_selection_uses_stable_viewer_id_and_authoritative_name(self):
        request = request_from()
        viewer_key = main.get_viewer_key("10.0.0.25")
        self.profiles.write_text(
            json.dumps({viewer_key: {"display_name": "Explorer", "email": ""}}),
            encoding="utf-8",
        )

        result = main.select_news(
            request,
            {"title": "Test signal", "selected_by": "Spoofed name"},
        )
        stored = json.loads(self.default_workflow.read_text(encoding="utf-8"))

        self.assertEqual(result["status"], "success")
        self.assertEqual(stored["selected"][0]["selected_by_id"], viewer_key)
        self.assertEqual(stored["selected"][0]["selected_by"], "Explorer")

    def test_rename_updates_legacy_workflow_and_future_rendering(self):
        request = request_from()
        viewer_key = main.get_viewer_key("10.0.0.25")
        self.profiles.write_text(
            json.dumps({viewer_key: {"display_name": "Explorer", "email": ""}}),
            encoding="utf-8",
        )
        self.default_workflow.write_text(
            json.dumps(
                {
                    "selected": [
                        {
                            "title": "Selected signal",
                            "selected_by_id": viewer_key,
                            "selected_by": "Explorer",
                        }
                    ],
                    "approved": [
                        {
                            "title": "Approved signal",
                            "approved_by_id": viewer_key,
                            "approved_by": "Explorer",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        response = main.update_viewer_profile(
            request,
            {"display_name": "Navigator", "email": "nav@example.test"},
        )
        workflow = main.get_workflow(request)

        self.assertEqual(response["display_name"], "Navigator")
        self.assertEqual(response["ip"], "10.0.0.25")
        self.assertEqual(workflow["selected"][0]["selected_by"], "Navigator")
        self.assertEqual(workflow["approved"][0]["approved_by"], "Navigator")

    def test_display_names_are_unique_case_insensitively(self):
        request = request_from()
        other_key = main.get_viewer_key("10.0.0.30")
        self.profiles.write_text(
            json.dumps({other_key: {"display_name": "Analyst", "email": ""}}),
            encoding="utf-8",
        )

        with self.assertRaises(HTTPException) as raised:
            main.update_viewer_profile(
                request,
                {"display_name": " analyst ", "email": ""},
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("already in use", raised.exception.detail)

    def test_hidden_signals_are_private_and_do_not_train_the_bouncer(self):
        owner_request = request_from("10.0.0.25")
        other_request = request_from("10.0.0.30")
        article = {
            "title": "A private hidden signal",
            "link": "https://example.test/private-signal",
            "keywords_found": ["private"],
        }

        with patch.object(main, "save_training_vote") as save_training_vote:
            result = main.hide_for_current_viewer(owner_request, article)

        self.assertEqual(result["scope"], "current_viewer_only")
        self.assertFalse(result["trains_bouncer"])
        save_training_vote.assert_not_called()
        self.assertEqual(main.get_personal_hidden(owner_request)["count"], 1)
        self.assertEqual(main.get_personal_hidden(other_request)["count"], 0)
        self.assertEqual(main.filter_viewer_hidden([article], owner_request), [])
        self.assertEqual(main.filter_viewer_hidden([article], other_request), [article])

        restored = main.restore_for_current_viewer(owner_request, article)
        self.assertEqual(restored["count"], 0)


if __name__ == "__main__":
    unittest.main()
