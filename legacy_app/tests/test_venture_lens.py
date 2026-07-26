import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.storage import JsonStore
from venture_lens.intelligence import VentureIntelligenceService
from venture_lens.service import VentureLensService


class VentureLensTests(unittest.TestCase):
    def service_for(self, directory):
        service = VentureLensService()
        service.github_store = JsonStore(Path(directory) / "github.json", dict)
        service.research_store = JsonStore(Path(directory) / "research.json", dict)
        return service

    def test_starter_snapshot_is_available_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            service = self.service_for(directory)
            self.assertEqual(service.github()["status"], "starter")
            self.assertGreater(len(service.github()["items"]), 0)
            self.assertEqual(service.research()["status"], "starter")
            self.assertGreater(len(service.research()["items"]), 0)

    def test_successful_refresh_is_cached_atomically(self):
        repository = {
            "id": "example/repository",
            "name": "repository",
            "category": "ai-agents",
        }
        with tempfile.TemporaryDirectory() as directory:
            service = self.service_for(directory)
            with patch.object(
                service,
                "_fetch_catalog",
                return_value=([repository], []),
            ):
                refreshed = service.refresh_github(force=True)
            self.assertEqual(refreshed["status"], "live")
            self.assertEqual(service.github()["items"][0]["id"], repository["id"])

    def test_provider_failure_preserves_last_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            service = self.service_for(directory)
            original = service.github()
            with patch.object(
                service,
                "_fetch_catalog",
                return_value=([], ["provider unavailable"]),
            ):
                refreshed = service.refresh_github(force=True)
            self.assertTrue(refreshed["refresh_failed"])
            self.assertEqual(refreshed["items"], original["items"])

    def test_intelligence_workspace_builds_all_decision_views(self):
        with tempfile.TemporaryDirectory() as directory:
            service = self.service_for(directory)
            intelligence = VentureIntelligenceService(service)
            intelligence.watchlist_store = JsonStore(Path(directory) / "watchlist.json", dict)
            intelligence.notification_store = JsonStore(Path(directory) / "notifications.json", dict)

            radar = intelligence.radar()
            self.assertGreaterEqual(len(radar), 6)
            self.assertTrue(all(0 < item["score"] <= 100 for item in radar))

            technology = intelligence.technology_dossier(radar[0]["id"])
            self.assertEqual(technology["kind"], "technology")
            self.assertIn("recommendation", technology)

            repository_items = service.github()["items"]
            repository = repository_items[0]
            repository_dossier = intelligence.repository_dossier(repository["id"])
            self.assertEqual(repository_dossier["kind"], "repository")
            self.assertIn("metrics", repository_dossier)

            paper = service.research()["items"][0]
            paper_dossier = intelligence.paper_dossier(paper["id"])
            self.assertEqual(paper_dossier["kind"], "paper")
            self.assertIn("related_repositories", paper_dossier)

            comparison = intelligence.compare([
                {"kind": "repository", "id": repository["id"]},
                {"kind": "repository", "id": repository_items[1]["id"]},
            ])
            self.assertEqual(comparison["count"], 2)
            self.assertEqual(comparison["kind"], "repository")
            self.assertEqual(comparison["metrics"][0]["id"], "stars")
            with self.assertRaisesRegex(ValueError, "same type"):
                intelligence.compare([
                    {"kind": "repository", "id": repository["id"]},
                    {"kind": "paper", "id": paper["id"]},
                ])
            self.assertGreater(len(intelligence.graph()["edges"]), 0)
            self.assertGreaterEqual(len(intelligence.briefs()), 4)

    def test_watchlist_and_notifications_are_viewer_specific(self):
        with tempfile.TemporaryDirectory() as directory:
            service = self.service_for(directory)
            intelligence = VentureIntelligenceService(service)
            intelligence.watchlist_store = JsonStore(Path(directory) / "watchlist.json", dict)
            intelligence.notification_store = JsonStore(Path(directory) / "notifications.json", dict)
            repository = service.github()["items"][0]
            reference = {
                "kind": "repository",
                "id": repository["id"],
                "label": repository["full_name"],
            }

            saved = intelligence.toggle_watchlist("viewer-a", reference)
            self.assertTrue(saved["saved"])
            self.assertEqual(len(intelligence.watchlist("viewer-a")), 1)
            self.assertEqual(intelligence.watchlist("viewer-b"), [])
            self.assertFalse(intelligence.notifications("viewer-a")[0]["read"])
            self.assertTrue(intelligence.mark_notifications_read("viewer-a")[0]["read"])

            removed = intelligence.toggle_watchlist("viewer-a", reference)
            self.assertFalse(removed["saved"])
            self.assertEqual(intelligence.watchlist("viewer-a"), [])


if __name__ == "__main__":
    unittest.main()
