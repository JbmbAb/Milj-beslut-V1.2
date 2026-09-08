import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildIndexProjection,
  computeIndexSnapshotIdentity,
  createDeterministicHashEmbeddingProvider,
  createGovernedKnowledgeLookup,
  fitIdfTable,
  searchKnowledgeIndex,
  verifyIndexProjection,
  type GovernedKnowledgeLookup,
  type IndexRow,
  type KnowledgeEmbeddingProvider,
  type KnowledgeIndexProjection,
} from '@miljobeslut/mps-knowledge-index';

import { buildGoldenCorpus, type GoldenCorpus } from '../fixtures/buildGoldenCorpus';
import { GOLDEN_CASES } from '../fixtures/goldenCases';
import {
  calibrateAbstentionThreshold,
  goldSetHash,
  judgeAcceptance,
  runGoldenEval,
  writeEvalReport,
  type AbstentionCalibration,
  type EvalReport,
} from '../src';

/**
 * GOLD SET v1 identity. Any edit to fixtures/goldenCases.ts changes this hash: bumping it here is
 * the deliberate, reviewable act that the authoring log in goldenCases.ts must explain.
 */
const GOLD_SET_V1_HASH = '460b9c27b69d0761cc242850683c1da387e38840852d100a0b5e25fd98e6362e';

let corpus: GoldenCorpus;
let provider: KnowledgeEmbeddingProvider;
let index: KnowledgeIndexProjection;
let governed: GovernedKnowledgeLookup;
let calibration: AbstentionCalibration;
let baseline: EvalReport;
let sourceNarrowed: EvalReport;
let candidate: EvalReport;
const tmpDirs: string[] = [];

beforeAll(async () => {
  corpus = await buildGoldenCorpus();
  // The fixture embedding is fitted (IDF) on the governed chunk texts of this exact corpus — a
  // deterministic function of the corpus, with the table identity bound into model_version.
  const idf = fitIdfTable(corpus.snapshot.documents.flatMap((d) => d.chunks.map((c) => c.full_text)));
  // Exact-vocabulary mode: one dimension per fitted term, no hashing, null floor exactly 0.
  provider = createDeterministicHashEmbeddingProvider({ idf });
  index = (await buildIndexProjection(corpus.snapshot, provider)).index;
  expect(verifyIndexProjection(index, corpus.snapshot)).toEqual([]);
  governed = createGovernedKnowledgeLookup(corpus.snapshot);
  // Abstention threshold from a NULL model (out-of-domain calibration queries disjoint from the
  // gold abstention cases), fixed before any mode is evaluated and identical for all of them.
  calibration = await calibrateAbstentionThreshold(index, provider, governed);
  const shared = { corpus: corpus.snapshot, index, provider, cases: GOLDEN_CASES, keys: corpus.keys };
  const config = { abstain_below_score: calibration.threshold, abstention_calibration: calibration };
  baseline = await runGoldenEval({ ...shared, config: { ...config, mode: 'unrestricted' } });
  sourceNarrowed = await runGoldenEval({ ...shared, config: { ...config, mode: 'source_narrowed' } });
  candidate = await runGoldenEval({ ...shared, config: { ...config, mode: 'narrowed' } });
}, 60_000);

