import { describe, it, expect } from 'vitest';
import { CanonicalizerRegistry } from '../../alpha-runtime/src/recovery/CanonicalizerRegistry';

describe('CanonicalIdentityKernel', () => {
  const payload = {
    facts: { b: 2, a: 1 },
    refs: [{ id: 'ref2' }, { id: 'ref1' }],
    metadata: {
      municipality_id: '0180'
    }
  };

  it('DFL-I8: canonical(canonical(P)) = canonical(P) - Idempotency', () => {
    const canonicalStr = CanonicalizerRegistry.canonicalize('dg-canonical-1', payload);
    const parsed = JSON.parse(canonicalStr);
    
    // Applying canonicalizer again on the parsed representation should yield the identical string
    const secondCanonicalStr = CanonicalizerRegistry.canonicalize('dg-canonical-1', parsed);
    
    expect(secondCanonicalStr).toBe(canonicalStr);
  });

  it('DFL-I9: hash(P) = hash(deserialize(serialize(P))) - Serialization Neutrality', () => {
    const originalHash = CanonicalizerRegistry.generateIdentityHash('dg-canonical-1', payload);
    
    const serializedAndParsed = JSON.parse(JSON.stringify(payload));
    const processedHash = CanonicalizerRegistry.generateIdentityHash('dg-canonical-1', serializedAndParsed);
    
    expect(processedHash).toBe(originalHash);
  });

  it('DFL-I12: Canonical domain separation - same payload different canonicalizer produces different identity', () => {
    const hash1 = CanonicalizerRegistry.generateIdentityHash('dg-canonical-1', payload);
    const hash2 = CanonicalizerRegistry.generateIdentityHash('RFC8785-STRICT-V1', payload);
    
    expect(hash1).not.toBe(hash2);
  });

  it('DFL-I13: Canonicalizer availability - Unknown canonicalizer throws exception', () => {
    expect(() => {
      CanonicalizerRegistry.generateIdentityHash('dg-canonical-99', payload);
    }).toThrow('UNKNOWN_CANONICALIZER');
  });

  it('Key ordering should not affect identity hash', () => {
    const payloadUnordered = {
      metadata: { municipality_id: '0180' },
      refs: [{ id: 'ref2' }, { id: 'ref1' }],
      facts: { a: 1, b: 2 }
    };

    const hashOriginal = CanonicalizerRegistry.generateIdentityHash('dg-canonical-1', payload);
    const hashUnordered = CanonicalizerRegistry.generateIdentityHash('dg-canonical-1', payloadUnordered);

    expect(hashOriginal).toBe(hashUnordered);
  });
});
