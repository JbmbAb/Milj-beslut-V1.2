import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DescriptorFactory,
  EvolutionLedger,
  FileCASRepository,
  InMemoryEventLog,
  ManifestBuilder,
  MANIFEST_COMPONENT_MEDIA_TYPES,
  validateManifest,
} from '@miljobeslut/mimers-brunn-core';

describe('DescriptorFactory', () => {
  let dir: string;
  let cas: FileCASRepository;
  let factory: DescriptorFactory;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'mimers-df-'));
    cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
    factory = new DescriptorFactory(cas);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('store returns digest/size/mediaType and is idempotent', async () => {
    const payload = { id: 'pipe-1', nodes: ['a'] };
    const first = await factory.store(payload, MANIFEST_COMPONENT_MEDIA_TYPES.pipeline);
    expect(first.mediaType).toBe(MANIFEST_COMPONENT_MEDIA_TYPES.pipeline);
    expect(first.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.size).toBeGreaterThan(0);
    expect(first.existed).toBe(false);

    const second = await factory.store(payload, MANIFEST_COMPONENT_MEDIA_TYPES.pipeline);
    expect(second.digest).toBe(first.digest);
    expect(second.existed).toBe(true);
    expect(await cas.existsAuthoritative(first.digest)).toBe(true);
  });

  it('rejects undefined payload and empty mediaType', async () => {
    await expect(factory.store(undefined, MANIFEST_COMPONENT_MEDIA_TYPES.pipeline)).rejects.toThrow(
      /undefined/,
    );
    await expect(factory.store({ ok: true }, '')).rejects.toThrow(/mediaType/);
  });
});

describe('ManifestBuilder', () => {
  let dir: string;
  let cas: FileCASRepository;
  let builder: ManifestBuilder;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'mimers-mb-'));
    cas = new FileCASRepository(dir, { durabilityMode: 'none' });
    await cas.initialize();
    builder = new ManifestBuilder(cas);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const sampleInput = () => ({
    pipeline: { id: 'rag-demo', version: '1.0.0', nodes: ['retrieve', 'rerank'] },
    policySnapshot: { id: 'pol-1', maxCostSek: 1.5 },
    runtimeFingerprint: { runtimeVersion: 'test', platform: 'node' },
    metrics: { latencyMs: 120, costSek: 0.01, qualityScore: 0.9, errorRate: 0 },
  });

  it('fluent API builds without exposing descriptor assembly', async () => {
    const sample = sampleInput();
    const result = await new ManifestBuilder(cas)
      .pipeline(sample.pipeline)
      .policy(sample.policySnapshot)
      .runtime(sample.runtimeFingerprint)
      .metrics(sample.metrics)
      .build();

    expect(() => validateManifest(result.manifest)).not.toThrow();
    expect(result.manifest.pipeline.mediaType).toBe(MANIFEST_COMPONENT_MEDIA_TYPES.pipeline);
    expect(result.components.pipeline.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await cas.existsAuthoritative(result.components.metrics.digest)).toBe(true);
  });

  it('builds a validated manifest with CAS-backed descriptors (batch compat)', async () => {
    const result = await builder.build(sampleInput());
    expect(() => validateManifest(result.manifest)).not.toThrow();
    expect(result.manifest.schemaVersion).toBe('v1.0.0');
    expect(result.manifest.pipeline.mediaType).toBe(MANIFEST_COMPONENT_MEDIA_TYPES.pipeline);
    expect(result.components.pipeline.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.components.pipeline.size).toBeGreaterThan(0);
    expect(await cas.existsAuthoritative(result.components.pipeline.digest)).toBe(true);
    expect(await cas.existsAuthoritative(result.components.metrics.digest)).toBe(true);
  });

  it('buildAndSeal puts the manifest object and is idempotent', async () => {
    const first = await builder.buildAndSeal(sampleInput());
    const second = await builder.buildAndSeal(sampleInput());
    expect(first.manifestHash).toBe(second.manifestHash);
    expect(second.manifestExisted).toBe(true);
    expect(second.components.pipeline.existed).toBe(true);
    const loaded = await cas.get(first.manifestHash, { verifyHash: true });
    expect(loaded).toEqual(first.manifest);
  });

  it('feeds EvolutionLedger.commitPromotion without manual descriptor assembly', async () => {
    const { manifest } = await builder.build(sampleInput());
    const ledger = new EvolutionLedger(cas, new InMemoryEventLog());
    const committed = await ledger.commitPromotion(manifest, [], 1, { metadataName: 'from-builder' });
    expect(committed.manifestHash).toMatch(/^sha256:/);
    expect(await cas.existsAuthoritative(committed.promotionHash)).toBe(true);
  });

  it('buildFromDescriptors reassembles without additional puts', async () => {
    const sealed = await builder.build(sampleInput());
    const rebuilt = builder.buildFromDescriptors({
      pipeline: sealed.manifest.pipeline,
      policySnapshot: sealed.manifest.policySnapshot,
      runtimeFingerprint: sealed.manifest.runtimeFingerprint,
      metrics: sealed.manifest.metrics,
    });
    expect(rebuilt).toEqual(sealed.manifest);
  });

  it('rejects undefined components', async () => {
    await expect(
      builder.build({
        pipeline: { ok: true },
        policySnapshot: { ok: true },
        runtimeFingerprint: undefined,
        metrics: { ok: true },
      }),
    ).rejects.toThrow(/runtimeFingerprint/);
  });

  it('rejects wrong descriptor mediaType in buildFromDescriptors', () => {
    expect(() =>
      builder.buildFromDescriptors({
        pipeline: {
          mediaType: 'application/json',
          digest: 'sha256:' + 'a'.repeat(64),
          size: 1,
        },
        policySnapshot: {
          mediaType: MANIFEST_COMPONENT_MEDIA_TYPES.policySnapshot,
          digest: 'sha256:' + 'b'.repeat(64),
          size: 1,
        },
        runtimeFingerprint: {
          mediaType: MANIFEST_COMPONENT_MEDIA_TYPES.runtimeFingerprint,
          digest: 'sha256:' + 'c'.repeat(64),
          size: 1,
        },
        metrics: {
          mediaType: MANIFEST_COMPONENT_MEDIA_TYPES.metrics,
          digest: 'sha256:' + 'd'.repeat(64),
          size: 1,
        },
      }),
    ).toThrow(/mediaType/i);
  });

  it('accepts an injected DescriptorFactory', async () => {
    const factory = new DescriptorFactory(cas);
    const sample = sampleInput();
    const result = await new ManifestBuilder(factory)
      .pipeline(sample.pipeline)
      .policy(sample.policySnapshot)
      .runtime(sample.runtimeFingerprint)
      .metrics(sample.metrics)
      .build();
    expect(result.manifest.pipeline.digest).toMatch(/^sha256:/);
    expect(new ManifestBuilder(factory).descriptorFactory).toBe(factory);
  });
});
