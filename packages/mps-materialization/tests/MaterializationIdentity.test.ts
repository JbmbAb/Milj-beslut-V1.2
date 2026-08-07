import { describe, it, expect } from 'vitest';
import { CanonicalIdentityProvider } from '../../alpha-runtime/src/recovery/CanonicalIdentityProvider';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Runtime projection identity (MAT-I02 - MAT-I04)', () => {
  
  it('MAT-I02: the projection builder SHALL NOT calculate identity directly (no sha256 in source)', () => {
    const sourcePath = join(__dirname, '../../alpha-runtime/src/runtime/ArtifactProjectionBuilder.ts');
    const sourceCode = readFileSync(sourcePath, 'utf8');
    
    expect(sourceCode).not.toContain('createHash');
    expect(sourceCode).not.toContain('crypto');
    expect(sourceCode).not.toContain('sha256');
    expect(sourceCode).toContain('CanonicalIdentityProvider.generateProjectionIdentity');
  });

  it('MAT-I03: Canonicalizer Binding - different canonicalizer produces different hash', () => {
    const evidence = [{ id: 'doc1' }];
    const facts = { a: 1 };
    const ruleVersion = 'v1';
    const matVersion = 'v1';
    const provenance = { extraction_model: 'gemini-1.5' };

    const hashA = CanonicalIdentityProvider.generateProjectionIdentity(
      'runtime-projection-1', evidence, facts, ruleVersion, matVersion, provenance
    );

    const hashB = CanonicalIdentityProvider.generateProjectionIdentity(
      'RFC8785-STRICT-V1', evidence, facts, ruleVersion, matVersion, provenance
    );

    expect(hashA).toBeDefined();
    expect(hashB).toBeDefined();
    expect(hashA).not.toBe(hashB);
  });

  it('MAT-I04: Provenance Isolation - extraction_model mutation MUST NOT change the hash', () => {
    const evidence = [{ id: 'doc1' }];
    const facts = { a: 1 };
    
    const hashOriginal = CanonicalIdentityProvider.generateProjectionIdentity(
      'runtime-projection-1', evidence, facts, 'v1', 'v1', { extraction_model: 'gemini-2.5' }
    );

    const hashMutated = CanonicalIdentityProvider.generateProjectionIdentity(
      'runtime-projection-1', evidence, facts, 'v1', 'v1', { extraction_model: 'local-model-v3' }
    );

    expect(hashOriginal).toBe(hashMutated);
  });
});
