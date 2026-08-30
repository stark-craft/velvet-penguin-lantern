import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main
from core.storage import JsonStore
from news_scrapper.access_control import service
from tests.asgi_harness import request


class AccessControlTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.store_patch = patch.object(
            service, "ACCESS_STORE", JsonStore(root / "access.json", dict)
        )
        self.audit_patch = patch.object(
            service, "AUDIT_STORE", JsonStore(root / "audit.json", dict)
        )
        self.store_patch.start()
        self.audit_patch.start()
        self.addCleanup(self.store_patch.stop)
        self.addCleanup(self.audit_patch.stop)

    def call(self, method, path, *, ip="10.0.0.99", headers=None, body=None):
        return request(
            main.app,
            method,
            path,
            client_ip=ip,
            headers=headers,
            json_body=body,
        )

    def test_untrusted_forwarded_address_cannot_gain_loopback_privileges(self):
        response = self.call(
            "GET",
            "/access-control/capabilities",
            headers={"X-Forwarded-For": "127.0.0.1"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("access.manage", response.json()["capabilities"])
        self.assertEqual(response.json()["ip"], "10.0.0.99")

    def test_trusted_proxy_resolves_configured_client(self):
        with patch.dict(
            os.environ,
            {
                "TRUSTED_PROXY_IPS": "127.0.0.1",
                "ACCESS_MANAGEMENT_ALLOWED_IPS": "192.0.2.25",
            },
            clear=False,
        ):
            response = self.call(
                "GET",
                "/access-control/capabilities",
                ip="127.0.0.1",
                headers={"X-Forwarded-For": "192.0.2.25"},
            )
        self.assertEqual(response.json()["ip"], "192.0.2.25")
        self.assertIn("access.manage", response.json()["capabilities"])

    def test_dynamic_capability_change_is_immediate_and_audited(self):
        with patch.dict(
            os.environ,
            {"ACCESS_MANAGEMENT_ALLOWED_IPS": "10.0.0.25"},
            clear=False,
        ):
            saved = self.call(
                "PUT",
                "/access-control/principals/viewer-abc",
                ip="10.0.0.25",
                body={
                    "display_name": "Reviewer",
                    "known_ips": ["192.0.2.44"],
                    "capabilities": ["review.news.view", "approved.view"],
                },
            )
            audit = self.call(
                "GET", "/access-control/audit", ip="10.0.0.25"
            )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(
            set(service.dynamic_capabilities("viewer-abc")),
            {"review.news.view", "approved.view"},
        )
        self.assertEqual(audit.status_code, 200)
        self.assertEqual(len(audit.json()["items"]), 2)
        self.assertTrue(all(item["actor"] for item in audit.json()["items"]))

    def test_privileged_mutations_fail_closed_for_ordinary_viewer(self):
        cases = (
            ("POST", "/sites", {"name": "Blocked", "url": "https://example.com"}),
            ("PUT", "/sites/example", {"enabled": False}),
            ("DELETE", "/sites/example", None),
            ("POST", "/workflow/select", {"title": "Blocked"}),
            ("POST", "/workflow/import", {"items": [{"title": "Blocked"}]}),
            ("POST", "/workflow/approve", {"title": "Blocked"}),
            ("POST", "/workflow/remove", {"title": "Blocked", "list_type": "selected"}),
            ("POST", "/region/correct", {"title": "Blocked", "region": "Global", "keywords": ["x"]}),
            ("POST", "/train", {"keywords": [], "summary": "Blocked", "vote": "interested"}),
            ("GET", "/crawl", None),
            ("POST", "/scheduler/run", None),
            ("POST", "/gatekeeper/restore", {"id": "blocked"}),
            ("POST", "/briefing/remove", {"title": "Blocked"}),
            ("POST", "/internal-content/blocked/publish", None),
            ("PUT", "/access-control/principals/blocked", {"capabilities": []}),
        )
        for method, path, body in cases:
            with self.subTest(method=method, path=path):
                response = self.call(method, path, body=body)
                self.assertEqual(response.status_code, 403, response.text)


if __name__ == "__main__":
    unittest.main()
