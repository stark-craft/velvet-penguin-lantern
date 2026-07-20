from __future__ import annotations

import json
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from signalroom.json_storage import JSONRepository
from signalroom.models import (
    ArticleActionCreate,
    ArticleActionType,
    ArticleCreate,
    ArticleSourceCreate,
    BriefingSnapshotCreate,
    CrawlJobCreate,
    DiscoveryMethod,
    PageParams,
    ProfileId,
    TelemetryEventCreate,
    TelemetryEventType,
    make_stable_id,
)
from signalroom.storage import RecordNotFoundError, UnsafePayloadError


class MutableClock:
    def __init__(self, value: datetime) -> None:
        self.value = value

    def __call__(self) -> datetime:
        return self.value


class JsonStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.clock = MutableClock(datetime(2026, 1, 1, 9, tzinfo=timezone.utc))
        self.repository = JSONRepository(self.root, now_factory=self.clock)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def create_article(
        self,
        suffix: str,
        *,
        profile: ProfileId = ProfileId.DEFAULT,
        summary: str | None = None,
        job_id=None,
    ):
        url = f"https://example.com/{suffix}"
        source = ArticleSourceCreate(
            stable_id=make_stable_id("source", profile.value, suffix, job_id or "initial"),
            profile=profile,
            source_key=f"source-{profile.value}",
            publisher=f"{profile.value.title()} News",
            url=url,
            discovery_method=DiscoveryMethod.RSS,
            crawl_job_id=job_id,
        )
        return self.repository.upsert_article(
            ArticleCreate(
                stable_id=make_stable_id("article", url),
                title=f"Article {suffix}",
                canonical_url=url,
                summary=summary,
                profiles=(profile,),
                sources=(source,),
            )
        )

    def test_state_is_durable_human_readable_and_recovers_from_backup(self) -> None:
        article = self.create_article("durable")
        state_path = self.root / "state.json"
        backup_path = self.root / "state.json.bak"
        payload = json.loads(state_path.read_text(encoding="utf-8"))
        self.assertEqual(payload["schema_version"], 1)
        self.assertIn(str(article.id), payload["articles"])
        self.assertTrue(backup_path.exists())

        state_path.write_text("{not-json", encoding="utf-8")
        reopened = JSONRepository(self.root, now_factory=self.clock)
        self.assertEqual(reopened.get_article(article.id).id, article.id)
        self.assertEqual(
            json.loads(state_path.read_text(encoding="utf-8"))["schema_version"], 1
        )

    def test_profile_intelligence_and_sources_do_not_cross_profiles(self) -> None:
        default_job = self.repository.create_job(
            CrawlJobCreate(profile=ProfileId.DEFAULT)
        )
        broadcast_job = self.repository.create_job(
            CrawlJobCreate(profile=ProfileId.BROADCAST)
        )
        default = self.create_article(
            "shared", summary="Default summary", job_id=default_job.id
        )
        self.create_article(
            "shared",
            profile=ProfileId.BROADCAST,
            summary="Broadcast summary",
            job_id=broadcast_job.id,
        )

        default_view = self.repository.get_article(default.id, profile=ProfileId.DEFAULT)
        broadcast_view = self.repository.get_article(default.id, profile=ProfileId.BROADCAST)
        self.assertEqual(default_view.summary, "Default summary")
        self.assertEqual(broadcast_view.summary, "Broadcast summary")
        self.assertEqual({source.profile for source in default_view.sources}, {ProfileId.DEFAULT})
        self.assertEqual(
            {source.profile for source in broadcast_view.sources}, {ProfileId.BROADCAST}
        )

        default_only = self.create_article("default-only")
        with self.assertRaises(RecordNotFoundError):
            self.repository.get_article(default_only.id, profile=ProfileId.BROADCAST)

    def test_cursor_pagination_survives_repository_reopen(self) -> None:
        for index in range(4):
            self.clock.value += timedelta(seconds=1)
            self.create_article(str(index))
        first = self.repository.list_articles(page=PageParams(limit=2))
        reopened = JSONRepository(self.root, now_factory=self.clock)
        second = reopened.list_articles(
            page=PageParams(limit=2, cursor=first.page.next_cursor)
        )
        self.assertEqual(len(first.items), 2)
        self.assertEqual(len(second.items), 2)
        self.assertFalse(second.page.has_more)
        self.assertTrue(set(item.id for item in first.items).isdisjoint(item.id for item in second.items))

    def test_30_day_pruning_keeps_saved_and_review_later_article_data(self) -> None:
        ordinary = self.create_article("ordinary")
        saved = self.create_article("saved")
        review_later = self.create_article("review")
        briefing = self.repository.create_briefing_snapshot(
            BriefingSnapshotCreate(
                stable_id=make_stable_id("briefing", "old"),
                profile=ProfileId.DEFAULT,
                article_ids=(ordinary.id, saved.id, review_later.id),
            )
        )
        self.repository.record_article_action(
            ArticleActionCreate(
                article_id=saved.id,
                profile=ProfileId.DEFAULT,
                actor_id="editor@example.com",
                action=ArticleActionType.SAVE,
            )
        )
        self.repository.record_article_action(
            ArticleActionCreate(
                article_id=review_later.id,
                profile=ProfileId.DEFAULT,
                actor_id="editor@example.com",
                action=ArticleActionType.MARK_UNDER_REVIEW,
            )
        )

        # Go well beyond both article history and ordinary action retention;
        # current SAVE/review state is retained as a compact anchor.
        self.clock.value += timedelta(days=400)
        self.repository.record_activity(
            TelemetryEventCreate(
                profile=ProfileId.DEFAULT,
                session_id=uuid4(),
                event_type=TelemetryEventType.PAGE_VIEW,
                path="/briefing",
            )
        )

        with self.assertRaises(RecordNotFoundError):
            self.repository.get_article(ordinary.id)
        with self.assertRaises(RecordNotFoundError):
            self.repository.get_briefing(briefing.id)
        self.assertEqual(self.repository.get_article(saved.id).title, "Article saved")
        self.assertEqual(self.repository.get_article(review_later.id).title, "Article review")
        self.assertTrue(
            self.repository.get_disposition(
                saved.id, "editor@example.com", ProfileId.DEFAULT
            ).saved
        )
        self.assertTrue(
            self.repository.get_disposition(
                review_later.id, "editor@example.com", ProfileId.DEFAULT
            ).under_review
        )

    def test_multiple_instances_do_not_lose_concurrent_writes(self) -> None:
        repositories = [JSONRepository(self.root, now_factory=self.clock) for _ in range(4)]
        failures = []

        def writer(index: int) -> None:
            try:
                repositories[index % len(repositories)].record_activity(
                    TelemetryEventCreate(
                        profile=ProfileId.DEFAULT,
                        actor_id=f"user-{index}",
                        session_id=uuid4(),
                        event_type=TelemetryEventType.PAGE_VIEW,
                        path=f"/page/{index}",
                    )
                )
            except Exception as exc:  # pragma: no cover - assertion reports details
                failures.append(exc)

        threads = [threading.Thread(target=writer, args=(index,)) for index in range(24)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(failures, [])
        self.assertEqual(self.repository.analytics_summary().total_events, 24)

    def test_viewer_preferences_are_durable_and_validated(self) -> None:
        created = self.repository.upsert_viewer_preference(
            "viewer@example.com",
            display_name="Tony Stark",
            contact_email="TONY@EXAMPLE.COM",
        )
        reopened = JSONRepository(self.root, now_factory=self.clock)
        loaded = reopened.get_viewer_preference("viewer@example.com")
        self.assertEqual(loaded, created)
        self.assertEqual(loaded["contact_email"], "TONY@example.com")
        with self.assertRaises(ValueError):
            reopened.upsert_viewer_preference(
                "viewer@example.com", display_name="Tony", contact_email="invalid"
            )

    def test_generic_payload_safety_is_enforced_by_json_runtime(self) -> None:
        with self.assertRaises(UnsafePayloadError):
            self.repository.record_activity(
                TelemetryEventCreate(
                    profile=ProfileId.DEFAULT,
                    session_id=uuid4(),
                    event_type=TelemetryEventType.PAGE_VIEW,
                    properties={"origin": "2001:db8::1"},
                )
            )
        stored = self.repository.record_activity(
            TelemetryEventCreate(
                profile=ProfileId.DEFAULT,
                session_id=uuid4(),
                event_type=TelemetryEventType.PAGE_VIEW,
                properties={"source": "https://[2001:db8::1]/article"},
            )
        )
        self.assertEqual(stored.properties["source"], "https://[2001:db8::1]/article")


if __name__ == "__main__":
    unittest.main()
