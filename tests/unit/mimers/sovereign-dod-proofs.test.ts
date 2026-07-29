import { describe, expect, it } from 'vitest';
import { externalVerifyMimersRoot } from '../../../scripts/mimers/prove-external-verify';
import { proveColdStartReplay } from '../../../scripts/mimers/prove-cold-start-replay';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  EvolutionLedger,
  FileCASRepository,
  FileEventLog,
  ManifestBuilder,
} from '@miljobeslut/mimers-brunn-core';

describe('Sovereign DoD proofs (§1/§3/§5)', () => {
  it('external verify passes on seeded CAS+ledger without ArtifactStore', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mimers-dod-verify-'));
    try {
      const cas = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'none' });
      await cas.initialize();
      const log = new FileEventLog(path.join(root, 'ledger'), {
        durabilityMode: 'none',
        maxEventsPerSegment: 2,
      });
      await log.initialize();
      const ledger = new EvolutionLedger(cas, log);
      const { manifest } = await new ManifestBuilder(cas)
        .pipeline({ id: 'dod' })
        .policy({ p: 1 })
        .runtime({ r: 1 })
        .metrics({ latencyMs: 1, costSek: 0, qualityScore: 1, errorRate: 0 })
        .build();
      await ledger.commitPromotion(manifest, [], 1);

      const report = await externalVerifyMimersRoot(root);
      expect(report.ok).toBe(true);
      expect(report.events).toBe(1);
      expect(report.l0).toBe('CLEAN');
      expect(report.l2).toBe('CLEAN');
      expect(report.errors).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cold-start empty node reconstitutes identical hashes from CAS+ledger only', async () => {
    const report = await proveColdStartReplay();
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.hashesMatch).toBe(true);
    expect(report.coldVerifyOk).toBe(true);
    expect(report.seedEvents).toBe(4);
    expect(report.coldPromotionHashes).toEqual(report.seedPromotionHashes);
    expect(report.coldManifestHashes).toEqual(report.seedManifestHashes);
  });
});
