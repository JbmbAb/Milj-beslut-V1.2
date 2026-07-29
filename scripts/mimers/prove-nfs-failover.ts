/**
 * Sovereign DoD §6 — NFS / shared-FS failover proof.
 *
 * Requires a real shared mount (NFS or equivalent multi-client FS):
 *
 *   MIMERS_NFS_ROOT=/mnt/mimers-nfs npm run mimers:nfs-proof
 *
 * Without MIMERS_NFS_ROOT the script exits 2 (not proven — do not treat as pass).
 *
 * Scenario:
 * 1) Node A writes promotions on the shared root
 * 2) Node B opens a fresh process view of the same cas+ledger (no in-memory carry)
 * 3) Node B appends; Node A reloads and verifies identical Merkle + CLEAN recovery
 * 4) Emit evidence JSON under tmp-artifacts/
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  EvolutionLedger,
  FileCASRepository,
  FileEventLog,
  ManifestBuilder,
  MerkleTree,
  RecoveryOrchestrator,
} from '@miljobeslut/mimers-brunn-core';
import { externalVerifyMimersRoot } from './prove-external-verify';

export type NfsFailoverProofReport = {
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly sharedRoot: string | null;
  readonly platform: string;
  readonly eventsAfterA: number;
  readonly eventsAfterB: number;
  readonly merkleAfterFailover: string | null;
  readonly nodeAReloadMatch: boolean;
  readonly externalVerifyOk: boolean;
  readonly recoverStatus: string | null;
  readonly elapsedMs: number;
  readonly errors: readonly string[];
  readonly evidencePath: string | null;
};

async function seedNode(
  root: string,
  count: number,
  namePrefix: string,
  startGen: number,
): Promise<void> {
  const cas = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'best-effort' });
  await cas.initialize();
  const log = new FileEventLog(path.join(root, 'ledger'), {
    durabilityMode: 'best-effort',
    maxEventsPerSegment: 3,
  });
  await log.initialize();
  const ledger = new EvolutionLedger(cas, log);
  for (let i = 0; i < count; i += 1) {
    const gen = startGen + i;
    const { manifest } = await new ManifestBuilder(cas)
      .pipeline({ id: `${namePrefix}-${gen}` })
      .policy({ gen, node: namePrefix })
      .runtime({ nfs: true })
      .metrics({ latencyMs: gen, costSek: 0, qualityScore: 1, errorRate: 0 })
      .build();
    await ledger.commitPromotion(manifest, [], gen, { metadataName: `${namePrefix}-${gen}` });
  }
}

export async function proveNfsFailover(options?: {
  readonly sharedRoot?: string;
}): Promise<NfsFailoverProofReport> {
  const sharedRoot = (options?.sharedRoot ?? process.env.MIMERS_NFS_ROOT)?.trim() || null;
  const platform = `${process.platform}/${os.type()} ${os.release()}`;

  if (!sharedRoot) {
    return {
      ok: false,
      skipped: true,
      sharedRoot: null,
      platform,
      eventsAfterA: 0,
      eventsAfterB: 0,
      merkleAfterFailover: null,
      nodeAReloadMatch: false,
      externalVerifyOk: false,
      recoverStatus: null,
      elapsedMs: 0,
      errors: [
        'MIMERS_NFS_ROOT not set — NFS/failover remains PARTIAL. See docs/ops/mimers-brunn-v9-nfs-validation.md',
      ],
      evidencePath: null,
    };
  }

  const errors: string[] = [];
  const t0 = performance.now();
  const runId = `nfs-${process.pid}-${Date.now()}`;
  const root = path.join(path.resolve(sharedRoot), runId);

  try {
    await mkdir(root, { recursive: true });

    // Node A — primary writer
    await seedNode(root, 6, 'A', 1);

    const casA1 = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'best-effort' });
    await casA1.initialize();
    const logA1 = new FileEventLog(path.join(root, 'ledger'), {
      durabilityMode: 'best-effort',
      maxEventsPerSegment: 3,
      checkpointPolicy: 'fail-closed',
    });
    await logA1.initialize();
    const eventsA = await logA1.getAllEvents();
    const merkleA = MerkleTree.computeEventRoot(eventsA);
    if (eventsA.length !== 6) errors.push(`node A expected 6 events, got ${eventsA.length}`);

    // Node B — cold open of same shared tree (failover / second client)
    await seedNode(root, 3, 'B', 7);

    const casB = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'best-effort' });
    await casB.initialize();
    const logB = new FileEventLog(path.join(root, 'ledger'), {
      durabilityMode: 'best-effort',
      maxEventsPerSegment: 3,
      checkpointPolicy: 'fail-closed',
    });
    await logB.initialize();
    const eventsB = await logB.getAllEvents();
    const merkleB = MerkleTree.computeEventRoot(eventsB);
    if (eventsB.length !== 9) errors.push(`node B expected 9 events, got ${eventsB.length}`);

    // Node A reloads after B wrote (shared visibility)
    const casA2 = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'best-effort' });
    await casA2.initialize();
    const logA2 = new FileEventLog(path.join(root, 'ledger'), {
      durabilityMode: 'best-effort',
      maxEventsPerSegment: 3,
      checkpointPolicy: 'fail-closed',
    });
    await logA2.initialize();
    const eventsA2 = await logA2.getAllEvents();
    const merkleA2 = MerkleTree.computeEventRoot(eventsA2);
    const nodeAReloadMatch =
      merkleA2 === merkleB &&
      JSON.stringify(eventsA2.map((e) => e.eventHash)) ===
        JSON.stringify(eventsB.map((e) => e.eventHash));
    if (!nodeAReloadMatch) {
      errors.push('node A reload after failover does not match node B state');
    }
    if (merkleA2 === merkleA) {
      errors.push('merkle unchanged after node B writes — shared FS may not be visible');
    }

    const recovery = new RecoveryOrchestrator(casA2, () => logA2.getAllEvents());
    const restored = await recovery.recoverFromLedger();
    if (restored.status !== 'CLEAN') {
      errors.push(`recoverFromLedger not CLEAN: ${restored.status}`);
    }

    const verify = await externalVerifyMimersRoot(root);
    if (!verify.ok) errors.push(...verify.errors.map((e) => `external-verify: ${e}`));

    const elapsedMs = Number((performance.now() - t0).toFixed(3));
    const outDir = path.resolve('tmp-artifacts');
    await mkdir(outDir, { recursive: true });
    const evidencePath = path.join(outDir, 'mimers-nfs-failover.json');
    const report: NfsFailoverProofReport = {
      ok: errors.length === 0,
      skipped: false,
      sharedRoot,
      platform,
      eventsAfterA: eventsA.length,
      eventsAfterB: eventsB.length,
      merkleAfterFailover: merkleA2,
      nodeAReloadMatch,
      externalVerifyOk: verify.ok,
      recoverStatus: restored.status,
      elapsedMs,
      errors,
      evidencePath,
    };
    await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
    return report;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const report = await proveNfsFailover();
  console.log(JSON.stringify(report, null, 2));
  if (report.skipped) {
    process.exitCode = 2;
    return;
  }
  if (!report.ok) process.exitCode = 1;
}

const isDirect =
  process.argv[1]?.includes('prove-nfs-failover') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('prove-nfs-failover.ts');
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
