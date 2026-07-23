import tempfile
import unittest
from pathlib import Path

from main_new_pipeline_idea import (
    JsonCheckpointStore,
    NewPipelineIdea,
    PacedRateLimiter,
    PipelineSettings,
)


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


class FakeBouncer:
    def __init__(self, drop_titles=()):
        self.drop_titles = set(drop_titles)

    def filter(self, items, profile):
        kept, dropped = [], []
        for item in items:
            target = dropped if item["title"] in self.drop_titles else kept
            target.append({**item, "bouncer_decision": "drop" if target is dropped else "keep"})
        return kept, dropped


class FakeClusterer:
    def cluster(self, items):
        items = list(items)
        if not items:
            return []
        return [{
            **items[0],
            "title": "Clustered event",
            "sources": [
                {"name": item["source"], "link": item["link"], "date": item.get("date", "")}
                for item in items
            ],
            "source_count": len(items),
            "full_contents": " ".join(item["full_contents"] for item in items),
        }]


class NewPipelineIdeaTests(unittest.TestCase):
    def settings(self, directory):
        return PipelineSettings(
            checkpoint_dir=Path(directory),
            external_call_attempts=1,
            retry_backoff_seconds=0,
        )

    def pipeline(self, directory, *, web, chat, image, bouncer=None, clock=None):
        clock = clock or FakeClock()
        settings = self.settings(directory)
        return NewPipelineIdea(
            settings,
            web_search_adapter=web,
            chat_adapter=chat,
            image_adapter=image,
            bouncer=bouncer or FakeBouncer(),
            clusterer=FakeClusterer(),
            checkpoints=JsonCheckpointStore(Path(directory)),
            web_rate_limiter=PacedRateLimiter(3, clock=clock.clock, sleeper=clock.sleep),
            chat_rate_limiter=PacedRateLimiter(3, clock=clock.clock, sleeper=clock.sleep),
            sleeper=clock.sleep,
            progress=lambda event: None,
        )

    def test_flow_uses_web_before_bouncer_and_chat_after_clustering(self):
        calls = []

        def web(item, keywords=None):
            calls.append(("web", item["title"]))
            return {
                **item,
                "full_contents": f"Extracted {item['title']}",
                "enrichment_status": "success",
            }

        def image(item):
            calls.append(("image", item["title"]))
            return {**item, "top_image": "https://example.test/image.jpg", "image_metadata_status": "success"}

        def chat(item):
            calls.append(("chat", item["title"]))
            return {**item, "master_summary": "Chat summary", "chat_summary_status": "success"}

        with tempfile.TemporaryDirectory() as directory:
            run = self.pipeline(directory, web=web, chat=chat, image=image).run(
                [
                    {"title": "Story A", "link": "https://a.test/story", "source": "A"},
                    {"title": "Story B", "link": "https://b.test/story", "source": "B"},
                ],
                keywords=["AI"],
            )

        self.assertEqual([call[0] for call in calls], ["web", "web", "image", "image", "chat"])
        self.assertEqual(run.metrics["discovered"], 2)
        self.assertEqual(run.metrics["clustered_events"], 1)
        self.assertEqual(run.metrics["chat_summarized"], 1)
        self.assertEqual(run.items[0]["source_count"], 2)

    def test_web_search_failure_is_quarantined(self):
        chat_calls = []

        def failed_web(item, keywords=None):
            return {**item, "enrichment_status": "failed", "enrichment_error": "no match"}

        def chat(item):
            chat_calls.append(item)
            return {**item, "chat_summary_status": "success"}

        with tempfile.TemporaryDirectory() as directory:
            run = self.pipeline(
                directory,
                web=failed_web,
                chat=chat,
                image=lambda item: item,
            ).run([{"title": "Unknown", "link": "https://unknown.test", "source": "Unknown"}])

        self.assertEqual(run.items, [])
        self.assertEqual(run.quarantine[0]["quarantine_stage"], "samsung_web_search")
        self.assertEqual(chat_calls, [])

    def test_successful_external_results_resume_from_checkpoint(self):
        counts = {"web": 0, "chat": 0}

        def web(item, keywords=None):
            counts["web"] += 1
            return {**item, "full_contents": "Extracted", "enrichment_status": "success"}

        def chat(item):
            counts["chat"] += 1
            return {**item, "master_summary": "Summary", "chat_summary_status": "success"}

        article = {"title": "Story", "link": "https://a.test/story", "source": "A"}
        with tempfile.TemporaryDirectory() as directory:
            first = self.pipeline(directory, web=web, chat=chat, image=lambda item: item)
            first.run([article])
            second = self.pipeline(directory, web=web, chat=chat, image=lambda item: item)
            second.run([article])

        self.assertEqual(counts, {"web": 1, "chat": 1})

    def test_rate_limit_is_hard_capped_at_three_and_evenly_paced(self):
        clock = FakeClock()
        limiter = PacedRateLimiter(99, clock=clock.clock, sleeper=clock.sleep)
        starts = []
        for _ in range(4):
            limiter.acquire()
            starts.append(clock.now)

        self.assertEqual(limiter.requests_per_minute, 3)
        self.assertEqual(starts, [0.0, 20.0, 40.0, 60.0])


if __name__ == "__main__":
    unittest.main()
