import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from fastapi import Request, Response

from news_scrapper.recommendation.preferences import ViewerRepository
from news_scrapper.recommendation.schemas import ViewerPreferences


class SearchHistoryApiTests(unittest.TestCase):
    def _make_request(self, viewer_key="test-viewer-key"):
        req = MagicMock(spec=Request)
        req.state = MagicMock()
        req.state.private_viewer_key = viewer_key
        req.state.private_viewer_created = False
        req.state.private_viewer_token = "dummy.token"
        req.cookies = {}
        req.headers = {}
        req.client = MagicMock()
        req.client.host = "127.0.0.1"
        resp = MagicMock(spec=Response)
        return req, resp

    def test_toggling_remember_does_not_erase_preferences_via_real_endpoints(self):
        with tempfile.TemporaryDirectory() as td:
            viewers_dir = Path(td) / "viewers"
            viewers_dir.mkdir()
            import importlib
            router_mod = importlib.import_module("news_scrapper.recommendation.router")
            original_repo = router_mod.REPOSITORY
            test_repo = ViewerRepository(viewers_dir)
            router_mod.REPOSITORY = test_repo
            try:
                from news_scrapper.recommendation.router import update_preferences, read_preferences
                req, resp = self._make_request("viewer-api-preserve")
                # Set initial preferences with all fields via real endpoint
                init_payload = ViewerPreferences(
                    topics=["ai_models", "devices_displays"],
                    outcomes=["product_launches"],
                    source_families=["tech_press"],
                    regions=["global"],
                    surprise_me=False,
                    remember_search_history=True
                )
                result = update_preferences(init_payload, req, resp)
                prefs = result["preferences"]
                self.assertEqual(set(prefs["topics"]), {"ai_models", "devices_displays"})
                self.assertEqual(prefs["outcomes"], ["product_launches"])
                self.assertEqual(prefs["source_families"], ["tech_press"])
                self.assertEqual(prefs["regions"], ["global"])
                self.assertEqual(prefs["surprise_me"], False)
                self.assertEqual(prefs["remember_search_history"], True)

                # Toggle off via real endpoint with partial payload (only flag)
                off_payload = ViewerPreferences.model_validate({"remember_search_history": False}, strict=False)
                # Use exclude_unset to simulate partial: we construct via model with only that field
                # Instead, call repository directly via endpoint that uses exclude_unset
                # Simulate by creating payload with only that field set
                from pydantic import BaseModel
                # Create a minimal payload that will have only remember_search_history in model_dump(exclude_unset=True)
                off_payload = ViewerPreferences(remember_search_history=False)
                # Manually set __pydantic_fields_set__ to only contain that field
                off_payload.__pydantic_fields_set__ = {"remember_search_history"}
                result2 = update_preferences(off_payload, req, resp)
                prefs2 = result2["preferences"]
                self.assertEqual(set(prefs2["topics"]), {"ai_models", "devices_displays"})
                self.assertEqual(prefs2["outcomes"], ["product_launches"])
                self.assertEqual(prefs2["source_families"], ["tech_press"])
                self.assertEqual(prefs2["regions"], ["global"])
                self.assertEqual(prefs2["surprise_me"], False)
                self.assertEqual(prefs2["remember_search_history"], False)

                # Toggle back on
                on_payload = ViewerPreferences(remember_search_history=True)
                on_payload.__pydantic_fields_set__ = {"remember_search_history"}
                result3 = update_preferences(on_payload, req, resp)
                prefs3 = result3["preferences"]
                self.assertEqual(set(prefs3["topics"]), {"ai_models", "devices_displays"})
                self.assertEqual(prefs3["remember_search_history"], True)
            finally:
                router_mod.REPOSITORY = original_repo

    def test_purge_and_prevent_future_search_weights(self):
        with tempfile.TemporaryDirectory() as td:
            repo = ViewerRepository(Path(td) / "viewers")
            key = "viewer-purge-test"
            repo.update_preferences(key, {"topics": ["ai_models"], "remember_search_history": True})
            # record search
            repo.record_search_query(key, "AI broadcast test")
            state = repo.read(key)
            self.assertTrue(len(state["search_history"]) > 0)
            # add search event
            repo.append_events(key, [{"event_id": "e1", "action": "search_intent", "article_id": "a1", "occurred_at": "2026-09-12T00:00:00Z", "detail": {"query": "AI broadcast test", "topics": ["ai_models"]}}])
            self.assertTrue(any(e["action"] == "search_intent" for e in repo.read(key)["events"]))
            # turning off purges
            repo.update_preferences(key, {"remember_search_history": False})
            state2 = repo.read(key)
            self.assertEqual(len(state2["search_history"]), 0)
            self.assertFalse(any(e["action"] == "search_intent" for e in state2["events"]))
            # future search should not be recorded when off
            repo.record_search_query(key, "another query")
            self.assertEqual(len(repo.read(key)["search_history"]), 0)
            # future event should be rejected
            accepted, dup, rej = repo.append_events(key, [{"event_id": "e2", "action": "search", "article_id": "a2", "occurred_at": "2026-09-12T00:01:00Z", "detail": {"query": "another query", "topics": ["ai_models"]}}])
            self.assertEqual(accepted, 0)
            self.assertGreater(rej, 0)
            # turning on permits future
            repo.update_preferences(key, {"remember_search_history": True})
            repo.record_search_query(key, "final query")
            self.assertTrue(len(repo.read(key)["search_history"]) > 0)
            accepted2, _, _ = repo.append_events(key, [{"event_id": "e3", "action": "search_intent", "article_id": "a3", "occurred_at": "2026-09-12T00:02:00Z", "detail": {"query": "final query", "topics": ["ai_models"]}}])
            self.assertEqual(accepted2, 1)

    def test_partial_update_does_not_replace_omitted_fields_with_defaults(self):
        with tempfile.TemporaryDirectory() as td:
            repo = ViewerRepository(Path(td) / "viewers")
            key = "viewer-partial"
            repo.update_preferences(key, {"topics": ["ai_models"], "outcomes": ["research"], "source_families": ["primary"], "regions": ["local"], "surprise_me": False, "remember_search_history": False})
            # partial update only remember flag
            repo.update_preferences(key, {"remember_search_history": True})
            prefs = repo.read(key)["preferences"]
            self.assertEqual(prefs["topics"], ["ai_models"])
            self.assertEqual(prefs["outcomes"], ["research"])
            self.assertEqual(prefs["source_families"], ["primary"])
            self.assertEqual(prefs["regions"], ["local"])
            self.assertEqual(prefs["surprise_me"], False)
            self.assertEqual(prefs["remember_search_history"], True)

    def test_archive_endpoint_records_search_intent_only_when_remember_enabled(self):
        import json, os
        import news_scrapper.application as app
        from news_scrapper.recommendation.router import REPOSITORY as prod_repo
        from pathlib import Path
        with tempfile.TemporaryDirectory() as td:
            viewers_dir = Path(td) / "viewers"
            viewers_dir.mkdir()
            archive_file = os.path.join(td, "briefing_2026-07-23_08-00-00.json")
            with open(archive_file, "w", encoding="utf-8") as f:
                json.dump([{"title": "Samsung OLED breakthrough", "date": "2026-07-23", "master_summary": "Samsung OLED", "keywords_found": ["Samsung"], "source": "Tech", "link": "https://example.test/samsung", "source_count": 1}], f)
            # patch REPOSITORY to use temp viewers dir and also patch application's REPOSITORY reference
            from news_scrapper.recommendation.preferences import ViewerRepository
            test_repo = ViewerRepository(viewers_dir)
            import importlib as _il
            router_mod = _il.import_module("news_scrapper.recommendation.router")
            import news_scrapper.application as app_mod
            orig_router_repo = router_mod.REPOSITORY
            # need to also patch the REPOSITORY used inside search_archive (imported locally)
            # search_archive does `from news_scrapper.recommendation.router import REPOSITORY` inside function, so patching router_mod.REPOSITORY is enough
            router_mod.REPOSITORY = test_repo
            try:
                viewer_key = "viewer-archive-test"
                # Enable remember and search
                test_repo.update_preferences(viewer_key, {"remember_search_history": True})
                req = self._make_request(viewer_key)[0]
                req.state.private_viewer_key = viewer_key
                # ensure get_private_viewer_key returns viewer_key
                with patch.object(app_mod, "get_profile_history_files", return_value=[archive_file]), \
                     patch.object(app_mod, "filter_viewer_hidden", side_effect=lambda items, *a, **kw: items), \
                     patch.object(app_mod, "get_private_viewer_key", return_value=viewer_key):
                    result = app_mod.search_archive(req, query="Samsung", from_date=None, to_date=None, target_sites=None, limit=10)
                    self.assertEqual(result["status"], "success")
                    state = test_repo.read(viewer_key)
                    self.assertTrue(len(state["search_history"]) > 0, "search history should be recorded when remember enabled")
                    self.assertTrue(any(e["action"] == "search_intent" for e in state["events"]), "search_intent should be recorded when remember enabled")
                # Now disable remember and search again with a different query
                test_repo.update_preferences(viewer_key, {"remember_search_history": False})
                # clear history to check not re-added
                self.assertEqual(len(test_repo.read(viewer_key)["search_history"]), 0)
                with patch.object(app_mod, "get_profile_history_files", return_value=[archive_file]), \
                     patch.object(app_mod, "filter_viewer_hidden", side_effect=lambda items, *a, **kw: items), \
                     patch.object(app_mod, "get_private_viewer_key", return_value=viewer_key):
                    result2 = app_mod.search_archive(req, query="OLED", from_date=None, to_date=None, target_sites=None, limit=10)
                    self.assertEqual(result2["status"], "success")
                    state2 = test_repo.read(viewer_key)
                    self.assertEqual(len(state2["search_history"]), 0, "search history must NOT be recorded when remember disabled")
                    # search_intent from second query should not be added; only previous events maybe remain but not new
                    # After disabling, existing search_intent events are purged, so no search_intent should remain
                    self.assertFalse(any(e.get("detail", {}).get("query", "").casefold() == "oled" for e in state2["events"]))
            finally:
                router_mod.REPOSITORY = orig_router_repo
