from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from signalroom.models import (
    ArticleActionCreate,
    ArticleActionType,
    ArticleCreate,
    ArticleSourceCreate,
    BriefingSnapshotCreate,
    ClusterCreate,
    ClusterMemberCreate,
    CrawlJobCreate,
    CrawlJobEventCreate,
    CrawlJobEventType,
    CrawlJobStatus,
    CrawlJobUpdate,
    DiscoveryMethod,
    PageParams,
    ProfileId,
    TelemetryEventCreate,
    TelemetryEventType,
    VocFeedbackCreate,
    make_stable_id,
)
from signalroom.storage import (
    InvalidJobTransitionError,
    Repository,
    UnsafePayloadError,
)


class StorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.repository = Repository(Path(self.temporary_directory.name) / "signalroom.db")

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def create_job(self):
        return self.repository.create_job(
            CrawlJobCreate(profile=ProfileId.DEFAULT, keywords=("OpenAI",))
        )

    def create_article(self, suffix: str = "one", job_id=None):
        url = f"https://example.com/{suffix}"
        source = ArticleSourceCreate(
            stable_id=make_stable_id("source", ProfileId.DEFAULT.value, url),
            profile=ProfileId.DEFAULT,
            source_key="example",
            publisher="Example",
            url=url,
            discovery_method=DiscoveryMethod.RSS,
            crawl_job_id=job_id,
            metadata={"http_status": 200},
        )
        return self.repository.upsert_article(
            ArticleCreate(
                stable_id=make_stable_id("article", url),
                title=f"Article {suffix}",
                canonical_url=url,
                profiles=(ProfileId.DEFAULT,),
                sources=(source,),
                keywords=("OpenAI", "openai"),
            )
        )

    def test_migration_enables_wal_foreign_keys_and_schema_version(self) -> None:
        self.assertEqual(self.repository.schema_version, 2)
        connection = self.repository._connect()
        try:
            self.assertEqual(connection.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            self.assertEqual(connection.execute("PRAGMA journal_mode").fetchone()[0], "wal")
        finally:
            connection.close()

    def test_article_source_round_trip_and_idempotent_upsert(self) -> None:
        job = self.create_job()
        first = self.create_article(job_id=job.id)
        second = self.create_article(job_id=job.id)
        self.assertEqual(first.id, second.id)
        self.assertEqual(first.keywords, ("OpenAI",))
        self.assertEqual(len(first.sources), 1)
        self.assertEqual(first.sources[0].crawl_job_id, job.id)

    def test_article_base_record_is_immutable(self) -> None:
        article = self.create_article()
        with self.assertRaises(sqlite3.IntegrityError):
            with self.repository.transaction() as connection:
                connection.execute(
                    "UPDATE articles SET title = ? WHERE id = ?",
                    ("Changed", str(article.id)),
                )

    def test_profile_intelligence_is_isolated_for_shared_articles(self) -> None:
        default_job = self.create_job()
        broadcast_job = self.repository.create_job(
            CrawlJobCreate(profile=ProfileId.BROADCAST, keywords=("DVB",))
        )
        url = "https://example.com/shared"

        def article_for(profile, job, summary, intent):
            source = ArticleSourceCreate(
                stable_id=make_stable_id("source", profile.value, job.id, url),
                profile=profile,
                source_key=f"{profile.value}-source",
                publisher=f"{profile.value.title()} Publisher",
                url=url,
                discovery_method=DiscoveryMethod.RSS,
                crawl_job_id=job.id,
            )
            return ArticleCreate(
                stable_id=make_stable_id("article", url),
                title="Shared article",
                canonical_url=url,
                profiles=(profile,),
                sources=(source,),
                summary=summary,
                intent=intent,
                keywords=(profile.value,),
                metadata={"profile_view": profile.value},
            )

        stored = self.repository.upsert_article(
            article_for(ProfileId.DEFAULT, default_job, "Default summary", "product")
        )
        self.repository.upsert_article(
            article_for(
                ProfileId.BROADCAST,
                broadcast_job,
                "Broadcast summary",
                "regulation",
            )
        )

        default_view = self.repository.get_article(stored.id, profile=ProfileId.DEFAULT)
        broadcast_view = self.repository.get_article(stored.id, profile=ProfileId.BROADCAST)
        self.assertEqual(default_view.summary, "Default summary")
        self.assertEqual(default_view.intent, "product")
        self.assertEqual(default_view.metadata["profile_view"], "default")
        self.assertEqual(len(default_view.sources), 1)
        self.assertEqual(broadcast_view.summary, "Broadcast summary")
        self.assertEqual(broadcast_view.intent, "regulation")
        self.assertEqual(broadcast_view.metadata["profile_view"], "broadcast")
        self.assertEqual(len(broadcast_view.sources), 1)

    def test_article_pagination_is_bounded_and_cursor_based(self) -> None:
        for index in range(3):
            self.create_article(str(index))
        first = self.repository.list_articles(page=PageParams(limit=2))
        self.assertEqual(len(first.items), 2)
        self.assertTrue(first.page.has_more)
        second = self.repository.list_articles(
            page=PageParams(limit=2, cursor=first.page.next_cursor)
        )
        self.assertEqual(len(second.items), 1)
        self.assertFalse(second.page.has_more)

    def test_job_transitions_and_events_are_durable(self) -> None:
        job = self.create_job()
        event = self.repository.add_job_event(
            CrawlJobEventCreate(
                job_id=job.id,
                event_type=CrawlJobEventType.STATUS,
                message="Starting",
            )
        )
        self.assertEqual(event.sequence, 1)
        self.repository.update_job(
            job.id,
            CrawlJobUpdate(status=CrawlJobStatus.RUNNING, counters={"discovered": 2}),
        )
        finished = self.repository.update_job(
            job.id,
            CrawlJobUpdate(status=CrawlJobStatus.SUCCEEDED, counters={"discovered": 2}),
        )
        self.assertIsNotNone(finished.started_at)
        self.assertIsNotNone(finished.completed_at)
        self.assertEqual(len(self.repository.list_job_events(job.id)), 1)
        with self.assertRaises(InvalidJobTransitionError):
            self.repository.update_job(
                job.id, CrawlJobUpdate(status=CrawlJobStatus.RUNNING)
            )

    def test_cluster_and_briefing_preserve_order_and_membership(self) -> None:
        job = self.create_job()
        article = self.create_article(job_id=job.id)
        cluster = self.repository.upsert_cluster(
            ClusterCreate(
                stable_id=make_stable_id("cluster", job.id, article.id),
                profile=ProfileId.DEFAULT,
                crawl_job_id=job.id,
                title=article.title,
                model_name="sentence-transformers/all-MiniLM-L6-v2",
                similarity_threshold=0.78,
                members=(
                    ClusterMemberCreate(
                        article_id=article.id,
                        similarity=1.0,
                        is_primary=True,
                    ),
                ),
            )
        )
        briefing = self.repository.create_briefing_snapshot(
            BriefingSnapshotCreate(
                stable_id=make_stable_id("briefing", job.id),
                profile=ProfileId.DEFAULT,
                crawl_job_id=job.id,
                article_ids=(article.id,),
            )
        )
        self.assertEqual(cluster.members[0].article_id, article.id)
        self.assertEqual(briefing.article_ids, (article.id,))
        self.assertEqual(
            self.repository.get_latest_briefing(ProfileId.DEFAULT).id, briefing.id
        )

    def test_actions_are_append_only_idempotent_and_fold_into_worklists(self) -> None:
        article = self.create_article()
        action = ArticleActionCreate(
            article_id=article.id,
            profile=ProfileId.DEFAULT,
            actor_id="user-1",
            action=ArticleActionType.SELECT,
            idempotency_key="selection-request-1",
        )
        first = self.repository.record_article_action(action)
        second = self.repository.record_article_action(action)
        self.assertEqual(first.id, second.id)
        worklist = self.repository.list_worklist(
            actor_id="user-1", profile=ProfileId.DEFAULT, state="selected"
        )
        self.assertEqual([item.article.id for item in worklist.items], [article.id])
        self.repository.record_article_action(
            ArticleActionCreate(
                article_id=article.id,
                profile=ProfileId.DEFAULT,
                actor_id="user-1",
                action=ArticleActionType.DESELECT,
            )
        )
        self.assertEqual(
            self.repository.list_worklist(
                actor_id="user-1", profile=ProfileId.DEFAULT, state="selected"
            ).items,
            [],
        )

        self.repository.record_article_action(
            ArticleActionCreate(
                article_id=article.id,
                profile=ProfileId.DEFAULT,
                actor_id="user-1",
                action=ArticleActionType.SELECT,
            )
        )
        self.repository.record_article_action(
            ArticleActionCreate(
                article_id=article.id,
                profile=ProfileId.DEFAULT,
                actor_id="user-1",
                action=ArticleActionType.NOT_INTERESTED,
            )
        )
        disposition = self.repository.get_disposition(
            article.id, "user-1", ProfileId.DEFAULT
        )
        self.assertFalse(disposition.selected)
        self.assertFalse(disposition.interesting)

        self.repository.record_article_action(
            ArticleActionCreate(
                article_id=article.id,
                profile=ProfileId.DEFAULT,
                actor_id="user-1",
                action=ArticleActionType.RESTORE,
            )
        )
        self.assertIsNone(
            self.repository.get_disposition(
                article.id, "user-1", ProfileId.DEFAULT
            ).interesting
        )

        self.repository.record_article_action(
            ArticleActionCreate(
                article_id=article.id,
                profile=ProfileId.DEFAULT,
                actor_id="user-1",
                action=ArticleActionType.APPROVE,
            )
        )
        self.repository.record_article_action(
            ArticleActionCreate(
                article_id=article.id,
                profile=ProfileId.DEFAULT,
                actor_id="user-1",
                action=ArticleActionType.MARK_UNDER_REVIEW,
            )
        )
        disposition = self.repository.get_disposition(
            article.id, "user-1", ProfileId.DEFAULT
        )
        self.assertFalse(disposition.approved)
        self.assertTrue(disposition.under_review)

    def test_voc_and_activity_store_only_hashed_network_identity(self) -> None:
        session_id = uuid4()
        ip_hash = "ip:v1:" + "a" * 64
        feedback = self.repository.record_voc(
            VocFeedbackCreate(
                profile=ProfileId.DEFAULT,
                session_id=session_id,
                rating=5,
                message="Useful",
                ip_hash=ip_hash,
            )
        )
        event = self.repository.record_activity(
            TelemetryEventCreate(
                profile=ProfileId.DEFAULT,
                session_id=session_id,
                event_type=TelemetryEventType.PAGE_VIEW,
                path="/briefing",
                ip_hash=ip_hash,
            )
        )
        self.assertEqual(feedback.ip_hash, ip_hash)
        self.assertEqual(event.ip_hash, ip_hash)
        schema = " ".join(
            row["sql"] or ""
            for row in self.repository.query(
                "SELECT sql FROM sqlite_master WHERE type = 'table'"
            )
        )
        self.assertNotIn("client_ip", schema)
        self.assertNotIn("raw_ip", schema)

    def test_generic_metadata_rejects_raw_ip_fields(self) -> None:
        with self.assertRaises(UnsafePayloadError):
            self.repository.record_activity(
                TelemetryEventCreate(
                    profile=ProfileId.DEFAULT,
                    session_id=uuid4(),
                    event_type=TelemetryEventType.PAGE_VIEW,
                    properties={"client_ip": "203.0.113.1"},
                )
            )

    def test_generic_metadata_rejects_exact_ip_values_but_allows_urls(self) -> None:
        with self.assertRaises(UnsafePayloadError):
            self.repository.record_activity(
                TelemetryEventCreate(
                    profile=ProfileId.DEFAULT,
                    session_id=uuid4(),
                    event_type=TelemetryEventType.PAGE_VIEW,
                    properties={"origin": "203.0.113.1"},
                )
            )

        stored = self.repository.record_activity(
            TelemetryEventCreate(
                profile=ProfileId.DEFAULT,
                session_id=uuid4(),
                event_type=TelemetryEventType.PAGE_VIEW,
                properties={"article_url": "https://203.0.113.1/news?id=7"},
            )
        )
        self.assertEqual(
            stored.properties["article_url"], "https://203.0.113.1/news?id=7"
        )

    def test_generic_metadata_has_size_depth_and_entry_bounds(self) -> None:
        oversized = {"blob": "x" * 262_145}
        deeply_nested = {}
        cursor = deeply_nested
        for _ in range(18):
            child = {}
            cursor["child"] = child
            cursor = child
        too_many_entries = {"values": list(range(4_100))}

        for properties in (oversized, deeply_nested, too_many_entries):
            with self.subTest(kind=next(iter(properties))):
                with self.assertRaises(UnsafePayloadError):
                    self.repository.record_activity(
                        TelemetryEventCreate(
                            profile=ProfileId.DEFAULT,
                            session_id=uuid4(),
                            event_type=TelemetryEventType.PAGE_VIEW,
                            properties=properties,
                        )
                    )


if __name__ == "__main__":
    unittest.main()
