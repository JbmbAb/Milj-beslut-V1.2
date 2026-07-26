"""Unit tests for production prompt optimizer."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cache import PersistentCache, build_cache_key, candidate_hash
from metrics import (
    bootstrap_ci,
    kendall_tau,
    mrr_at_k,
    ndcg_at_k,
    pareto_frontier,
    percentile,
    pick_winner_pareto,
    recall_at_k,
    spearman_rank,
)
from eval import normalize_record, score_prompt_variant
from rerank_client import RerankClient


class MetricsTest(unittest.TestCase):
    def test_spearman_perfect_match(self) -> None:
        gold = ['a', 'b', 'c']
        self.assertAlmostEqual(spearman_rank(gold, ['a', 'b', 'c']), 1.0)

    def test_kendall_tau(self) -> None:
        self.assertAlmostEqual(kendall_tau(['a', 'b', 'c'], ['a', 'b', 'c']), 1.0)

    def test_ndcg_perfect(self) -> None:
        self.assertAlmostEqual(ndcg_at_k(['a', 'b'], ['a', 'b'], 2), 1.0)

    def test_recall_at_k(self) -> None:
        self.assertAlmostEqual(recall_at_k(['a', 'b'], ['a', 'x'], 1), 0.5)

    def test_bootstrap_ci(self) -> None:
        ci = bootstrap_ci([0.8, 0.9, 0.85, 0.88], n_resamples=200, seed=1)
        self.assertLess(ci['lower'], ci['mean'])
        self.assertGreater(ci['upper'], ci['mean'])

    def test_pareto_frontier(self) -> None:
        variants = [
            {'variant_id': 'a', 'mean_ndcg': 0.9, 'mean_spearman': 0.8, 'mean_mrr': 0.7, 'mean_map': 0.7,
             'mean_kendall_tau': 0.7, 'p95_latency_s': 2.0, 'est_cost_usd': 1.0, 'failure_rate': 0.0},
            {'variant_id': 'b', 'mean_ndcg': 0.85, 'mean_spearman': 0.85, 'mean_mrr': 0.7, 'mean_map': 0.7,
             'mean_kendall_tau': 0.7, 'p95_latency_s': 1.0, 'est_cost_usd': 0.5, 'failure_rate': 0.0},
        ]
        frontier = pareto_frontier(variants)
        self.assertIn('a', frontier)
        self.assertIn('b', frontier)

    def test_pick_winner_under_latency_budget(self) -> None:
        variants = [
            {'variant_id': 'a', 'mean_ndcg': 0.9, 'mean_spearman': 0.8, 'p95_latency_s': 5.0, 'est_cost_usd': 1},
            {'variant_id': 'b', 'mean_ndcg': 0.85, 'mean_spearman': 0.85, 'p95_latency_s': 1.0, 'est_cost_usd': 0.5},
        ]
        winner = pick_winner_pareto(variants, latency_budget_s=2.0)
        self.assertEqual(winner['variant_id'], 'b')


class CacheTest(unittest.TestCase):
    def test_persistent_cache_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db = os.path.join(tmp, 'cache.sqlite')
            cache = PersistentCache(db_path=db)
            key = build_cache_key(
                prompt_hash='ph', query_id='q1', candidate_hash='ch', reranker_version='v1',
            )
            cache.put(
                key,
                prompt_hash='ph',
                query_id='q1',
                candidate_hash='ch',
                reranker_version='v1',
                variant_id='v1',
                ranking=[{'id': 'd1', 'score': 0.9}],
                latency={'total_ms': 100.0},
                tokens_in=10,
                tokens_out=5,
                cost_usd=0.001,
                engine='mock',
            )
            got = cache.get(key)
            self.assertIsNotNone(got)
            assert got is not None
            self.assertEqual(got['ranking'][0]['id'], 'd1')


class EvalTest(unittest.TestCase):
    def test_normalize_record(self) -> None:
        row = normalize_record({
            'id': 'q1',
            'query': 'test',
            'gold_ranking': ['d1', 'd2'],
            'context_documents': [{'doc_id': 'd1', 'text': 'a'}],
        })
        self.assertEqual(row['query_id'], 'q1')

    def test_score_with_mock_and_resume(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            os.environ['MOCK_RERANK'] = '1'
            db = os.path.join(tmp, 'cache.sqlite')
            cache = PersistentCache(db_path=db)
            client = RerankClient(mode='mock', persistent_cache=cache)
            records = [{
                'id': 'q1',
                'query': 'skyddade områden västerås',
                'gold_ranking': ['d1', 'd2'],
                'context_documents': [
                    {'doc_id': 'd1', 'text': 'skyddade områden i västerås'},
                    {'doc_id': 'd2', 'text': 'vägkarta'},
                ],
            }]
            template = 'Rank "{{QUERY}}".\n\n{{DOCUMENTS}}'
            r1 = score_prompt_variant(records, template, variant_id='v1', client=client, max_workers=1)
            r2 = score_prompt_variant(records, template, variant_id='v1', client=client, max_workers=1)
            self.assertEqual(r1['n_queries'], 1)
            self.assertEqual(r2['n_resumed_from_cache'], 1)
            self.assertTrue(any(pq.get('cached') for pq in r2['per_query']))


if __name__ == '__main__':
    unittest.main()
