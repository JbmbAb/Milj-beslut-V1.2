import { describe, expect, it } from 'vitest';
import {
  assertLegalArtifactClassAllowed,
  buildLegalRetrievalPolicy,
  evaluateLegalRetrieval,
  LEGAL_RETRIEVAL_POLICY_VERSION,
} from '../src/LegalRetrievalPolicy';
import { LegalRetrievalGovernanceError } from '../src/LegalArtifactAccessRules';

describe('LEGAL-RETRIEVAL-POLICY-01', () => {
  it('LEGAL-RET-I01: the only initial artifact class is LegalCorpusMaterializedChunk', () => {
    const policy = buildLegalRetrievalPolicy('LEGAL_CORPUS_SEARCH');
    expect(policy.access.initial).toBe('LegalCorpusMaterializedChunk');
    expect(policy.policy_version).toBe(LEGAL_RETRIEVAL_POLICY_VERSION);
  });

  it('LEGAL-RET-I02: LegalCorpusMaterializedChunk is allowed', () => {
    const policy = buildLegalRetrievalPolicy('LEGAL_CORPUS_SEARCH');
    expect(() => assertLegalArtifactClassAllowed(policy, 'LegalCorpusMaterializedChunk')).not.toThrow();
  });

  it('LEGAL-RET-I02: the legacy legal_corpus_chunks table is forbidden, never silently substituted', () => {
    const policy = buildLegalRetrievalPolicy('LEGAL_CORPUS_SEARCH');
    expect(() => assertLegalArtifactClassAllowed(policy, 'LegacyLegalCorpusChunk')).toThrow(
      LegalRetrievalGovernanceError,
    );
    expect(() => assertLegalArtifactClassAllowed(policy, 'LegacyLegalCorpusChunk')).toThrow(/LEGAL-RET-I02/);
  });

  it('LEGAL-RET-I02: unsigned Phase B drafts are forbidden, never promoted to retrievable', () => {
    const policy = buildLegalRetrievalPolicy('LEGAL_CORPUS_SEARCH');
    expect(() => assertLegalArtifactClassAllowed(policy, 'UnsignedDraftChunk')).toThrow(/LEGAL-RET-I02/);
  });

  it('LEGAL-RET-I03: evaluateLegalRetrieval never throws for the governed class and is always read-only', () => {
    const decision = evaluateLegalRetrieval('LEGAL_CORPUS_SEARCH');
    expect(decision.read_only).toBe(true);
    expect(decision.initial_artifact_class).toBe('LegalCorpusMaterializedChunk');
    expect(decision.policy.read_only).toBe(true);
  });

  it('policy is deterministic: identical inputs produce a structurally identical policy', () => {
    const a = buildLegalRetrievalPolicy('LEGAL_CORPUS_SEARCH');
    const b = buildLegalRetrievalPolicy('LEGAL_CORPUS_SEARCH');
    expect(a).toEqual(b);
  });

  it('the LU RetrievalPolicy (DecisionImpactArtifact-oriented) is untouched by this module -- both coexist without collision', async () => {
    const lu = await import('../src/RetrievalPolicy');
    expect(lu.RETRIEVAL_POLICY_VERSION).toBe('ret-policy-1');
    const luPolicy = lu.buildRetrievalPolicy('GENERAL');
    expect(luPolicy.access.initial).toBe('DecisionImpactArtifact');
  });
});