afterAll(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/** Re-stamps the index identity (a forger who recomputes hashes): only the governed cross-check can catch the forgery. */
function restamp(base: KnowledgeIndexProjection, rows: readonly IndexRow[]): KnowledgeIndexProjection {
  return {
    ...base,
    rows,
    index_snapshot_identity: computeIndexSnapshotIdentity({
      provider: base.provider,
      corpus_snapshot_identity: base.corpus_snapshot_identity,
      catalog_origin: base.catalog_origin,
      skipped_documents: base.skipped_documents,
      rows,
    }),
  };
}

describe('K2.2 golden eval harness', () => {
  it('has a reviewable golden set of 20-50 cases spanning roles and failure modes, pinned by hash', () => {
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(20);
    expect(GOLDEN_CASES.length).toBeLessThanOrEqual(50);
    const categories = new Set(GOLDEN_CASES.map((c) => c.category));
    for (const required of [
      'law',
      'ordinance',
      'court',
      'decision',
      'mkb',
      'technical',
      'control',
      'guidance',
      'version',
      'abstention',
      'adversarial',
    ]) {
      expect(categories.has(required as never), required).toBe(true);
    }
    expect(goldSetHash(GOLDEN_CASES)).toBe(GOLD_SET_V1_HASH);
    expect(candidate.gold_set_hash).toBe(GOLD_SET_V1_HASH);
  });

  it('is deterministic: two runs produce byte-identical reports', async () => {
    const again = await runGoldenEval({
      corpus: corpus.snapshot,
      index,
      provider,
      cases: GOLDEN_CASES,
      keys: corpus.keys,
      config: {
        mode: 'narrowed',
        abstain_below_score: calibration.threshold,
        abstention_calibration: calibration,
      },
    });
    expect(again.report_hash).toBe(candidate.report_hash);
    expect(again.cases.map((c) => c.trace_hash)).toEqual(candidate.cases.map((c) => c.trace_hash));
  });

  it('candidate: every evaluated hit resolves chunk -> document -> registry entry (100% provenance correctness), no unauthorized, no stale, no fabricated evidence', () => {
    expect(candidate.index_verified).toBe('verified_with_reembedding');
    expect(candidate.metrics.provenance_correctness).toBe(1);
    expect(candidate.metrics.canonical_identity_resolution).toBe(1);
    expect(candidate.metrics.unauthorized_source_acceptance).toBe(0);
    expect(candidate.metrics.stale_or_wrong_version_acceptance).toBe(0);
    expect(candidate.metrics.unsupported_claim_rate).toBe(0);
    expect(candidate.metrics.exclusion_violations).toBe(0);
    expect(candidate.metrics.version_correctness).toBe(1);
    expect(candidate.metrics.evaluated_hits).toBeGreaterThan(30);
    const verdict = judgeAcceptance(candidate, baseline);
    expect(verdict.violations).toEqual([]);
    expect(verdict.accepted).toBe(true);
  });

  /**
   * Retrieval cases the FIXTURE embedding is known not to rank within the required rank. The gold
   * case is correct and stays in the set (it is the signal a production embedding is evaluated
   * against); the failure is a documented property of a bag-of-stems cosine model, recorded with
   * the measured behaviour so a verifier can reproduce it. The list is asserted EXACTLY: an
   * unexpected new failure and an unexpected pass both surface, and a listed case must still fail
   * ONLY on relevance with its relevant chunk present in the pool (a broken predicate would show
   * up as relevant_in_pool = 0).
   */
  const KNOWN_FIXTURE_MODEL_LIMITATIONS: ReadonlyMap<string, string> = new Map([
    [
      'law-mb-9-1-definition',
      'cosine length bias: the 49-token MB 9 kap. 1 § definition chunk ranks 8th (score ~0.17) behind 6-14-token ' +
        'fragments that also contain "miljöfarlig verksamhet" (9 kap. 6 b § ~0.38); the query shares only ' +
        'avses/miljöfarlig/verksamhet with it and nothing distinguishes the definition lexically.',
    ],
  ]);

  it('candidate: every retrieval case finds a relevant governed chunk within its required rank, except the exactly-listed fixture-model limitations', () => {
    const failed = candidate.cases.filter((c) => c.outcome === 'FAIL');
    const unexpected = failed.filter((c) => !KNOWN_FIXTURE_MODEL_LIMITATIONS.has(c.case_id));
    expect(
      unexpected.map(
        (c) =>
          `${c.case_id}: ${c.failure_reasons.join(' | ')} :: ${c.hits
            .slice(0, 3)
            .map((h) => `${h.source_id}#${h.anchor}@${h.score}`)
            .join(', ')}`,
      ),
    ).toEqual([]);
    for (const [caseId, reason] of KNOWN_FIXTURE_MODEL_LIMITATIONS) {
      const c = candidate.cases.find((x) => x.case_id === caseId);
      expect(c, `${caseId} (${reason})`).toBeDefined();
      expect(
        c!.outcome,
        `${caseId} no longer fails under the fixture model — remove it from KNOWN_FIXTURE_MODEL_LIMITATIONS`,
      ).toBe('FAIL');
      expect(
        c!.failure_reasons.every((r) => r.startsWith('relevance:')),
        `${caseId}: ${c!.failure_reasons.join(' | ')}`,
      ).toBe(true);
      expect(c!.provenance_failures).toEqual([]);
      expect(
        c!.relevant_in_pool,
        `${caseId}: the relevant chunk must exist in the pool — a 0 means the predicate is broken, not the model`,
      ).toBeGreaterThanOrEqual(1);
      expect(c!.structurally_guaranteed).toBe(false);
    }
    expect(candidate.metrics.cases_passed).toBe(
      candidate.metrics.cases_total - KNOWN_FIXTURE_MODEL_LIMITATIONS.size,
    );
  });

  it('reports the baseline and the source-only narrowing honestly, discloses how many cases narrowing alone decides, and the candidate does not regress provenance or version correctness', () => {
    expect(baseline.metrics.provenance_correctness).toBe(1);
    expect(sourceNarrowed.metrics.provenance_correctness).toBe(1);
    expect(candidate.metrics.hit_at['5']).toBeGreaterThanOrEqual(baseline.metrics.hit_at['5']!);
    expect(candidate.metrics.mrr).toBeGreaterThanOrEqual(baseline.metrics.mrr);
    // The version cases are exactly what unrestricted retrieval cannot do: it has no version notion.
    expect(baseline.metrics.version_correctness).toBeLessThanOrEqual(candidate.metrics.version_correctness);
    // Structural disclosure: in unrestricted mode nothing is guaranteed by narrowing; the candidate's
    // guaranteed count is reported (it is a property of the gold filters, not of ranking quality).
    expect(baseline.metrics.structurally_guaranteed_cases).toBe(0);
    expect(sourceNarrowed.metrics.structurally_guaranteed_cases).toBeLessThanOrEqual(
      candidate.metrics.structurally_guaranteed_cases,
    );
    expect(candidate.metrics.structurally_guaranteed_cases).toBeLessThan(candidate.metrics.retrieval_cases);
    expect(candidate.cases.every((c) => typeof c.structurally_guaranteed === 'boolean')).toBe(true);
  });

  it('a forged index is REJECTED before any case runs, and the search layer refuses to serve the forged row — never a pass with a footnote', async () => {
    const passing = candidate.cases.find((c) => c.outcome === 'PASS' && c.hits.length > 0)!;
    const target = passing.hits[0]!.fragment_id;
    const forge = (patch: Partial<IndexRow>) =>
      index.rows.map((r) =>
        r.embedding_identity.fragment_id === target ? ({ ...r, ...patch } as IndexRow) : r,
      );
    const shared = { corpus: corpus.snapshot, provider, cases: GOLDEN_CASES, keys: corpus.keys };
    // Forged registry binding, identity NOT re-stamped: caught by the index identity.
    await expect(
      runGoldenEval({
        ...shared,
        index: { ...index, rows: forge({ registry_artifact_id: 'reg-evil-001' }) },
      }),
    ).rejects.toThrow(/REJECT_EVAL.*ROW_MISMATCH/);
    // Forged registry binding, identity re-stamped: caught by the governed cross-check.
    const restamped = restamp(index, forge({ registry_artifact_id: 'reg-evil-001' }));
    await expect(runGoldenEval({ ...shared, index: restamped })).rejects.toThrow(/REJECT_EVAL.*ROW_MISMATCH/);
    const forgedCase = GOLDEN_CASES.find((c) => c.id === passing.case_id)!;
    await expect(
      searchKnowledgeIndex(
        restamped,
        provider,
        {
          query: forgedCase.query,
          ...(forgedCase.filters ? { filters: forgedCase.filters } : {}),
          top_k: 10,
        },
        governed,
      ),
    ).rejects.toMatchObject({ code: 'INDEX_ROW_CORRUPT' });
    // Forged embedding model version with a recomputed identity hash: MODEL_MISMATCH + ROW_MISMATCH.
    const row = index.rows.find((r) => r.embedding_identity.fragment_id === target)!;
    const evilIdentity = restamp(
      index,
      forge({ embedding_identity: { ...row.embedding_identity, embedding_model_version: 'EVIL' } }),
    );
    await expect(runGoldenEval({ ...shared, index: evilIdentity })).rejects.toThrow(/REJECT_EVAL/);
  }, 30_000);

  it('the index must derive from the evaluated corpus snapshot', async () => {
    const other = { ...index, corpus_snapshot_identity: '0'.repeat(64) };
    await expect(
      runGoldenEval({
        corpus: corpus.snapshot,
        index: other,
        provider,
        cases: GOLDEN_CASES,
        keys: corpus.keys,
      }),
    ).rejects.toThrow(/REJECT_EVAL/);
  });

  it('writes a machine-readable report with a deterministic file name and the required metric fields', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'k22-eval-'));
    tmpDirs.push(dir);
    const file = writeEvalReport(candidate, dir);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as EvalReport;
    expect(parsed.report_schema).toBe('knowledge-eval-report-v1');
    expect(parsed.eval_version).toBe('knowledge-eval-v1');
    expect(parsed.corpus_projection_version).toBe('knowledge-corpus-projection-v1');
    expect(parsed.embedding_model.model_id).toBe('fixture-hash-embedding');
    expect(parsed.index_snapshot_identity).toBe(index.index_snapshot_identity);
    for (const key of ['coverage', 'cases', 'metrics', 'gold_set_hash', 'report_hash', 'index_verified'])
      expect(parsed).toHaveProperty(key);
    for (const key of [
      'hit_at',
      'recall_at',
      'mrr',
      'ndcg_at_10',
      'provenance_correctness',
      'version_correctness',
      'unsupported_claim_rate',
      'structurally_guaranteed_cases',
    ])
      expect(parsed.metrics).toHaveProperty(key);
    for (const key of ['text_coverage_min', 'text_coverage_mean', 'documents_text_coverage_below_0_9'])
      expect(parsed.coverage).toHaveProperty(key);
    expect(path.basename(file)).toBe(
      `knowledge-eval-v1-narrowed-${index.index_snapshot_identity.slice(0, 16)}-${candidate.report_hash.slice(0, 16)}.json`,
    );
  });

  it('acceptance is never vacuous: an all-abstaining report (zero evaluated hits) is NOT accepted', async () => {
    const allAbstain = await runGoldenEval({
      corpus: corpus.snapshot,
      index,
      provider,
      cases: GOLDEN_CASES,
      keys: corpus.keys,
      config: { mode: 'narrowed', abstain_below_score: 1 },
    });
    expect(allAbstain.metrics.evaluated_hits).toBe(0);
    const verdict = judgeAcceptance(allAbstain, baseline);
    expect(verdict.accepted).toBe(false);
    expect(verdict.violations.some((v) => v.startsWith('NON_VACUOUS'))).toBe(true);
  });

  it('coverage reports the adversarial non-admitted documents and silently dropped text explicitly', () => {
    expect(candidate.coverage.documents_extraction_failed).toBe(1);
    expect(
      candidate.coverage.documents_empty + candidate.coverage.documents_extraction_failed,
    ).toBeGreaterThanOrEqual(2);
    expect(candidate.coverage.index_skipped_documents).toBe(
      candidate.coverage.documents_total - candidate.coverage.documents_admitted,
    );
    expect(candidate.coverage.metadata_completeness).toBe(1);
    // KNOWN UPSTREAM LIMITATION (EvidenceChunker v2.3, mps-chunking): a section marker regex also
    // matches a body line starting with "Grundvatten…", so the control program's VATTENKONTROLL body
    // is dropped with no rejected fragment. The eval SEES it as text coverage < 0.9 on that document.
    expect(candidate.coverage.documents_text_coverage_below_0_9).toBeGreaterThanOrEqual(1);
    expect(candidate.coverage.text_coverage_min).toBeLessThan(0.9);
  });
});
