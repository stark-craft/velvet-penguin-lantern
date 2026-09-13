import tempfile
import hashlib
import os
from pathlib import Path
from unittest.mock import patch, MagicMock
import unittest

from core.storage import JsonStore
from venture_lens.intelligence import VentureIntelligenceService
from venture_lens.service import VentureLensService
from news_scrapper.recommendation.preferences import ViewerRepository
from news_scrapper import application as app

class VentureViewerIdentityTests(unittest.TestCase):
    def test_same_ip_isolation(self):
        with tempfile.TemporaryDirectory() as d:
            svc = VentureLensService()
            svc.github_store = JsonStore(Path(d)/"g.json", dict)
            svc.research_store = JsonStore(Path(d)/"r.json", dict)
            intel = VentureIntelligenceService(svc)
            intel.watchlist_store = JsonStore(Path(d)/"w.json", dict)
            intel.notification_store = JsonStore(Path(d)/"n.json", dict)
            ref = {"kind":"repository","id":"test/repo","label":"test/repo"}
            intel.toggle_watchlist("browser-a-key", ref)
            self.assertEqual(len(intel.watchlist("browser-a-key")),1)
            self.assertEqual(len(intel.watchlist("browser-b-key")),0)

    def test_ip_roaming_retains_data(self):
        with tempfile.TemporaryDirectory() as d:
            svc = VentureLensService()
            svc.github_store = JsonStore(Path(d)/"g.json", dict)
            svc.research_store = JsonStore(Path(d)/"r.json", dict)
            intel = VentureIntelligenceService(svc)
            intel.watchlist_store = JsonStore(Path(d)/"w.json", dict)
            intel.notification_store = JsonStore(Path(d)/"n.json", dict)
            ref = {"kind":"paper","id":"paper1","label":"paper1"}
            intel.toggle_watchlist("same-viewer-key", ref)
            # same key different IP should still have data (key is viewer, not IP)
            self.assertEqual(len(intel.watchlist("same-viewer-key")),1)

    def test_legacy_migration_one_time(self):
        with tempfile.TemporaryDirectory() as d:
            claim_store = JsonStore(Path(d)/"claims.json", dict)
            watch_store = JsonStore(Path(d)/"w.json", dict)
            # legacy bucket
            legacy_key = hashlib.sha256(b"secret:1.2.3.4").hexdigest()
            watch_store.write({legacy_key: [{"key":"technology:ai","kind":"technology","id":"ai","label":"AI"}]})
            # simulate first browser claiming
            private_a = "private-a"
            private_b = "private-b"
            # first claim should move
            claims = {}
            claims[legacy_key]=private_a
            claim_store.write(claims)
            data = watch_store.read()
            if legacy_key in data and private_a not in data:
                data[private_a]=data.pop(legacy_key)
                watch_store.write(data)
            self.assertIn(private_a, watch_store.read())
            self.assertNotIn(private_b, watch_store.read())
            # second browser cannot claim same legacy
            self.assertEqual(claim_store.read()[legacy_key], private_a)

    def test_concurrent_first_access_two_browsers_one_ip_via_production_router(self):
        import threading
        from unittest.mock import MagicMock
        from venture_lens import router as vl_router
        with tempfile.TemporaryDirectory() as d:
            # isolate production router's stores
            claim_store = JsonStore(Path(d)/"claims.json", dict)
            watch_store = JsonStore(Path(d)/"w.json", dict)
            notif_store = JsonStore(Path(d)/"n.json", dict)
            legacy_key = hashlib.sha256(b"secret:10.0.0.99").hexdigest()
            watch_store.write({legacy_key: [{"key":"technology:ai","kind":"technology","id":"ai","label":"AI"}]})
            notif_store.write({legacy_key: [{"id": "n1", "kind": "repository", "label": "test"}]})
            with patch.object(vl_router, "VENTURE_VIEWER_CLAIMS", claim_store), \
                 patch.object(vl_router.venture_intelligence, "watchlist_store", watch_store), \
                 patch.object(vl_router.venture_intelligence, "notification_store", notif_store), \
                 patch.object(vl_router, "_legacy_ip_key", return_value=legacy_key):
                def make_req(private_key, created):
                    req = MagicMock()
                    req.state = MagicMock()
                    req.state.private_viewer_key = private_key
                    req.state.private_viewer_created = created
                    req.client = MagicMock()
                    req.client.host = "10.0.0.99"
                    req.headers = {}
                    return req
                private_a = "private-browser-a-" + hashlib.sha256(b"a").hexdigest()[:12]
                private_b = "private-browser-b-" + hashlib.sha256(b"b").hexdigest()[:12]
                req_a = make_req(private_a, True)
                req_b = make_req(private_b, True)
                # concurrent first access: both browsers at same IP hit production router simultaneously
                barrier = threading.Barrier(2)
                def run_migrate(req, key):
                    barrier.wait()
                    vl_router._migrate_legacy_venture_viewer(req, key)
                t1 = threading.Thread(target=run_migrate, args=(req_a, private_a))
                t2 = threading.Thread(target=run_migrate, args=(req_b, private_b))
                t1.start(); t2.start()
                t1.join(); t2.join()
                claims = claim_store.read()
                # exactly one owner must have claimed
                self.assertIn(legacy_key, claims)
                owner = claims[legacy_key]
                self.assertIn(owner, [private_a, private_b])
                watch_data = watch_store.read()
                notif_data = notif_store.read()
                # atomic: both buckets must have moved together to the same owner, no partial
                if owner == private_a:
                    self.assertIn(private_a, watch_data)
                    self.assertIn(private_a, notif_data)
                    self.assertNotIn(private_b, watch_data)
                    self.assertNotIn(private_b, notif_data)
                else:
                    self.assertIn(private_b, watch_data)
                    self.assertIn(private_b, notif_data)
                    self.assertNotIn(private_a, watch_data)
                    self.assertNotIn(private_a, notif_data)
                self.assertNotIn(legacy_key, watch_data)
                self.assertNotIn(legacy_key, notif_data)
                # second access via same IP with same private keys should not re-migrate
                vl_router._migrate_legacy_venture_viewer(req_a if owner==private_a else req_b, owner)
                self.assertEqual(claim_store.read()[legacy_key], owner)

