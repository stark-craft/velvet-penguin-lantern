import json
import tempfile
import unittest
from pathlib import Path

from pydantic import SecretStr

from signalroom.config import Settings
from signalroom.ml.embeddings import EmbeddingService
from signalroom.ml.summarizer import SummarizationService
from signalroom.models import CrawlJobCreate, CrawlJobStatus, PageParams, ProfileId
from signalroom.profiles import ProfileRegistry
from signalroom.services.crawl_runner import CrawlResult
from signalroom.services.pipeline import PipelineBusyError, PipelineService
from signalroom.storage import SQLiteRepository


def _profile_payload(profile):
    return {
        "schema_version": 1,
        "id": profile,
        "label": f"{profile.title()} Intelligence",
        "enabled": True,
        "sources_file": f"{profile}.json",
        "cluster_similarity_threshold": 0.78,
        "gatekeeper_review_threshold": 0.45,
        "gatekeeper_drop_threshold": 0.60,
        "prefetch_drop_threshold": 0.90,
        "schedule_order": 1 if profile == "default" else 2,
        "keywords": ["AI", "display"] if profile == "default" else ["broadcast", "DVB"],
    }


def _site_payload(profile):
    return {
        "schema_version": 1,
        "sites": [
            {
                "id": f"{profile}-source",
                "name": f"{profile.title()} Source",
                "enabled": True,
                "rss_url": f"https://example.com/{profile}.xml",
                "homepage": "https://example.com/",
                "timezone": "UTC",
            }
        ],
    }


