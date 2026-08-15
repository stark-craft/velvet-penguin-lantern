import unittest
from unittest.mock import patch

from starlette.requests import Request

from news_scrapper import application as main


def request_from(ip, headers=None, query=b""):
    raw_headers = [
        (str(key).lower().encode("latin1"), str(value).encode("latin1"))
        for key, value in (headers or {}).items()
    ]
    return Request({"type": "http", "method": "GET", "scheme": "http", "path": "/profile", "raw_path": b"/profile", "query_string": query, "headers": raw_headers, "client": (ip, 50000), "server": ("testserver", 80)})


class ProfileRoutingTests(unittest.TestCase):
    def test_unified_mode_ignores_the_retired_broadcast_ip_split(self):
        with patch.object(main, "BROADCAST_SPECIAL_IPS", {"192.0.2.10"}), patch.object(main, "PROFILE_SETTINGS_ALLOWED_IPS", {"127.0.0.1"}):
            request = request_from("192.0.2.10", {"X-Sense-Profile": "default"})
            self.assertEqual(main.get_client_ip(request), "192.0.2.10")
            self.assertEqual(main.get_profile_for_request(request), "default")

    def test_normal_user_cannot_force_profile_with_header(self):
        with patch.object(main, "BROADCAST_SPECIAL_IPS", set()), patch.object(main, "PROFILE_SETTINGS_ALLOWED_IPS", {"127.0.0.1"}):
            self.assertEqual(main.get_profile_for_request(request_from("10.20.30.40", {"X-Sense-Profile": "broadcast"})), "default")

    def test_legacy_rollback_can_still_switch_profile_explicitly(self):
        with patch.object(main, "UNIFIED_CORPUS_ENABLED", False), patch.object(
            main, "LEGACY_PROFILE_ROUTING_ENABLED", True
        ), patch.object(main, "PROFILE_SETTINGS_ALLOWED_IPS", {"127.0.0.1"}):
            self.assertEqual(main.get_profile_for_request(request_from("127.0.0.1", {"X-Sense-Profile": "broadcast"})), "broadcast")

    def test_forwarded_ip_is_ignored_from_untrusted_peer(self):
        with patch.object(main, "TRUSTED_PROXY_IPS", {"127.0.0.1"}):
            self.assertEqual(main.get_client_ip(request_from("10.0.0.99", {"X-Forwarded-For": "192.0.2.10"})), "10.0.0.99")

    def test_forwarded_ip_is_used_from_trusted_proxy(self):
        with patch.object(main, "TRUSTED_PROXY_IPS", {"127.0.0.1"}):
            self.assertEqual(main.get_client_ip(request_from("127.0.0.1", {"X-Forwarded-For": "192.0.2.10, 127.0.0.1"})), "192.0.2.10")

    def test_ipv4_mapped_ipv6_is_normalized(self):
        self.assertEqual(main.normalize_ip("::ffff:192.0.2.10"), "192.0.2.10")


if __name__ == "__main__":
    unittest.main()
