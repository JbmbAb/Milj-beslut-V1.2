import { describe, expect, it } from 'vitest';
import { ArtifactPolicyViolation } from '@miljobeslut/mimers-brunn-core';
import { FileArtifactStore } from '../../../server/artifact/FileArtifactStore';
import {
  PolicyEnforcingArtifactStore,
  parseMimersDurabilityMode,
  resolveMimersBackendFromEnv,
} from '../../../server/mimers';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('Mimers env + WORM policy wiring', () => {
  it('parseMimersDurabilityMode validates inputs', () => {
    expect(parseMimersDurabilityMode(undefined)).toBe('best-effort');
    expect(parseMimersDurabilityMode('strict')).toBe('strict');
    expect(parseMimersDurabilityMode('NONE')).toBe('none');
    expect(() => parseMimersDurabilityMode('turbo')).toThrow(/MIMERS_DURABILITY_MODE/);
  });

  it('resolveMimersBackendFromEnv returns null without root', async () => {
    const resolved = await resolveMimersBackendFromEnv({ env: {} });
    expect(resolved).toBeNull();
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
});
