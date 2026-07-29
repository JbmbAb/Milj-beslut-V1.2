import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArtifactPolicyViolation } from '@miljobeslut/mimers-brunn-core';
import { createPromotionArtifactV3 } from '../../../server/artifact';
import { FileArtifactStore } from '../../../server/artifact/FileArtifactStore';
import {
  PolicyEnforcingArtifactStore,
  createPersistentMimersBackend,
  isMimersRequired,
  parseMimersDurabilityMode,
  requireMimersBackendFromEnv,
  resolveMimersBackendFromEnv,
  verifyPromotionAgainstBackend,
} from '../../../server/mimers';

describe('Mimers env + WORM policy wiring', () => {
  it('parseMimersDurabilityMode validates inputs', () => {
    expect(parseMimersDurabilityMode(undefined)).toBe('best-effort');
    expect(parseMimersDurabilityMode('strict')).toBe('strict');
    expect(parseMimersDurabilityMode('NONE')).toBe('none');
    expect(() => parseMimersDurabilityMode('turbo')).toThrow(/MIMERS_DURABILITY_MODE/);
  });

  it('isMimersRequired / resolve fail-closed', async () => {
    expect(isMimersRequired({})).toBe(false);
    expect(isMimersRequired({ MIMERS_REQUIRED: 'true' })).toBe(true);
    await expect(
      resolveMimersBackendFromEnv({ env: { MIMERS_REQUIRED: 'true' } }),
    ).rejects.toThrow(/MIMERS_ROOT/);
    await expect(resolveMimersBackendFromEnv({ env: {} })).resolves.toBeNull();
  });

  it('requireMimersBackendFromEnv uses fallbackRoot', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mimers-req-'));
    try {
      const resolved = await requireMimersBackendFromEnv({
        env: { MIMERS_DURABILITY_MODE: 'none' },
        fallbackRoot: root,
      });
      expect(resolved.rootDir).toBe(path.resolve(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolveMimersBackendFromEnv uses MIMERS_ROOT', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mimers-env-'));
    try {
      const resolved = await resolveMimersBackendFromEnv({
        env: { MIMERS_ROOT: root, MIMERS_DURABILITY_MODE: 'none' },
      });
      expect(resolved?.rootDir).toBe(path.resolve(root));
      expect(resolved?.backend).toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('PolicyEnforcingArtifactStore blocks promotion overwrite', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mimers-worm-'));
    try {
      const store = new PolicyEnforcingArtifactStore(new FileArtifactStore(dir));
      await store.put('promotion/sha256:abc', { v: 1 });
      await expect(store.put('promotion/sha256:abc', { v: 2 })).rejects.toBeInstanceOf(
        ArtifactPolicyViolation,
      );
      await store.put('experiment/run-1/x', { ok: true });
      await store.put('experiment/run-1/x', { ok: true, again: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('verifyPromotionAgainstCas fails without Mimers index fields', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mimers-verify-'));
    try {
      const { backend } = await createPersistentMimersBackend(root, { durabilityMode: 'none' });
      const artifact = createPromotionArtifactV3({
        humanId: 'promotion-g001-c000',
        pipelineId: 'p',
        executionHash: 'sha256:' + 'e'.repeat(64),
        pipelineDefinitionRef: 'definition:x',
        mutationChain: [{ id: 'm1', type: 't' }],
        fitness: { rawFitness: 1, penalty: 0, fitness: 1 },
        promotedAt: 1,
        sourceExperimentId: 'exp',
        evolutionRunId: 'run',
        approvalRecordId: 'appr',
        schemaVersion: 'promotion.v3',
      });
      const result = await verifyPromotionAgainstBackend(artifact, backend);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /manifestHash/i.test(e))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
