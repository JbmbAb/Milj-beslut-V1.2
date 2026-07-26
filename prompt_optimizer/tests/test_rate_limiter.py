"""Tests for sync rate limiter."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rate_limiter import RateLimiter


class RateLimiterTest(unittest.TestCase):
    def test_acquire_within_limits(self) -> None:
        limiter = RateLimiter(max_requests_per_minute=1000, max_tokens_per_minute=1_000_000)
        limiter.acquire(estimated_tokens=100)
        limiter.acquire(estimated_tokens=50)

    def test_record_tokens_noop_when_actual_lower(self) -> None:
        limiter = RateLimiter(max_requests_per_minute=100, max_tokens_per_minute=10_000)
        limiter.acquire(estimated_tokens=200)
        limiter.record_tokens(actual_tokens=100, estimated_tokens=200)


if __name__ == '__main__':
    unittest.main()
