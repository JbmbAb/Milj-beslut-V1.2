import { describe, expect, it } from 'vitest';

/**
 * RED: the pre-contract prototype returns an attestation beside a V1 fact, but the fact itself
 * cannot carry the immutable hashed reference required by the frozen V2 production contract.
 */
describe('DOCUMENT-REVIEW-ATTESTATION-BINDING-CONTRACT-01 RED', () => {
  it('requires a V2 fact contract with a mandatory review_attestation_ref', async () => {
    const facts = await import('../../packages/mps-data-governance/src/DocumentFactArtifact');
    expect('VerifiedDocumentFactArtifactV2' in facts).toBe(true);
  });
});
