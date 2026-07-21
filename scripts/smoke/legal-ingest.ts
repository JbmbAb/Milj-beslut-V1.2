/**
 * scripts/smoke/legal-ingest.ts
 *
 * Smoketest för juridikingest. Stegen:
 *   1. Räkna JudgmentRecord och LegalSourceRecord före.
 *   2. Kör ingestDomstolRssFeed() en gång.
 *   3. Verifiera att pipelineRun loggades med status SUCCESS.
 *   4. Räkna efter och rapportera nya/uppdaterade.
 *   5. Slå mot /api/legal/judgments och /api/legal/sources via BASE_URL (om satt).
 */

import { ingestDomstolRssFeed } from '../../server/services/domstolRssService';
import { prisma } from '../../server/db/prisma';
import { loadEnvFile } from '../../server/loadEnv';

const BASE_URL = process.env.BASE_URL;

async function pingRoute(path: string): Promise<{ ok: boolean; status?: number; body?: unknown }> {
  if (!BASE_URL) return { ok: true };
  try {
    const res = await fetch(`${BASE_URL}${path}`);
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, body: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  loadEnvFile();
  console.log('Legal ingest smoketest');
  console.log('─'.repeat(80));

  const [judgmentsBefore, sourcesBefore] = await Promise.all([
    prisma.judgmentRecord.count(),
    prisma.legalSourceRecord.count(),
  ]);
  console.log(`Before: judgments=${judgmentsBefore}, legal_sources=${sourcesBefore}`);

  const started = Date.now();
  let result: Awaited<ReturnType<typeof ingestDomstolRssFeed>> | null = null;
  let ingestError: Error | null = null;
  try {
    result = await ingestDomstolRssFeed();
  } catch (err) {
    ingestError = err instanceof Error ? err : new Error(String(err));
  }
  const durationMs = Date.now() - started;

  const [judgmentsAfter, sourcesAfter] = await Promise.all([
    prisma.judgmentRecord.count(),
    prisma.legalSourceRecord.count(),
  ]);

  const latestRun = await prisma.pipelineRun.findFirst({
    where: { runType: 'domstol-rss-ingest' },
    orderBy: { startedAt: 'desc' },
  });

  console.log(`Kördes på ${durationMs}ms`);
  if (ingestError) {
    console.log(`[FAIL] ingest kastade: ${ingestError.message}`);
  } else if (result) {
    console.log(`[OK] ingest körd: new=${result.newJudgments}, updated=${result.updatedJudgments}`);
  }
  console.log(
    `After:  judgments=${judgmentsAfter} (+${judgmentsAfter - judgmentsBefore}), legal_sources=${sourcesAfter} (+${sourcesAfter - sourcesBefore})`,
  );
  if (latestRun) {
    console.log(
      `pipeline_run: id=${latestRun.runId} status=${latestRun.status} processed=${latestRun.processedCount} errors=${latestRun.errorCount}`,
    );
  } else {
    console.log('[WARN] ingen pipeline_run hittades — kontrollera schema/migreringar.');
  }

  if (BASE_URL) {
    const judg = await pingRoute('/api/legal/judgments?pageSize=5');
    const src = await pingRoute('/api/legal/sources?pageSize=5');
    console.log(`GET /api/legal/judgments -> ${judg.status ?? '—'} ok=${judg.ok}`);
    console.log(`GET /api/legal/sources   -> ${src.status ?? '—'} ok=${src.ok}`);
  }

  await prisma.$disconnect();
  process.exit(ingestError || !latestRun || latestRun.status === 'FAILED' ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Smoketest error:', err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
