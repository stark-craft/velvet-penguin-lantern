from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import SecretStr

from signalroom.app import create_app
from signalroom.config import Settings
from signalroom.json_storage import JSONRepository
from signalroom.models import (
    ArticleCreate,
    BriefingSnapshotCreate,
    ClusterCreate,
    ClusterMemberCreate,
    PageParams,
    ProfileId,
    make_stable_id,
)
from signalroom.profiles import ProfileRegistry


def _profile(profile: str) -> dict:
    return {
        "schema_version": 1,
        "id": profile,
        "label": f"{profile.title()} Intelligence",
        "enabled": True,
        "sources_file": f"{profile}.json",
        "cluster_similarity_threshold": 0.78,
        "gatekeeper_review_threshold": 0.45,
        "gatekeeper_drop_threshold": 0.60,
        "prefetch_drop_threshold": 0.90,
        "schedule_order": 1 if profile == "default" else 2,
        "keywords": ["AI", "display"] if profile == "default" else ["broadcast"],
    }


def _sites(profile: str) -> dict:
    return {
        "schema_version": 1,
        "sites": [
            {
                "id": f"{profile}-source",
                "name": f"{profile.title()} Source",
                "enabled": False,
                "rss_url": f"https://example.com/{profile}.xml",
                "homepage": "https://example.com/",
                "timezone": "UTC",
            }
        ],
    }


class FakePipeline:
    pass


