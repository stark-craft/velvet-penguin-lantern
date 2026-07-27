import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from news_scrapper import application


def request_from(ip="10.0.0.25", key=""):
    headers = []
    if key:
        headers.append((b"x-gatekeeper-key", key.encode("latin1")))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "http",
            "path": "/gatekeeper/dropped",
            "raw_path": b"/gatekeeper/dropped",
            "query_string": b"",
            "headers": headers,
            "client": (ip, 50000),
            "server": ("testserver", 80),
        }
    )


class GatekeeperTests(unittest.TestCase):
    def test_gatekeeper_requires_both_allowed_ip_and_key(self):
        with (
            patch.object(application, "GATEKEEPER_ALLOWED_IPS", {"10.0.0.25"}),
            patch.object(application, "GATEKEEPER_KEY", "secure-key"),
        ):
            self.assertEqual(
                application.require_gatekeeper_access(
                    request_from(key="secure-key")
                ),
                "10.0.0.25",
            )
            with self.assertRaises(HTTPException) as wrong_key:
                application.require_gatekeeper_access(
                    request_from(key="wrong-key")
                )
            with self.assertRaises(HTTPException) as wrong_ip:
                application.require_gatekeeper_access(
                    request_from("10.0.0.30", "secure-key")
                )

        self.assertEqual(wrong_key.exception.status_code, 403)
        self.assertEqual(wrong_ip.exception.status_code, 403)

    def test_gatekeeper_dropped_view_is_profile_scoped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dropped_file = root / "dropped_articles.json"
            dropped_file.write_text(
                json.dumps(
                    [
                        {
                            "id": "default-item",
                            "profile": "default",
                            "status": "dropped",
                            "title": "Default signal",
                        },
                        {
                            "id": "broadcast-item",
                            "profile": "broadcast",
                            "status": "failed",
                            "title": "Broadcast signal",
                        },
                    ]
                ),
                encoding="utf-8",
            )
            with (
                patch.object(application, "ROOT_DIR", str(root)),
                patch.object(
                    application,
                    "GATEKEEPER_ALLOWED_IPS",
                    {"10.0.0.25"},
                ),
                patch.object(application, "GATEKEEPER_KEY", "secure-key"),
            ):
                result = application.gatekeeper_dropped(
                    request_from(key="secure-key"),
                    profile="broadcast",
                    status="all",
                    search="",
                    offset=0,
                    limit=100,
                )

        self.assertEqual(
            [item["id"] for item in result["items"]],
            ["broadcast-item"],
        )
        self.assertEqual(result["counts"]["all"], 1)
        self.assertEqual(result["counts"]["failed"], 1)


if __name__ == "__main__":
    unittest.main()
