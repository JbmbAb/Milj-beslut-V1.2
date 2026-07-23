/**
 * Stage 5 load harness (simulation-friendly).
 * Concurrent search / RAG / PDF export pressure without requiring live cluster.
 *
 * Usage:
 *   npx tsx scripts/load/stage5-load-harness.ts
 *   npx tsx scripts/load/stage5-load-harness.ts --searches=100 --rag=10 --pdfs=50
 */
import { buildSimplePdfBuffer } from '../../server/services/pdfExportService';
import { evaluateRagRuns, type RagEvalCase, type RagEvalRunResult } from '../../server/services/ragEvalService';

function argNum(name: string, fallback: number): number {
  const entry = process.argv.find((v) => v.startsWith(`--${name}=`));
  if (!entry) return fallback;
  const n = Number(entry.slice(name.length + 3));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function runConcurrent<T>(count: number, label: string, fn: (i: number) => Promise<T>): Promise<T[]> {
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: count }, (_, i) => fn(i)));
  const ms = Date.now() - started;
  console.log(`[load] ${label}: ${count} tasks in ${ms}ms (avg ${(ms / count).toFixed(1)}ms)`);
  return results;
}

async function main() {
  const searches = argNum('searches', 100);
  const rag = argNum('rag', 10);
  const pdfs = argNum('pdfs', 50);

  // Simulated concurrent "searches" — hash work approximating request handling
  await runConcurrent(searches, 'searches', async (i) => {
    const token = `q-${i}-${Date.now()}`;
    return token.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  });

  // Concurrent RAG eval runs
  const cases: RagEvalCase[] = Array.from({ length: rag }, (_, i) => ({
    query: `Fråga ${i} om vattenavstånd`,
    relevantIds: [`doc-${i % 3}`],
    goldKeywords: ['vatten'],
  }));
  const runs: RagEvalRunResult[] = cases.map((c, i) => ({
    answer: `Svar ${i}: avstånd till vatten är ${50 + i} meter.`,
    sources: [{ documentId: `doc-${i % 3}` }],
    cacheHit: i % 2 === 0,
  }));
  await runConcurrent(1, 'rag-batch', async () => evaluateRagRuns(cases, runs));

  // Concurrent PDF exports
  await runConcurrent(pdfs, 'pdf-exports', async (i) => {
    const buf = await buildSimplePdfBuffer({
      title: `Lasttest rapport ${i}`,
      body: `ÅÄÖ fastighetstest ${i}. Spårbarhet och sidbrytning.`,
      traceability: {
        operator: 'load-harness',
        correlationId: `load-${i}`,
        modelId: 'n/a',
      },
    });
    return buf.length;
  });

  console.log('[load] Stage 5 harness completed OK');
}

main().catch((err) => {
  console.error('[load] FAILED', err);
  process.exit(1);
});
