/**
 * Mimers Brunn v9 regression micro-benchmark (ADR-042 P3 ops).
 *
 *   npm run mimers:bench
 *
 * Creates a temp CAS+ledger, measures put / commitPromotion / L0, asserts soft budgets.
 * Exit 1 on regression or functional failure.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  EvolutionLedger,
  FileCASRepository,
  FileEventLog,
  ManifestBuilder,
  RecoveryOrchestrator,
} from '@miljobeslut/mimers-brunn-core';

const BUDGETS = {
  casPutMeanMs: 50,
  commitPromotionMeanMs: 400,
  auditL0Ms: 100,
  iterations: 20,
} as const;

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimers-bench-'));
  const report: Record<string, number | string | boolean> = {
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
  };

  try {
    const cas = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'none' });
    await cas.initialize();
    const log = new FileEventLog(path.join(root, 'ledger'), { durabilityMode: 'none' });
    await log.initialize();
    const builder = new ManifestBuilder(cas);
    const ledger = new EvolutionLedger(cas, log);

    const putSamples: number[] = [];
    for (let i = 0; i < BUDGETS.iterations; i += 1) {
      const t0 = performance.now();
      await cas.put({ bench: true, n: i });
      putSamples.push(performance.now() - t0);
    }
    report.casPutMeanMs = Number((putSamples.reduce((a, b) => a + b, 0) / putSamples.length).toFixed(3));

    const commitSamples: number[] = [];
    for (let i = 0; i < BUDGETS.iterations; i += 1) {
      const t0 = performance.now();
      const built = await builder.build({
        pipeline: { id: 'bench', nodes: ['a'], i },
        policySnapshot: { maxCost: 1 },
        runtimeFingerprint: { runtime: 'bench' },
        metrics: { latencyMs: i, costSek: 0, qualityScore: 1, errorRate: 0 },
      });
      await ledger.commitPromotion(built.manifest, [], i + 1, { metadataName: `bench-${i}` });
      commitSamples.push(performance.now() - t0);
    }
    report.commitPromotionMeanMs = Number(
      (commitSamples.reduce((a, b) => a + b, 0) / commitSamples.length).toFixed(3),
    );
    report.events = (await log.getAllEvents()).length;

    const recovery = new RecoveryOrchestrator(cas, () => log.getAllEvents());
    const tL0 = performance.now();
    const l0 = await recovery.auditL0();
    report.auditL0Ms = Number((performance.now() - tL0).toFixed(3));
    report.l0Status = l0.status;

    const failures: string[] = [];
    if (l0.status !== 'CLEAN') failures.push(`L0 not CLEAN: ${l0.errors.join('; ')}`);
    if ((report.events as number) !== BUDGETS.iterations) {
      failures.push(`expected ${BUDGETS.iterations} ledger events, got ${report.events}`);
    }
    if ((report.casPutMeanMs as number) > BUDGETS.casPutMeanMs) {
      failures.push(`casPutMeanMs ${report.casPutMeanMs} > ${BUDGETS.casPutMeanMs}`);
    }
    if ((report.commitPromotionMeanMs as number) > BUDGETS.commitPromotionMeanMs) {
      failures.push(
        `commitPromotionMeanMs ${report.commitPromotionMeanMs} > ${BUDGETS.commitPromotionMeanMs}`,
      );
    }
    if ((report.auditL0Ms as number) > BUDGETS.auditL0Ms) {
      failures.push(`auditL0Ms ${report.auditL0Ms} > ${BUDGETS.auditL0Ms}`);
    }

    report.ok = failures.length === 0;
    console.log(JSON.stringify({ budgets: BUDGETS, report, failures }, null, 2));
    if (failures.length > 0) process.exit(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
