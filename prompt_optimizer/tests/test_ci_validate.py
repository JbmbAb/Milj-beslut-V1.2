"""Tests for CI results validation script."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(REPO_ROOT, 'scripts'))

from ci_validate_results import find_winner, validate  # noqa: E402


def _sample_results() -> dict:
    return {
        'summary': {'winner': 'v1'},
        'variants': [
            {
                'variant_id': 'v1',
                'mean_ndcg': 0.85,
                'confidence_intervals': {'ndcg10': {'lower': 0.80, 'upper': 0.90, 'mean': 0.85}},
                'p95_latency_s': 1.5,
                'failure_rate': 0.0,
            }
        ],
    }


class CiValidateResultsTest(unittest.TestCase):
    def test_find_winner(self) -> None:
        winner = find_winner(_sample_results())
        self.assertEqual(winner['variant_id'], 'v1')

    def test_validate_passes_clean_results(self) -> None:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as handle:
            json.dump(_sample_results(), handle)
            path = handle.name
        try:
            errors = validate(path, hard_failure_rate=0.05)
            self.assertEqual(errors, [])
        finally:
            os.unlink(path)

    def test_validate_fails_on_high_failure_rate(self) -> None:
        data = _sample_results()
        data['variants'][0]['failure_rate'] = 0.10
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as handle:
            json.dump(data, handle)
            path = handle.name
        try:
            errors = validate(path, hard_failure_rate=0.05)
            self.assertTrue(any('failure' in err.lower() for err in errors))
        finally:
            os.unlink(path)

    def test_validate_empty_variants(self) -> None:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as handle:
            json.dump({'variants': []}, handle)
            path = handle.name
        try:
            errors = validate(path)
            self.assertIn('no variants in results', errors)
        finally:
            os.unlink(path)


if __name__ == '__main__':
    unittest.main()
