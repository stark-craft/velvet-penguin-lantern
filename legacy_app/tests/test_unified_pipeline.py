import json
import importlib
import inspect
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import Response
from starlette.requests import Request

from core.settings import migrate_unified_news_state
from news_scrapper import application
from news_scrapper import train_bouncer
from news_scrapper.recommendation.preferences import ViewerRepository
from news_scrapper.recommendation.scoring import score_candidates
from news_scrapper.source_catalog import build_unified_catalog, canonical_url, load_sites


recommendation_router = importlib.import_module("news_scrapper.recommendation.router")


def request_for(path="/track"):
    return Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("latin1"),
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
    )


def story(identifier, title, *, vertical="technology", score=60):
    return {
        "id": identifier,
        "title": title,
        "link": f"https://example.test/{identifier}",
        "date": "2026-08-15T08:00:00+00:00",
        "importance_score": score,
        "source": "Example",
        "source_count": 1,
        "vertical": vertical,
        "verticals": [vertical],
        "audiences": ["all"],
    }


class UnifiedSourceTests(unittest.TestCase):
    def test_primary_sites_file_contains_both_inventories_once(self):
        primary = Path("news_scrapper/config/sites.json")
        rollback = Path("news_scrapper/config/sites_broadcast.json")
        sites = load_sites(primary)
        entrypoints = [canonical_url(site.get("rss_url") or site.get("url")) for site in sites]
        self.assertEqual(len(sites), 167)
        self.assertEqual(len(entrypoints), len(set(entrypoints)))
        self.assertEqual(sum("broadcast" in (site.get("verticals") or []) for site in sites), 59)
        rollback_entrypoints = {
            canonical_url(site.get("rss_url") or site.get("url"))
            for site in load_sites(rollback)
        }
        self.assertTrue(rollback_entrypoints.issubset(set(entrypoints)))

        _, report = build_unified_catalog(primary, rollback)
        self.assertEqual(report["records"], 167)
        self.assertEqual(report["duplicate_records_removed"], 59)
        self.assertFalse(report["duplicate_entrypoints"])

    def test_sources_api_writes_only_unified_catalog_with_vertical_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            sites_path = Path(directory) / "sites.json"
            sites_path.write_text("[]", encoding="utf-8")
            with patch.object(application, "DEFAULT_SITES_FILE", str(sites_path)), patch.object(
                application, "UNIFIED_CORPUS_ENABLED", True
            ):
                result = application.add_site(
                    {
                        "name": "Broadcast Test",
                        "url": "https://broadcast.example.test/news",
                        "verticals": ["broadcast"],
                        "enabled": True,
                    },
                    request_for("/sites"),
                )
                source_id = result["source"]["id"]
                toggled = application.update_site(
                    source_id,
                    request_for("/sites"),
                    {"enabled": False},
                )
                stored = load_sites(sites_path)
                removed = application.delete_site(source_id, request_for("/sites"))
            self.assertEqual(result["profile"], "unified")
            self.assertEqual(stored[0]["verticals"], ["broadcast"])
            self.assertEqual(stored[0]["legacy_profile"], "broadcast")
            self.assertEqual(stored[0]["audiences"], ["all"])
            self.assertFalse(toggled["source"]["enabled"])
            self.assertEqual(removed["count"], 0)


class UnifiedSchedulerAndBouncerTests(unittest.TestCase):
    def test_environment_and_lifespan_register_unified_mode_once(self):
        env_values = {}
        for line in Path(".env.example").read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                env_values[key.strip()] = value.strip()
        self.assertEqual(env_values["UNIFIED_CORPUS_ENABLED"], "true")
        self.assertEqual(env_values["LEGACY_PROFILE_ROUTING_ENABLED"], "false")
        lifespan_source = inspect.getsource(application.lifespan)
        self.assertEqual(lifespan_source.count("scheduler.add_job("), 1)
        self.assertIn('id="unified_briefing"', lifespan_source)
        self.assertIn("coalesce=True", lifespan_source)

    def test_one_scheduler_cycle_invokes_one_unified_scan(self):
        original_status = dict(application.SCHEDULER_STATUS)
        original_jobs = dict(application.active_jobs)
        original_pending = application.scheduler_pending_run
        application.SCHEDULER_STATUS.update({"is_active": False, "mode": "idle"})
        application.active_jobs.clear()
        application.scheduler_pending_run = False
        capabilities = {
            "mode": "local_scrapy_bart",
            "web_search": False,
            "chat": False,
            "discovery_only": False,
        }
        try:
            with patch.object(application, "UNIFIED_CORPUS_ENABLED", True), patch.object(
                application, "ensure_profile_storage"
            ), patch.object(
                application, "resolve_pipeline_capabilities", return_value=capabilities
            ), patch.object(
                application, "run_scheduler_for_profile", return_value=True
            ) as scan, patch.object(
                application, "update_durable_scheduler_state"
            ), patch.object(application, "_schedule_scheduler_retry"):
                application.run_morning_briefing()
            scan.assert_called_once_with(application.UNIFIED_PROFILE, capabilities)
            self.assertEqual(application.SCHEDULER_STATUS["last_profiles"], ["unified"])
        finally:
            application.SCHEDULER_STATUS.clear()
            application.SCHEDULER_STATUS.update(original_status)
            application.active_jobs.clear()
            application.active_jobs.update(original_jobs)
            application.scheduler_pending_run = original_pending

    def test_loaded_and_trained_bouncer_paths_are_identical(self):
        with patch.object(application, "UNIFIED_CORPUS_ENABLED", True):
            self.assertEqual(
                application.get_sites_file_for_profile("default"),
                application.get_sites_file_for_profile("broadcast"),
            )
            self.assertEqual(
                application.get_training_file_for_profile("default"),
                application.get_training_file_for_profile("broadcast"),
            )
            self.assertEqual(
                application.get_bouncer_model_file_for_profile("default"),
                application.get_bouncer_model_file_for_profile("broadcast"),
            )
        self.assertEqual(
            train_bouncer.PROFILE_CONFIGS["default"]["training_file"],
            train_bouncer.PROFILE_CONFIGS["broadcast"]["training_file"],
        )
        self.assertEqual(
            train_bouncer.PROFILE_CONFIGS["default"]["model_file"],
            train_bouncer.PROFILE_CONFIGS["broadcast"]["model_file"],
        )

    def test_state_migration_is_idempotent_and_preserves_rollback_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            primary = [{"title": "AI", "summary": "one", "label": "interested"}]
            rollback = [{"title": "Broadcast", "summary": "two", "label": "not_interested"}]
            (root / "trainingData.json").write_text(json.dumps(primary), encoding="utf-8")
            rollback_path = root / "trainingData_broadcast.json"
            rollback_path.write_text(json.dumps(rollback), encoding="utf-8")
            first = migrate_unified_news_state(root)
            second = migrate_unified_news_state(root)
            merged = json.loads((root / "trainingData.json").read_text(encoding="utf-8"))
            self.assertTrue(first["training_changed"])
            self.assertFalse(second["training_changed"])
            self.assertEqual(len(merged), 2)
            self.assertEqual(json.loads(rollback_path.read_text(encoding="utf-8")), rollback)
            self.assertEqual(first["authoritative_model"], str(root / "bouncer_model.pkl"))


