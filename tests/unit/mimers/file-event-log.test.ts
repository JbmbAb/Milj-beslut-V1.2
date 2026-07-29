import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EvolutionLedger,
  FileCASRepository,
  FileEventLog,
  LedgerCorruptionError,
  ManifestBuilder,
  newLedgerEventId,
  verifyLedgerHashChain,
} from '@miljobeslut/mimers-brunn-core';
import { createPersistentMimersBackend } from '../../../server/mimers';

describe('FileEventLog (persistent)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'mimers-felog-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('survives process restart and rebuilds hash chain', async () => {
    const log1 = new FileEventLog(dir, { durabilityMode: 'none' });
    await log1.initialize();
    const a = await log1.append({
      eventId: newLedgerEventId(),
      type: 'PROMOTION_COMMITTED',
      promotionHash: 'sha256:' + 'a'.repeat(64),
      manifestHash: 'sha256:' + 'b'.repeat(64),
      timestamp: 1,
    });
    const b = await log1.append({
      eventId: newLedgerEventId(),
      type: 'PROMOTION_COMMITTED',
      promotionHash: 'sha256:' + 'c'.repeat(64),
      manifestHash: 'sha256:' + 'd'.repeat(64),
      timestamp: 2,
    });

    const log2 = new FileEventLog(dir, { durabilityMode: 'none' });
    await log2.initialize();
    const events = await log2.getAllEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.eventHash).toBe(a.eventHash);
    expect(events[1]?.eventHash).toBe(b.eventHash);
    expect(verifyLedgerHashChain(events).ok).toBe(true);
    expect((await log2.findByPromotionHash(b.promotionHash))?.eventId).toBe(b.eventId);
  });

  it('serializes parallel appends into contiguous sequences', async () => {
    const log = new FileEventLog(dir, { durabilityMode: 'none' });
    await log.initialize();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        log.append({
          eventId: newLedgerEventId(),
          type: 'PROMOTION_COMMITTED',
          promotionHash: 'sha256:' + i.toString(16).padStart(64, '0'),
          manifestHash: 'sha256:' + 'e'.repeat(64),
          timestamp: i,
        }),
      ),
    );
    const events = await log.getAllEvents();
    expect(events.map((e) => e.sequence)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(verifyLedgerHashChain(events).ok).toBe(true);
  });

  it('detects truncated event files on reload', async () => {
    const log = new FileEventLog(dir, { durabilityMode: 'none' });
    await log.initialize();
    await log.append({
      eventId: newLedgerEventId(),
      type: 'PROMOTION_COMMITTED',
      promotionHash: 'sha256:' + '1'.repeat(64),
      manifestHash: 'sha256:' + '2'.repeat(64),
      timestamp: 1,
    });
    await writeFile(path.join(dir, 'events', '00000001.json'), '{"truncated":', 'utf-8');

    const reloaded = new FileEventLog(dir, { durabilityMode: 'none' });
    await expect(reloaded.initialize()).rejects.toBeInstanceOf(LedgerCorruptionError);
  });

  it('works with EvolutionLedger + ManifestBuilder after restart', async () => {
    const cas = new FileCASRepository(path.join(dir, 'cas'), { durabilityMode: 'none' });
    await cas.initialize();
    const log = new FileEventLog(path.join(dir, 'ledger'), { durabilityMode: 'none' });
    await log.initialize();
    const builder = new ManifestBuilder(cas);
    const ledger = new EvolutionLedger(cas, log);

    const { manifest } = await builder.build({
      pipeline: { id: 'p' },
      policySnapshot: { maxCost: 1 },
      runtimeFingerprint: { v: 1 },
      metrics: { latencyMs: 1, costSek: 0, qualityScore: 1, errorRate: 0 },
    });
    const first = await ledger.commitPromotion(manifest, [], 1, { metadataName: 'g1' });

    const log2 = new FileEventLog(path.join(dir, 'ledger'), { durabilityMode: 'none' });
    await log2.initialize();
    const ledger2 = new EvolutionLedger(cas, log2);
    const replay = await ledger2.commitPromotion(manifest, [], 1, { metadataName: 'g1' });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.promotionHash).toBe(first.promotionHash);
    expect((await log2.getAllEvents()).length).toBe(1);
  });

  it('createPersistentMimersBackend seals and reloads', async () => {
    const root = path.join(dir, 'mimers-root');
    const created = await createPersistentMimersBackend(root, { durabilityMode: 'none' });
    const sealed = await created.backend.seal({
      pipeline: { nodes: ['a'] },
      policySnapshot: { p: 1 },
      runtimeFingerprint: { r: 1 },
      metrics: { latencyMs: 1, costSek: 0, qualityScore: 1, errorRate: 0 },
      parents: [],
      generation: 1,
      metadataName: 'persist',
    });

    const reopened = await createPersistentMimersBackend(root, { durabilityMode: 'none' });
    const found = await reopened.eventLog.findByPromotionHash(sealed.promotionHash);
    expect(found?.eventId).toBe(sealed.eventId);
    expect(await reopened.cas.existsAuthoritative(sealed.manifestHash)).toBe(true);
  });
});
