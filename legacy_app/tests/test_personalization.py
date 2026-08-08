import datetime as dt
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from news_scrapper.personalization import PersonalizationService


NOW = dt.datetime(2026, 8, 8, 12, 0, tzinfo=dt.timezone.utc)


def article(title, *, keyword, score=70, link=None):
    return {
        "title": title,
        "link": link or f"https://example.com/{title.casefold().replace(' ', '-')}",
        "keywords_found": [keyword],
        "category": "Technology",
        "source": "Example",
        "importance_score": score,
        "source_count": 1,
    }


class PersonalizationTests(unittest.TestCase):
    def service(self, directory):
        return PersonalizationService(Path(directory) / "viewer_personalization.json")

    def test_viewer_and_profile_preferences_are_isolated(self):
        with tempfile.TemporaryDirectory() as directory:
            service = self.service(directory)
            ai = article("AI model release", keyword="AI", score=65)
            tv = article("Premium television launch", keyword="Television", score=78)
            service.record_event("viewer-a", "default", "vote_interested", ai, now=NOW)

            ranked_a, meta_a = service.rank_articles(
                [tv, ai], "viewer-a", "default", now=NOW
            )
            ranked_other, meta_other = service.rank_articles(
                [tv, ai], "viewer-b", "default", now=NOW
            )
            ranked_broadcast, meta_broadcast = service.rank_articles(
                [tv, ai], "viewer-a", "broadcast", now=NOW
            )

        self.assertEqual(ranked_a[0]["title"], "AI model release")
        self.assertTrue(meta_a["applied"])
        self.assertEqual([item["title"] for item in ranked_other], [tv["title"], ai["title"]])
        self.assertFalse(meta_other["applied"])
        self.assertEqual([item["title"] for item in ranked_broadcast], [tv["title"], ai["title"]])
        self.assertFalse(meta_broadcast["applied"])

    def test_recent_saved_story_marks_related_update_but_not_every_viewer(self):
        saved = article(
            "Tesla sends Optimus robot to Mars",
            keyword="Optimus",
            link="https://example.com/saved",
        )
        saved["saved_at"] = (NOW - dt.timedelta(days=5)).isoformat()
        update = article(
            "Tesla reveals new Optimus robot mission",
            keyword="Optimus",
            score=55,
            link="https://example.com/update",
        )
        unrelated = article("OLED television launch", keyword="OLED", score=90)

        with tempfile.TemporaryDirectory() as directory:
            service = self.service(directory)
            ranked, meta = service.rank_articles(
                [unrelated, update], "viewer-a", "default", [saved], now=NOW
            )
            other, other_meta = service.rank_articles(
                [unrelated, update], "viewer-b", "default", [], now=NOW
            )

        self.assertEqual(ranked[0]["title"], update["title"])
        self.assertTrue(ranked[0]["personalization"]["follow_up"])
        self.assertEqual(
            ranked[0]["personalization"]["follow_label"],
            "Update to a story you saved",
        )
        self.assertEqual(meta["follow_up_count"], 1)
        self.assertFalse(other_meta["applied"])
        self.assertFalse(other[1]["personalization"]["follow_up"])

    def test_saved_story_stops_influencing_rank_after_thirty_days(self):
        saved = article("Optimus robot mission", keyword="Optimus")
        saved["saved_at"] = (NOW - dt.timedelta(days=31)).isoformat()
        update = article("New Optimus robot mission", keyword="Optimus", score=50)
        leader = article("Major display launch", keyword="Display", score=95)

        with tempfile.TemporaryDirectory() as directory:
            service = self.service(directory)
            ranked, meta = service.rank_articles(
                [leader, update], "viewer-a", "default", [saved], now=NOW
            )

        self.assertEqual(ranked[0]["title"], leader["title"])
        self.assertFalse(meta["applied"])
        self.assertEqual(meta["saved_signal_count"], 0)
        self.assertFalse(ranked[1]["personalization"]["follow_up"])

    def test_negative_feedback_deprioritizes_without_deleting(self):
        disliked = article("AI regulation debate", keyword="AI", score=82)
        alternative = article("OLED production expands", keyword="OLED", score=75)
        with tempfile.TemporaryDirectory() as directory:
            service = self.service(directory)
            service.record_event(
                "viewer-a", "default", "vote_not_interested", disliked, now=NOW
            )
            ranked, _ = service.rank_articles(
                [disliked, alternative], "viewer-a", "default", now=NOW
            )

        self.assertEqual(len(ranked), 2)
        self.assertEqual(ranked[0]["title"], alternative["title"])

    def test_atomic_store_retains_concurrent_events(self):
        with tempfile.TemporaryDirectory() as directory:
            service = self.service(directory)
            signal = article("Concurrent AI signal", keyword="AI")
            with ThreadPoolExecutor(max_workers=12) as executor:
                futures = [
                    executor.submit(
                        service.record_event,
                        "viewer-a",
                        "default",
                        "dossier_open",
                        signal,
                        now=NOW + dt.timedelta(seconds=index),
                    )
                    for index in range(80)
                ]
                self.assertTrue(all(future.result() for future in futures))
            summary = service.summary("viewer-a", "default")

        self.assertEqual(summary["event_count"], 80)

    def test_hundred_viewers_can_write_and_rank_two_hundred_signal_feeds(self):
        with tempfile.TemporaryDirectory() as directory:
            service = self.service(directory)
            viewers = [f"viewer-{index}" for index in range(100)]
            feed = [
                article(
                    f"Signal {index} about topic {index % 12}",
                    keyword=f"topic-{index % 12}",
                    score=50 + (index % 45),
                )
                for index in range(200)
            ]
            with ThreadPoolExecutor(max_workers=24) as executor:
                writes = [
                    executor.submit(
                        service.record_event,
                        viewer,
                        "default",
                        "dossier_open",
                        feed[index % len(feed)],
                        now=NOW,
                    )
                    for index, viewer in enumerate(viewers)
                ]
                self.assertTrue(all(result.result() for result in writes))
                reads = [
                    executor.submit(
                        service.rank_articles,
                        feed,
                        viewer,
                        "default",
                        (),
                        now=NOW,
                    )
                    for viewer in viewers
                ]
                ranked_results = [result.result() for result in reads]

        self.assertTrue(all(len(ranked) == 200 for ranked, _ in ranked_results))
        self.assertTrue(all(meta["event_count"] == 1 for _, meta in ranked_results))


if __name__ == "__main__":
    unittest.main()
