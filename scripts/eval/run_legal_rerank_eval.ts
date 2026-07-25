#!/usr/bin/env npx tsx
/**
 * Legal rerank eval smoke — kör fixture-baserad eval mot eval-set.json.
 * Exit 0 om recall uppfyller trösklar i smoke_thresholds.json.
 *
 * Usage:
 *   npx tsx scripts/eval/run_legal_rerank_eval.ts
 *   npx tsx scripts/eval/run_legal_rerank_eval.ts --baseline
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');
const evalSetPath = join(
  repoRoot,
  'scripts/alphaevolve/experiments/legal_search_params/eval-set.json',
);
const runEvalScript = join(
  repoRoot,
  'scripts/alphaevolve/experiments/legal_search_params/run_eval.ts',
);
const thresholdsPath = join(__dirname, 'smoke_thresholds.json');

type Thresholds = {
  min_recall_at_8: number;
  max_regression_vs_baseline?: number;
  max_p95_latency_ms?: number;
};

function defaultParams() {
  const evalSet = JSON.parse(readFileSync(evalSetPath, 'utf8')) as {
    source_defaults: { searchLegalCorpusTool: Record<string, number> };
  };
  const d = evalSet.source_defaults.searchLegalCorpusTool;
  return {
    RRF_K: d.RRF_K,
    RRF_K_EXACT: d.RRF_K_EXACT,
    FTS_CANDIDATE_LIMIT: 50,
    VECTOR_CANDIDATE_LIMIT: 50,
    RRF_CANDIDATE_LIMIT: d.RRF_CANDIDATE_LIMIT,
    RERANKER_FINAL_K: d.RERANKER_FINAL_K,
    LEGAL_RERANKER_RELATIVE_GAP: d.LEGAL_RERANKER_RELATIVE_GAP,
    rerankerEnabled: true,
  };
}

function runEval(params: Record<string, unknown>) {
  const child = spawnSync('npx', ['tsx', runEvalScript], {
    cwd: repoRoot,
    input: JSON.stringify(params),
    encoding: 'utf8',
    shell: true,
  });
  if (child.status !== 0) {
    console.error(child.stderr || child.stdout);
    process.exit(child.status ?? 1);
  }
  return JSON.parse(child.stdout.trim()) as {
    mean_recall: number;
    neg_weighted_recall: number;
    p95_latency_ms: number;
  };
}

const thresholds = JSON.parse(readFileSync(thresholdsPath, 'utf8')) as Thresholds;
const isBaseline = process.argv.includes('--baseline');

console.log('=== Legal rerank eval smoke ===');
const result = runEval(defaultParams());

console.log(JSON.stringify(result, null, 2));

if (isBaseline) {
  console.log('Baseline-läge — ingen tröskelkontroll.');
  process.exit(0);
}

if (result.mean_recall < thresholds.min_recall_at_8) {
  console.error(
    `FAIL: mean_recall ${result.mean_recall} < ${thresholds.min_recall_at_8}`,
  );
  process.exit(1);
}

if (
  thresholds.max_p95_latency_ms != null &&
  result.p95_latency_ms > thresholds.max_p95_latency_ms
) {
  console.error(
    `FAIL: p95_latency_ms ${result.p95_latency_ms} > ${thresholds.max_p95_latency_ms}`,
  );
  process.exit(1);
}

console.log('PASS: legal rerank eval smoke');
process.exit(0);
