import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildIndexProjection,
  createDeterministicHashEmbeddingProvider,
  createGovernedKnowledgeLookup,
  fitIdfTable,
  type GovernedKnowledgeLookup,
  type KnowledgeEmbeddingProvider,
  type KnowledgeIndexProjection,
} from '@miljobeslut/mps-knowledge-index';

import { buildGoldenCorpus, type GoldenCorpus } from '../fixtures/buildGoldenCorpus';
import { GOLDEN_CASES } from '../fixtures/goldenCases';
import {
  calibrateAbstentionThreshold,
  judgeAcceptance,
  runGoldenEval,
  type AbstentionCalibration,
  type EvalReport,
} from '../src';

let corpus: GoldenCorpus;
let provider: KnowledgeEmbeddingProvider;
let index: KnowledgeIndexProjection;
let governed: GovernedKnowledgeLookup;
let calibration: AbstentionCalibration;
let candidate: EvalReport;
let baseline: EvalReport;

beforeAll(async () => {
  corpus = await buildGoldenCorpus();
  provider = createDeterministicHashEmbeddingProvider({
    idf: fitIdfTable(corpus.snapshot.documents.flatMap((d) => d.chunks.map((c) => c.full_text))),
  });
  index = (await buildIndexProjection(corpus.snapshot, provider)).index;
  governed = createGovernedKnowledgeLookup(corpus.snapshot);
  calibration = await calibrateAbstentionThreshold(index, provider, governed);
  const shared = { corpus: corpus.snapshot, index, provider, cases: GOLDEN_CASES, keys: corpus.keys };
  const config = { abstain_below_score: calibration.threshold, abstention_calibration: calibration };
  baseline = await runGoldenEval({ ...shared, config: { ...config, mode: 'unrestricted' } });
  candidate = await runGoldenEval({ ...shared, config: { ...config, mode: 'narrowed' } });
}, 90_000);

describe('K2.2 eval integrity (round 2) — the verdict cannot be reached by turning knobs', () => {
  it('the verdict is defined only for the canonical config with the recorded calibration applied: drift, mismatch or a missing calibration are violations', async () => {
    const shared = { corpus: corpus.snapshot, index, provider, cases: GOLDEN_CASES, keys: corpus.keys };
    const uncalibrated = await runGoldenEval({
      ...shared,
      config: { mode: 'narrowed', abstain_below_score: calibration.threshold },
    });
    expect(
      judgeAcceptance(uncalibrated, baseline).violations.some((v) => v.startsWith('CALIBRATION_MISSING')),
    ).toBe(true);
    const mismatched = await runGoldenEval({
      ...shared,
      config: { mode: 'narrowed', abstain_below_score: 0.8, abstention_calibration: calibration },
    });
    expect(
      judgeAcceptance(mismatched, baseline).violations.some((v) => v.startsWith('CALIBRATION_MISMATCH')),
    ).toBe(true);
    const loosened = await runGoldenEval({
      ...shared,
      config: {
        mode: 'narrowed',
        abstain_below_score: calibration.threshold,
        abstention_calibration: calibration,
        default_required_hit_within: 10,
      },
    });
    expect(loosened.metrics.cases_passed).toBeGreaterThanOrEqual(candidate.metrics.cases_passed);
    expect(judgeAcceptance(loosened, baseline).violations.some((v) => v.startsWith('CONFIG_DRIFT'))).toBe(
      true,
    );
    // A high threshold that leaves retrieval questions unanswered is NON_VACUOUS-rejected even with hits.
    const starved = await runGoldenEval({
      ...shared,
      config: {
        mode: 'narrowed',
        abstain_below_score: 0.8,
        abstention_calibration: { ...calibration, threshold: 0.8 },
      },
    });
    expect(starved.metrics.evaluated_hits).toBeGreaterThan(0);
    expect(starved.metrics.retrieval_cases_no_evidence).toBeGreaterThan(0);
    expect(judgeAcceptance(starved, baseline).violations.some((v) => v.startsWith('NON_VACUOUS'))).toBe(true);
    expect(judgeAcceptance(candidate, baseline)).toEqual({ accepted: true, violations: [] });
  }, 90_000);

  it('structural disclosure is computed INSIDE the narrowed pool: a filter that excludes the relevant chunk is visible as relevant_in_pool = 0, never as a model limitation', async () => {
    const definition = GOLDEN_CASES.find((c) => c.id === 'law-mb-9-1-definition')!;
    const excluded = {
      ...definition,
      id: 'probe-filter-excludes-relevant',
      filters: { ...definition.filters, chapter: '99' },
    };
    const report = await runGoldenEval({
      corpus: corpus.snapshot,
      index,
      provider,
      cases: [excluded],
      keys: corpus.keys,
      config: {
        mode: 'narrowed',
        abstain_below_score: calibration.threshold,
        abstention_calibration: calibration,
      },
    });
    const c = report.cases[0]!;
    expect(c.candidate_count).toBe(0);
    expect(c.relevant_in_index).toBeGreaterThanOrEqual(1);
    expect(c.relevant_in_pool).toBe(0);
    expect(c.structurally_guaranteed).toBe(false);
    for (const r of candidate.cases)
      expect(r.relevant_in_pool, r.case_id).toBeLessThanOrEqual(r.relevant_in_index);
  });

  it('text coverage names every outlier document (not only an aggregate), uncapped', () => {
    const outliers = candidate.coverage.documents_text_coverage_outliers;
    expect(outliers.length).toBeGreaterThanOrEqual(4);
    expect(outliers.map((o) => o.document_id)).toContain(corpus.keys.mora_control);
    expect(outliers.map((o) => o.document_id)).toContain(corpus.keys.mora_decision_v1);
    expect(outliers.every((o) => o.coverage < 0.9 || o.coverage > 1.05)).toBe(true);
    expect(candidate.coverage.text_coverage_min).toBeLessThan(0.7);
  });
});
