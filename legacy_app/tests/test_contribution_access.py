import os
import unittest
from unittest.mock import patch

import main as composition
from news_scrapper.internal_content import access
from tests.asgi_harness import request


class ContributionAccessTests(unittest.TestCase):
    def call(self, method, path, *, ip="10.0.0.25", headers=None, json_body=None):
        return request(
            composition.app,
            method,
            path,
            client_ip=ip,
            headers=headers,
            json_body=json_body,
        )

    def test_capability_reports_normalized_allowed_and_denied_ips(self):
        with patch.object(access, "CONTRIBUTIONS_ALLOWED_IPS", {"192.0.2.25"}):
            allowed = self.call("GET", "/internal-content/contribute-access", ip="::ffff:192.0.2.25")
            denied = self.call("GET", "/internal-content/contribute-access", ip="192.0.2.99")
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.json(), {"allowed": True, "ip": "192.0.2.25"})
        self.assertEqual(denied.json(), {"allowed": False, "ip": "192.0.2.99"})

    def test_forged_forwarded_ip_from_untrusted_peer_cannot_bypass(self):
        with patch.object(access, "CONTRIBUTIONS_ALLOWED_IPS", {"192.0.2.25"}), patch.object(
            access, "TRUSTED_PROXY_IPS", {"127.0.0.1"}
        ):
            result = self.call(
                "GET",
                "/internal-content/contribute-access",
                ip="10.0.0.99",
                headers={"X-Forwarded-For": "192.0.2.25"},
            )
        self.assertEqual(result.json(), {"allowed": False, "ip": "10.0.0.99"})

    def test_trusted_proxy_resolves_the_original_client(self):
        with patch.object(access, "CONTRIBUTIONS_ALLOWED_IPS", {"192.0.2.25"}), patch.object(
            access, "TRUSTED_PROXY_IPS", {"127.0.0.1"}
        ):
            result = self.call(
                "GET",
                "/internal-content/contribute-access",
                ip="127.0.0.1",
                headers={"X-Forwarded-For": "192.0.2.25, 127.0.0.1"},
            )
        self.assertEqual(result.json(), {"allowed": True, "ip": "192.0.2.25"})

    def test_contributor_owned_operations_fail_closed_but_public_and_editor_routes_remain(self):
        with patch.object(access, "CONTRIBUTIONS_ALLOWED_IPS", set()):
            mine = self.call("GET", "/internal-content/mine")
            create = self.call("POST", "/internal-content/drafts", json_body={"title": "Private"})
            notifications = self.call("GET", "/internal-content/notifications")
            public = self.call("GET", "/internal-content/published")
            with patch.dict(os.environ, {"INTERNAL_EDITOR_KEY": "editor-test-key-123"}):
                review = self.call(
                    "GET",
                    "/internal-content/review",
                    headers={"x-editor-key": "editor-test-key-123"},
                )
        self.assertEqual(mine.status_code, 403)
        self.assertEqual(create.status_code, 403)
        self.assertEqual(notifications.status_code, 403)
        self.assertEqual(public.status_code, 200)
        self.assertEqual(review.status_code, 200)


if __name__ == "__main__":
    unittest.main()
