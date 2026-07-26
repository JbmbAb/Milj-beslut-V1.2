"""Thread-safe rate limiter for requests/min and tokens/min (separate from concurrency)."""

from __future__ import annotations

import os
import threading
import time
from collections import deque


class RateLimiter:
    """
    Sliding-window limiter for concurrent workers.
    Use together with threading.Semaphore for max concurrent in-flight requests.
    """

    def __init__(
        self,
        *,
        max_requests_per_minute: int | None = None,
        max_tokens_per_minute: int | None = None,
    ) -> None:
        self.max_requests = max_requests_per_minute or int(
            os.environ.get('MAX_REQUESTS_PER_MINUTE', '120')
        )
        self.max_tokens = max_tokens_per_minute or int(
            os.environ.get('MAX_TOKENS_PER_MINUTE', '400000')
        )
        self._lock = threading.Lock()
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

    def acquire(self, estimated_tokens: int = 0) -> None:
        """Block until request and token budgets allow the next call."""
        while True:
            with self._lock:
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
                    wait_s = max(wait_s, self._window_s - (now - self._request_times[0]) + 0.01)
                if self._token_events:
                    wait_s = max(wait_s, self._window_s - (now - self._token_events[0][0]) + 0.01)
            time.sleep(min(wait_s, 1.0))

    def record_tokens(self, actual_tokens: int, estimated_tokens: int) -> None:
        """Adjust token accounting when actual usage differs from estimate."""
        if actual_tokens <= estimated_tokens:
            return
        with self._lock:
            delta = actual_tokens - estimated_tokens
            self._token_events.append((time.monotonic(), delta))
