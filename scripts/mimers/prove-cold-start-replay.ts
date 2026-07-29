/**
 * Sovereign DoD §3 — cold-start replay proof.
 *
 * 1. Seed CAS+ledger on node A
 * 2. Copy only `cas/` + `ledger/` to an empty node B directory
 * 3. Open fresh FileCASRepository + FileEventLog (no in-memory carry-over)
 * 4. Assert identical promotion/manifest hashes and CLEAN recovery
 *
 *   npm run mimers:cold-start
 */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  EvolutionLedger,
  FileCASRepository,
  FileEventLog,
  ManifestBuilder,
  RecoveryOrchestrator,
} from '@miljobeslut/mimers-brunn-core';
import { externalVerifyMimersRoot } from './prove-external-verify';

export type ColdStartProofReport = {
  readonly ok: boolean;
  readonly seedEvents: number;
  readonly seedPromotionHashes: readonly string[];
  readonly seedManifestHashes: readonly string[];
  readonly coldPromotionHashes: readonly string[];
  readonly coldManifestHashes: readonly string[];
  readonly hashesMatch: boolean;
  readonly coldVerifyOk: boolean;
  readonly coldStartMs: number;
  readonly errors: readonly string[];
};

export async function proveColdStartReplay(): Promise<ColdStartProofReport> {
  const errors: string[] = [];
  const work = await mkdtemp(path.join(os.tmpdir(), 'mimers-cold-'));
  const nodeA = path.join(work, 'node-a');
  const nodeB = path.join(work, 'node-b');

  try {
    const casA = new FileCASRepository(path.join(nodeA, 'cas'), { durabilityMode: 'none' });
    await casA.initialize();
    const logA = new FileEventLog(path.join(nodeA, 'ledger'), {
      durabilityMode: 'none',
      maxEventsPerSegment: 2,
    });
    await logA.initialize();
    const ledgerA = new EvolutionLedger(casA, logA);

    const seedPromotionHashes: string[] = [];
    const seedManifestHashes: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { manifest } = await new ManifestBuilder(casA)
        .pipeline({ id: `cold-${i}`, nodes: ['x'] })
        .policy({ maxCost: i })
        .runtime({ cold: true })
        .metrics({ latencyMs: i, costSek: 0, qualityScore: 1, errorRate: 0 })
        .build();
      const committed = await ledgerA.commitPromotion(manifest, [], i + 1, {
        metadataName: `cold-${i}`,
      });
      seedPromotionHashes.push(committed.promotionHash);
      seedManifestHashes.push(committed.manifestHash);
    }

    // Empty node B: only durable files (CAS + ledger).
    await cp(path.join(nodeA, 'cas'), path.join(nodeB, 'cas'), { recursive: true });
    await cp(path.join(nodeA, 'ledger'), path.join(nodeB, 'ledger'), { recursive: true });

    const t0 = performance.now();
    const casB = new FileCASRepository(path.join(nodeB, 'cas'), { durabilityMode: 'none' });
    await casB.initialize();
    const logB = new FileEventLog(path.join(nodeB, 'ledger'), {
      durabilityMode: 'none',
      maxEventsPerSegment: 2,
    });
    await logB.initialize();
    const eventsB = await logB.getAllEvents();
    const coldPromotionHashes = eventsB.map((e) => e.promotionHash);
    const coldManifestHashes = eventsB.map((e) => e.manifestHash);
    const coldStartMs = Number((performance.now() - t0).toFixed(3));

    const hashesMatch =
      JSON.stringify(coldPromotionHashes) === JSON.stringify(seedPromotionHashes) &&
      JSON.stringify(coldManifestHashes) === JSON.stringify(seedManifestHashes);
    if (!hashesMatch) {
      errors.push('cold-start hashes differ from seed node');
    }

    // Idempotent replay on cold node must not append duplicates.
    const ledgerB = new EvolutionLedger(casB, logB);
    const { manifest: lastManifest } = await new ManifestBuilder(casB)
      .pipeline({ id: 'cold-3', nodes: ['x'] })
      .policy({ maxCost: 3 })
      .runtime({ cold: true })
      .metrics({ latencyMs: 3, costSek: 0, qualityScore: 1, errorRate: 0 })
      .build();
    const replay = await ledgerB.commitPromotion(lastManifest, [], 4, { metadataName: 'cold-3' });
    if (!replay.idempotentReplay) {
      errors.push('expected idempotentReplay on cold node for identical sealed content');
    }
    if ((await logB.getAllEvents()).length !== seedPromotionHashes.length) {
      errors.push('cold node ledger grew on idempotent replay');
    }

    const recovery = new RecoveryOrchestrator(casB, () => logB.getAllEvents());
    const restored = await recovery.recoverFromLedger();
    if (restored.status !== 'CLEAN') {
      errors.push(`recoverFromLedger not CLEAN: failed=${restored.failedEvents}`);
    }

    const verify = await externalVerifyMimersRoot(nodeB);
    if (!verify.ok) errors.push(...verify.errors.map((e) => `external-verify: ${e}`));

    return {
      ok: errors.length === 0,
      seedEvents: seedPromotionHashes.length,
      seedPromotionHashes,
      seedManifestHashes,
      coldPromotionHashes,
      coldManifestHashes,
      hashesMatch,
      coldVerifyOk: verify.ok,
      coldStartMs,
      errors,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const report = await proveColdStartReplay();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

const isDirect =
  process.argv[1]?.includes('prove-cold-start-replay') ||
  process.argv[1]?.includes('cold-start');

if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
