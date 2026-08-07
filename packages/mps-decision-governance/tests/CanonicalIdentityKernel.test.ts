/**
 * Canonical kernel properties for the runtime projection canonicalizer.
 *
 * MAT-I05: this registry belongs to alpha-runtime and produces projection identity.
 * Decision Truth identity lives in CanonicalDecisionImpactHash and is tested separately.
 */
import { describe, it, expect } from 'vitest';
import { CanonicalizerRegistry } from '../../alpha-runtime/src/recovery/CanonicalizerRegistry';
import { hashVersionedCanonicalPayload } from '../src/CanonicalDecisionImpactHash';

describe('CanonicalIdentityKernel', () => {
  const payload = {
    facts: { b: 2, a: 1 },
    refs: [{ id: 'ref2' }, { id: 'ref1' }],
    metadata: {
      municipality_id: '0180'
    }
  };

  it('DFL-I8: canonical(canonical(P)) = canonical(P) - Idempotency', () => {
    const canonicalStr = CanonicalizerRegistry.canonicalize('runtime-projection-1', payload);
    const parsed = JSON.parse(canonicalStr);
    
    // Applying canonicalizer again on the parsed representation should yield the identical string
    const secondCanonicalStr = CanonicalizerRegistry.canonicalize('runtime-projection-1', parsed);
    
    expect(secondCanonicalStr).toBe(canonicalStr);
  });

  it('DFL-I9: hash(P) = hash(deserialize(serialize(P))) - Serialization Neutrality', () => {
    const originalHash = CanonicalizerRegistry.generateIdentityHash('runtime-projection-1', payload);
    
    const serializedAndParsed = JSON.parse(JSON.stringify(payload));
    const processedHash = CanonicalizerRegistry.generateIdentityHash('runtime-projection-1', serializedAndParsed);
    
    expect(processedHash).toBe(originalHash);
  });

  it('DFL-I12: Canonical domain separation - same payload different canonicalizer produces different identity', () => {
    const hash1 = CanonicalizerRegistry.generateIdentityHash('runtime-projection-1', payload);
    const hash2 = CanonicalizerRegistry.generateIdentityHash('RFC8785-STRICT-V1', payload);
    
    expect(hash1).not.toBe(hash2);
  });

  it('DFL-I13: Canonicalizer availability - Unknown canonicalizer throws exception', () => {
    expect(() => {
      CanonicalizerRegistry.generateIdentityHash('runtime-projection-99', payload);
    }).toThrow('UNKNOWN_CANONICALIZER');
  });

  it('MAT-I05: the runtime registry cannot claim a governance canonical version', () => {
    expect(() => {
      CanonicalizerRegistry.generateIdentityHash('dg-canonical-1', payload);
    }).toThrow('CANONICALIZER_NAMESPACE_VIOLATION');

    // The id previously denoted two different algorithms. It now denotes exactly one.
    expect(hashVersionedCanonicalPayload(payload, 'dg-canonical-1')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('Key ordering should not affect identity hash', () => {
    const payloadUnordered = {
      metadata: { municipality_id: '0180' },
      refs: [{ id: 'ref2' }, { id: 'ref1' }],
      facts: { a: 1, b: 2 }
    };

    const hashOriginal = CanonicalizerRegistry.generateIdentityHash('runtime-projection-1', payload);
    const hashUnordered = CanonicalizerRegistry.generateIdentityHash('runtime-projection-1', payloadUnordered);

    expect(hashOriginal).toBe(hashUnordered);
  });
});
