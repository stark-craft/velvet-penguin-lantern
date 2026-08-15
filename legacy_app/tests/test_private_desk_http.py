import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import main as composition
from core.storage import JsonStore
from news_scrapper import application
from news_scrapper.recommendation.identity import COOKIE_NAME
from tests.asgi_harness import request as asgi_request


class PrivateDeskHttpTests(unittest.TestCase):
    def test_same_ip_browsers_do_not_share_saved_or_imported_urls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            saved_file = root / "saved.json"
            briefings = JsonStore(root / "briefings.json", dict)
            claims = JsonStore(root / "claims.json", dict)
            executor = Mock()
            with (
                patch.object(application, "VIEWER_SAVED_FILE", str(saved_file)),
                patch.object(application, "PERSONAL_BRIEFING_STORE", briefings),
                patch.object(application, "PRIVATE_VIEWER_CLAIMS", claims),
                patch.object(application, "personal_briefing_executor", executor),
                patch.object(application, "assert_public_article_url", side_effect=lambda value: value),
                patch.object(application, "record_usage_activity", return_value=True),
            ):
                saved = asgi_request(
                    composition.app,
                    "POST",
                    "/viewer/saved",
                    json_body={
                        "title": "Private signal",
                        "link": "https://example.test/private",
                    },
                )
                first_cookie = saved.headers["set-cookie"].split(";", 1)[0]
                imported = asgi_request(
                    composition.app,
                    "POST",
                    "/viewer/briefings",
                    headers={"cookie": first_cookie},
                    json_body={"urls": ["https://example.test/private"]},
                )
                first_saved = asgi_request(
                    composition.app, "GET", "/viewer/saved", headers={"cookie": first_cookie}
                ).json()
                second_response = asgi_request(composition.app, "GET", "/viewer/saved")
                second_cookie = second_response.headers["set-cookie"].split(";", 1)[0]
                second_saved = second_response.json()
                first_jobs = asgi_request(
                    composition.app, "GET", "/viewer/briefings", headers={"cookie": first_cookie}
                ).json()
                second_jobs = asgi_request(
                    composition.app, "GET", "/viewer/briefings", headers={"cookie": second_cookie}
                ).json()

            self.assertEqual(saved.status_code, 200)
            self.assertEqual(imported.status_code, 200)
            self.assertTrue(first_cookie.startswith(f"{COOKIE_NAME}="))
            self.assertIn("HttpOnly", saved.headers.get("set-cookie", ""))
            self.assertEqual(first_saved["count"], 1)
            self.assertEqual(second_saved["count"], 0)
            self.assertEqual(first_jobs["count"], 1)
            self.assertEqual(second_jobs["count"], 0)
            executor.submit.assert_called_once()
            persisted = json.loads(saved_file.read_text(encoding="utf-8"))
            self.assertNotIn("testclient", json.dumps(persisted))

    def test_signed_browser_identity_survives_ip_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            saved_file = root / "saved.json"
            claims = JsonStore(root / "claims.json", dict)
            with (
                patch.object(application, "VIEWER_SAVED_FILE", str(saved_file)),
                patch.object(application, "PRIVATE_VIEWER_CLAIMS", claims),
                patch.object(application, "record_usage_activity", return_value=True),
            ):
                saved = asgi_request(
                    composition.app,
                    "POST",
                    "/viewer/saved",
                    client_ip="10.0.0.25",
                    json_body={
                        "title": "Roaming signal",
                        "link": "https://example.test/roaming",
                    },
                )
                cookie = saved.headers["set-cookie"].split(";", 1)[0]
                after_ip_change = asgi_request(
                    composition.app,
                    "GET",
                    "/viewer/saved",
                    client_ip="10.0.0.99",
                    headers={"cookie": cookie},
                )

        self.assertEqual(after_ip_change.status_code, 200)
        self.assertEqual(after_ip_change.json()["count"], 1)
        self.assertEqual(
            after_ip_change.json()["items"][0]["title"],
            "Roaming signal",
        )

    def test_roaming_identity_cannot_claim_another_ips_legacy_bucket(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            saved_file = root / "saved.json"
            claims = JsonStore(root / "claims.json", dict)
            other_ip_legacy_key = application.get_viewer_key("10.0.0.99")
            JsonStore(saved_file, dict).write(
                {
                    other_ip_legacy_key: {
                        "default": [
                            {
                                "title": "Someone else's legacy signal",
                                "link": "https://example.test/not-mine",
                            }
                        ]
                    }
                }
            )
            with (
                patch.object(application, "VIEWER_SAVED_FILE", str(saved_file)),
                patch.object(application, "PRIVATE_VIEWER_CLAIMS", claims),
            ):
                initial = asgi_request(
                    composition.app,
                    "GET",
                    "/viewer/saved",
                    client_ip="10.0.0.25",
                )
                cookie = initial.headers["set-cookie"].split(";", 1)[0]
                roamed = asgi_request(
                    composition.app,
                    "GET",
                    "/viewer/saved",
                    client_ip="10.0.0.99",
                    headers={"cookie": cookie},
                )
                persisted = JsonStore(saved_file, dict).read()

        self.assertEqual(roamed.json()["count"], 0)
        self.assertIn(other_ip_legacy_key, persisted)

    def test_legacy_ip_bucket_is_claimed_once_without_cross_browser_leak(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            saved_file = root / "saved.json"
            claims = JsonStore(root / "claims.json", dict)
            legacy_key = application.get_viewer_key("10.0.0.25")
            JsonStore(saved_file, dict).write(
                {
                    legacy_key: {
                        "default": [
                            {
                                "title": "Legacy saved signal",
                                "link": "https://example.test/legacy",
                            }
                        ]
                    }
                }
            )
            with (
                patch.object(application, "VIEWER_SAVED_FILE", str(saved_file)),
                patch.object(application, "PRIVATE_VIEWER_CLAIMS", claims),
            ):
                first = asgi_request(composition.app, "GET", "/viewer/saved")
                second = asgi_request(composition.app, "GET", "/viewer/saved")
                persisted = JsonStore(saved_file, dict).read()
                claim_values = claims.read()

        self.assertEqual(first.json()["count"], 1)
        self.assertEqual(second.json()["count"], 0)
        self.assertNotIn(legacy_key, persisted)
        self.assertEqual(list(claim_values), [legacy_key])
        self.assertRegex(next(iter(claim_values.values())), r"^[0-9a-f]{64}$")

    def test_saved_commit_survives_usage_tracker_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            saved_file = root / "saved.json"
            claims = JsonStore(root / "claims.json", dict)
            with (
                patch.object(application, "VIEWER_SAVED_FILE", str(saved_file)),
                patch.object(application, "PRIVATE_VIEWER_CLAIMS", claims),
                patch.object(
                    application,
                    "record_usage_activity",
                    side_effect=OSError("tracker unavailable"),
                ),
            ):
                saved = asgi_request(
                    composition.app,
                    "POST",
                    "/viewer/saved",
                    json_body={
                        "title": "Durable signal",
                        "link": "https://example.test/durable",
                    },
                )
                cookie = saved.headers["set-cookie"].split(";", 1)[0]
                loaded = asgi_request(
                    composition.app,
                    "GET",
                    "/viewer/saved",
                    headers={"cookie": cookie},
                )

        self.assertEqual(saved.status_code, 200)
        self.assertFalse(saved.json()["activity_tracked"])
        self.assertEqual(loaded.json()["count"], 1)

    def test_untrusted_cross_origin_browser_request_is_not_authorized_by_cors(self):
        response = asgi_request(
            composition.app,
            "OPTIONS",
            "/viewer/saved",
            headers={
                "Origin": "https://hostile.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        self.assertNotEqual(
            response.headers.get("access-control-allow-origin"),
            "https://hostile.example",
        )
        self.assertNotEqual(response.headers.get("access-control-allow-origin"), "*")


if __name__ == "__main__":
    unittest.main()
