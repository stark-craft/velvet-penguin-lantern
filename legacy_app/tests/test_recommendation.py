import datetime as dt
import json
import tempfile
import unittest
import importlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi import Request, Response

from news_scrapper.recommendation.candidates import article_id as candidate_article_id, collect_candidates
from news_scrapper.recommendation.diversity import diversify
from news_scrapper.recommendation.events import aggregate_quality_metrics
from news_scrapper.recommendation.hooks import ensure_article_hooks, validate_hook
from news_scrapper.recommendation.identity import issue_token, resolve_viewer, valid_token, viewer_key
from news_scrapper.recommendation.preferences import ViewerRepository, sanitize_preferences
from news_scrapper.recommendation.reactions import ReactionRepository
from news_scrapper.recommendation.following import build_following_threads
from news_scrapper.recommendation.scoring import score_candidates
from news_scrapper.recommendation.service import RecommendationService, allocate_exclusive_sections
from news_scrapper.source_catalog import build_shadow_briefing, build_unified_catalog

recommendation_router = importlib.import_module("news_scrapper.recommendation.router")


def article(index, **changes):
    value = {
        "title": f"AI model signal {index}",
        "link": f"https://publisher{index % 3}.example/story/{index}",
        "source": f"Publisher {index % 3}",
        "cluster_id": f"cluster-{index}",
        "date": "2026-08-15",
        "signal_score": 70 - index,
        "source_count": 2,
        "summary": "A new artificial intelligence model was released with verified benchmark details for enterprise teams today.",
        "audiences": ["all"],
    }
    value.update(changes)
    return value


