/**
 * Sovereign DoD §6 — backup/restore proof.
 *
 * 1. Seed live CAS+ledger
 * 2. Take offline backup (copy cas/ + ledger/ only)
 * 3. Destroy live root
 * 4. Restore from backup into empty root
 * 5. Assert identical hashes / Merkle / CLEAN recovery + external verify
 *
 *   npm run mimers:backup-restore
 */
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

export type BackupRestoreProofReport = {
  readonly ok: boolean;
  readonly platform: string;
  readonly eventCount: number;
  readonly backupBytesHint: string;
  readonly seedMerkleRoot: string;
  readonly restoredMerkleRoot: string;
  readonly hashesMatch: boolean;
  readonly recoverStatus: string;
  readonly externalVerifyOk: boolean;
  readonly backupMs: number;
  readonly restoreMs: number;
  readonly verifyMs: number;
  readonly errors: readonly string[];
};

async function seedLive(root: string, eventCount: number): Promise<{
  promotionHashes: string[];
  manifestHashes: string[];
  merkleRoot: string;
}> {
  const cas = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'none' });
  await cas.initialize();
  const log = new FileEventLog(path.join(root, 'ledger'), {
    durabilityMode: 'none',
    maxEventsPerSegment: 3,
  });
  await log.initialize();
  const ledger = new EvolutionLedger(cas, log);

  const promotionHashes: string[] = [];
  const manifestHashes: string[] = [];
  for (let i = 0; i < eventCount; i += 1) {
    const { manifest } = await new ManifestBuilder(cas)
      .pipeline({ id: `bak-${i}` })
      .policy({ i })
      .runtime({ backup: true })
      .metrics({ latencyMs: i, costSek: 0, qualityScore: 1, errorRate: 0 })
      .build();
    const committed = await ledger.commitPromotion(manifest, [], i + 1, {
      metadataName: `bak-${i}`,
    });
    promotionHashes.push(committed.promotionHash);
    manifestHashes.push(committed.manifestHash);
  }

  return {
    promotionHashes,
    manifestHashes,
    merkleRoot: MerkleTree.computeEventRoot(await log.getAllEvents()),
  };
}

export async function proveBackupRestore(options?: {
  readonly eventCount?: number;
}): Promise<BackupRestoreProofReport> {
  const eventCount = options?.eventCount ?? 12;
  const errors: string[] = [];
  const work = await mkdtemp(path.join(os.tmpdir(), 'mimers-bak-'));
  const live = path.join(work, 'live');
  const backup = path.join(work, 'backup');
  const restored = path.join(work, 'restored');

  try {
    const seed = await seedLive(live, eventCount);

    const tBak0 = performance.now();
    await cp(path.join(live, 'cas'), path.join(backup, 'cas'), { recursive: true });
    await cp(path.join(live, 'ledger'), path.join(backup, 'ledger'), { recursive: true });
    await writeFile(
      path.join(backup, 'BACKUP_MANIFEST.json'),
      `${JSON.stringify(
        {
          kind: 'mimers-backup-manifest-v1',
          createdAt: new Date().toISOString(),
          includes: ['cas', 'ledger'],
          eventCount,
          merkleRoot: seed.merkleRoot,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    const backupMs = Number((performance.now() - tBak0).toFixed(3));

    // Destroy live (simulate total loss of primary).
    await rm(live, { recursive: true, force: true });

    const tRes0 = performance.now();
    await cp(path.join(backup, 'cas'), path.join(restored, 'cas'), { recursive: true });
    await cp(path.join(backup, 'ledger'), path.join(restored, 'ledger'), { recursive: true });
    const restoreMs = Number((performance.now() - tRes0).toFixed(3));

    const tVer0 = performance.now();
    const cas = new FileCASRepository(path.join(restored, 'cas'), { durabilityMode: 'none' });
    await cas.initialize();
    const log = new FileEventLog(path.join(restored, 'ledger'), {
      durabilityMode: 'none',
      maxEventsPerSegment: 3,
      checkpointPolicy: 'fail-closed',
    });
    await log.initialize();
    const events = await log.getAllEvents();
    const restoredMerkleRoot = MerkleTree.computeEventRoot(events);
    const promotionHashes = events.map((e) => e.promotionHash);
    const manifestHashes = events.map((e) => e.manifestHash);

    const hashesMatch =
      restoredMerkleRoot === seed.merkleRoot &&
      JSON.stringify(promotionHashes) === JSON.stringify(seed.promotionHashes) &&
      JSON.stringify(manifestHashes) === JSON.stringify(seed.manifestHashes);

    if (!hashesMatch) errors.push('restored hashes/Merkle differ from pre-backup seed');

    const recovery = new RecoveryOrchestrator(cas, () => log.getAllEvents());
    const restoredReport = await recovery.recoverFromLedger();
    if (restoredReport.status !== 'CLEAN') {
      errors.push(`recoverFromLedger not CLEAN: ${restoredReport.status}`);
    }

    const verify = await externalVerifyMimersRoot(restored);
    if (!verify.ok) errors.push(...verify.errors.map((e) => `external-verify: ${e}`));
    const verifyMs = Number((performance.now() - tVer0).toFixed(3));

    return {
      ok: errors.length === 0 && hashesMatch && restoredReport.status === 'CLEAN' && verify.ok,
      platform: `${process.platform}/${os.type()}`,
      eventCount: events.length,
      backupBytesHint: 'cas+ledger recursive copy (+ BACKUP_MANIFEST.json)',
      seedMerkleRoot: seed.merkleRoot,
      restoredMerkleRoot,
      hashesMatch,
      recoverStatus: restoredReport.status,
      externalVerifyOk: verify.ok,
      backupMs,
      restoreMs,
      verifyMs,
      errors,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const report = await proveBackupRestore();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

const isDirect =
  process.argv[1]?.includes('prove-backup-restore') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('prove-backup-restore.ts');
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
