"""Async rate limiter: semaphore + requests/min + tokens/min."""

from __future__ import annotations

import asyncio
import os
import time
from collections import deque
from contextlib import asynccontextmanager
from typing import AsyncIterator


class AsyncRateLimiter:
    """Async sliding-window limiter combined with concurrency semaphore."""

    def __init__(
        self,
        *,
        max_concurrent: int | None = None,
        max_requests_per_minute: int | None = None,
        max_tokens_per_minute: int | None = None,
    ) -> None:
        self.max_concurrent = max_concurrent or int(
            os.environ.get("MAX_CONCURRENT_QUERIES", "8")
        )
        self.max_requests = max_requests_per_minute or int(
            os.environ.get("MAX_REQUESTS_PER_MINUTE", "120")
        )
        self.max_tokens = max_tokens_per_minute or int(
            os.environ.get("MAX_TOKENS_PER_MINUTE", "400000")
        )
        self._semaphore = asyncio.Semaphore(self.max_concurrent)
        self._lock = asyncio.Lock()
        self._request_times: deque[float] = deque()
        self._token_events: deque[tuple[float, int]] = deque()
        self._window_s = 60.0

    def _prune(self, now: float) -> None:
        cutoff = now - self._window_s
        while self._request_times and self._request_times[0] < cutoff:
            self._request_times.popleft()
        while self._token_events and self._token_events[0][0] < cutoff:
            self._token_events.popleft()

    def _tokens_in_window(self) -> int:
        return sum(t for _, t in self._token_events)

    async def _wait_for_budget(self, estimated_tokens: int) -> None:
        while True:
            async with self._lock:
                now = time.monotonic()
                self._prune(now)
                req_ok = len(self._request_times) < self.max_requests
                tok_ok = self._tokens_in_window() + estimated_tokens <= self.max_tokens
                if req_ok and tok_ok:
                    self._request_times.append(now)
                    if estimated_tokens > 0:
                        self._token_events.append((now, estimated_tokens))
                    return
                wait_s = 0.05
                if self._request_times:
                    wait_s = max(
                        wait_s, self._window_s - (now - self._request_times[0]) + 0.01
                    )
                if self._token_events:
                    wait_s = max(
                        wait_s, self._window_s - (now - self._token_events[0][0]) + 0.01
                    )
            await asyncio.sleep(min(wait_s, 1.0))

    async def record_tokens(self, actual_tokens: int, estimated_tokens: int) -> None:
        if actual_tokens <= estimated_tokens:
            return
        async with self._lock:
            self._token_events.append(
                (time.monotonic(), actual_tokens - estimated_tokens)
            )

    @asynccontextmanager
    async def acquire(self, estimated_tokens: int = 0) -> AsyncIterator[None]:
        await self._semaphore.acquire()
        try:
            await self._wait_for_budget(estimated_tokens)
            yield
        finally:
            self._semaphore.release()
