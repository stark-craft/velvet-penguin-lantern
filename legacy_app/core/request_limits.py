"""Small process-local rate limits for expensive or privileged operations."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._events: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = threading.RLock()

    def check(
        self,
        operation: str,
        principal: str,
        *,
        limit: int,
        window_seconds: int,
    ) -> None:
        now = time.monotonic()
        cutoff = now - max(1, window_seconds)
        key = (str(operation), str(principal))
        with self._lock:
            values = self._events[key]
            while values and values[0] <= cutoff:
                values.popleft()
            if len(values) >= max(1, limit):
                retry_after = max(1, round(values[0] + window_seconds - now))
                raise HTTPException(
                    status_code=429,
                    detail="This operation was requested too often. Try again shortly.",
                    headers={"Retry-After": str(retry_after)},
                )
            values.append(now)


REQUEST_LIMITER = SlidingWindowLimiter()
