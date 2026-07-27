"""Thread-safe pacing for shared internal API quotas."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable


class PacedRateLimiter:
    """Space calls evenly and cap the configured requests-per-minute value."""

    def __init__(
        self,
        requests_per_minute: int,
        *,
        maximum_requests_per_minute: int = 3,
        clock: Callable[[], float] = time.monotonic,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.requests_per_minute = min(
            max(1, int(maximum_requests_per_minute)),
            max(1, int(requests_per_minute)),
        )
        self.minimum_interval = 60.0 / self.requests_per_minute
        self._clock = clock
        self._sleep = sleeper
        self._last_started: float | None = None
        self._lock = threading.Lock()

    def acquire(self) -> None:
        """Wait until the next request is allowed.

        The lock covers the wait as well as the timestamp update. Concurrent
        scheduler/manual-scan threads therefore share one quota instead of each
        believing it can send three requests per minute.
        """

        with self._lock:
            now = self._clock()
            if self._last_started is not None:
                remaining = self.minimum_interval - (now - self._last_started)
                if remaining > 0:
                    self._sleep(remaining)
                    now = self._clock()
            self._last_started = now
