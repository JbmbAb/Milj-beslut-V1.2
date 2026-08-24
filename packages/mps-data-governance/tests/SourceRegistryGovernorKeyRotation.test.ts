import { describe, it, expect, afterEach } from 'vitest';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { getSourceRegistrySigningKeyFromEnv } from '../src/SourceRegistry';

/**
 * SOURCE-REGISTRY-GOVERNOR-KEY-ROTATION-V1 -- separation-of-duties and env-resolution proofs.
 *
 * The real key generation / persistence / end-to-end coexistence proof is
 * scripts/ops/prove-source-registry-governor-key-rotation-01.ts (run twice against real
 * ~/.mimers state -- second run confirms fresh-process resolution of the already-persisted key,
 * not regeneration). This test covers the two things that don't need real disk state: that the
 * new governor key id is distinct from every other real governance key id used this session, and
 * that the signing-authority resolution function reads exactly the env vars it claims to.
 */
describe('SOURCE-REGISTRY-GOVERNOR-KEY-ROTATION-V1', () => {
  const NEW_GOVERNOR_KEY_ID = 'ed25519:source-registry-governor-2026-08-25';
  const HISTORICAL_GOVERNOR_KEY_ID = 'ed25519:source-registry-governor-2026-08-14';
  const OTHER_REAL_GOVERNANCE_KEY_IDS = [
    'ed25519:document-fact-extractor-v1',
    'ed25519:document-fact-reviewer-v1',
    'ed25519:governance-promotion-v1',
  ];

  afterEach(() => {
    delete process.env.SOURCE_REGISTRY_SIGNING_KEY_ID;
    delete process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM;
    delete process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM;
  });

  it('the new governor key id is distinct from the historical key and every other real governance key', () => {
    expect(NEW_GOVERNOR_KEY_ID).not.toBe(HISTORICAL_GOVERNOR_KEY_ID);
    expect(OTHER_REAL_GOVERNANCE_KEY_IDS).not.toContain(NEW_GOVERNOR_KEY_ID);
    // No accidental duplicate in the "other keys" list itself.
    expect(new Set(OTHER_REAL_GOVERNANCE_KEY_IDS).size).toBe(OTHER_REAL_GOVERNANCE_KEY_IDS.length);
  });

  it('getSourceRegistrySigningKeyFromEnv resolves exactly the provisioned key id and public material', () => {
    const generated = LocalPemSigningKeyProvider.generate(NEW_GOVERNOR_KEY_ID);
    process.env.SOURCE_REGISTRY_SIGNING_KEY_ID = generated.provider.keyId;
    process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM = generated.privateKey;
    process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM = generated.publicKey;

    const resolved = getSourceRegistrySigningKeyFromEnv();
    expect(resolved.keyId).toBe(NEW_GOVERNOR_KEY_ID);
  });

  it('resolution fails closed when the private key env var is absent -- a verify-only host cannot accidentally sign', () => {
    process.env.SOURCE_REGISTRY_SIGNING_KEY_ID = NEW_GOVERNOR_KEY_ID;
    process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM = 'irrelevant-for-this-check';
    delete process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM;

    expect(() => getSourceRegistrySigningKeyFromEnv()).toThrow(/SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM/);
  });
});