class ArchiveCacheTests(unittest.TestCase):
    def test_unchanged_not_reparsed(self):
        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, "briefing_2026-07-23_08-00-00.json")
            import json
            json.dump([{"title":"Test","date":"2026-07-23","link":"https://example.com/a"}], open(p,"w"))
            with patch.object(app, "get_profile_history_files", return_value=[p]):
                r1 = app.search_extracted_intelligence("default","Test",None,None,None,limit=10)
                hits_before = app._archive_search_cache_hits
                r2 = app.search_extracted_intelligence("default","Test",None,None,None,limit=10)
                self.assertGreaterEqual(app._archive_search_cache_hits, hits_before+1)

    def test_modified_invalidates(self):
        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, "briefing_2026-07-23_08-00-00.json")
            import json, time
            json.dump([{"title":"Alpha","date":"2026-07-23","link":"https://example.com/a"}], open(p,"w"))
            with patch.object(app, "get_profile_history_files", return_value=[p]):
                app.search_extracted_intelligence("default","Alpha",None,None,None,limit=10)
                time.sleep(0.02)
                json.dump([{"title":"Beta","date":"2026-07-23","link":"https://example.com/b"}], open(p,"w"))
                os.utime(p, None)
                r = app.search_extracted_intelligence("default","Beta",None,None,None,limit=10)
                self.assertEqual(r["results"][0]["title"],"Beta")

class SearchPreferenceTests(unittest.TestCase):
    def test_remember_persistence_and_purge(self):
        with tempfile.TemporaryDirectory() as td:
            repo = ViewerRepository(Path(td)/"viewers")
            key="viewer1"
            repo.update_preferences(key, {"remember_search_history": True})
            self.assertTrue(repo.read(key)["preferences"]["remember_search_history"])
            # add search event
            repo.append_events(key, [{"event_id":"s1","action":"search_intent","article_id":"a1","occurred_at":"2026-09-01T00:00:00Z","detail":{"query":"AI","topics":["ai_models"]}}])
            self.assertTrue(any(e["action"]=="search_intent" for e in repo.read(key)["events"]))
            # turning off purges
            repo.update_preferences(key, {"remember_search_history": False})
            self.assertFalse(repo.read(key)["preferences"]["remember_search_history"])
            self.assertFalse(any(e["action"]=="search_intent" for e in repo.read(key)["events"]))
            # turning back on does not resurrect
            repo.update_preferences(key, {"remember_search_history": True})
            self.assertFalse(any(e["action"]=="search_intent" for e in repo.read(key)["events"]))

if __name__=="__main__":
    unittest.main()
