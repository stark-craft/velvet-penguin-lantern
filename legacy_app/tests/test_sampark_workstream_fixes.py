"""Regression tests for the Sampark stabilization pass.

Covers, at behavior level (no implementation-detail repetition):
- WS5: same-IP different-signed-viewer isolation (viewer_name, migration, state)
- WS7: archive search returns a projected payload without full bodies
- WS8: For You compact response (no duplicated sections, no bodies)
- WS12: capability/session truthfulness (privileged flag, role, sources)
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import Response
from starlette.requests import Request

from news_scrapper import application as app


def _request(ip="10.0.0.77", viewer_key="viewer-a", created=False, cookies=""):
    headers = []
    if cookies:
        headers.append((b"cookie", cookies.encode("latin-1")))
    req = Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": headers,
            "client": (ip, 50000),
            "server": ("testserver", 80),
        }
    )
    req.state.private_viewer_key = viewer_key
    req.state.private_viewer_created = created
    req.state.private_viewer_token = "tok"
    resp = MagicMock(spec=Response)
    return req, resp


def _router_module():
    import importlib
    return importlib.import_module("news_scrapper.recommendation.router")


class SignedViewerIsolationTests(unittest.TestCase):
    def test_same_ip_viewer_name_and_migration_are_isolated(self):
        with tempfile.TemporaryDirectory() as td:
            profiles = Path(td) / "viewer_profiles.json"
            claims = Path(td) / "viewer_identity_claims.json"
            profiles.write_text("{}", encoding="utf-8")
            claims.write_text("{}", encoding="utf-8")
            from core.storage import JsonStore
            claims_store = JsonStore(claims, dict)
            with patch.object(app, "VIEWER_PROFILES_FILE", str(profiles)), \
                 patch.object(app, "PRIVATE_VIEWER_CLAIMS", claims_store):
                # Legacy IP desk belongs to the network; browser A claims it first.
                legacy_key = app.get_viewer_key("10.0.0.77")
                app.save_viewer_profiles({legacy_key: {"display_name": "Legacy Desk", "email": ""}})
                req_a, _ = _request(ip="10.0.0.77", viewer_key="browser-a-key", created=True)
                app.claim_legacy_private_bucket({}, req_a)
                # Browser A sees the legacy name; browser B must not.
                self.assertEqual(app.get_signed_viewer_display_name(req_a), "Legacy Desk")
                req_b, _ = _request(ip="10.0.0.77", viewer_key="browser-b-key", created=True)
                self.assertEqual(app.get_signed_viewer_display_name(req_b), "")
                self.assertNotEqual(
                    app.get_signed_migration_source(req_a), {},
                    "owner browser keeps its migration source",
                )
                self.assertEqual(
                    app.get_signed_migration_source(req_b), {},
                    "second browser behind one NAT must not see another browser's claimed legacy name",
                )


class ArchiveSearchProjectionTests(unittest.TestCase):
    def test_results_exclude_full_bodies_but_keep_list_fields(self):
        with tempfile.TemporaryDirectory() as td:
            art = {
                "title": "Samsung OLED Breakthrough",
                "link": "https://example.test/oled",
                "url": "https://example.test/oled",
                "source": "Tech",
                "src": "Tech",
                "category": "Display Tech",
                "date": "2026-09-10",
                "summary": "Short summary",
                "master_summary": "Short summary",
                "full_contents": "X" * 5000,
                "full_content": "Y" * 5000,
                "source_count": 3,
                "importance_score": 80,
            }
            hist = Path(td) / "briefing_2026-09-10_08-00-00.json"
            hist.write_text(json.dumps([art]), encoding="utf-8")
            req, _ = _request()
            with patch.object(app, "get_profile_history_files", return_value=[str(hist)]), \
                 patch.object(app, "filter_viewer_hidden", side_effect=lambda arts, req, prof: arts), \
                 patch.object(app, "apply_learned_regions", side_effect=lambda arts, prof: arts):
                from news_scrapper.recommendation.preferences import ViewerRepository
                rec_router = _router_module()
                viewers = Path(td) / "viewers"
                viewers.mkdir()
                with patch.object(rec_router, "REPOSITORY", ViewerRepository(viewers)):
                    res = app.search_archive(
                        req,
                        query="Samsung OLED",
                        from_date=None,
                        to_date=None,
                        target_sites=None,
                        limit=100,
                        offset=0,
                        sort="relevance",
                    )
            self.assertGreaterEqual(res["count"], 1)
            first = res["results"][0]
            self.assertNotIn("full_contents", first)
            self.assertNotIn("full_content", first)
            for field in ("title", "summary", "link", "source", "date", "category"):
                self.assertIn(field, first)


class ForYouSignedIsolationTests(unittest.TestCase):
    def test_same_ip_browsers_get_own_names_and_private_state(self):
        rec_router = _router_module()
        from news_scrapper.recommendation.reactions import ReactionRepository
        from news_scrapper.recommendation.preferences import ViewerRepository
        with tempfile.TemporaryDirectory() as td:
            viewers = Path(td) / "viewers"
            viewers.mkdir()
            reactions_file = Path(td) / "reactions.json"
            reactions_file.write_text("{}", encoding="utf-8")
            profiles = Path(td) / "viewer_profiles.json"
            profiles.write_text("{}", encoding="utf-8")
            article = {
                "title": "AI Model Launch",
                "link": "https://example.test/ai",
                "url": "https://example.test/ai",
                "source": "Tech",
                "src": "Tech",
                "category": "AI Models",
                "date": "2026-09-10",
                "summary": "S",
                "master_summary": "S",
                "source_count": 2,
                "importance_score": 80,
                "audiences": ["all"],
            }
            with patch.object(rec_router, "REPOSITORY", ViewerRepository(viewers)), \
                 patch.object(rec_router, "REACTIONS", ReactionRepository(reactions_file)), \
                 patch.object(rec_router, "_profile_and_articles", return_value=("unified", [article])), \
                 patch.object(app, "get_viewer_saved_items", return_value=[]), \
                 patch.object(app, "VIEWER_PROFILES_FILE", str(profiles)):
                # Two browsers behind one NAT set different display names.
                app.save_viewer_profiles({
                    "browser-a-key": {"display_name": "Alice", "email": ""},
                    "browser-b-key": {"display_name": "Bob", "email": ""},
                })
                req_a, resp_a = _request(ip="10.0.0.77", viewer_key="browser-a-key")
                req_b, resp_b = _request(ip="10.0.0.77", viewer_key="browser-b-key")
                res_a = rec_router.for_you(req_a, resp_a, cursor="", limit=20, include_sections=False)
                res_b = rec_router.for_you(req_b, resp_b, cursor="", limit=20, include_sections=False)
                self.assertEqual(res_a.get("viewer_name"), "Alice")
                self.assertEqual(res_b.get("viewer_name"), "Bob")
                # Private events never merge: record under A only.
                from news_scrapper.recommendation.router import record_shared_briefing_event
                with patch.object(rec_router, "_load_raw_engagement_pool", return_value=[article]):
                    out = record_shared_briefing_event(
                        req_a, resp_a, track_action="dossier_open",
                        detail={"title": article["title"], "link": article["link"]},
                        event_id="evt-isolation-1",
                    )
                self.assertEqual(out["accepted"], 1)
                repo = rec_router.REPOSITORY
                self.assertEqual(len(repo.read("browser-a-key").get("events", [])), 1)
                self.assertEqual(repo.read("browser-b-key").get("events", []), [])
class ForYouCompactTests(unittest.TestCase):
    def test_compact_response_omits_sections_bodies_and_duplicate_points(self):
        rec_router = _router_module()
        from news_scrapper.recommendation.reactions import ReactionRepository
        from news_scrapper.recommendation.preferences import ViewerRepository
        with tempfile.TemporaryDirectory() as td:
            viewers = Path(td) / "viewers"
            viewers.mkdir()
            reactions_file = Path(td) / "reactions.json"
            reactions_file.write_text("{}", encoding="utf-8")
            article = {
                "title": "AI Model Launch",
                "link": "https://example.test/ai",
                "url": "https://example.test/ai",
                "source": "Tech",
                "src": "Tech",
                "category": "AI Models",
                "date": "2026-09-10",
                "summary": "S",
                "master_summary": "S",
                "full_contents": "Z" * 4000,
                "summary_points": ["a", "b"],
                "key_points": ["a", "b"],
                "source_count": 2,
                "importance_score": 80,
                "audiences": ["all"],
            }
            req, resp = _request(viewer_key="foryou-compact-viewer")
            with patch.object(rec_router, "REPOSITORY", ViewerRepository(viewers)), \
                 patch.object(rec_router, "REACTIONS", ReactionRepository(reactions_file)), \
                 patch.object(rec_router, "_profile_and_articles", return_value=("unified", [article])), \
                 patch.object(app, "get_viewer_saved_items", return_value=[]), \
                 patch.object(app, "get_signed_viewer_display_name", return_value=""):
                res = rec_router.for_you(req, resp, cursor="", limit=20, include_sections=False)
            self.assertIn("items", res)
            self.assertNotIn("sections", res)
            self.assertGreaterEqual(len(res["items"]), 1)
            item = res["items"][0]
            self.assertNotIn("full_contents", item)
            self.assertNotIn("full_content", item)
            self.assertFalse(
                item.get("key_points") == item.get("summary_points") and item.get("key_points"),
                "identical key_points must not duplicate summary_points",
            )


class NotificationContractTests(unittest.TestCase):
    def test_change_request_roundtrip_keeps_read_state(self):
        from news_scrapper.internal_content import service, storage as internal_storage
        from news_scrapper.internal_content import access as internal_access
        with tempfile.TemporaryDirectory() as td:
            runtime = Path(td) / "internal_content"
            patches = [
                patch.object(internal_storage, attr, target)
                for attr, target in (
                    ("RUNTIME_DIR", runtime),
                    ("ORIGINALS_DIR", runtime / "originals"),
                    ("COVERS_DIR", runtime / "covers"),
                    ("CONTRIBUTIONS_FILE", runtime / "contributions.json"),
                    ("NOTIFICATIONS_FILE", runtime / "internal_notifications.json"),
                )
            ]
            for p in patches:
                p.start()
                self.addCleanup(p.stop)
            owner = "owner-browser-key"
            rec = service.create_draft(owner, {
                "title": "Colleague story", "summary": "Summary",
                "body": "Body with enough length for validation.", "category": "Technology",
            })
            from PIL import Image
            import io
            image = Image.new("RGB", (1600, 900), (210, 40, 40))
            buffer = io.BytesIO()
            image.save(buffer, "PNG")
            service.attach_cover(owner, rec["id"], "cover.png", buffer.getvalue(), 0.5, 0.5)
            service.submit_draft(owner, rec["id"])
            service.request_changes(rec["id"], "Please add a cover image.")
            inbox = service.list_notifications(owner)
            self.assertEqual(len(inbox["items"]), 1)
            note = inbox["items"][0]
            # Canonical backend shape: read boolean, reviewer note, kind, record title.
            self.assertFalse(note["read"])
            self.assertEqual(note["kind"], "changes")
            self.assertEqual(note["record_id"], rec["id"])
            self.assertIn("cover", note["note"])
            service.mark_notifications_read(owner, [note["id"]])
            again = service.list_notifications(owner)
            self.assertTrue(again["items"][0]["read"])
            self.assertEqual(again["unread"], 0)


class ArchiveArticleDetailTests(unittest.TestCase):
    def _history(self, td, articles):
        hist = Path(td) / "briefing_2026-09-10_08-00-00.json"
        hist.write_text(json.dumps(articles), encoding="utf-8")
        return str(hist)

    def test_detail_resolves_by_link_and_rejects_unknown(self):
        from fastapi import HTTPException
        rec_router = _router_module()
        from news_scrapper.recommendation.preferences import ViewerRepository
        with tempfile.TemporaryDirectory() as td:
            art = {
                "title": "Samsung OLED Breakthrough", "link": "https://example.test/oled",
                "url": "https://example.test/oled", "source": "Tech", "src": "Tech",
                "category": "Display Tech", "date": "2026-09-10", "summary": "Short summary",
                "full_contents": "Complete body text here.",
            }
            hist = self._history(td, [art])
            viewers = Path(td) / "viewers"
            viewers.mkdir()
            req, _ = _request(viewer_key="detail-viewer")
            with patch.object(app, "get_profile_history_files", return_value=[hist]), \
                 patch.object(app, "filter_viewer_hidden", side_effect=lambda arts, req, prof: arts), \
                 patch.object(app, "apply_learned_regions", side_effect=lambda arts, prof: arts), \
                 patch.object(rec_router, "REPOSITORY", ViewerRepository(viewers)), \
                 patch.object(rec_router, "_profile_and_articles", return_value=("unified", [])):
                res = app.archive_article(req, link="https://example.test/oled", url=None, title=None)
                self.assertEqual(res["status"], "success")
                self.assertIn("Complete body text", res["article"].get("full_contents", ""))
                with self.assertRaises(HTTPException) as ctx:
                    app.archive_article(req, link="https://evil.test/forged", url=None, title=None)
                self.assertEqual(ctx.exception.status_code, 404)

    def test_hidden_articles_are_not_resolvable(self):
        from fastapi import HTTPException
        rec_router = _router_module()
        from news_scrapper.recommendation.preferences import ViewerRepository
        from core.storage import JsonStore
        with tempfile.TemporaryDirectory() as td:
            art = {
                "title": "Hidden Story", "link": "https://example.test/hidden",
                "url": "https://example.test/hidden", "source": "Tech", "src": "Tech",
                "category": "Tech News", "date": "2026-09-10", "summary": "S",
            }
            hist = self._history(td, [art])
            viewers = Path(td) / "viewers"
            viewers.mkdir()
            hidden_file = Path(td) / "viewer_hidden_store.json"
            hidden_file.write_text("{}", encoding="utf-8")
            claims_file = Path(td) / "viewer_identity_claims.json"
            claims_file.write_text("{}", encoding="utf-8")
            hidden_store = {"hidden-viewer": {"default": [dict(art)]}}
            hidden_file.write_text(json.dumps(hidden_store), encoding="utf-8")
            req, _ = _request(viewer_key="hidden-viewer")
            with patch.object(app, "get_profile_history_files", return_value=[hist]), \
                 patch.object(app, "VIEWER_HIDDEN_FILE", str(hidden_file)), \
                 patch.object(app, "PRIVATE_VIEWER_CLAIMS", JsonStore(claims_file, dict)), \
                 patch.object(app, "apply_learned_regions", side_effect=lambda arts, prof: arts), \
                 patch.object(rec_router, "REPOSITORY", ViewerRepository(viewers)), \
                 patch.object(rec_router, "_profile_and_articles", return_value=("unified", [])):
                with self.assertRaises(HTTPException) as ctx:
                    app.archive_article(req, link="https://example.test/hidden", url=None, title=None)
                self.assertEqual(ctx.exception.status_code, 404)


class SchedulerContractTests(unittest.TestCase):
    def test_active_run_returns_409_without_queueing(self):
        from fastapi import BackgroundTasks, HTTPException
        with patch.object(app, "SCHEDULER_STATUS", {"is_active": True, "mode": "autonomous"}):
            req, _ = _request()
            with patch.object(
                app.capability_service, "require_capability", return_value="tester"
            ):
                with self.assertRaises(HTTPException) as ctx:
                    app.trigger_scheduler_run(req, BackgroundTasks())
        self.assertEqual(ctx.exception.status_code, 409)


class CapabilitySessionTests(unittest.TestCase):
    def test_capabilities_report_privileged_session_truthfully(self):
        from news_scrapper.access_control import service, router
        req, resp = _request()
        body = router.capabilities(req, resp)
        self.assertFalse(body["privileged_session_active"])
        self.assertEqual(body["session_role"], "")
        self.assertIn("capability_sources", body)
        self.assertIn("session", body["capability_sources"])
        # Unlock an editor session and verify flag + role without secrets.
        unlock_req, unlock_resp = _request()
        token = service.create_privileged_session(
            unlock_req, unlock_resp, {"review.contributions.view"}, role="editor"
        )
        self.assertTrue(token)
        authed_req, _ = _request(cookies=f"{service.PRIVILEGED_COOKIE}={token}")
        authed_body = router.capabilities(authed_req, resp)
        self.assertTrue(authed_body["privileged_session_active"])
        self.assertEqual(authed_body["session_role"], "editor")
        service.revoke_privileged_session(authed_req, MagicMock(spec=Response))
        logged_out_req, _ = _request(cookies=f"{service.PRIVILEGED_COOKIE}={token}")
        logged_out_body = router.capabilities(logged_out_req, resp)
        self.assertFalse(logged_out_body["privileged_session_active"])


if __name__ == "__main__":
    unittest.main()


class GatekeeperPaginationContractTests(unittest.TestCase):
    def _items(self, n=120):
        return [
            {
                "id": f"d{i}",
                "title": f"Signal {i} {'chip' if i % 2 == 0 else 'display'}",
                "status": "dropped",
                "profile": "default",
                "updated_at": f"2026-09-{(i % 28) + 1:02d}T10:00:00",
            }
            for i in range(n)
        ]

    def test_dropped_returns_total_matched_page_and_has_more(self):
        req, _ = _request(ip="10.0.0.25", viewer_key="gatekeeper-viewer")
        with patch.object(app, "load_dropped_articles", return_value=self._items()), \
             patch.object(app, "require_gatekeeper_access", return_value="10.0.0.25"):
            first = app.gatekeeper_dropped(req, profile="all", status="all", search="", offset=0, limit=50)
            self.assertEqual(first["total"], 120)
            self.assertEqual(first["matched"], 120)
            self.assertEqual(first["count"], 50)
            self.assertEqual(first["offset"], 0)
            self.assertEqual(first["limit"], 50)
            self.assertTrue(first["has_more"])
            second = app.gatekeeper_dropped(req, profile="all", status="all", search="", offset=50, limit=50)
            self.assertEqual(second["count"], 50)
            self.assertEqual(second["matched"], 120)
            self.assertTrue(second["has_more"])
            third = app.gatekeeper_dropped(req, profile="all", status="all", search="", offset=100, limit=50)
            self.assertEqual(third["count"], 20)
            self.assertFalse(third["has_more"])
            expect_order = sorted(
                range(120),
                key=lambda i: f"2026-09-{(i % 28) + 1:02d}T10:00:00",
                reverse=True,
            )
            self.assertEqual(
                [r["id"] for r in first["items"]] + [r["id"] for r in second["items"]],
                [f"d{i}" for i in expect_order[:100]],
            )
            filtered = app.gatekeeper_dropped(req, profile="all", status="all", search="chip", offset=0, limit=50)
            self.assertEqual(filtered["total"], 120)
            self.assertEqual(filtered["matched"], 60)
            self.assertEqual(filtered["count"], 50)
            self.assertTrue(filtered["has_more"])