class RecordingJobManager:
    def __init__(self) -> None:
        self.submissions = []

    def submit(self, job, payload):
        self.submissions.append((job, payload))
        return None


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for directory in ("profiles", "sites", "models", "runtime/crawls"):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        for profile in ("default", "broadcast"):
            (self.root / "profiles" / f"{profile}.json").write_text(
                json.dumps(_profile(profile)), encoding="utf-8"
            )
            (self.root / "sites" / f"{profile}.json").write_text(
                json.dumps(_sites(profile)), encoding="utf-8"
            )
        self.settings = Settings(
            environment="test",
            root_dir=self.root,
            developer_ips=(),
            trusted_proxy_ips=(),
            admin_key=SecretStr("test-admin-key"),
            ip_hash_secret=SecretStr("x" * 40),
        )
        self.profiles = ProfileRegistry.from_settings(self.settings)
        self.repository = JSONRepository(self.settings.storage_path)
        self.manager = RecordingJobManager()
        app = create_app(
            settings=self.settings,
            profiles=self.profiles,
            repository=self.repository,
            pipeline=FakePipeline(),
            job_manager=self.manager,
        )

        @app.middleware("http")
        async def fixed_test_peer(request, call_next):
            request.scope["client"] = ("203.0.113.8", 41234)
            return await call_next(request)

        self.client_context = TestClient(app)
        self.client = self.client_context.__enter__()
        self.admin_headers = {"Authorization": "Bearer test-admin-key"}

        self.article = self.repository.upsert_article(
            ArticleCreate(
                stable_id=make_stable_id("article", "https://example.com/news/ai"),
                title="A new AI display platform launches",
                canonical_url="https://example.com/news/ai",
                summary="A concise summary.",
                intent="product launch",
                region="Global",
                category="Technology",
                importance_score=0.8,
                keywords=("AI", "display"),
                profiles=(ProfileId.DEFAULT,),
            )
        )
        self.supporting_article = self.repository.upsert_article(
            ArticleCreate(
                stable_id=make_stable_id("article", "https://example.com/news/ai-followup"),
                title="Analysts assess the new AI display platform",
                canonical_url="https://example.com/news/ai-followup",
                summary="A supporting report.",
                intent="market movement",
                region="Global",
                category="Technology",
                importance_score=0.7,
                keywords=("AI", "display"),
                profiles=(ProfileId.DEFAULT,),
            )
        )
        self.singleton_article = self.repository.upsert_article(
            ArticleCreate(
                stable_id=make_stable_id("article", "https://example.com/news/robotics"),
                title="A robotics edge model reaches production",
                canonical_url="https://example.com/news/robotics",
                summary="A separate robotics signal.",
                intent="opportunity",
                region="Global",
                category="Robotics",
                importance_score=0.76,
                keywords=("robotics", "edge AI"),
                profiles=(ProfileId.DEFAULT,),
            )
        )
        self.cluster = self.repository.upsert_cluster(
            ClusterCreate(
                stable_id=make_stable_id("cluster", self.article.id),
                profile=ProfileId.DEFAULT,
                title=self.article.title,
                summary=self.article.summary,
                intent=self.article.intent,
                model_name="test-embedder",
                similarity_threshold=0.78,
                members=(
                    ClusterMemberCreate(
                        article_id=self.article.id,
                        similarity=1.0,
                        is_primary=True,
                    ),
                    ClusterMemberCreate(
                        article_id=self.supporting_article.id,
                        rank=1,
                        similarity=0.84,
                    ),
                ),
            )
        )
        self.singleton_cluster = self.repository.upsert_cluster(
            ClusterCreate(
                stable_id=make_stable_id("cluster", self.singleton_article.id),
                profile=ProfileId.DEFAULT,
                title=self.singleton_article.title,
                summary=self.singleton_article.summary,
                intent=self.singleton_article.intent,
                model_name="test-embedder",
                similarity_threshold=0.78,
                members=(
                    ClusterMemberCreate(
                        article_id=self.singleton_article.id,
                        similarity=1.0,
                        is_primary=True,
                    ),
                ),
            )
        )
        self.briefing = self.repository.create_briefing_snapshot(
            BriefingSnapshotCreate(
                stable_id=make_stable_id("briefing", self.article.id),
                profile=ProfileId.DEFAULT,
                article_ids=(self.article.id, self.singleton_article.id),
                metadata={
                    "cluster_ids": [str(self.cluster.id), str(self.singleton_cluster.id)],
                    "counters": {"discovered": 3, "retained": 2, "clusters": 2},
                },
            )
        )

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary.cleanup()

    def test_health_identity_and_profile_access(self) -> None:
        health = self.client.get("/api/v1/health")
        self.assertEqual(health.status_code, 200)
        self.assertGreaterEqual(health.json()["database_schema"], 1)

        me = self.client.get("/api/v1/me")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["active_profile"], "default")
        self.assertTrue(me.json()["actor_id"].startswith("anonymous:"))
        self.assertEqual(me.json()["current_ip"], "203.0.113.8")

        profiles = self.client.get("/api/v1/profiles")
        self.assertEqual([item["id"] for item in profiles.json()], ["default"])
        sources = self.client.get("/api/v1/sources")
        self.assertEqual(sources.status_code, 200)
        self.assertEqual(sources.json()[0]["id"], "default-source")
        denied = self.client.get("/api/v1/articles?profile=broadcast")
        self.assertEqual(denied.status_code, 403)

        admin_profiles = self.client.get(
            "/api/v1/profiles?profile=broadcast", headers=self.admin_headers
        )
        self.assertEqual(admin_profiles.status_code, 200)
        self.assertEqual(
            {item["id"] for item in admin_profiles.json()}, {"default", "broadcast"}
        )

    def test_read_dossier_cluster_and_latest_briefing(self) -> None:
        articles = self.client.get("/api/v1/articles")
        self.assertEqual(articles.status_code, 200)
        self.assertIn(
            str(self.article.id), {item["id"] for item in articles.json()["items"]}
        )

        dossier = self.client.get(f"/api/v1/articles/{self.article.id}")
        self.assertEqual(dossier.status_code, 200)
        self.assertEqual(dossier.json()["intent"], "product launch")

        clusters = self.client.get("/api/v1/clusters")
        self.assertEqual(clusters.status_code, 200)
        self.assertIn(
            str(self.cluster.id), {item["id"] for item in clusters.json()["items"]}
        )
        cluster = self.client.get(f"/api/v1/clusters/{self.cluster.id}")
        self.assertEqual(cluster.status_code, 200)
        self.assertEqual(len(cluster.json()["members"]), 2)

        briefing = self.client.get("/api/v1/briefings/latest")
        self.assertEqual(briefing.status_code, 200)
        self.assertEqual(briefing.json()["id"], str(self.briefing.id))
        history = self.client.get("/api/v1/briefings")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()["items"][0]["id"], str(self.briefing.id))
        snapshot = self.client.get(f"/api/v1/briefings/{self.briefing.id}")
        self.assertEqual(snapshot.status_code, 200)
        self.assertEqual(snapshot.json()["articles"][0]["id"], str(self.article.id))
        empty = self.client.get(
            "/api/v1/briefings/latest?profile=broadcast", headers=self.admin_headers
        )
        self.assertEqual(empty.status_code, 200)
        self.assertIsNone(empty.json())

        feed = self.client.get("/api/v1/feed")
        self.assertEqual(feed.status_code, 200)
        self.assertEqual(feed.json()["profile"], "default")
        self.assertEqual(feed.json()["briefing"]["counters"]["retained"], 2)
        self.assertEqual(
            feed.json()["articles"][0]["headline"], self.singleton_article.title
        )
        self.assertEqual(feed.json()["articles"][0]["sourceCode"], "UN")
        self.assertEqual(len(feed.json()["articles"]), 1)
        self.assertEqual(len(feed.json()["clusters"]), 1)
        self.assertEqual(feed.json()["clusters"][0]["id"], str(self.cluster.id))
        self.assertEqual(feed.json()["clusters"][0]["confidence"], 92)
        self.assertIn("sources", feed.json()["clusters"][0])
        self.assertEqual(
            {source["articleId"] for source in feed.json()["clusters"][0]["sources"]},
            {str(self.article.id), str(self.supporting_article.id)},
        )

    def test_source_management_is_privileged_atomic_and_profile_scoped(self) -> None:
        payload = {
            "name": "New Technology Desk",
            "url": "https://news.example.org/feed",
            "category": "Technology",
            "region": "India",
            "enabled": True,
            "allow_deep_scan": False,
            "timezone": "Asia/Kolkata",
            "max_links": 75,
            "manual_deep_scan_candidate": False,
        }
        denied = self.client.post("/api/v1/sources", json=payload)
        self.assertEqual(denied.status_code, 403)

        created = self.client.post(
            "/api/v1/sources",
            headers=self.admin_headers,
            json=payload,
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["id"], "new-technology-desk")
        self.assertEqual(created.json()["url"], payload["url"])

        duplicate = self.client.post(
            "/api/v1/sources",
            headers=self.admin_headers,
            json=payload,
        )
        self.assertEqual(duplicate.status_code, 409)

        payload["enabled"] = False
        payload["max_links"] = 25
        updated = self.client.put(
            "/api/v1/sources/new-technology-desk",
            headers=self.admin_headers,
            json=payload,
        )
        self.assertEqual(updated.status_code, 200)
        self.assertFalse(updated.json()["enabled"])
        self.assertEqual(updated.json()["max_links"], 25)

        stored = json.loads((self.root / "sites" / "default.json").read_text())
        matching = [
            site for site in stored["sites"] if site["id"] == "new-technology-desk"
        ]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["allowed_domains"], ["news.example.org"])
        broadcast = json.loads(
            (self.root / "sites" / "broadcast.json").read_text()
        )
        self.assertNotIn(
            "new-technology-desk", {site["id"] for site in broadcast["sites"]}
        )

    def test_source_management_rejects_ssrf_prone_urls(self) -> None:
        template = {
            "name": "Blocked Source",
            "category": "Technology",
            "region": "Global",
            "enabled": True,
            "allow_deep_scan": False,
            "timezone": "UTC",
            "max_links": 25,
            "manual_deep_scan_candidate": False,
        }
        blocked_urls = (
            "https://user:password@example.com/feed",
            "http://127.0.0.1/feed",
            "http://[::1]/feed",
            "http://localhost/feed",
            "https://news.local/feed",
            "https://feeds.internal/feed",
            "https://example.com:8080/feed",
        )
        original = (self.root / "sites" / "default.json").read_text(encoding="utf-8")
        for index, url in enumerate(blocked_urls):
            with self.subTest(url=url):
                response = self.client.post(
                    "/api/v1/sources",
                    headers=self.admin_headers,
                    json={**template, "name": f"Blocked Source {index}", "url": url},
                )
                self.assertEqual(response.status_code, 422)
        self.assertEqual(
            (self.root / "sites" / "default.json").read_text(encoding="utf-8"),
            original,
        )

    def test_mutation_requests_are_size_bounded_and_rate_limited(self) -> None:
        strict_settings = self.settings.model_copy(
            update={"max_request_bytes": 160, "mutation_rate_limit_per_minute": 2}
        )
        app = create_app(
            settings=strict_settings,
            profiles=self.profiles,
            repository=self.repository,
            pipeline=FakePipeline(),
            job_manager=RecordingJobManager(),
        )
        with TestClient(app) as protected:
            oversized = protected.put(
                "/api/v1/me/preferences",
                json={"display_name": "x" * 500, "contact_email": None},
            )
            self.assertEqual(oversized.status_code, 413)
            self.assertEqual(oversized.json()["code"], "request_too_large")

            accepted = protected.put(
                "/api/v1/me/preferences",
                json={"display_name": "Vineet", "contact_email": None},
            )
            self.assertEqual(accepted.status_code, 200)
            self.assertEqual(accepted.headers["x-ratelimit-remaining"], "0")

            limited = protected.put(
                "/api/v1/me/preferences",
                json={"display_name": "Vineet", "contact_email": None},
            )
            self.assertEqual(limited.status_code, 429)
            self.assertEqual(limited.json()["code"], "mutation_rate_limited")
            self.assertGreaterEqual(int(limited.headers["retry-after"]), 1)

            # Read-only traffic is intentionally outside the mutation budget.
            self.assertEqual(protected.get("/api/v1/me").status_code, 200)

    def test_viewer_preferences_personalize_identity_without_storing_raw_ip(self) -> None:
        initial = self.client.get("/api/v1/me")
        self.assertEqual(initial.status_code, 200)
        self.assertIsNone(initial.json()["preferences"])

        saved = self.client.put(
            "/api/v1/me/preferences",
            json={
                "display_name": "Tony Stark",
                "contact_email": "TONY@EXAMPLE.COM",
            },
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["display_name"], "Tony Stark")
        self.assertEqual(saved.json()["contact_email"], "tony@example.com")
        self.assertFalse(saved.json()["pet_enabled"])
        self.assertTrue(saved.json()["actor_id"].startswith("anonymous:"))

        refreshed = self.client.get("/api/v1/me")
        self.assertEqual(
            refreshed.json()["preferences"]["display_name"], "Tony Stark"
        )
        self.assertNotIn("203.0.113.8", self.repository.storage_path.read_text())

        invalid = self.client.put(
            "/api/v1/me/preferences",
            json={"display_name": "Tony", "contact_email": "not-an-email"},
        )
        self.assertEqual(invalid.status_code, 422)

        event = self.client.post(
            "/api/v1/events",
            json={"event_type": "page_view", "session_id": str(uuid4()), "path": "/briefing"},
        )
        self.assertEqual(event.status_code, 201)
        renamed = self.client.put(
            "/api/v1/me/preferences",
            json={"display_name": "Pepper Potts", "contact_email": None},
        )
        self.assertEqual(renamed.status_code, 200)
        analytics = self.client.get(
            "/api/v1/admin/analytics/detail?window_days=7",
            headers=self.admin_headers,
        )
        self.assertEqual(analytics.status_code, 200)
        self.assertEqual(analytics.json()["users"][0]["display_name"], "Pepper Potts")

    def test_actions_worklists_feedback_and_telemetry(self) -> None:
        action = self.client.post(
            f"/api/v1/articles/{self.article.id}/actions",
            json={"action": "select", "idempotency_key": "select-ai-001"},
        )
        self.assertEqual(action.status_code, 201)
        self.assertTrue(action.json()["disposition"]["selected"])

        denied_approval = self.client.post(
            f"/api/v1/articles/{self.article.id}/actions",
            json={"action": "approve", "approval_key": "2741"},
        )
        self.assertEqual(denied_approval.status_code, 403)
        approved = self.client.post(
            f"/api/v1/articles/{self.article.id}/actions",
            headers=self.admin_headers,
            json={"action": "approve", "approval_key": "0000"},
        )
        self.assertEqual(approved.status_code, 403)
        approved = self.client.post(
            f"/api/v1/articles/{self.article.id}/actions",
            headers=self.admin_headers,
            json={"action": "approve", "approval_key": "2741"},
        )
        self.assertEqual(approved.status_code, 201)
        self.assertTrue(approved.json()["disposition"]["approved"])
        viewer_actions = self.client.get(
            f"/api/v1/articles/{self.article.id}/actions"
        )
        self.assertEqual(viewer_actions.status_code, 200)
        self.assertEqual(
            {item["action"] for item in viewer_actions.json()["items"]},
            {"select", "approve"},
        )
        notifications = self.client.get("/api/v1/notifications")
        self.assertEqual(notifications.status_code, 200)
        self.assertEqual(
            {item["kind"] for item in notifications.json()},
            {"briefing", "approval"},
        )

        worklist = self.client.get("/api/v1/worklists?state=selected")
        self.assertEqual(worklist.status_code, 200)
        self.assertEqual(worklist.json()["items"][0]["article"]["id"], str(self.article.id))

        feedback = self.client.post(
            "/api/v1/feedback",
            json={
                "rating": 5,
                "category": "usability",
                "message": "The dossier is easy to scan.",
            },
        )
        self.assertEqual(feedback.status_code, 201)
        self.assertTrue(feedback.json()["reference"].startswith("voc:"))

        event = self.client.post(
            "/api/v1/events",
            json={
                "event_type": "article_open",
                "session_id": str(uuid4()),
                "article_id": str(self.article.id),
                "path": f"/articles/{self.article.id}",
            },
        )
        self.assertEqual(event.status_code, 201)
        self.assertEqual(event.json()["profile"], "default")

        not_interested = self.client.post(
            f"/api/v1/articles/{self.article.id}/actions",
            json={"action": "not_interested"},
        )
        self.assertEqual(not_interested.status_code, 201)
        filtered_feed = self.client.get("/api/v1/feed").json()
        self.assertEqual(filtered_feed["clusters"], [])
        self.assertEqual(
            [item["id"] for item in filtered_feed["articles"]],
            [str(self.singleton_article.id)],
        )

    def test_profile_scoped_export_returns_a_real_download(self) -> None:
        response = self.client.post(
            "/api/v1/exports",
            json={
                "profile": "default",
                "article_ids": [str(self.article.id)],
                "format": "json",
                "filename": "../Board briefing.exe",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/json")
        self.assertEqual(
            response.headers["content-disposition"],
            'attachment; filename="Board-briefing.json"',
        )
        self.assertEqual(response.headers["x-signalroom-article-count"], "1")
        payload = response.json()
        self.assertEqual(payload["article_count"], 1)
        self.assertEqual(payload["articles"][0]["article_id"], str(self.article.id))

    def test_batch_action_applies_to_a_prevalidated_selection(self) -> None:
        response = self.client.post(
            "/api/v1/article-actions/batch",
            json={
                "article_ids": [
                    str(self.article.id),
                    str(self.singleton_article.id),
                ],
                "action": "select",
                "idempotency_key": "batch-select-001",
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.json()), 2)
        self.assertTrue(all(item["disposition"]["selected"] for item in response.json()))
        selected = self.client.get("/api/v1/worklists?state=selected").json()["items"]
        self.assertEqual(
            {item["article"]["id"] for item in selected},
            {str(self.article.id), str(self.singleton_article.id)},
        )

    def test_only_submitter_or_admin_can_clear_shared_review(self) -> None:
        submitted = self.client.post(
            f"/api/v1/articles/{self.supporting_article.id}/actions",
            json={"action": "mark_under_review"},
        )
        self.assertEqual(submitted.status_code, 201)
        self.assertTrue(submitted.json()["disposition"]["under_review"])

        shared = self.client.get(
            "/api/v1/worklists?state=under_review", headers=self.admin_headers
        )
        self.assertEqual(shared.status_code, 200)
        self.assertEqual(
            shared.json()["items"][0]["disposition"]["actor_id"],
            submitted.json()["action"]["actor_id"],
        )

        approved = self.client.post(
            f"/api/v1/articles/{self.supporting_article.id}/actions",
            headers=self.admin_headers,
            json={"action": "approve", "approval_key": "2741"},
        )
        self.assertEqual(approved.status_code, 201)
        self.assertTrue(approved.json()["disposition"]["approved"])

        cleared = self.client.post(
            f"/api/v1/articles/{self.supporting_article.id}/actions",
            headers=self.admin_headers,
            json={"action": "clear_review"},
        )
        self.assertEqual(cleared.status_code, 201)
        self.assertFalse(cleared.json()["disposition"]["approved"])
        self.assertFalse(cleared.json()["disposition"]["under_review"])

    def test_gatekeeper_accepts_its_key_without_granting_admin_capability(self) -> None:
        denied = self.client.get(
            "/api/v1/gatekeeper/audit",
            headers={"x-signalroom-gatekeeper-key": "0000"},
        )
        self.assertEqual(denied.status_code, 403)
        allowed = self.client.get(
            "/api/v1/gatekeeper/audit",
            headers={"x-signalroom-gatekeeper-key": "6384"},
        )
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.json()["profile"], "default")

    def test_selected_and_saved_are_private_while_review_is_shared(self) -> None:
        self.client.post(
            f"/api/v1/articles/{self.article.id}/actions",
            json={"action": "select"},
        )
        self.client.post(
            f"/api/v1/articles/{self.article.id}/actions",
            json={"action": "save"},
        )
        self.client.post(
            f"/api/v1/articles/{self.article.id}/actions",
            json={"action": "mark_under_review"},
        )
        self.assertEqual(
            len(self.client.get("/api/v1/worklists?state=selected").json()["items"]), 1
        )
        self.assertEqual(
            len(self.client.get("/api/v1/worklists?state=saved").json()["items"]), 1
        )
        self.assertEqual(
            len(self.repository.list_worklist(
                actor_id="a-different-user",
                profile=ProfileId.DEFAULT,
                state="selected",
                page=PageParams(limit=25),
            ).items),
            0,
        )
        self.assertEqual(
            len(self.repository.list_worklist(
                actor_id="a-different-user",
                profile=ProfileId.DEFAULT,
                state="saved",
                page=PageParams(limit=25),
            ).items),
            0,
        )
        self.assertEqual(
            len(self.repository.list_worklist(
                actor_id="a-different-user",
                profile=ProfileId.DEFAULT,
                state="under_review",
                page=PageParams(limit=25),
            ).items),
            1,
        )

    def test_admin_surfaces_require_capability_and_submit_durable_job(self) -> None:
        denied = self.client.get("/api/v1/admin/analytics")
        self.assertEqual(denied.status_code, 403)

        telemetry = self.client.post(
            "/api/v1/events",
            json={
                "event_type": "article_open",
                "session_id": str(uuid4()),
                "article_id": str(self.article.id),
                "path": f"/articles/{self.article.id}",
            },
        )
        self.assertEqual(telemetry.status_code, 201)

        analytics = self.client.get(
            "/api/v1/admin/analytics", headers=self.admin_headers
        )
        self.assertEqual(analytics.status_code, 200)

        detailed = self.client.get(
            "/api/v1/admin/analytics/detail?window_days=7",
            headers=self.admin_headers,
        )
        self.assertEqual(detailed.status_code, 200)
        self.assertEqual(detailed.json()["profile"], "default")
        self.assertEqual(detailed.json()["summary"]["event_count"], 1)
        self.assertEqual(detailed.json()["coverage"]["events_truncated"], False)

        denied_audit = self.client.get("/api/v1/gatekeeper/audit")
        self.assertEqual(denied_audit.status_code, 403)
        audit = self.client.get(
            "/api/v1/gatekeeper/audit?limit=25", headers=self.admin_headers
        )
        self.assertEqual(audit.status_code, 200)
        self.assertEqual(audit.json()["profile"], "default")
        self.assertIsNone(audit.json()["job"])
        self.assertEqual(audit.json()["counters"]["articles"]["total"], 0)

        feedback = self.client.get(
            "/api/v1/admin/feedback", headers=self.admin_headers
        )
        self.assertEqual(feedback.status_code, 200)

        submission = self.client.post(
            "/api/v1/admin/scans",
            headers=self.admin_headers,
            json={"profile": "default", "keywords": ["AI"]},
        )
        self.assertEqual(submission.status_code, 202)
        job = submission.json()["job"]
        self.assertEqual(job["status"], "queued")
        self.assertEqual(len(self.manager.submissions), 1)

        fetched = self.client.get(
            submission.json()["status_url"], headers=self.admin_headers
        )
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["id"], job["id"])
        events = self.client.get(
            submission.json()["events_url"], headers=self.admin_headers
        )
        self.assertEqual(events.status_code, 200)
        self.assertEqual(events.json(), [])

    def test_admin_gatekeeper_training_reports_insufficient_labels(self) -> None:
        response = self.client.post(
            "/api/v1/admin/gatekeeper/train",
            headers=self.admin_headers,
            json={"profile": "default", "min_samples": 2},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["code"], "insufficient_training_data")


if __name__ == "__main__":
    unittest.main()
