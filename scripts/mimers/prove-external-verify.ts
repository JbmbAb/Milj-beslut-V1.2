/**
 * Sovereign DoD §1/§5 — external offline verification.
 *
 * Verifies ledger → promotionHash/manifestHash → CAS bytes (SHA-256) without
 * ArtifactStore, evolve DB, or any other internal index.
 *
 *   npm run mimers:verify
 *   npm run mimers:verify -- --root ./tmp-mimers
 *
 * Without --root: seeds a temp CAS+ledger, verifies, prints JSON, exits 0/1.
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
  verifyChainedCheckpointSequence,
} from '@miljobeslut/mimers-brunn-core';

export type ExternalVerifyReport = {
  readonly root: string;
  readonly ok: boolean;
  readonly events: number;
  readonly l0: string;
  readonly l1: string;
  readonly l2: string;
  readonly recoverStatus: string;
  readonly recoverableEvents: number;
  readonly failedEvents: number;
  readonly checkpoints: number;
  readonly checkpointChainOk: boolean;
  readonly errors: readonly string[];
};

export async function externalVerifyMimersRoot(rootDir: string): Promise<ExternalVerifyReport> {
  const root = path.resolve(rootDir);
  const errors: string[] = [];

  const cas = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'none' });
  await cas.initialize();
  const log = new FileEventLog(path.join(root, 'ledger'), { durabilityMode: 'none' });
  await log.initialize();

  const events = await log.getAllEvents();
  const recovery = new RecoveryOrchestrator(cas, () => log.getAllEvents());
  const l0 = await recovery.auditL0();
  const l1 = await recovery.auditL1();
  const l2 = await recovery.auditL2();
  const restored = await recovery.recoverFromLedger();

  if (l0.status !== 'CLEAN') errors.push(...l0.errors.map((e) => `L0: ${e}`));
  if (l1.status !== 'CLEAN') errors.push(...l1.errors.map((e) => `L1: ${e}`));
  if (l2.status !== 'CLEAN') errors.push(...l2.errors.map((e) => `L2: ${e}`));
  if (restored.status !== 'CLEAN') {
    errors.push(
      ...restored.replay.filter((r) => !r.ok).map((r) => `replay seq ${r.sequence}: ${r.error}`),
    );
  }

  const checkpoints = await log.listCheckpoints();
  const chain = verifyChainedCheckpointSequence(checkpoints, events);
  if (!chain.ok) errors.push(...chain.errors.map((e) => `checkpoint: ${e}`));

  // Explicit lineage walk: every event must resolve promotion → manifest in CAS.
  for (const event of events) {
    const promo = await cas.getBytes(event.promotionHash, { verifyHash: true });
    if (!promo) errors.push(`missing promotion bytes ${event.promotionHash}`);
    const man = await cas.getBytes(event.manifestHash, { verifyHash: true });
    if (!man) errors.push(`missing manifest bytes ${event.manifestHash}`);
  }

  return {
    root,
    ok: errors.length === 0,
    events: events.length,
    l0: l0.status,
    l1: l1.status,
    l2: l2.status,
    recoverStatus: restored.status,
    recoverableEvents: restored.recoverableEvents,
    failedEvents: restored.failedEvents,
    checkpoints: checkpoints.length,
    checkpointChainOk: chain.ok,
    errors,
  };
}

async function seedTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mimers-verify-seed-'));
  const cas = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'none' });
  await cas.initialize();
  const log = new FileEventLog(path.join(root, 'ledger'), {
    durabilityMode: 'none',
    maxEventsPerSegment: 2,
  });
  await log.initialize();
  const ledger = new EvolutionLedger(cas, log);
  for (let i = 0; i < 3; i += 1) {
    const { manifest } = await new ManifestBuilder(cas)
      .pipeline({ id: `verify-${i}` })
      .policy({ i })
      .runtime({ node: process.version })
      .metrics({ latencyMs: i, costSek: 0, qualityScore: 1, errorRate: 0 })
      .build();
    await ledger.commitPromotion(manifest, [], i + 1, { metadataName: `v-${i}` });
  }
  return root;
}

function parseRoot(argv: string[]): string | undefined {
  const idx = argv.indexOf('--root');
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}

async function main(): Promise<void> {
  const argRoot = parseRoot(process.argv.slice(2));
  let root = argRoot;
  let cleanup: string | undefined;
  if (!root) {
    root = await seedTempRoot();
    cleanup = root;
  }
  try {
    const report = await externalVerifyMimersRoot(root);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(1);
  } finally {
    if (cleanup) await rm(cleanup, { recursive: true, force: true });
  }
}

const isDirect =
  process.argv[1]?.includes('prove-external-verify') ||
  process.argv[1]?.includes('external-verify');

if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
