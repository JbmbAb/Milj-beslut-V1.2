import { describe, expect, it } from 'vitest';
import {
  MIMERS_METRICS,
  MerkleTree,
  canonicalizeStrict,
  generateUUIDv7,
  hashCanonicalValue,
  isSignatureAlgorithmId,
  parseHash,
} from '@miljobeslut/mimers-brunn-core';

describe('mimers-brunn-core P1 primitives', () => {
  it('canonicalizeStrict is order-independent and fail-fast on cycles', () => {
    const a = { alpha: 1, beta: { gamma: 't', delta: [1, 2] } };
    const b = { beta: { delta: [1, 2], gamma: 't' }, alpha: 1 };
    expect(hashCanonicalValue(a)).toBe(hashCanonicalValue(b));

    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    expect(() => canonicalizeStrict(circular)).toThrow(/circular/i);
  });

  it('parseHash validates algorithm and digest length', () => {
    const h = hashCanonicalValue({ x: 1 });
    expect(parseHash(h).algorithm).toBe('sha256');
    expect(() => parseHash('blake3:' + 'a'.repeat(64))).toThrow(/blake3/i);
    expect(() => parseHash('sha256:dead')).toThrow(/length/i);
  });

  it('exposes first-class signature algorithm ids', () => {
    expect(isSignatureAlgorithmId('Ed25519')).toBe(true);
    expect(isSignatureAlgorithmId('ECDSA_P256_SHA256')).toBe(true);
    expect(isSignatureAlgorithmId('RSA_PSS_SHA256')).toBe(true);
    expect(isSignatureAlgorithmId('unknown')).toBe(false);
  });

  it('generates RFC9562 UUIDv7', () => {
    expect(generateUUIDv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('Merkle empty root is stable', () => {
    expect(MerkleTree.computeEventRoot([])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('publishes stable metrics contract names', () => {
    expect(MIMERS_METRICS.casPutDuration).toBe('cas.put.duration');
    expect(MIMERS_METRICS.auditL3Duration).toBe('audit.l3.duration');
  });
});