class FakeCrawler:
    def __init__(self):
        self.calls = []
        self.site_names = []

    def run(self, profile, from_date, to_date, **kwargs):
        profile_id = profile.id.value
        self.calls.append((profile_id, from_date, to_date, kwargs))
        self.site_names.append(tuple(site.name for site in profile.enabled_sites))
        common = {
            "published_at": "2026-07-20T06:00:00+00:00",
            "discovered_at": "2026-07-20T07:00:00+00:00",
            "body_text": (
                "A company announced a new artificial intelligence display platform. "
                "The system combines on-device models with television software."
            ),
            "keywords_found": ["AI", "display"],
            "discovery_method": "RSS",
            "extraction_quality": "good",
        }
        articles = [
            {
                **common,
                "source": "Publisher One",
                "source_id": "publisher-one",
                "title": "Company launches AI display platform",
                "canonical_url": "https://example.com/news/one",
                "requested_url": "https://example.com/news/one?utm_source=feed",
                "excerpt": "A new AI display platform was announced.",
            },
            {
                **common,
                "source": "Publisher Two",
                "source_id": "publisher-two",
                "title": "Company launches AI display platform",
                "canonical_url": "https://example.com/news/two",
                "requested_url": "https://example.com/news/two",
                "excerpt": "A new AI display platform was announced.",
            },
        ]
        return CrawlResult(
            run_id=kwargs["run_id"],
            profile=profile_id,
            articles=articles,
            output_file=Path("unused.json"),
            command=[],
        )


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for directory in ("profiles", "sites", "models", "runtime/crawls"):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        for profile in ("default", "broadcast"):
            (self.root / "profiles" / f"{profile}.json").write_text(
                json.dumps(_profile_payload(profile)), encoding="utf-8"
            )
            (self.root / "sites" / f"{profile}.json").write_text(
                json.dumps(_site_payload(profile)), encoding="utf-8"
            )
        self.settings = Settings(
            environment="test",
            root_dir=self.root,
            ip_hash_secret=SecretStr("x" * 40),
            hf_local_only=True,
        )
        self.settings.prepare_runtime_directories()
        self.profiles = ProfileRegistry.from_settings(self.settings)
        self.repository = SQLiteRepository(self.settings.database_path)
        self.repository.migrate()
        self.crawler = FakeCrawler()
        self.pipeline = PipelineService(
            self.settings,
            self.profiles,
            self.repository,
            crawler=self.crawler,
            embedder=EmbeddingService(force_fallback=True),
            summarizer=SummarizationService(force_fallback=True),
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_end_to_end_profile_run_persists_briefing_and_provenance(self):
        result = self.pipeline.run_profile(profile_id="default", requested_by="tester")
        self.assertEqual(result["job"]["status"], CrawlJobStatus.SUCCEEDED.value)
        self.assertEqual(result["counters"]["discovered"], 2)
        self.assertEqual(result["counters"]["clusters"], 1)
        self.assertEqual(result["counters"]["retained"], 1)
        self.assertIsNotNone(result["briefing"])

        articles = self.repository.list_articles(
            profile=ProfileId.DEFAULT, page=PageParams(limit=10)
        )
        self.assertEqual(len(articles.items), 2)
        self.assertTrue(all(article.summary for article in articles.items))
        self.assertEqual(
            sum(
                bool(article.metadata.get("is_cluster_representative"))
                for article in articles.items
            ),
            1,
        )
        briefing = self.repository.get_latest_briefing(ProfileId.DEFAULT)
        self.assertIsNotNone(briefing)
        self.assertEqual(len(briefing.articles), 1)
        self.assertTrue(briefing.articles[0].summary)

        job_id = result["job"]["id"]
        clusters = self.repository.list_clusters(
            profile=ProfileId.DEFAULT,
            crawl_job_id=job_id,
            page=PageParams(limit=10),
        )
        self.assertEqual(len(clusters.items), 1)
        self.assertEqual(len(clusters.items[0].members), 2)
        stored_article_ids = {str(article.id) for article in articles.items}
        source_article_ids = {
            str(source["article_id"])
            for source in clusters.items[0].metadata.get("sources") or []
        }
        self.assertEqual(source_article_ids, stored_article_ids)
        events = self.repository.list_job_events(job_id)
        self.assertGreaterEqual(len(events), 7)
        self.assertTrue(any("MiniLM" in event.message for event in events))
        self.assertTrue(any("gatekeeper" in event.message.casefold() for event in events))

    def test_same_canonical_article_can_join_both_profiles(self):
        first = self.pipeline.run_profile(profile_id="default")
        self.assertEqual(first["counters"]["retained"], 1)
        second = self.pipeline.run_profile(profile_id="broadcast")
        self.assertEqual(second["counters"]["retained"], 1)
        article = self.repository.get_article_by_stable_id(
            self.repository.list_articles(profile=ProfileId.DEFAULT).items[0].stable_id
        )
        self.assertEqual(set(article.profiles), {ProfileId.DEFAULT, ProfileId.BROADCAST})

    def test_repeat_scheduler_run_reuses_source_provenance_ids(self):
        first = self.pipeline.run_profile(profile_id="default", trigger="scheduler")
        second = self.pipeline.run_profile(profile_id="default", trigger="scheduler")
        self.assertEqual(first["counters"]["retained"], 1)
        self.assertEqual(second["counters"]["retained"], 1)
        articles = self.repository.list_articles(
            profile=ProfileId.DEFAULT, page=PageParams(limit=10)
        )
        self.assertEqual(len(articles.items), 2)

    def test_queued_job_becomes_terminal_when_profile_is_busy(self):
        job = self.repository.create_job(CrawlJobCreate(profile=ProfileId.DEFAULT))
        lock = self.pipeline._profile_locks[ProfileId.DEFAULT]
        lock.acquire()
        try:
            with self.assertRaises(PipelineBusyError):
                self.pipeline.run_profile(profile_id=ProfileId.DEFAULT, job=job)
        finally:
            lock.release()
        failed = self.repository.get_job(job.id)
        self.assertEqual(failed.status, CrawlJobStatus.FAILED)
        self.assertIn("already active", failed.error)
        self.assertEqual(len(self.repository.list_job_events(job.id)), 1)

    def test_each_run_reloads_profile_keywords_and_source_json(self):
        profile_payload = _profile_payload("default")
        profile_payload["keywords"] = ["freshly configured term"]
        (self.root / "profiles" / "default.json").write_text(
            json.dumps(profile_payload), encoding="utf-8"
        )
        site_payload = _site_payload("default")
        site_payload["sites"][0]["name"] = "Fresh Source Name"
        (self.root / "sites" / "default.json").write_text(
            json.dumps(site_payload), encoding="utf-8"
        )

        self.pipeline.run_profile(profile_id="default")

        self.assertEqual(
            self.crawler.calls[-1][3]["keywords"],
            ("freshly configured term",),
        )
        self.assertEqual(self.crawler.site_names[-1], ("Fresh Source Name",))


if __name__ == "__main__":
    unittest.main()
