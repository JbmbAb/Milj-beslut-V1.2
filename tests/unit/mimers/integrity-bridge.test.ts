import { describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../../../server/artifact';
import {
  PolicyEnforcingArtifactStore,
  compareIntegrity,
  LegacyIntegrityProvider,
  MimersV9IntegrityProvider,
} from '../../../server/mimers';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArtifactPolicyViolation } from '@miljobeslut/mimers-brunn-core';

describe('Integrity bridge + WORM policy', () => {
  it('compareIntegrity returns dual digests (may differ across canonicalize strategies)', () => {
    const value = { b: 2, a: 1 };
    const cmp = compareIntegrity(value);
    expect(cmp.legacyDigest.startsWith('sha256:')).toBe(true);
    expect(cmp.v9Digest.startsWith('sha256:')).toBe(true);
    // Document intentional possible divergence — not forced equal.
    expect(typeof cmp.equal).toBe('boolean');
  });

  it('LegacyIntegrityProvider strips envelope fields from hash', () => {
    const legacy = new LegacyIntegrityProvider();
    const body = { humanId: 'h', pipelineId: 'p' };
    const withEnvelope = {
      ...body,
      artifactHash: 'sha256:noise',
      signature: 'ed25519:x',
      signingKeyId: 'k',
      artifactId: 'sha256:noise',
    };
    expect(legacy.hash(body)).toBe(legacy.hash(withEnvelope));
  });

  it('PolicyEnforcingArtifactStore denies overwrite on promotion/*', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'worm-policy-'));
    const store = new PolicyEnforcingArtifactStore(new FileArtifactStore(root));
    await store.put('promotion/sha256:abc', { ok: 1 });
    await expect(store.put('promotion/sha256:abc', { ok: 2 })).rejects.toBeInstanceOf(
      ArtifactPolicyViolation,
    );
  });

  it('MimersV9IntegrityProvider hashes via RFC8785', () => {
    const v9 = new MimersV9IntegrityProvider();
    expect(v9.hash({ a: 1, b: 2 })).toBe(v9.hash({ b: 2, a: 1 }));
  });
});
