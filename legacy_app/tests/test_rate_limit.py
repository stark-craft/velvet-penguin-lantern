import unittest

from core.rate_limit import PacedRateLimiter


class FakeClock:
    def __init__(self):
        self.value = 0.0
        self.sleeps = []

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.value += seconds


class RateLimitTests(unittest.TestCase):
    def test_internal_api_quota_is_capped_and_evenly_paced(self):
        clock = FakeClock()
        limiter = PacedRateLimiter(
            99,
            maximum_requests_per_minute=3,
            clock=clock.now,
            sleeper=clock.sleep,
        )
        starts = []
        for _ in range(4):
            limiter.acquire()
            starts.append(clock.value)

        self.assertEqual(limiter.requests_per_minute, 3)
        self.assertEqual(starts, [0.0, 20.0, 40.0, 60.0])


if __name__ == "__main__":
    unittest.main()
