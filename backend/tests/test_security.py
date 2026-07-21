from __future__ import annotations

import json
import unittest
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Dict, Optional

from pydantic import SecretStr, ValidationError

from signalroom.config import DEVELOPMENT_IP_HASH_SECRET, Settings
from signalroom.models import Capability, ProfileId
from signalroom.profiles import ProfileConfigurationError, load_profile
from signalroom.security import (
    hash_client_ip,
    resolve_capabilities,
    resolve_client_ip,
    resolve_principal,
)


@dataclass
class FakeClient:
    host: Optional[str]


@dataclass
class FakeRequest:
    headers: Dict[str, str]
    client: Optional[FakeClient]


class SecurityTests(unittest.TestCase):
    def settings(self, root: Path, **overrides: object) -> Settings:
        values = {
            "root_dir": root,
            "database_path": Path("runtime/test.db"),
            "developer_ips": (),
            "trusted_proxy_ips": ("10.0.0.0/8",),
            "ip_hash_secret": SecretStr("x" * 40),
        }
        values.update(overrides)
        return Settings(**values)

    def test_forwarded_header_is_ignored_by_default(self) -> None:
        with TemporaryDirectory() as directory:
            settings = self.settings(Path(directory), trust_proxy_headers=False)
            actual = resolve_client_ip(
                "10.1.2.3", {"x-forwarded-for": "203.0.113.7"}, settings
            )
            self.assertEqual(actual, "10.1.2.3")

    def test_forwarded_header_requires_a_trusted_peer(self) -> None:
        with TemporaryDirectory() as directory:
            settings = self.settings(Path(directory), trust_proxy_headers=True)
            trusted = resolve_client_ip(
                "10.1.2.3", {"x-forwarded-for": "203.0.113.7"}, settings
            )
            spoofed = resolve_client_ip(
                "192.0.2.9", {"x-forwarded-for": "203.0.113.7"}, settings
            )
            self.assertEqual(trusted, "203.0.113.7")
            self.assertEqual(spoofed, "192.0.2.9")

    def test_forwarded_chain_walks_back_through_trusted_proxies(self) -> None:
        with TemporaryDirectory() as directory:
            settings = self.settings(Path(directory), trust_proxy_headers=True)
            actual = resolve_client_ip(
                "10.0.0.9",
                {"forwarded": "for=198.51.100.4;proto=https, for=10.0.0.8"},
                settings,
            )
            self.assertEqual(actual, "198.51.100.4")

    def test_peerless_local_bridge_is_development_only(self) -> None:
        headers = {
            "x-signalroom-proxy": "frontend-bff-v1",
            "x-forwarded-for": "127.0.0.1",
        }
        with TemporaryDirectory() as directory:
            development = self.settings(
                Path(directory), environment="development", trust_proxy_headers=True
            )
            production = self.settings(
                Path(directory),
                environment="production",
                trust_proxy_headers=True,
                cors_origins=("https://news.internal",),
                ip_hash_secret=SecretStr("production-unique-secret-value-123456789"),
            )
            self.assertEqual(resolve_client_ip(None, headers, development), "127.0.0.1")
            self.assertEqual(resolve_client_ip(None, headers, production), "0.0.0.0")

    def test_ip_hash_is_deterministic_and_does_not_embed_raw_ip(self) -> None:
        with TemporaryDirectory() as directory:
            settings = self.settings(Path(directory))
            first = hash_client_ip("203.0.113.7", settings)
            second = hash_client_ip("203.0.113.7", settings)
            other = hash_client_ip("203.0.113.8", settings)
            self.assertEqual(first, second)
            self.assertNotEqual(first, other)
            self.assertTrue(first.startswith("ip:v1:"))
            self.assertNotIn("203.0.113.7", first)

    def test_admin_bearer_key_uses_constant_time_capability_path(self) -> None:
        with TemporaryDirectory() as directory:
            settings = self.settings(
                Path(directory), admin_key=SecretStr("correct-horse-battery-staple")
            )
            capabilities, method = resolve_capabilities(
                settings,
                identity=None,
                client_ip="203.0.113.2",
                bearer_token="correct-horse-battery-staple",
            )
            self.assertEqual(method, "admin_key")
            self.assertIn(Capability.ADMIN, capabilities)
            self.assertIn(Capability.MANAGE_SOURCES, capabilities)

    def test_developer_and_identity_allowlists_resolve_independently(self) -> None:
        with TemporaryDirectory() as directory:
            settings = self.settings(
                Path(directory),
                developer_ips=("192.0.2.0/24",),
                analytics_emails=("analyst@example.com",),
            )
            developer, _ = resolve_capabilities(
                settings, identity=None, client_ip="192.0.2.5"
            )
            analyst, _ = resolve_capabilities(
                settings, identity="Analyst@Example.com", client_ip="203.0.113.2"
            )
            self.assertIn(Capability.PROFILE_SWITCH, developer)
            self.assertIn(Capability.ANALYTICS, analyst)
            self.assertNotIn(Capability.ADMIN, analyst)

    def test_untrusted_identity_header_is_ignored(self) -> None:
        with TemporaryDirectory() as directory:
            settings = self.settings(
                Path(directory),
                admin_emails=("admin@example.com",),
                trust_identity_headers=False,
            )
            request = FakeRequest(
                headers={"x-signalroom-user-email": "admin@example.com"},
                client=FakeClient("203.0.113.2"),
            )
            principal = resolve_principal(request, settings)
            self.assertIsNone(principal.identity)
            self.assertNotIn(Capability.ADMIN, principal.capabilities)

    def test_verified_identity_is_allowed_without_trusting_headers(self) -> None:
        with TemporaryDirectory() as directory:
            settings = self.settings(Path(directory), admin_emails=("admin@example.com",))
            request = FakeRequest(headers={}, client=FakeClient("203.0.113.2"))
            principal = resolve_principal(
                request, settings, verified_identity="ADMIN@example.com"
            )
            self.assertEqual(principal.identity, "admin@example.com")
            self.assertIn(Capability.ADMIN, principal.capabilities)

    def test_missing_peer_host_is_anonymous_and_never_developer(self) -> None:
        with TemporaryDirectory() as directory:
            settings = self.settings(
                Path(directory),
                developer_ips=("127.0.0.1", "::1"),
                admin_ips=("127.0.0.1",),
            )
            request = FakeRequest(headers={}, client=FakeClient(None))
            principal = resolve_principal(request, settings)
            self.assertEqual(principal.authentication_method, "internal_viewer")
            self.assertNotIn(Capability.ADMIN, principal.capabilities)
            self.assertNotIn(Capability.PROFILE_SWITCH, principal.capabilities)
            self.assertTrue(principal.ip_hash.startswith("ip:v1:"))

    def test_production_rejects_development_hash_secret(self) -> None:
        with TemporaryDirectory() as directory:
            with self.assertRaises(ValidationError):
                Settings(
                    root_dir=Path(directory),
                    environment="production",
                    ip_hash_secret=SecretStr(DEVELOPMENT_IP_HASH_SECRET),
                )

    def test_request_protection_limits_load_from_environment(self) -> None:
        with TemporaryDirectory() as directory:
            settings = Settings.from_env(
                {
                    "SIGNALROOM_IP_HASH_SECRET": "x" * 40,
                    "SIGNALROOM_MAX_REQUEST_BYTES": "2048",
                    "SIGNALROOM_MUTATION_RATE_LIMIT_PER_MINUTE": "17",
                },
                root_dir=Path(directory),
            )
            self.assertEqual(settings.max_request_bytes, 2048)
            self.assertEqual(settings.mutation_rate_limit_per_minute, 17)

    def test_local_model_paths_resolve_against_backend_root(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            settings = Settings.from_env(
                {
                    "SIGNALROOM_IP_HASH_SECRET": "x" * 40,
                    "SIGNALROOM_EMBEDDING_MODEL_PATH": "model_weights/minilm",
                    "SIGNALROOM_SUMMARIZATION_MODEL_PATH": "model_weights/distilbart",
                },
                root_dir=root,
            )
            self.assertEqual(
                settings.embedding_model,
                str((root / "model_weights/minilm").resolve()),
            )
            self.assertEqual(
                settings.embedding_model_id,
                "sentence-transformers/all-MiniLM-L6-v2",
            )
            self.assertEqual(
                settings.summarization_model,
                str((root / "model_weights/distilbart").resolve()),
            )
            self.assertEqual(
                settings.summarization_model_id,
                "sshleifer/distilbart-cnn-12-6",
            )


class ProfileLoaderTests(unittest.TestCase):
    def test_repository_profiles_match_the_strict_contract(self) -> None:
        backend_root = Path(__file__).resolve().parents[1]
        settings = Settings(root_dir=backend_root)
        profile = load_profile(ProfileId.DEFAULT, settings)
        self.assertEqual(str(profile.id), "default")
        self.assertEqual(profile.sources_file, "sites.json")
        self.assertEqual(profile.gatekeeper_drop_threshold, 0.60)
        self.assertEqual(len(profile.sites), 107)
        self.assertEqual(len(profile.enabled_sites), 79)

    def test_source_contract_supports_publisher_boundaries_and_crawl_limits(self) -> None:
        backend_root = Path(__file__).resolve().parents[1]
        settings = Settings(root_dir=backend_root)
        profile = load_profile(ProfileId.DEFAULT, settings)
        site = profile.sites[0]
        self.assertEqual(site.id, "huawei-central")
        self.assertEqual(site.category, "Mobile & OS Competitors")
        self.assertFalse(site.allow_deep_scan)
        self.assertEqual(site.region, "Global")
        self.assertEqual(site.max_links, 100)
        self.assertIn("huaweicentral.com", site.allowed_hosts)

    def test_broadcast_profile_uses_its_deep_scan_source_file(self) -> None:
        backend_root = Path(__file__).resolve().parents[1]
        profile = load_profile(
            ProfileId.BROADCAST,
            Settings(root_dir=backend_root),
        )
        self.assertEqual(profile.sources_file, "broadcast_sites.json")
        self.assertEqual(len(profile.sites), 59)
        self.assertEqual(len(profile.enabled_sites), 59)
        self.assertTrue(all(site.allow_deep_scan for site in profile.sites))
        self.assertTrue(all(site.rss_url is None for site in profile.sites))

    def test_unknown_profile_fields_are_rejected(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "profiles").mkdir()
            (root / "sites").mkdir()
            (root / "profiles" / "default.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "id": "default",
                        "label": "Default",
                        "enabled": True,
                        "sources_file": "default.json",
                        "cluster_similarity_threshold": 0.78,
                        "gatekeeper_review_threshold": 0.45,
                        "gatekeeper_drop_threshold": 0.60,
                        "prefetch_drop_threshold": 0.90,
                        "schedule_order": 1,
                        "keywords": ["OpenAI"],
                        "unexpected": "rejected",
                    }
                ),
                encoding="utf-8",
            )
            (root / "sites" / "default.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "sites": [
                            {
                                "id": "example",
                                "name": "Example",
                                "enabled": False,
                                "rss_url": "https://example.com/rss.xml",
                                "timezone": "UTC",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaises(ProfileConfigurationError):
                load_profile(ProfileId.DEFAULT, Settings(root_dir=root))


if __name__ == "__main__":
    unittest.main()
