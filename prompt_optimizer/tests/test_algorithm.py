"""Tests for prompt variant generation (algorithm module)."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from algorithm import DEFAULT_VARIANT_SEEDS, build_variants


class AlgorithmTest(unittest.TestCase):
    def test_build_variants_count(self) -> None:
        variants = build_variants('', 3)
        self.assertEqual(len(variants), 3)
        self.assertEqual(variants[0][0], 'v1')
        self.assertEqual(variants[2][0], 'v3')

    def test_custom_base_template_first(self) -> None:
        custom = 'Custom template for {{QUERY}}'
        variants = build_variants(custom, 1)
        self.assertEqual(variants[0][1], custom)

    def test_cycles_seeds_when_iterations_exceed_seeds(self) -> None:
        n = len(DEFAULT_VARIANT_SEEDS) + 1
        variants = build_variants('', n)
        self.assertEqual(variants[-1][1], DEFAULT_VARIANT_SEEDS[0])

    def test_variant_ids_are_unique(self) -> None:
        variants = build_variants('', 4)
        ids = [vid for vid, _ in variants]
        self.assertEqual(len(ids), len(set(ids)))


if __name__ == '__main__':
    unittest.main()
