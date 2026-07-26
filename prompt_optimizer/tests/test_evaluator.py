"""Tests for evaluator facade re-exports."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import evaluator


class EvaluatorFacadeTest(unittest.TestCase):
    def test_public_api_exports(self) -> None:
        for name in evaluator.__all__:
            self.assertTrue(hasattr(evaluator, name))


if __name__ == "__main__":
    unittest.main()
