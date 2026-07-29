/**
 * Fas 4 M7 acceptance: Byte-CAS → DescriptorFactory → ManifestBuilder →
 * Ledger segments/checkpoints → Verifier/Repair/Recovery → UUIDProvider.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DescriptorFactory,
  EvolutionLedger,
  FileCASRepository,
  FileEventLog,
  ManifestBuilder,
  RecoveryOrchestrator,
  UUIDv7Provider,
  getUUIDProvider,
  hashBytes,
  newLedgerEventId,
  setUUIDProvider,
  type UUIDProvider,
} from '@miljobeslut/mimers-brunn-core';

describe('Fas 4 Sovereign acceptance (M1–M7)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'mimers-accept-'));
    setUUIDProvider(undefined);
  });

  afterEach(async () => {
    setUUIDProvider(undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it('M1 Byte-CAS stores opaque bytes without JSON knowledge', async () => {
    const cas = new FileCASRepository(path.join(dir, 'cas'), { durabilityMode: 'none' });
    await cas.initialize();
    const bytes = Uint8Array.from([0x00, 0xff, 0x10, 0x80]);
    const put = await cas.putBytes(bytes);
    expect(put.hash).toBe(hashBytes(bytes));
    const loaded = await cas.getBytes(put.hash, { verifyHash: true });
    expect(Buffer.from(loaded!).equals(Buffer.from(bytes))).toBe(true);

    const canon = await cas.putCanonical({ z: 1, a: 2 });
    const again = await cas.put({ z: 1, a: 2 });
    expect(again.hash).toBe(canon.hash);
    expect(again.existed).toBe(true);
  });

  it('M2–M5: factory → fluent builder → segmented ledger → merkle checkpoints', async () => {
    const cas = new FileCASRepository(path.join(dir, 'cas'), { durabilityMode: 'none' });
    await cas.initialize();
    const factory = new DescriptorFactory(cas);
    const log = new FileEventLog(path.join(dir, 'ledger'), {
      durabilityMode: 'none',
      maxEventsPerSegment: 2,
      enableMerkleCheckpoints: true,
    });
    await log.initialize();
    const ledger = new EvolutionLedger(cas, log);

    for (let i = 0; i < 3; i += 1) {
      const { manifest } = await new ManifestBuilder(factory)
        .pipeline({ id: `p-${i}` })
        .policy({ maxCost: i })
        .runtime({ node: process.version })
        .metrics({ latencyMs: i, costSek: 0, qualityScore: 1, errorRate: 0 })
        .build();
      await ledger.commitPromotion(manifest, [], i + 1, { metadataName: `g${i}` });
    }

    expect((await log.getAllEvents()).length).toBe(3);
    expect((await log.listSegments()).filter((s) => s.closed).length).toBeGreaterThanOrEqual(1);
    const checkpoints = await log.listCheckpoints();
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(checkpoints[0]?.previousRoot).toBeNull();
    if (checkpoints.length > 1) {
      expect(checkpoints[1]?.previousRoot).toBe(checkpoints[0]?.rootHash);
    }

    const recovery = new RecoveryOrchestrator(cas, () => log.getAllEvents());
    expect((await recovery.auditL0()).status).toBe('CLEAN');
    expect((await recovery.auditL1()).status).toBe('CLEAN');
    expect((await recovery.auditL2()).status).toBe('CLEAN');
    const restored = await recovery.recoverFromLedger();
    expect(restored.status).toBe('CLEAN');
    expect(restored.recoverableEvents).toBe(3);
  });

  it('M6–M7: recovery components + swappable UUIDProvider', async () => {
    const cas = new FileCASRepository(path.join(dir, 'cas'), { durabilityMode: 'none' });
    await cas.initialize();
    const log = new FileEventLog(path.join(dir, 'ledger'), {
      durabilityMode: 'none',
      maxEventsPerSegment: 10,
    });
    await log.initialize();

    expect(getUUIDProvider()).toBeInstanceOf(UUIDv7Provider);
    expect(newLedgerEventId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    let n = 0;
    const fake: UUIDProvider = {
      generate: () => `00000000-0000-7000-8000-${(n++).toString(16).padStart(12, '0')}`,
    };
    setUUIDProvider(fake);
    expect(newLedgerEventId()).toBe('00000000-0000-7000-8000-000000000000');
    expect(newLedgerEventId()).toBe('00000000-0000-7000-8000-000000000001');

    const { manifest } = await new ManifestBuilder(cas)
      .pipeline({ id: 'uuid-pipe' })
      .policy({ p: 1 })
      .runtime({ r: 1 })
      .metrics({ latencyMs: 1, costSek: 0, qualityScore: 1, errorRate: 0 })
      .build();
    const ledger = new EvolutionLedger(cas, log);
    const committed = await ledger.commitPromotion(manifest, [], 1);
    expect(committed.eventId).toBe('00000000-0000-7000-8000-000000000002');

    const recovery = new RecoveryOrchestrator(cas, () => log.getAllEvents());
    expect(recovery.verifier).toBeTruthy();
    expect(recovery.repair).toBeTruthy();
    expect(recovery.recovery).toBeTruthy();
    expect((await recovery.auditL3({ concurrency: 2 })).status).toBe('CLEAN');
  });
});
