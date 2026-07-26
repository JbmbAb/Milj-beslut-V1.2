import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateParamsOnFixtures,
  type LegalSearchEvalParams,
} from '../../../scripts/alphaevolve/experiments/legal_search_params/run_eval';

const root = join(process.cwd(), 'scripts/alphaevolve/experiments/legal_search_params');

describe('legal_search_params fixture eval (Phase 2)', () => {
  const evalSet = JSON.parse(readFileSync(join(root, 'eval-set.json'), 'utf-8')) as {
    cases: Array<{ id: string; query: string; must_include_terms: string[]; min_results: number }>;
  };
  const fixtures = JSON.parse(readFileSync(join(root, 'fixtures/eval-chunks.json'), 'utf-8')) as Record<
    string,
    unknown
  >;

  const defaults: LegalSearchEvalParams = {
    RRF_K: 60,
    RRF_K_EXACT: 30,
    FTS_CANDIDATE_LIMIT: 50,
    VECTOR_CANDIDATE_LIMIT: 50,
    RRF_CANDIDATE_LIMIT: 30,
    RERANKER_FINAL_K: 8,
    LEGAL_RERANKER_RELATIVE_GAP: 0.15,
    rerankerEnabled: true,
  };

  it('default params achieve full recall on fixture set', () => {
    const result = evaluateParamsOnFixtures(defaults, evalSet.cases, fixtures as never);
    expect(result.mean_recall).toBeGreaterThanOrEqual(0.99);
    expect(result.per_case.every((row) => row.recall >= 1)).toBe(true);
  });

  it('low candidate limit can drop recall', () => {
    const weak: LegalSearchEvalParams = {
      ...defaults,
      RRF_CANDIDATE_LIMIT: 1,
      RERANKER_FINAL_K: 1,
    };
    const result = evaluateParamsOnFixtures(weak, evalSet.cases, fixtures as never);
    expect(result.mean_recall).toBeLessThan(1);
  });
});
