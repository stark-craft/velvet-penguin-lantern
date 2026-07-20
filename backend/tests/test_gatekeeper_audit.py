from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from signalroom.models import (
    ArticleActionCreate,
    ArticleActionType,
    ArticleCreate,
    ArticleSourceCreate,
    BriefingSnapshotCreate,
    ClusterCreate,
    ClusterMemberCreate,
    CrawlJobCreate,
    CrawlJobStatus,
    CrawlJobUpdate,
    DiscoveryMethod,
    ProfileId,
    make_stable_id,
)
from signalroom.services.gatekeeper_audit import (
    GatekeeperAuditBucket,
    GatekeeperAuditService,
)
from signalroom.storage import SQLiteRepository


class GatekeeperAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.repository = SQLiteRepository(Path(self.temporary.name) / "audit.db")
        self.repository.migrate()
        self.service = GatekeeperAuditService(self.repository)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _job(self, profile: ProfileId, counters=None):
        job = self.repository.create_job(CrawlJobCreate(profile=profile))
        self.repository.update_job(
            job.id,
            CrawlJobUpdate(status=CrawlJobStatus.RUNNING, counters={}),
        )
        return self.repository.update_job(
            job.id,
            CrawlJobUpdate(
                status=CrawlJobStatus.SUCCEEDED,
                counters=counters
                or {
                    "discovered": 3,
                    "clusters": 3,
                    "retained": 2,
                    "dropped": 1,
                },
            ),
        )

    def _article(self, profile: ProfileId, job, suffix: str, publisher: str):
        url = f"https://example.com/{profile.value}/{suffix}"
        return self.repository.upsert_article(
            ArticleCreate(
                stable_id=make_stable_id("article", url),
                title=f"{profile.value.title()} {suffix.title()} Article",
                canonical_url=url,
                summary=f"Summary for {suffix}",
                profiles=(profile,),
                sources=(
                    ArticleSourceCreate(
                        stable_id=make_stable_id("source", job.id, url),
                        profile=profile,
                        source_key=f"{profile.value}-{suffix}",
                        publisher=publisher,
                        url=url,
                        discovery_method=DiscoveryMethod.RSS,
                        crawl_job_id=job.id,
                    ),
                ),
            )
        )

    def _cluster(
        self,
        profile: ProfileId,
        job,
        article,
        decision: str,
        score: float,
        *,
        degraded: bool = False,
    ):
        retained = decision != "drop"
        return ClusterCreate(
            stable_id=make_stable_id("cluster", job.id, article.id),
            profile=profile,
            crawl_job_id=job.id,
            title=article.title,
            summary=article.summary,
            model_name="sentence-transformers/all-MiniLM-L6-v2",
            similarity_threshold=0.78,
            members=(
                ClusterMemberCreate(
                    article_id=article.id,
                    similarity=1.0,
                    is_primary=True,
                ),
            ),
            metadata={
                "retained": retained,
                "gatekeeper": {
                    "decision": decision,
                    "keep": retained,
                    "score": score,
                    "profile": profile.value,
                    "stage": "final",
                    "degraded": degraded,
                    "reason": f"test_{decision}_reason",
                    "model_version": "v-test-1",
                    "thresholds": {
                        "review": 0.45,
                        "hard_drop": 0.60,
                        "prefetch_drop": 0.90,
                    },
                    "embedding": {
                        "model": "sentence-transformers/all-MiniLM-L6-v2",
                        "backend": "sentence-transformers",
                    },
                },
            },
        )

    def _populate_default_run(self):
        job = self._job(ProfileId.DEFAULT)
        articles = {
            "keep": self._article(
                ProfileId.DEFAULT, job, "keep", "Default Retained Source"
            ),
            "review": self._article(
                ProfileId.DEFAULT, job, "review", "Default Review Source"
            ),
            "drop": self._article(
                ProfileId.DEFAULT, job, "drop", "Default Dropped Source"
            ),
        }
        clusters = tuple(
            self._cluster(
                ProfileId.DEFAULT,
                job,
                articles[decision],
                decision,
                {"keep": 0.10, "review": 0.50, "drop": 0.80}[decision],
            )
            for decision in ("keep", "review", "drop")
        )
        self.repository.replace_run_clusters(job.id, clusters)
        briefing = self.repository.create_briefing_snapshot(
            BriefingSnapshotCreate(
                stable_id=make_stable_id("briefing", job.id),
                profile=ProfileId.DEFAULT,
                crawl_job_id=job.id,
                article_ids=(articles["keep"].id, articles["review"].id),
            )
        )
        return job, articles, briefing

    def test_dropped_and_review_rows_are_discoverable_outside_briefing(self) -> None:
        job, articles, briefing = self._populate_default_run()
        self.repository.record_article_action(
            ArticleActionCreate(
                article_id=articles["drop"].id,
                profile=ProfileId.DEFAULT,
                actor_id="reviewer-1",
                action=ArticleActionType.HIDE,
            )
        )

        audit = self.service.get_latest(
            ProfileId.DEFAULT, actor_id="reviewer-1"
        )

        self.assertEqual(audit.job.id, job.id)
        self.assertEqual(audit.counters.pipeline["discovered"], 3)
        self.assertEqual(audit.counters.clusters.model_dump(), {
            "total": 3,
            "retained": 1,
            "review": 1,
            "dropped": 1,
        })
        self.assertEqual(audit.counters.articles.model_dump(), {
            "total": 3,
            "retained": 1,
            "review": 1,
            "dropped": 1,
        })
        self.assertEqual(len(audit.clusters), 3)
        self.assertEqual(len(audit.articles), 3)

        dropped_cluster = next(
            row
            for row in audit.clusters
            if row.gatekeeper.bucket == GatekeeperAuditBucket.DROPPED
        )
        dropped_article = next(
            row
            for row in audit.articles
            if row.gatekeeper.bucket == GatekeeperAuditBucket.DROPPED
        )
        self.assertEqual(dropped_cluster.gatekeeper.score, 0.80)
        self.assertEqual(dropped_cluster.gatekeeper.reason, "test_drop_reason")
        self.assertEqual(dropped_cluster.gatekeeper.thresholds["hard_drop"], 0.60)
        self.assertEqual(dropped_cluster.gatekeeper.model.version, "v-test-1")
        self.assertFalse(dropped_cluster.gatekeeper.model.degraded)
        self.assertEqual(dropped_cluster.source, "Default Dropped Source")
        self.assertEqual(dropped_article.title, articles["drop"].title)
        self.assertEqual(dropped_article.summary, "Summary for drop")
        self.assertTrue(dropped_article.disposition.hidden)
        self.assertNotIn(dropped_article.article_id, briefing.article_ids)
        self.assertTrue(audit.latest_briefing.is_for_audited_run)

    def test_profile_scope_does_not_leak_sources_clusters_or_actions(self) -> None:
        self._populate_default_run()
        broadcast_job = self._job(
            ProfileId.BROADCAST,
            {"discovered": 1, "clusters": 1, "retained": 0, "dropped": 1},
        )
        secret = self._article(
            ProfileId.BROADCAST,
            broadcast_job,
            "secret",
            "Broadcast Secret Source",
        )
        self.repository.replace_run_clusters(
            broadcast_job.id,
            (
                self._cluster(
                    ProfileId.BROADCAST,
                    broadcast_job,
                    secret,
                    "drop",
                    0.95,
                ),
            ),
        )
        self.repository.record_article_action(
            ArticleActionCreate(
                article_id=secret.id,
                profile=ProfileId.BROADCAST,
                actor_id="reviewer-1",
                action=ArticleActionType.HIDE,
            )
        )

        audit = self.service.get_latest(
            ProfileId.DEFAULT, actor_id="reviewer-1"
        )
        rendered = audit.model_dump_json()

        self.assertEqual(audit.profile, ProfileId.DEFAULT)
        self.assertTrue(all(row.profile == ProfileId.DEFAULT for row in audit.clusters))
        self.assertTrue(all(row.profile == ProfileId.DEFAULT for row in audit.articles))
        self.assertNotIn("Broadcast Secret", rendered)

    def test_rows_are_bounded_and_invalid_limits_are_rejected(self) -> None:
        self._populate_default_run()

        audit = self.service.get_latest(ProfileId.DEFAULT, limit=2)

        self.assertEqual(len(audit.clusters), 2)
        self.assertLessEqual(len(audit.articles), 2)
        self.assertTrue(audit.truncated)
        with self.assertRaises(ValueError):
            self.service.get_latest(ProfileId.DEFAULT, limit=101)
        with self.assertRaises(ValueError):
            self.service.get_latest(ProfileId.DEFAULT, limit=0)


if __name__ == "__main__":
    unittest.main()
