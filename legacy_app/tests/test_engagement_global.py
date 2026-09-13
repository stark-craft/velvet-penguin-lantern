import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from fastapi import Request, Response

import main as composition
from news_scrapper.recommendation.preferences import ViewerRepository
from news_scrapper.internal_content import storage as internal_storage
from news_scrapper.internal_content import service as internal_service
from news_scrapper.internal_content import access as internal_access
from tests.asgi_harness import request as asgi_request


def _make_req(viewer_key):
    # Create a mock request with signed viewer identity
    # Use the real bind_viewer_request flow via cookies is complex, so we mock get_private_viewer_key and REPOSITORY
    req = MagicMock(spec=Request)
    req.state = MagicMock()
    req.state.private_viewer_key = viewer_key
    req.state.private_viewer_created = True
    req.client = MagicMock()
    req.client.host = "127.0.0.1"
    req.headers = {}
    req.cookies = {}
    resp = MagicMock(spec=Response)
    return req, resp


class CrossSurfaceEngagementTests(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.viewers_dir = Path(self.td.name) / "viewers"
        self.viewers_dir.mkdir(parents=True, exist_ok=True)
        self.history_dir = Path(self.td.name) / "history"
        self.history_dir.mkdir(parents=True, exist_ok=True)
        # Patch REPOSITORY to temp
        self.test_repo = ViewerRepository(self.viewers_dir)
        import importlib
        self.router_mod = importlib.import_module("news_scrapper.recommendation.router")
        self.orig_repo = self.router_mod.REPOSITORY
        self.router_mod.REPOSITORY = self.test_repo
        self.addCleanup(lambda: setattr(self.router_mod, "REPOSITORY", self.orig_repo))
        # Clear engagement cache
        self.router_mod._ENGAGEMENT_RAW_CACHE = None
        self.router_mod._ENGAGEMENT_RAW_SIGNATURE = None
        # Patch history files to use our temp dir
        self.orig_get_history = None
        # Patch internal storage to temp for published
        self.runtime_internal = Path(self.td.name) / "internal_content"
        (self.runtime_internal / "originals").mkdir(parents=True, exist_ok=True)
        (self.runtime_internal / "covers").mkdir(parents=True, exist_ok=True)
        for attr, target in (
            ("RUNTIME_DIR", self.runtime_internal),
            ("ORIGINALS_DIR", self.runtime_internal / "originals"),
            ("COVERS_DIR", self.runtime_internal / "covers"),
            ("CONTRIBUTIONS_FILE", self.runtime_internal / "contributions.json"),
            ("NOTIFICATIONS_FILE", self.runtime_internal / "internal_notifications.json"),
        ):
            p = patch.object(internal_storage, attr, target)
            p.start()
            self.addCleanup(p.stop)
        # Allow internal contributions from test IP
        p2 = patch.object(internal_access, "CONTRIBUTIONS_ALLOWED_IPS", {"127.0.0.1", "10.0.0.25"})
        p2.start()
        self.addCleanup(p2.stop)
        os.environ["INTERNAL_EDITOR_KEY"] = "test-engagement-key-123"
        self.addCleanup(lambda: os.environ.pop("INTERNAL_EDITOR_KEY", None))

    def _write_briefing(self, filename, articles):
        path = self.history_dir / filename
        with open(path, "w", encoding="utf-8") as f:
            json.dump(articles, f)
        return str(path)

    def _article(self, title, link, extra=None):
        base = {
            "title": title,
            "link": link,
            "url": link,
            "source": "Tech",
            "src": "Tech",
            "category": "AI Models",
            "audiences": ["all"],
            "source_count": 1,
            "importance_score": 80,
            "summary": f"Summary for {title}",
            "master_summary": f"Summary for {title}",
        }
        if extra:
            base.update(extra)
        return base

    def test_current_briefing_article_is_accepted(self):
        art_current = self._article("Current Briefing Article", "https://example.test/current")
        latest_path = self._write_briefing("briefing_2026-09-10_08-00-00.json", [art_current])
        self.router_mod._ENGAGEMENT_RAW_CACHE = None
        self.router_mod._ENGAGEMENT_RAW_SIGNATURE = None
        with patch.object(self.router_mod._legacy(), "get_profile_history_files", return_value=[latest_path]), \
             patch.object(self.router_mod._legacy(), "filter_viewer_hidden", side_effect=lambda arts, req, prof: arts), \
             patch.object(self.router_mod._legacy(), "apply_learned_regions", side_effect=lambda arts, prof: arts):
            req, resp = _make_req("viewer-current")
            res = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_open", detail={"title": art_current["title"], "link": art_current["link"]})
            self.assertEqual(res["accepted"], 1)

    def test_older_retained_briefing_is_accepted(self):
        art_old = self._article("Old Retained Article", "https://example.test/old")
        art_latest = self._article("Latest Article", "https://example.test/latest")
        old_path = self._write_briefing("briefing_2026-09-01_08-00-00.json", [art_old])
        latest_path = self._write_briefing("briefing_2026-09-10_08-00-00.json", [art_latest])
        # Use real history file reading, not patched _load_raw
        self.router_mod._ENGAGEMENT_RAW_CACHE = None
        self.router_mod._ENGAGEMENT_RAW_SIGNATURE = None
        with patch.object(self.router_mod._legacy(), "get_profile_history_files", return_value=[old_path, latest_path]), \
             patch.object(self.router_mod._legacy(), "get_latest_briefing_file_for_profile", return_value=latest_path), \
             patch.object(self.router_mod._legacy(), "filter_viewer_hidden", side_effect=lambda arts, req, prof: arts), \
             patch.object(self.router_mod._legacy(), "apply_learned_regions", side_effect=lambda arts, prof: arts):
            req, resp = _make_req("viewer-old")
            res = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_dwell", detail={"title": art_old["title"], "link": art_old["link"]}, active_ms=5000)
            self.assertEqual(res["accepted"], 1)
            state = self.test_repo.read("viewer-old")
            self.assertTrue(any(e["action"] == "dossier_dwell" for e in state["events"]))

    def test_published_internal_contribution_is_accepted(self):
        # Create a published internal contribution via service
        owner_key = "viewer-published-owner"
        # Use internal service directly with owner_key as viewer
        # Need to bypass IP check by patching access
        with patch.object(internal_access, "CONTRIBUTIONS_ALLOWED_IPS", {"127.0.0.1"}):
            rec = internal_service.create_draft(owner_key, {"title": "Internal Published Story", "summary": "summary", "body": "Body with enough length for validation.", "category": "Technology", "content_type": "announcement"})
            # submit and publish
            internal_service.submit_draft(owner_key, rec["id"])
            internal_service.publish_record(rec["id"])
        # Now engagement pool should contain it
        # We need to ensure _load_raw includes published; it will call list_published which reads from our temp storage
        # Clear cache
        self.router_mod._ENGAGEMENT_RAW_CACHE = None
        self.router_mod._ENGAGEMENT_RAW_SIGNATURE = None
        req, resp = _make_req("viewer-published")
        res = self.router_mod.record_shared_briefing_event(req, resp, track_action="source_open", detail={"title": "Internal Published Story", "id": rec["id"]})
        self.assertEqual(res["accepted"], 1)

    def test_unknown_forged_article_is_rejected(self):
        art_real = self._article("Real Article", "https://example.test/real")
        with patch.object(self.router_mod, "_load_raw_engagement_pool", return_value=[art_real]):
            req, resp = _make_req("viewer-unknown")
            res = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_open", detail={"title": "Forged Title", "link": "https://evil.test/forged"})
            self.assertEqual(res["accepted"], 0)
            self.assertEqual(res["rejected"], 1)

    def test_dwell_below_5000_is_ignored(self):
        art = self._article("Dwell Test", "https://example.test/dwell")
        with patch.object(self.router_mod, "_load_raw_engagement_pool", return_value=[art]):
            req, resp = _make_req("viewer-dwell-low")
            res = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_dwell", detail={"title": art["title"], "link": art["link"]}, active_ms=4999)
            self.assertEqual(res["accepted"], 0)
            self.assertEqual(res["rejected"], 1)

    def test_dwell_at_or_above_5000_is_accepted_once(self):
        art = self._article("Dwell High", "https://example.test/dwellhigh")
        with patch.object(self.router_mod, "_load_raw_engagement_pool", return_value=[art]):
            req, resp = _make_req("viewer-dwell-high")
            res1 = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_dwell", detail={"title": art["title"], "link": art["link"]}, active_ms=5000, event_id="evt-dwell-1")
            self.assertEqual(res1["accepted"], 1)
            res2 = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_dwell", detail={"title": art["title"], "link": art["link"]}, active_ms=6000, event_id="evt-dwell-1")
            self.assertEqual(res2["duplicates"], 1)
            self.assertEqual(res2["accepted"], 0)

    def test_duplicate_event_ids_remain_idempotent(self):
        art = self._article("Dup Article", "https://example.test/dup")
        with patch.object(self.router_mod, "_load_raw_engagement_pool", return_value=[art]):
            req, resp = _make_req("viewer-dup")
            res1 = self.router_mod.record_shared_briefing_event(req, resp, track_action="source_open", detail={"title": art["title"]}, event_id="dup-id-12345678")
            res2 = self.router_mod.record_shared_briefing_event(req, resp, track_action="source_open", detail={"title": art["title"]}, event_id="dup-id-12345678")
            self.assertEqual(res1["accepted"], 1)
            self.assertEqual(res2["duplicates"], 1)

    def test_accepted_historical_read_appears_in_activity_and_influences_for_you(self):
        art_old = self._article("Historical Influence", "https://example.test/hist", {"keywords_found": ["AI Models"], "category": "AI Models"})
        art_related = self._article("Related Later", "https://example.test/related", {"keywords_found": ["AI Models"], "category": "AI Models"})
        old_path = self._write_briefing("briefing_2026-09-01_08-00-00.json", [art_old])
        new_path = self._write_briefing("briefing_2026-09-10_08-00-00.json", [art_related])
        self.router_mod._ENGAGEMENT_RAW_CACHE = None
        self.router_mod._ENGAGEMENT_RAW_SIGNATURE = None
        with patch.object(self.router_mod._legacy(), "get_profile_history_files", return_value=[old_path, new_path]), \
             patch.object(self.router_mod._legacy(), "filter_viewer_hidden", side_effect=lambda arts, req, prof: arts), \
             patch.object(self.router_mod._legacy(), "apply_learned_regions", side_effect=lambda arts, prof: arts):
            viewer = "viewer-influence"
            req, resp = _make_req(viewer)
            # Score before
            from news_scrapper.recommendation.scoring import score_candidates
            before_cands, _ = score_candidates([art_related], self.test_repo.read(viewer), [])
            before_score = before_cands[0]["recommendation"]["score"] if before_cands else 0
            res = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_dwell", detail={"title": art_old["title"], "link": art_old["link"]}, active_ms=5000)
            self.assertEqual(res["accepted"], 1)
            # Query real activity endpoint via the viewer's repo
            from news_scrapper.recommendation.router import _activity_summary_for_viewer
            summary = _activity_summary_for_viewer(viewer, "UTC")
            self.assertGreaterEqual(summary["news_read"]["today"], 1)
            after_cands, _ = score_candidates([art_related], self.test_repo.read(viewer), [])
            after_score = after_cands[0]["recommendation"]["score"] if after_cands else 0
            self.assertGreater(after_score, before_score, f"related score should increase after historical dwell: before {before_score} after {after_score}")
            state = self.test_repo.read(viewer)
            self.assertTrue(any(e["article_id"] for e in state["events"]))

    def test_two_viewers_remain_isolated_via_direct_call(self):
        art = self._article("Isolated Article", "https://example.test/iso")
        with patch.object(self.router_mod, "_load_raw_engagement_pool", return_value=[art]):
            req_a, resp_a = _make_req("viewer-a-isolated")
            req_b, resp_b = _make_req("viewer-b-isolated")
            res_a = self.router_mod.record_shared_briefing_event(req_a, resp_a, track_action="dossier_open", detail={"title": art["title"]})
            res_b = self.router_mod.record_shared_briefing_event(req_b, resp_b, track_action="dossier_open", detail={"title": "Other Title"})
            self.assertEqual(res_a["accepted"], 1)
            self.assertEqual(res_b["rejected"], 1)
            state_a = self.test_repo.read("viewer-a-isolated")
            state_b = self.test_repo.read("viewer-b-isolated")
            self.assertTrue(any(e["action"] == "dossier_open" for e in state_a["events"]))
            self.assertFalse(any(e["action"] == "dossier_open" for e in state_b["events"]))

    def test_two_browsers_same_ip_isolation_via_asgi(self):
        # Real ASGI /track through main.app with signed cookies from same IP.
        # Audited /track write path:
        # - record_usage_activity -> USAGE_TRACKER_FILE (patched), VIEWER_PROFILES_FILE
        #   (read-only, patched to temp empty), PERSONALIZATION_SERVICE (patched to temp)
        # - bind_private_viewer middleware -> PRIVATE_VIEWER_CLAIMS (patched to temp)
        # - filter_viewer_hidden -> VIEWER_HIDDEN_FILE (mocked to passthrough here,
        #   plus patched to temp for middleware safety), VIEWER_SAVED_FILE (patched)
        # - record_shared_briefing_event -> REPOSITORY (temp viewers_dir, patched in setUp),
        #   REACTIONS (not touched by dossier_open, still isolated to temp for safety)
        # - _load_raw_engagement_pool -> history files (patched to temp art_path),
        #   internal CONTRIBUTIONS_FILE (temp via setUp)
        # No real runtime JSON is touched; temp files prove the full endpoint ran.
        art = self._article("ASGI Isolated", "https://example.test/asgi-iso")
        art_path = self._write_briefing("briefing_2026-09-10_08-00-00.json", [art])
        from news_scrapper import application as app_mod
        from news_scrapper.personalization import PersonalizationService
        from core.storage import JsonStore
        from news_scrapper.recommendation.reactions import ReactionRepository
        usage_file = Path(self.td.name) / "usage_tracker.json"
        personalization_file = Path(self.td.name) / "viewer_personalization.json"
        profiles_file = Path(self.td.name) / "viewer_profiles.json"
        hidden_file = Path(self.td.name) / "viewer_hidden_store.json"
        saved_file = Path(self.td.name) / "viewer_saved_store.json"
        claims_file = Path(self.td.name) / "viewer_identity_claims.json"
        reactions_file = Path(self.td.name) / "reactions.json"
        for p in (usage_file, personalization_file, profiles_file, hidden_file, saved_file, claims_file, reactions_file):
            p.write_text("{}", encoding="utf-8")
        temp_personalization = PersonalizationService(str(personalization_file))
        temp_claims = JsonStore(claims_file, dict)
        temp_reactions = ReactionRepository(reactions_file)
        orig_reactions = self.router_mod.REACTIONS
        self.router_mod._ENGAGEMENT_RAW_CACHE = None
        self.router_mod._ENGAGEMENT_RAW_SIGNATURE = None
        with patch.object(self.router_mod._legacy(), "get_profile_history_files", return_value=[art_path]), \
             patch.object(self.router_mod._legacy(), "filter_viewer_hidden", side_effect=lambda arts, req, prof: arts), \
             patch.object(self.router_mod._legacy(), "apply_learned_regions", side_effect=lambda arts, prof: arts), \
             patch.object(app_mod, "USAGE_TRACKER_FILE", str(usage_file)), \
             patch.object(app_mod, "PERSONALIZATION_SERVICE", temp_personalization), \
             patch.object(app_mod, "VIEWER_PROFILES_FILE", str(profiles_file)), \
             patch.object(app_mod, "VIEWER_HIDDEN_FILE", str(hidden_file)), \
             patch.object(app_mod, "VIEWER_SAVED_FILE", str(saved_file)), \
             patch.object(app_mod, "PRIVATE_VIEWER_CLAIMS", temp_claims), \
             patch.object(self.router_mod, "REACTIONS", temp_reactions):
            self.addCleanup(lambda: setattr(self.router_mod, "REACTIONS", orig_reactions))
            jar_a = {}
            jar_b = {}
            def do_track(jar, detail, action="dossier_open", eid=None):
                headers = {}
                if jar:
                    headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in jar.items())
                body = {"fingerprint": "test", "action": action, "detail": detail, "recommendation_event_id": eid or f"evt-{action}-{detail.get('title','')}-{len(jar)}"}
                resp = asgi_request(composition.app, "POST", "/track", headers=headers, json_body=body, client_ip="10.0.0.77")
                sc = resp.headers.get("set-cookie", "")
                if sc and "=" in sc:
                    # Handle multiple set-cookie headers (may be comma separated)
                    for part in sc.split(","):
                        if "techscout_viewer" in part:
                            pair = part.split(";",1)[0]
                            k, _, v = pair.partition("=")
                            jar[k.strip()] = v.strip()
                return resp
            r1 = do_track(jar_a, {"title": art["title"], "link": art["link"]}, "dossier_open", "evt-a-asgi-12345678")
            r2 = do_track(jar_b, {"title": art["title"], "link": art["link"]}, "dossier_open", "evt-b-asgi-12345678")
            self.assertEqual(r1.status_code, 200)
            self.assertEqual(r2.status_code, 200)
            b1 = r1.json()
            b2 = r2.json()
            self.assertEqual(b1.get("recommendation", {}).get("accepted"), 1)
            self.assertEqual(b2.get("recommendation", {}).get("accepted"), 1)
            self.assertIn("techscout_viewer", jar_a)
            self.assertIn("techscout_viewer", jar_b)
            self.assertNotEqual(jar_a["techscout_viewer"], jar_b["techscout_viewer"])
            viewers = list(self.viewers_dir.glob("*.json"))
            non_empty = [p for p in viewers if p.stat().st_size > 10]
            # Exactly two browser-scoped viewer records; middleware legitimately
            # creates no extra ViewerRepository records (legacy IP claim lives in
            # PRIVATE_VIEWER_CLAIMS, isolated above). Any extra file would be a leak.
            self.assertEqual(len(non_empty), 2, f"expected 2 viewer records, got {[p.name for p in non_empty]}")
            event_to_file = {}
            for p in non_empty:
                data = json.loads(p.read_text())
                evs = data.get("events", [])
                self.assertEqual(len(evs), 1, f"{p.name} should contain exactly its own event")
                eid = evs[0].get("event_id")
                self.assertIn(eid, ("evt-a-asgi-12345678", "evt-b-asgi-12345678"))
                self.assertEqual(evs[0].get("action"), "dossier_open")
                self.assertNotIn(eid, event_to_file)
                event_to_file[eid] = p.name
            # Distinct IDs, no duplication, no cross-placement
            self.assertEqual(set(event_to_file.keys()), {"evt-a-asgi-12345678", "evt-b-asgi-12345678"})
            self.assertNotEqual(event_to_file["evt-a-asgi-12345678"], event_to_file["evt-b-asgi-12345678"])
            self.assertTrue(usage_file.exists())
            self.assertTrue(personalization_file.exists())
            # Full endpoint ran while isolated: usage tracker has both events
            usage_data = json.loads(usage_file.read_text())
            usage_actions = []
            for _dev, rec in usage_data.items():
                for _day, day in (rec.get("activity") or {}).items():
                    usage_actions.extend(e.get("action") for e in day.get("events", []))
            self.assertIn("dossier_open", usage_actions)

    def test_two_distinct_articles_same_cluster_both_resolvable(self):
        # Two different URLs with same cluster_id must both be engagement-eligible
        art1 = self._article("Cluster A", "https://example.test/cluster-a", {"cluster_id": "cluster-xyz"})
        art2 = self._article("Cluster B", "https://example.test/cluster-b", {"cluster_id": "cluster-xyz"})
        self.router_mod._ENGAGEMENT_RAW_CACHE = None
        self.router_mod._ENGAGEMENT_RAW_SIGNATURE = None
        with patch.object(self.router_mod, "_load_raw_engagement_pool", return_value=[art1, art2]):
            req, resp = _make_req("viewer-cluster")
            res1 = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_open", detail={"title": art1["title"], "link": art1["link"]})
            res2 = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_open", detail={"title": art2["title"], "link": art2["link"]})
            self.assertEqual(res1["accepted"], 1)
            self.assertEqual(res2["accepted"], 1)

    def test_current_not_shadowed_by_older_cluster_member(self):
        art_old = self._article("Old Cluster", "https://example.test/old-cluster", {"cluster_id": "shared-cluster"})
        art_new = self._article("New Cluster", "https://example.test/new-cluster", {"cluster_id": "shared-cluster"})
        old_path = self._write_briefing("briefing_2026-09-01_08-00-00.json", [art_old])
        new_path = self._write_briefing("briefing_2026-09-10_08-00-00.json", [art_new])
        self.router_mod._ENGAGEMENT_RAW_CACHE = None
        self.router_mod._ENGAGEMENT_RAW_SIGNATURE = None
        with patch.object(self.router_mod._legacy(), "get_profile_history_files", return_value=[old_path, new_path]), \
             patch.object(self.router_mod._legacy(), "filter_viewer_hidden", side_effect=lambda arts, req, prof: arts), \
             patch.object(self.router_mod._legacy(), "apply_learned_regions", side_effect=lambda arts, prof: arts):
            req, resp = _make_req("viewer-shadow")
            res = self.router_mod.record_shared_briefing_event(req, resp, track_action="source_open", detail={"title": art_new["title"], "link": art_new["link"]})
            self.assertEqual(res["accepted"], 1)

    def test_duplicate_canonical_url_prefers_newest(self):
        art_old = self._article("Dup Canonical", "https://example.test/dup-canonical", {"summary": "old summary"})
        art_new = self._article("Dup Canonical", "https://example.test/dup-canonical", {"summary": "new summary"})
        old_path = self._write_briefing("briefing_2026-09-01_08-00-00.json", [art_old])
        new_path = self._write_briefing("briefing_2026-09-10_08-00-00.json", [art_new])
        self.router_mod._ENGAGEMENT_RAW_CACHE = None
        self.router_mod._ENGAGEMENT_RAW_SIGNATURE = None
        with patch.object(self.router_mod._legacy(), "get_profile_history_files", return_value=[old_path, new_path]), \
             patch.object(self.router_mod._legacy(), "filter_viewer_hidden", side_effect=lambda arts, req, prof: arts), \
             patch.object(self.router_mod._legacy(), "apply_learned_regions", side_effect=lambda arts, prof: arts):
            req, resp = _make_req("viewer-dup-canonical")
            res = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_open", detail={"link": art_new["link"]})
            self.assertEqual(res["accepted"], 1)
            # Title is identical in both fixtures, so assert a differing field.
            # _resolve_shared_article must return the newest duplicate ("new summary").
            # Fails if the loader accidentally keeps the older duplicate.
            resolved = self.router_mod._resolve_shared_article(req, {"link": art_new["link"]})
            self.assertIsNotNone(resolved)
            self.assertEqual(resolved.get("summary"), "new summary")

    def test_forged_title_url_combination_rejected(self):
        art_real = self._article("Real Title", "https://example.test/real")
        with patch.object(self.router_mod, "_load_raw_engagement_pool", return_value=[art_real]):
            req, resp = _make_req("viewer-forged")
            # Forged: real title + different URL
            res = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_open", detail={"title": art_real["title"], "link": "https://evil.test/forged"})
            self.assertEqual(res["rejected"], 1)
            self.assertEqual(res["accepted"], 0)

    def test_removed_and_unauthorized_rejected(self):
        art_removed = self._article("Removed Article", "https://example.test/removed", {"removed": True})
        art_unauth = self._article("Unauthorized", "https://example.test/unauth", {"audiences": ["private"]})
        with patch.object(self.router_mod, "_load_raw_engagement_pool", return_value=[art_removed, art_unauth]):
            req, resp = _make_req("viewer-removed")
            res1 = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_open", detail={"title": art_removed["title"], "link": art_removed["link"]})
            res2 = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_open", detail={"title": art_unauth["title"], "link": art_unauth["link"]})
            self.assertEqual(res1["rejected"], 1)
            self.assertEqual(res2["rejected"], 1)

    def test_cache_invalidates_when_history_or_published_changes(self):
        art1 = self._article("Cache Test 1", "https://example.test/cache1")
        old_path = self._write_briefing("briefing_2026-09-01_08-00-00.json", [art1])
        self.router_mod._ENGAGEMENT_RAW_CACHE = None
        self.router_mod._ENGAGEMENT_RAW_SIGNATURE = None
        with patch.object(self.router_mod._legacy(), "get_profile_history_files", return_value=[old_path]), \
             patch.object(self.router_mod._legacy(), "filter_viewer_hidden", side_effect=lambda arts, req, prof: arts), \
             patch.object(self.router_mod._legacy(), "apply_learned_regions", side_effect=lambda arts, prof: arts):
            req, resp = _make_req("viewer-cache-1")
            res1 = self.router_mod.record_shared_briefing_event(req, resp, track_action="dossier_open", detail={"title": art1["title"]})
            self.assertEqual(res1["accepted"], 1)
            # Add a new retained file
            art2 = self._article("Cache Test 2", "https://example.test/cache2")
            new_path = self._write_briefing("briefing_2026-09-11_08-00-00.json", [art2])
            with patch.object(self.router_mod._legacy(), "get_profile_history_files", return_value=[old_path, new_path]):
                req2, resp2 = _make_req("viewer-cache-2")
                res2 = self.router_mod.record_shared_briefing_event(req2, resp2, track_action="dossier_open", detail={"title": art2["title"]})
                self.assertEqual(res2["accepted"], 1)
            # Published change: populate cache first (already done via res1/res2),
            # then publish a unique contribution WITHOUT clearing cache globals.
            # _engagement_pool_signature must detect the backing file change.
            # Fails if signature stops detecting published storage changes.
            with patch.object(internal_access, "CONTRIBUTIONS_ALLOWED_IPS", {"127.0.0.1"}):
                rec = internal_service.create_draft("viewer-cache-pub", {"title": "Cache Published Unique 2026-09-11", "summary": "unique-cache-summary-xyz", "body": "Body with enough length for validation and unique marker 987654321.", "category": "Technology", "content_type": "announcement"})
                internal_service.submit_draft("viewer-cache-pub", rec["id"])
                internal_service.publish_record(rec["id"])
            # Do NOT clear _ENGAGEMENT_RAW_CACHE / _ENGAGEMENT_RAW_SIGNATURE here.
            with patch.object(self.router_mod._legacy(), "get_profile_history_files", return_value=[old_path, new_path]), \
                 patch.object(self.router_mod._legacy(), "filter_viewer_hidden", side_effect=lambda arts, req, prof: arts), \
                 patch.object(self.router_mod._legacy(), "apply_learned_regions", side_effect=lambda arts, prof: arts):
                req3, resp3 = _make_req("viewer-cache-3")
                res3 = self.router_mod.record_shared_briefing_event(req3, resp3, track_action="source_open", detail={"title": "Cache Published Unique 2026-09-11", "id": rec["id"]})
                self.assertEqual(res3["accepted"], 1)
