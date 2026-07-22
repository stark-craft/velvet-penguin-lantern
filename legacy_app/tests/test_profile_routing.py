import unittest
from unittest.mock import patch

from starlette.requests import Request

import main


def request_from(ip, headers=None, query=b""):
    raw_headers = [
        (str(key).lower().encode("latin1"), str(value).encode("latin1"))
        for key, value in (headers or {}).items()
    ]
    return Request({"type": "http", "method": "GET", "scheme": "http", "path": "/profile", "raw_path": b"/profile", "query_string": query, "headers": raw_headers, "client": (ip, 50000), "server": ("testserver", 80)})


class ProfileRoutingTests(unittest.TestCase):
    def test_228_address_automatically_gets_broadcast_profile(self):
        with patch.object(main, "BROADCAST_SPECIAL_IPS", {"109.109.201.228"}), patch.object(main, "PROFILE_SETTINGS_ALLOWED_IPS", {"127.0.0.1"}):
            request = request_from("109.109.201.228", {"X-Sense-Profile": "default"})
            self.assertEqual(main.get_client_ip(request), "109.109.201.228")
            self.assertEqual(main.get_profile_for_request(request), "broadcast")

    def test_normal_user_cannot_force_profile_with_header(self):
        with patch.object(main, "BROADCAST_SPECIAL_IPS", set()), patch.object(main, "PROFILE_SETTINGS_ALLOWED_IPS", {"127.0.0.1"}):
            self.assertEqual(main.get_profile_for_request(request_from("10.20.30.40", {"X-Sense-Profile": "broadcast"})), "default")

    def test_authorized_developer_can_switch_profile(self):
        with patch.object(main, "PROFILE_SETTINGS_ALLOWED_IPS", {"127.0.0.1"}):
            self.assertEqual(main.get_profile_for_request(request_from("127.0.0.1", {"X-Sense-Profile": "broadcast"})), "broadcast")

    def test_forwarded_ip_is_ignored_from_untrusted_peer(self):
        with patch.object(main, "TRUSTED_PROXY_IPS", {"127.0.0.1"}):
            self.assertEqual(main.get_client_ip(request_from("10.0.0.99", {"X-Forwarded-For": "109.109.201.228"})), "10.0.0.99")

    def test_forwarded_ip_is_used_from_trusted_proxy(self):
        with patch.object(main, "TRUSTED_PROXY_IPS", {"127.0.0.1"}):
            self.assertEqual(main.get_client_ip(request_from("127.0.0.1", {"X-Forwarded-For": "109.109.201.228, 127.0.0.1"})), "109.109.201.228")

    def test_ipv4_mapped_ipv6_is_normalized(self):
        self.assertEqual(main.normalize_ip("::ffff:109.109.201.228"), "109.109.201.228")


if __name__ == "__main__":
    unittest.main()
