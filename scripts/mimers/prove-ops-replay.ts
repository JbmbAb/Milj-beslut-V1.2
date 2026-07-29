/**
 * Sovereign DoD ops proof slice:
 * 1. Multi-segment load → cold-start replay (hashes / Merkle / chain)
 * 2. Checkpoint-accelerated recovery ≡ full replay (+ timing)
 * 3. Fault injection: corrupt segment, truncated write, missing checkpoint
 *
 *   npm run mimers:ops-proof
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildCheckpointAcceleratedPlan,
  EvolutionLedger,
  FileCASRepository,
  FileEventLog,
  IntegrityVerifier,
  LedgerCorruptionError,
  ManifestBuilder,
  MerkleTree,
  RecoveryOrchestrator,
} from '@miljobeslut/mimers-brunn-core';
import { externalVerifyMimersRoot } from './prove-external-verify';

const DEFAULT_EVENT_COUNT = 50;
const DEFAULT_SEGMENT_SIZE = 4;

export type OpsProofReport = {
  readonly ok: boolean;
  readonly multiSegment: {
    readonly ok: boolean;
    readonly eventCount: number;
    readonly closedSegments: number;
    readonly checkpointCount: number;
    readonly seedMerkleRoot: string;
    readonly coldMerkleRoot: string;
    readonly hashesMatch: boolean;
    readonly chainIntact: boolean;
    readonly coldStartMs: number;
    readonly eventsPerSec: number;
    readonly heapUsedMb: number;
    readonly recoverStatus: string;
    readonly externalVerifyOk: boolean;
  };
  readonly checkpointRecovery: {
    readonly ok: boolean;
    readonly coveredThroughSequence: number;
    readonly tailEventCount: number;
    readonly identicalToFullReplay: boolean;
    readonly fullReplayMs: number;
    readonly checkpointPlanMs: number;
    readonly tailL2Ms: number;
    readonly timeSavedMs: number;
    readonly fullRoot: string;
  };
  readonly faultInjection: {
    readonly ok: boolean;
    readonly corruptSegmentDetected: boolean;
    readonly truncatedWriteDetected: boolean;
    readonly missingCheckpointFailClosed: boolean;
    readonly missingCheckpointBackfillRepair: boolean;
  };
  readonly errors: readonly string[];
};

function rssHeapMb(): number {
  return Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2));
}

async function seedLoad(
  root: string,
  eventCount: number,
  maxEventsPerSegment: number,
): Promise<{
  promotionHashes: string[];
  manifestHashes: string[];
  merkleRoot: string;
  closedSegments: number;
  checkpointCount: number;
}> {
  const cas = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'none' });
  await cas.initialize();
  const log = new FileEventLog(path.join(root, 'ledger'), {
    durabilityMode: 'none',
    maxEventsPerSegment,
  });
  await log.initialize();
  const ledger = new EvolutionLedger(cas, log);

  const promotionHashes: string[] = [];
  const manifestHashes: string[] = [];
  for (let i = 0; i < eventCount; i += 1) {
    const { manifest } = await new ManifestBuilder(cas)
      .pipeline({ id: `ops-${i}`, nodes: ['load'] })
      .policy({ i })
      .runtime({ load: true })
      .metrics({ latencyMs: i, costSek: 0, qualityScore: 1, errorRate: 0 })
      .build();
    const committed = await ledger.commitPromotion(manifest, [], i + 1, {
      metadataName: `ops-${i}`,
    });
    promotionHashes.push(committed.promotionHash);
    manifestHashes.push(committed.manifestHash);
  }

  const events = await log.getAllEvents();
  const segments = await log.listSegments();
  const checkpoints = await log.listCheckpoints();
  return {
    promotionHashes,
    manifestHashes,
    merkleRoot: MerkleTree.computeEventRoot(events),
    closedSegments: segments.filter((s) => s.closed).length,
    checkpointCount: checkpoints.length,
  };
}

export async function proveOpsReplay(options?: {
  readonly eventCount?: number;
  readonly maxEventsPerSegment?: number;
}): Promise<OpsProofReport> {
  const eventCount = options?.eventCount ?? DEFAULT_EVENT_COUNT;
  const maxEventsPerSegment = options?.maxEventsPerSegment ?? DEFAULT_SEGMENT_SIZE;
  const errors: string[] = [];
  const work = await mkdtemp(path.join(os.tmpdir(), 'mimers-ops-'));

  try {
    // ── 1) Multi-segment under load + cold-start ───────────────────────────
    const nodeA = path.join(work, 'node-a');
    const seed = await seedLoad(nodeA, eventCount, maxEventsPerSegment);
    if (seed.closedSegments < 2) {
      errors.push(`expected ≥2 closed segments, got ${seed.closedSegments}`);
    }
    if (seed.checkpointCount < 2) {
      errors.push(`expected ≥2 checkpoints, got ${seed.checkpointCount}`);
    }

    const nodeB = path.join(work, 'node-b');
    await cp(path.join(nodeA, 'cas'), path.join(nodeB, 'cas'), { recursive: true });
    await cp(path.join(nodeA, 'ledger'), path.join(nodeB, 'ledger'), { recursive: true });

    const tCold0 = performance.now();
    const casB = new FileCASRepository(path.join(nodeB, 'cas'), { durabilityMode: 'none' });
    await casB.initialize();
    const logB = new FileEventLog(path.join(nodeB, 'ledger'), {
      durabilityMode: 'none',
      maxEventsPerSegment,
      checkpointPolicy: 'fail-closed',
    });
    await logB.initialize();
    const eventsB = await logB.getAllEvents();
    const coldMerkleRoot = MerkleTree.computeEventRoot(eventsB);
    const coldPromotionHashes = eventsB.map((e) => e.promotionHash);
    const coldManifestHashes = eventsB.map((e) => e.manifestHash);
    const heapUsedMb = rssHeapMb();

    // Hash chain intact
    let chainIntact = true;
    for (let i = 0; i < eventsB.length; i += 1) {
      const e = eventsB[i]!;
      if (e.sequence !== i + 1) {
        chainIntact = false;
        break;
      }
      if (i === 0 && e.previousEventHash !== null) {
        chainIntact = false;
        break;
      }
      if (i > 0 && e.previousEventHash !== eventsB[i - 1]!.eventHash) {
        chainIntact = false;
        break;
      }
    }

    const recovery = new RecoveryOrchestrator(casB, () => logB.getAllEvents());
    const restored = await recovery.recoverFromLedger();
    const verify = await externalVerifyMimersRoot(nodeB);
    const coldStartMs = Number((performance.now() - tCold0).toFixed(3));
    const eventsPerSec =
      coldStartMs > 0 ? Number(((eventsB.length / coldStartMs) * 1000).toFixed(2)) : 0;

    const hashesMatch =
      JSON.stringify(coldPromotionHashes) === JSON.stringify(seed.promotionHashes) &&
      JSON.stringify(coldManifestHashes) === JSON.stringify(seed.manifestHashes) &&
      coldMerkleRoot === seed.merkleRoot;

    if (!hashesMatch) errors.push('multi-segment cold-start hashes/Merkle differ from seed');
    if (!chainIntact) errors.push('event hash chain broken after cold-start');
    if (restored.status !== 'CLEAN') {
      errors.push(`recoverFromLedger not CLEAN: ${restored.status}`);
    }
    if (!verify.ok) errors.push(...verify.errors.map((e) => `external-verify: ${e}`));

    const multiOk =
      hashesMatch &&
      chainIntact &&
      restored.status === 'CLEAN' &&
      verify.ok &&
      seed.closedSegments >= 2;

    // ── 2) Checkpoint-accelerated ≡ full replay ────────────────────────────
    const checkpointsB = await logB.listCheckpoints();
    const tFull0 = performance.now();
    const fullRoot = MerkleTree.computeEventRoot(eventsB);
    const fullL2 = await new IntegrityVerifier(casB, async () => eventsB).auditL2();
    const fullReplayMs = Number((performance.now() - tFull0).toFixed(3));

    const tPlan0 = performance.now();
    const plan = buildCheckpointAcceleratedPlan(eventsB, checkpointsB);
    const checkpointPlanMs = Number((performance.now() - tPlan0).toFixed(3));

    const tTail0 = performance.now();
    const tailL2 = await new IntegrityVerifier(casB, async () => plan.tailEvents).auditL2();
    const tailL2Ms = Number((performance.now() - tTail0).toFixed(3));

    if (!plan.identicalToFullReplay) {
      errors.push(
        `checkpoint plan not identical to full replay: ${plan.checkpointChainErrors.join('; ')}`,
      );
    }
    if (plan.fullMerkleRoot !== fullRoot) {
      errors.push('plan.fullMerkleRoot !== full Merkle root');
    }
    if (fullL2.status !== 'CLEAN') errors.push(`full L2 not CLEAN: ${fullL2.status}`);
    if (tailL2.status !== 'CLEAN' && plan.tailEvents.length > 0) {
      errors.push(`tail L2 not CLEAN: ${tailL2.status}`);
    }

    const timeSavedMs = Number(
      Math.max(0, fullReplayMs - (checkpointPlanMs + tailL2Ms)).toFixed(3),
    );
    const ckptOk =
      plan.identicalToFullReplay &&
      plan.fullMerkleRoot === fullRoot &&
      fullL2.status === 'CLEAN' &&
      (plan.tailEvents.length === 0 || tailL2.status === 'CLEAN');

    // ── 3) Fault injection ─────────────────────────────────────────────────
    let corruptSegmentDetected = false;
    let truncatedWriteDetected = false;
    let missingCheckpointFailClosed = false;
    let missingCheckpointBackfillRepair = false;

    // 3a corrupt segment event JSON
    {
      const faultRoot = path.join(work, 'fault-corrupt');
      await cp(path.join(nodeA, 'cas'), path.join(faultRoot, 'cas'), { recursive: true });
      await cp(path.join(nodeA, 'ledger'), path.join(faultRoot, 'ledger'), { recursive: true });
      const segDir = path.join(faultRoot, 'ledger', 'segments', '00000001');
      const victim = path.join(segDir, '00000001.json');
      const raw = await readFile(victim, 'utf-8');
      const obj = JSON.parse(raw) as { eventHash: string };
      obj.eventHash = 'sha256:' + 'ab'.repeat(32);
      await writeFile(victim, `${JSON.stringify(obj)}\n`, 'utf-8');
      try {
        const log = new FileEventLog(path.join(faultRoot, 'ledger'), {
          durabilityMode: 'none',
          maxEventsPerSegment,
          checkpointPolicy: 'fail-closed',
        });
        await log.initialize();
        errors.push('corrupt segment: expected initialize to throw');
      } catch (err: unknown) {
        corruptSegmentDetected =
          err instanceof LedgerCorruptionError ||
          (err instanceof Error && /corrupt|hash|chain|checkpoint/i.test(err.message));
        if (!corruptSegmentDetected) {
          errors.push(`corrupt segment: unexpected error ${String(err)}`);
        }
      }
    }

    // 3b truncated / torn write
    {
      const faultRoot = path.join(work, 'fault-trunc');
      await cp(path.join(nodeA, 'cas'), path.join(faultRoot, 'cas'), { recursive: true });
      await cp(path.join(nodeA, 'ledger'), path.join(faultRoot, 'ledger'), { recursive: true });
      const victim = path.join(faultRoot, 'ledger', 'segments', '00000002', '00000005.json');
      await writeFile(victim, '{"sequence":5,"eventHash":"sha256:dead', 'utf-8');
      try {
        const log = new FileEventLog(path.join(faultRoot, 'ledger'), {
          durabilityMode: 'none',
          maxEventsPerSegment,
          checkpointPolicy: 'fail-closed',
        });
        await log.initialize();
        errors.push('truncated write: expected initialize to throw');
      } catch (err: unknown) {
        truncatedWriteDetected =
          err instanceof LedgerCorruptionError ||
          (err instanceof Error && /truncat|JSON|corrupt|parse/i.test(err.message));
        if (!truncatedWriteDetected) {
          errors.push(`truncated write: unexpected error ${String(err)}`);
        }
      }
    }

    // 3c missing checkpoint — fail-closed (Verifier)
    {
      const faultRoot = path.join(work, 'fault-missing-fc');
      await cp(path.join(nodeA, 'cas'), path.join(faultRoot, 'cas'), { recursive: true });
      await cp(path.join(nodeA, 'ledger'), path.join(faultRoot, 'ledger'), { recursive: true });
      await rm(path.join(faultRoot, 'ledger', 'checkpoints', '00000001.json'), { force: true });
      try {
        const log = new FileEventLog(path.join(faultRoot, 'ledger'), {
          durabilityMode: 'none',
          maxEventsPerSegment,
          checkpointPolicy: 'fail-closed',
        });
        await log.initialize();
        errors.push('missing checkpoint fail-closed: expected throw');
      } catch (err: unknown) {
        missingCheckpointFailClosed =
          err instanceof LedgerCorruptionError &&
          /Missing checkpoints/i.test(err.message);
        if (!missingCheckpointFailClosed) {
          errors.push(`missing checkpoint fail-closed: unexpected ${String(err)}`);
        }
      }
    }

    // 3d missing checkpoint — backfill (Repair)
    {
      const faultRoot = path.join(work, 'fault-missing-bf');
      await cp(path.join(nodeA, 'cas'), path.join(faultRoot, 'cas'), { recursive: true });
      await cp(path.join(nodeA, 'ledger'), path.join(faultRoot, 'ledger'), { recursive: true });
      await rm(path.join(faultRoot, 'ledger', 'checkpoints', '00000001.json'), { force: true });
      const log = new FileEventLog(path.join(faultRoot, 'ledger'), {
        durabilityMode: 'none',
        maxEventsPerSegment,
        checkpointPolicy: 'backfill',
      });
      await log.initialize();
      const cps = await log.listCheckpoints();
      missingCheckpointBackfillRepair = cps.some((c) => c.segmentId === 1);
      if (!missingCheckpointBackfillRepair) {
        errors.push('missing checkpoint backfill: segment 1 checkpoint not recreated');
      }
      const planAfter = buildCheckpointAcceleratedPlan(await log.getAllEvents(), cps);
      if (!planAfter.identicalToFullReplay) {
        errors.push('after backfill repair, checkpoint plan not identical');
      }
    }

    const faultOk =
      corruptSegmentDetected &&
      truncatedWriteDetected &&
      missingCheckpointFailClosed &&
      missingCheckpointBackfillRepair;

    return {
      ok: errors.length === 0 && multiOk && ckptOk && faultOk,
      multiSegment: {
        ok: multiOk,
        eventCount: eventsB.length,
        closedSegments: seed.closedSegments,
        checkpointCount: seed.checkpointCount,
        seedMerkleRoot: seed.merkleRoot,
        coldMerkleRoot,
        hashesMatch,
        chainIntact,
        coldStartMs,
        eventsPerSec,
        heapUsedMb,
        recoverStatus: restored.status,
        externalVerifyOk: verify.ok,
      },
      checkpointRecovery: {
        ok: ckptOk,
        coveredThroughSequence: plan.coveredThroughSequence,
        tailEventCount: plan.tailEvents.length,
        identicalToFullReplay: plan.identicalToFullReplay,
        fullReplayMs,
        checkpointPlanMs,
        tailL2Ms,
        timeSavedMs,
        fullRoot,
      },
      faultInjection: {
        ok: faultOk,
        corruptSegmentDetected,
        truncatedWriteDetected,
        missingCheckpointFailClosed,
        missingCheckpointBackfillRepair,
      },
      errors,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const report = await proveOpsReplay();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

const isDirect =
  process.argv[1]?.includes('prove-ops-replay') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('prove-ops-replay.ts');
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
