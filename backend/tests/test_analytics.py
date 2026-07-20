from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Optional
from uuid import UUID, uuid4

from signalroom.models import (
    ArticleCreate,
    ProfileId,
    TelemetryEventCreate,
    TelemetryEventType,
    make_stable_id,
)
from signalroom.services.analytics import DetailedAnalyticsService
from signalroom.storage import Repository


class DetailedAnalyticsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.repository = Repository(Path(self.temporary_directory.name) / "analytics.db")
        self.end_at = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def create_article(self, suffix: str):
        url = f"https://example.com/{suffix}"
        return self.repository.upsert_article(
            ArticleCreate(
                stable_id=make_stable_id("article", url),
                title=f"Article {suffix}",
                canonical_url=url,
                profiles=(ProfileId.DEFAULT,),
            )
        )

    def record(
        self,
        *,
        session_id: UUID,
        occurred_at: datetime,
        event_type: TelemetryEventType = TelemetryEventType.PAGE_VIEW,
        actor_id: Optional[str] = "verified:reader@example.com",
        profile: ProfileId = ProfileId.DEFAULT,
        path: Optional[str] = "/briefing",
        article_id: Optional[UUID] = None,
        properties=None,
        ip_hash: Optional[str] = None,
    ):
        return self.repository.record_activity(
            TelemetryEventCreate(
                profile=profile,
                session_id=session_id,
                actor_id=actor_id,
                event_type=event_type,
                path=path,
                article_id=article_id,
                properties=properties or {},
                ip_hash=ip_hash,
                occurred_at=occurred_at,
            )
        )

    def test_window_rollups_estimate_active_time_and_strip_private_payloads(self) -> None:
        article = self.create_article("one")
        primary_session = uuid4()
        secondary_session = uuid4()
        started = self.end_at - timedelta(hours=1)
        private_hash = "ip:v1:" + "a" * 64

        self.record(
            session_id=primary_session,
            occurred_at=started,
            path="https://portal.internal/briefing?token=do-not-return#private",
            ip_hash=private_hash,
            properties={"note": "private-property-value"},
        )
        self.record(
            session_id=primary_session,
            occurred_at=started + timedelta(minutes=2),
            event_type=TelemetryEventType.HEARTBEAT,
            ip_hash=private_hash,
        )
        self.record(
            session_id=primary_session,
            occurred_at=started + timedelta(minutes=12),
            event_type=TelemetryEventType.ARTICLE_OPEN,
            path=f"/articles/{article.id}?access_key=do-not-return",
            article_id=article.id,
            ip_hash=private_hash,
        )
        self.record(
            session_id=primary_session,
            occurred_at=started + timedelta(minutes=13),
            event_type=TelemetryEventType.ARTICLE_ACTION,
            path=f"/articles/{article.id}",
            article_id=article.id,
            properties={"action": "interesting", "note": "private-property-value"},
            ip_hash=private_hash,
        )
        self.record(
            session_id=secondary_session,
            actor_id="anonymous:public-pseudonym",
            occurred_at=started + timedelta(minutes=20),
            path="feed/today?secret=do-not-return",
        )

        # Included in the repository's lifetime total, but outside this window.
        self.record(
            session_id=uuid4(),
            actor_id="verified:old-user@example.com",
            occurred_at=self.end_at - timedelta(days=8),
        )
        # Profile isolation is enforced by repository pagination.
        self.record(
            session_id=uuid4(),
            actor_id="verified:broadcast@example.com",
            profile=ProfileId.BROADCAST,
            occurred_at=started,
        )

        result = DetailedAnalyticsService(self.repository).build(
            profile=ProfileId.DEFAULT,
            window_days=7,
            end_at=self.end_at,
        )

        self.assertEqual(result.summary.event_count, 5)
        self.assertEqual(result.summary.session_count, 2)
        self.assertEqual(result.summary.unique_actors, 2)
        self.assertEqual(result.summary.article_count, 1)
        # Gaps: 2 minutes + capped 5 minutes + 1 minute.  A singleton
        # secondary session contributes no invented tail time.
        self.assertEqual(result.summary.active_minutes, 8.0)
        self.assertEqual(result.summary.event_types["heartbeat"], 1)
        self.assertEqual(result.summary.action_types, {"interesting": 1})
        self.assertEqual(result.coverage.profile_total_events, 6)
        self.assertFalse(result.coverage.events_truncated)

        primary_user = next(
            user for user in result.users if user.actor_id == "verified:reader@example.com"
        )
        self.assertEqual(primary_user.active_minutes, 8.0)
        self.assertEqual(primary_user.session_count, 1)
        self.assertEqual(primary_user.article_count, 1)
        self.assertEqual(result.sessions[0].session_id, primary_session)
        self.assertEqual(result.sessions[0].active_minutes, 8.0)

        paths = {item.path for item in result.summary.paths}
        self.assertIn("/briefing", paths)
        self.assertIn("/feed/today", paths)
        serialized = result.model_dump_json()
        self.assertNotIn("ip:v1:", serialized)
        self.assertNotIn("do-not-return", serialized)
        self.assertNotIn("private-property-value", serialized)
        self.assertNotIn("properties", serialized)

    def test_unsafe_network_actor_is_not_exposed_as_a_user_identifier(self) -> None:
        self.record(
            session_id=uuid4(),
            actor_id="203.0.113.77",
            occurred_at=self.end_at - timedelta(minutes=1),
            # URLs containing an address remain valid metadata; analytics must
            # still strip both the payload and the unsafe actor identifier.
            properties={
                "action": "not-a-recognized-action",
                "remote_url": "https://198.51.100.4/status",
            },
        )

        result = DetailedAnalyticsService(self.repository).build(
            profile=ProfileId.DEFAULT,
            end_at=self.end_at,
        )

        self.assertEqual(result.summary.unique_actors, 0)
        self.assertEqual(result.summary.unattributed_event_count, 1)
        self.assertEqual(len(result.users), 1)
        self.assertIsNone(result.users[0].actor_id)
        serialized = result.model_dump_json()
        self.assertNotIn("203.0.113.77", serialized)
        self.assertNotIn("198.51.100.4", serialized)
        self.assertEqual(result.summary.action_types, {})

    def test_event_and_row_limits_are_reported(self) -> None:
        for offset in range(4):
            self.record(
                session_id=uuid4(),
                actor_id=f"verified:user-{offset}@example.com",
                occurred_at=self.end_at - timedelta(minutes=offset + 1),
            )

        result = DetailedAnalyticsService(
            self.repository,
            event_limit=2,
            user_limit=1,
            session_limit=1,
        ).build(profile=ProfileId.DEFAULT, end_at=self.end_at)

        self.assertEqual(result.summary.event_count, 2)
        self.assertEqual(result.coverage.events_examined, 2)
        self.assertTrue(result.coverage.events_truncated)
        self.assertEqual(result.coverage.profile_total_events, 4)
        self.assertEqual(result.coverage.user_rows_available, 2)
        self.assertEqual(result.coverage.user_rows_returned, 1)
        self.assertTrue(result.coverage.user_rows_truncated)
        self.assertEqual(result.coverage.session_rows_available, 2)
        self.assertEqual(result.coverage.session_rows_returned, 1)
        self.assertTrue(result.coverage.session_rows_truncated)

    def test_configuration_and_window_bounds_are_enforced(self) -> None:
        with self.assertRaises(ValueError):
            DetailedAnalyticsService(self.repository, event_limit=0)
        with self.assertRaises(ValueError):
            DetailedAnalyticsService(self.repository, idle_cap_minutes=61)
        with self.assertRaises(ValueError):
            DetailedAnalyticsService(self.repository).build(
                profile=ProfileId.DEFAULT,
                window_days=91,
                end_at=self.end_at,
            )
        with self.assertRaises(ValueError):
            DetailedAnalyticsService(self.repository).build(
                profile=ProfileId.DEFAULT,
                end_at=datetime(2026, 7, 20, 12, 0),
            )


if __name__ == "__main__":
    unittest.main()
