import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { FileArtifactStore, createPromotionArtifactV3 } from '../../../server/artifact';
import {
  createPersistentMimersBackend,
  ensurePromotionMimersBinding,
  migrateArtifactStoreToMimersCas,
  mimersBindingKey,
} from '../../../server/mimers';

function sampleV3(humanId: string) {
  return createPromotionArtifactV3({
    humanId,
    pipelineId: 'pipe-1',
    executionHash: 'sha256:' + 'e'.repeat(64),
    pipelineDefinitionRef: 'definition:abc',
    mutationChain: [{ id: 'm1', type: 'tweak' }],
    fitness: { rawFitness: 1, penalty: 0, fitness: 1 },
    promotedAt: 1,
    sourceExperimentId: 'exp-1',
    evolutionRunId: 'run-1',
    approvalRecordId: 'approval-1',
    schemaVersion: 'promotion.v3',
  });
}

describe('migrate ArtifactStore → Mimers CAS', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'mimers-mig-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lazy ensurePromotionMimersBinding seals CAS without rewriting promotion/', async () => {
    const store = new FileArtifactStore(path.join(root, 'artifacts'));
    const { backend, cas } = await createPersistentMimersBackend(path.join(root, 'mimers'), {
      durabilityMode: 'none',
    });
    const artifact = sampleV3('promotion-run-g001-c000');
    await store.put(`promotion/${artifact.artifactHash}`, artifact);

    const first = await ensurePromotionMimersBinding(artifact, store, backend);
    expect(first.created).toBe(true);
    expect(await cas.existsAuthoritative(first.binding.manifestHash)).toBe(true);

    const second = await ensurePromotionMimersBinding(artifact, store, backend);
    expect(second.created).toBe(false);
    expect(second.binding.mimersPromotionHash).toBe(first.binding.mimersPromotionHash);

    const binding = await store.get(mimersBindingKey(artifact.artifactHash));
    expect(binding).toMatchObject({ artifactHash: artifact.artifactHash });
    // WORM promotion unchanged
    const stored = await store.get(`promotion/${artifact.artifactHash}`);
    expect(stored).toEqual(artifact);
  });

  it('one-shot migrate writes CAS report and is idempotent', async () => {
    const store = new FileArtifactStore(path.join(root, 'artifacts'));
    const { backend, cas } = await createPersistentMimersBackend(path.join(root, 'mimers'), {
      durabilityMode: 'none',
    });
    const a = sampleV3('promotion-run-g001-c000');
    const b = sampleV3('promotion-run-g002-c000');
    await store.put(`promotion/${a.artifactHash}`, a);
    await store.put(`promotion/${b.artifactHash}`, b);

    const { provider } = LocalPemSigningKeyProvider.generate('mig-key');
    const first = await migrateArtifactStoreToMimersCas(store, backend, { signing: provider });
    expect(first.report.migrated).toBe(2);
    expect(first.reportDigest).toMatch(/^sha256:/);
    expect(await cas.existsAuthoritative(first.reportDigest!)).toBe(true);
    expect(first.reportAttestationSubject).toBe(first.reportDigest);

    const second = await migrateArtifactStoreToMimersCas(store, backend);
    expect(second.report.migrated).toBe(0);
    expect(second.report.skipped).toBe(2);

    const reports = await store.list('migration-report/');
    expect(reports.some((k) => k.includes('mimers-cas-'))).toBe(true);
  });

  it('dry-run does not write bindings or CAS report', async () => {
    const store = new FileArtifactStore(path.join(root, 'artifacts'));
    const { backend, cas } = await createPersistentMimersBackend(path.join(root, 'mimers'), {
      durabilityMode: 'none',
    });
    const artifact = sampleV3('promotion-run-g001-c000');
    await store.put(`promotion/${artifact.artifactHash}`, artifact);

    const result = await migrateArtifactStoreToMimersCas(store, backend, { dryRun: true });
    expect(result.report.dryRun).toBe(true);
    expect(result.report.migrated).toBe(1);
    expect(result.reportDigest).toBeUndefined();
    expect(await store.list('mimers-binding/')).toEqual([]);
    expect(await store.list('migration-report/')).toEqual([]);
    let objectCount = 0;
    for await (const _ of cas.streamObjectDigests()) objectCount += 1;
    expect(objectCount).toBe(0);
  });
});