class RecommendationTests(unittest.TestCase):
    def test_reactions_are_one_reversible_vote_per_viewer(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ReactionRepository(Path(directory) / "reactions.json")
            target = article(1, article_id="article-one", keywords_found="AI agents")
            first = repository.set("viewer-a", target, "like")
            self.assertEqual((first["like_count"], first["dislike_count"]), (1, 0))
            repeated = repository.set("viewer-a", target, "like")
            self.assertEqual((repeated["like_count"], repeated["dislike_count"]), (1, 0))
            changed = repository.set("viewer-a", target, "dislike")
            self.assertEqual((changed["like_count"], changed["dislike_count"]), (0, 1))
            repository.set("viewer-b", target, "like")
            snapshot = repository.snapshots("viewer-b", ["article-one"])["article-one"]
            self.assertEqual((snapshot["like_count"], snapshot["dislike_count"]), (1, 1))
            self.assertEqual(snapshot["viewer_reaction"], "like")
            neutral = repository.set("viewer-a", target, "neutral")
            self.assertEqual((neutral["like_count"], neutral["dislike_count"]), (1, 0))

    def test_reaction_queries_resolve_shared_article_references_to_global_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ReactionRepository(Path(directory) / "reactions.json")
            target = article(9)
            canonical = candidate_article_id(target)
            repository.set("viewer-a", {**target, "article_id": canonical}, "like")
            repository.set("viewer-b", {**target, "article_id": canonical}, "dislike")
            with patch.object(recommendation_router, "REACTIONS", repository):
                snapshots = recommendation_router._reaction_snapshots("viewer-a", [target["link"]])
            self.assertEqual(snapshots[target["link"]]["like_count"], 1)
            self.assertEqual(snapshots[target["link"]]["dislike_count"], 1)
            self.assertEqual(snapshots[target["link"]]["viewer_reaction"], "like")
            self.assertEqual(snapshots[canonical], snapshots[target["link"]])

    def test_reaction_consensus_is_thresholded_and_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ReactionRepository(Path(directory) / "reactions.json")
            target = article(2, article_id="article-two")
            for index in range(4):
                repository.set(f"viewer-{index}", target, "dislike")
            repository.set("viewer-4", target, "like")
            candidates = repository.consensus_candidates(5, 0.70)
            self.assertEqual(len(candidates), 1)
            self.assertEqual(candidates[0]["label"], "not_interested")
            self.assertEqual(candidates[0]["ratio"], 0.8)
            repository.mark_processed("article-two", candidates[0]["fingerprint"])
            self.assertEqual(repository.consensus_candidates(5, 0.70), [])
            repository.set("viewer-5", target, "like")
            self.assertEqual(repository.consensus_candidates(5, 0.70), [])

    def test_reaction_state_updates_private_affinity_without_append_only_votes(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ViewerRepository(Path(directory))
            detail = {"topics": ["ai_models"], "outcomes": [], "source_family": "tech_press"}
            repository.set_reaction("viewer-a", "article-one", "like", detail)
            state = repository.read("viewer-a")
            self.assertEqual(state["events"], [])
            self.assertEqual(state["reaction_events"]["article-one"]["reaction"], "like")
            repository.set_reaction("viewer-a", "article-one", "dislike", detail)
            self.assertEqual(repository.read("viewer-a")["reaction_events"]["article-one"]["reaction"], "dislike")
            repository.set_reaction("viewer-a", "article-one", "neutral", detail)
            self.assertNotIn("article-one", repository.read("viewer-a")["reaction_events"])

    def test_following_threads_require_semantic_closeness_and_deduplicate_anchors(self):
        anchor = article(1, article_id="anchor", title="Nvidia launches a new inference GPU", date="2026-08-23")
        older_close = article(2, article_id="older-close", title="Nvidia GPU deployment benchmarks begin", date="2026-08-24")
        newer_close = article(4, article_id="newer-close", title="Nvidia GPU deployment benchmarks arrive", date="2026-08-25")
        unrelated = article(3, article_id="far", title="Nvidia sponsors a football event", date="2026-08-25")
        def similarity(_left, right):
            return 0.82 if "deployment benchmarks" in right else 0.12
        with patch("news_scrapper.recommendation.following.semantic_similarity", side_effect=similarity):
            threads = build_following_threads([anchor, dict(anchor)], [anchor, older_close, newer_close, unrelated])
        self.assertEqual(len(threads), 1)
        self.assertEqual(
            [value["title"] for value in threads[0]["updates"]],
            ["Nvidia GPU deployment benchmarks arrive", "Nvidia GPU deployment benchmarks begin"],
        )
        self.assertEqual(threads[0]["updates"][0]["follow_match"]["method"], "semantic")

    def test_signed_identity_is_stable_and_tamper_evident(self):
        first = issue_token()
        second = issue_token()
        self.assertEqual(valid_token(first), first)
        self.assertNotEqual(viewer_key(first), viewer_key(second))
        self.assertIsNone(valid_token(first + "tampered"))

    def test_cookie_secure_auto_supports_http_lan_and_https(self):
        def request(scheme):
            return Request({
                "type": "http", "method": "GET", "path": "/", "headers": [],
                "scheme": scheme, "server": ("testserver", 80),
                "client": ("127.0.0.1", 5000), "query_string": b"",
            })
        with patch.dict("os.environ", {"NEWSSCRAPPER_VIEWER_COOKIE_SECURE": "auto"}):
            http_response = Response()
            resolve_viewer(request("http"), http_response)
            self.assertNotIn("Secure", http_response.headers["set-cookie"])
            https_response = Response()
            resolve_viewer(request("https"), https_response)
            self.assertIn("Secure", https_response.headers["set-cookie"])

    def test_preferences_filter_unknown_taxonomy_and_keep_region_default(self):
        value = sanitize_preferences({
            "topics": ["ai_models", "unknown", "ai_models"],
            "outcomes": ["research"],
            "source_families": ["primary"],
            "regions": [],
        })
        self.assertEqual(value["topics"], ["ai_models"])
        self.assertEqual(value["regions"], ["balanced"])

    def test_events_are_idempotent_and_private(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ViewerRepository(Path(directory))
            event = {
                "event_id": "event-0001",
                "action": "save",
                "article_id": "article-a",
                "occurred_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "viewer_id": "must-not-persist",
            }
            repository.mark_served("viewer-a", ["article-a"], "feed-a")
            self.assertEqual(repository.append_events("viewer-a", [event]), (1, 0, 0))
            self.assertEqual(repository.append_events("viewer-a", [event]), (0, 1, 0))
            stored = repository.read("viewer-a")["events"][0]
            self.assertNotIn("viewer_id", stored)
            self.assertEqual(repository.read("viewer-b")["events"], [])

    def test_concurrent_event_batches_do_not_lose_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ViewerRepository(Path(directory))
            article_ids = [f"article-{index}" for index in range(100)]
            repository.mark_served("viewer-a", article_ids, "feed-a")
            def write(index):
                return repository.append_events("viewer-a", [{
                    "event_id": f"event-{index:04d}",
                    "action": "dossier_open",
                    "article_id": f"article-{index}",
                    "occurred_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                }])
            with ThreadPoolExecutor(max_workers=10) as executor:
                list(executor.map(write, range(100)))
            self.assertEqual(len(repository.read("viewer-a")["events"]), 100)

    def test_grounded_hook_contract_and_local_fallback(self):
        source = article(1, why_it_matters=(
            "Samsung introduced a verified enterprise AI model update today. "
            "The release changes deployment choices for product teams evaluating private inference infrastructure this quarter."
        ))
        result = ensure_article_hooks(source)
        self.assertGreaterEqual(len(result["attention_hook"].split()), 18)
        self.assertLessEqual(len(result["attention_hook"].split()), 35)
        self.assertTrue(result["hook_grounded"])
        self.assertEqual(result["hook_source"], "local_fallback")
        self.assertEqual(validate_hook("Shocking game-changing result users must read immediately today right now without any supporting evidence from the supplied report at all.", source), "")

    def test_audience_filter_precedes_ranking(self):
        values = [
            article(1, audiences=["all"]),
            article(2, audiences=["broadcast"]),
        ]
        ordinary = collect_candidates(values, entitled_audiences={"all", "technology"})
        entitled = collect_candidates(values, entitled_audiences={"all", "broadcast"})
        self.assertEqual(len(ordinary), 1)
        self.assertEqual(len(entitled), 2)

    def test_score_is_deterministic_and_confidence_ramps(self):
        now = dt.datetime(2026, 8, 15, tzinfo=dt.timezone.utc)
        events = [
            {
                "event_id": f"event-{index:04d}",
                "action": "interested",
                "occurred_at": f"2026-08-{14 - (index % 2):02d}T10:00:00+00:00",
                "detail": {"topics": ["ai_models"]},
            }
            for index in range(5)
        ]
        state = {
            "preferences": {"topics": ["ai_models"], "completed_at": "yes", "surprise_me": True},
            "events": events,
            "served": {},
        }
        first, diagnostics = score_candidates([article(1), article(2)], state, [], now=now)
        second, _ = score_candidates([article(1), article(2)], state, [], now=now)
        self.assertEqual([item["title"] for item in first], [item["title"] for item in second])
        self.assertEqual(diagnostics["behavior_confidence"], 0.25)
        self.assertEqual(diagnostics["session_count"], 2)

    def test_diversity_caps_first_page_publishers_topics_and_clusters(self):
        values = []
        for index in range(14):
            item = article(index, source="Same Publisher" if index < 6 else f"Publisher {index}")
            item["article_id"] = f"id-{index}"
            item["recommendation"] = {
                "score": 1 - index / 100,
                "topics": ["ai_models" if index < 7 else f"topic-{index}"],
                "exploration": index in {8, 9},
            }
            values.append(item)
        first_ten = diversify(values)[:10]
        self.assertLessEqual(sum(item["source"] == "Same Publisher" for item in first_ten), 2)
        self.assertLessEqual(sum(item["recommendation"]["topics"][0] == "ai_models" for item in first_ten), 3)
        self.assertLessEqual(sum(bool(item["recommendation"]["exploration_slot"]) for item in first_ten), 2)

    def test_service_is_stable_and_cursor_based(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ViewerRepository(Path(directory))
            service = RecommendationService(repository, hooks_enabled=True)
            result = service.build_feed(
                "viewer-a",
                [article(index) for index in range(12)],
                [],
                limit=5,
                entitled_audiences={"all"},
            )
            self.assertEqual(len(result["items"]), 5)
            self.assertRegex(result["cursor"], r"^fy1\.[A-Za-z0-9_-]+\.5$")
            displayed_ids = [
                item["article_id"]
                for section in result["sections"].values()
                for item in section
            ]
            self.assertEqual(len(displayed_ids), 5)
            self.assertEqual(len(displayed_ids), len(set(displayed_ids)))
            self.assertTrue(all("recommendation" in item for item in result["items"]))

    def test_two_page_cursor_is_disjoint_complete_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            values = [article(index, signal_score=70) for index in range(10)]
            first_service = RecommendationService(ViewerRepository(root), hooks_enabled=True)
            first = first_service.build_feed(
                "viewer-a",
                values,
                [],
                limit=5,
                entitled_audiences={"all"},
            )

            # A fresh repository/service simulates a process restart. Page-one
            # served-state now changes live scores, but the cursor must retain
            # the original snapshot order rather than re-slice a new ranking.
            second_service = RecommendationService(ViewerRepository(root), hooks_enabled=True)
            second = second_service.build_feed(
                "viewer-a",
                values,
                [],
                cursor=first["cursor"],
                limit=5,
                entitled_audiences={"all"},
            )

            first_ids = [item["article_id"] for item in first["items"]]
            second_ids = [item["article_id"] for item in second["items"]]
            expected_ids = {candidate_article_id(item) for item in values}
            self.assertEqual(len(first_ids), 5)
            self.assertEqual(len(second_ids), 5)
            self.assertTrue(set(first_ids).isdisjoint(second_ids))
            self.assertEqual(set(first_ids + second_ids), expected_ids)
            self.assertIsNone(second["cursor"])
            self.assertFalse(second["cursor_reset"])
            self.assertEqual(second["total"], 10)

            accepted = second_service.repository.append_events("viewer-a", [{
                "event_id": "page-two-impression",
                "action": "qualified_impression",
                "article_id": second_ids[0],
                "feed_request_id": second["feed_request_id"],
                "occurred_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }])
            self.assertEqual(accepted, (1, 0, 0))

            persisted = json.loads(next(root.glob("*.json")).read_text(encoding="utf-8"))
            self.assertIn("feed_snapshots", persisted)
            self.assertTrue(persisted["feed_snapshots"])

    def test_editorial_sections_never_repeat_the_same_story(self):
        values = [article(index, article_id=f"id-{index}") for index in range(12)]
        sections = allocate_exclusive_sections(
            values,
            fresh=values[:4],
            follow_ups=[values[1], values[5], values[6]],
            exploration=[values[2], values[6], values[7], values[8]],
        )
        displayed = [
            item["article_id"]
            for section in sections.values()
            for item in section
        ]
        self.assertEqual(len(displayed), len(set(displayed)))
        self.assertEqual(set(displayed), {item["article_id"] for item in values})

    def test_aggregate_metrics_never_return_viewer_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ViewerRepository(Path(directory))
            repository.mark_served("secret-viewer", ["article-a"], "feed-a")
            repository.append_events("secret-viewer", [{
                "event_id": "event-0001", "action": "qualified_impression",
                "article_id": "article-a",
                "occurred_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }])
            result = aggregate_quality_metrics(Path(directory))
            self.assertEqual(result["viewers"], 1)
            self.assertNotIn("secret-viewer", json.dumps(result))
            self.assertEqual(result["privacy"], "aggregate_only")

    def test_unified_source_catalog_preserves_inventory(self):
        catalog, report = build_unified_catalog(
            Path("news_scrapper/config/sites.json"),
            Path("news_scrapper/config/sites_broadcast.json"),
        )
        self.assertEqual(report["records"], 166)
        self.assertEqual(report["enabled"], 138)
        self.assertEqual(report["rss_records"], 98)
        self.assertTrue(report["preserves_distinct_source_ids"])
        nvidia = [site for site in catalog["sites"] if site.get("domain") == "nvidianews.nvidia.com"]
        self.assertGreaterEqual(len(nvidia), 18)
        self.assertEqual(len({site["id"] for site in nvidia}), len(nvidia))

    def test_shadow_briefing_deduplicates_cross_vertical_url_without_cutover(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "unified_shadow" / "briefing.json"
            report = build_shadow_briefing(
                [article(1, link="https://example.test/story?utm_source=a")],
                [article(2, link="https://example.test/story?utm_source=b")],
                destination,
            )
            # Query strings are canonicalized away for source identity.
            self.assertEqual(report["unified_count"], 1)
            self.assertEqual(report["duplicates_removed"], 1)
            self.assertTrue(destination.exists())


if __name__ == "__main__":
    unittest.main()