class SharedBriefingPersonalizationTests(unittest.TestCase):
    def test_validated_shared_event_changes_later_related_ranking(self):
        old_hardware = story("hardware-read", "Nvidia unveils a new GPU processor platform")
        new_hardware = story("hardware-next", "A new GPU processor architecture reaches production")
        ai_story = story("ai", "OpenAI launches a new AI agent model", score=70)
        with tempfile.TemporaryDirectory() as directory:
            repository = ViewerRepository(Path(directory))
            response = Response()
            request = request_for()
            with patch.object(recommendation_router, "REPOSITORY", repository), patch.object(
                recommendation_router,
                "_profile_and_articles",
                return_value=("unified", [old_hardware, new_hardware, ai_story]),
            ):
                viewer_key, _ = recommendation_router.resolve_viewer(request, response)
                repository.update_preferences(
                    viewer_key,
                    {
                        "topics": ["ai_models"],
                        "outcomes": [],
                        "source_families": [],
                        "regions": ["balanced"],
                        "surprise_me": True,
                    },
                    complete=True,
                )
                before, _ = score_candidates(
                    [new_hardware, ai_story], repository.read(viewer_key), []
                )
                before_score = next(
                    item["recommendation"]["score"]
                    for item in before
                    if item["title"] == new_hardware["title"]
                )

                ignored = recommendation_router.record_shared_briefing_event(
                    request,
                    response,
                    track_action="dossier_dwell",
                    detail=old_hardware,
                    event_id="shared-dwell-short",
                    active_ms=2_000,
                )
                accepted = recommendation_router.record_shared_briefing_event(
                    request,
                    response,
                    track_action="dossier_open",
                    detail=old_hardware,
                    event_id="shared-open-0001",
                )
                dwell = recommendation_router.record_shared_briefing_event(
                    request,
                    response,
                    track_action="dossier_dwell",
                    detail=old_hardware,
                    event_id="shared-dwell-15000",
                    active_ms=15_000,
                )
                duplicate = recommendation_router.record_shared_briefing_event(
                    request,
                    response,
                    track_action="dossier_open",
                    detail=old_hardware,
                    event_id="shared-open-0001",
                )

                after, _ = score_candidates(
                    [new_hardware, ai_story], repository.read(viewer_key), []
                )
                after_score = next(
                    item["recommendation"]["score"]
                    for item in after
                    if item["title"] == new_hardware["title"]
                )
                state = repository.read(viewer_key)

            self.assertTrue(ignored["ignored"])
            self.assertEqual(accepted["accepted"], 1)
            self.assertEqual(dwell["accepted"], 1)
            self.assertEqual(duplicate["duplicates"], 1)
            self.assertGreater(after_score, before_score)
            self.assertIn("semiconductors", state["events"][0]["detail"]["topics"])

    def test_track_endpoint_bridges_supported_shared_action(self):
        request = request_for()
        response = Response()
        detail = story("hardware-read", "Nvidia unveils a GPU processor")
        with patch.object(application, "record_usage_activity", return_value=True), patch.object(
            application,
            "record_recommendation_best_effort",
            return_value={"accepted": 1, "duplicates": 0, "rejected": 0},
        ) as bridge:
            result = application.track_activity(
                request,
                response,
                {
                    "fingerprint": "browser",
                    "action": "source_open",
                    "detail": json.dumps(detail),
                    "recommendation_event_id": "shared-source-0001",
                },
            )
        self.assertTrue(result["tracked"])
        self.assertEqual(result["recommendation"]["accepted"], 1)
        self.assertEqual(bridge.call_args.args[2], "source_open")
        self.assertEqual(bridge.call_args.args[3]["link"], detail["link"])


if __name__ == "__main__":
    unittest.main()
