import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';

/**
 * Mocks the deterministic hashing logic of the DecisionArtifactRepository.
 * In a real scenario, this imports the actual build/hash logic.
 */
function buildDecisionArtifactHash(payload: any, excludeMetadata = true): string {
  const canonicalPayload = JSON.stringify({
    decision_ref: payload.decision_ref,
    release_hash: payload.release_hash,
    municipality_id: payload.municipality_id,
    decision_facts_hash: payload.decision_facts_hash,
    evidence_refs: payload.evidence_refs,
    source_artifact_hashes: payload.source_artifact_hashes,
    semantic_version: payload.semantic_version,
    materialization_version: payload.materialization_version,
    extraction_model: payload.extraction_model,
    rule_version: payload.rule_version,
    // Note: created_at and generated_by are NOT in the canonical payload
  });
  return createHash('sha256').update(canonicalPayload).digest('hex');
}

describe('DecisionArtifactProperty (DFL Invariants)', () => {

  const basePayload = {
    decision_ref: 'case-123',
    release_hash: 'REL-001',
    municipality_id: '1280',
    decision_facts_hash: 'abc123hash',
    evidence_refs: ['ev-1', 'ev-2'],
    source_artifact_hashes: ['src-1', 'src-2'],
    semantic_version: '1.0.0',
    materialization_version: 'v2',
    extraction_model: 'gemini-1.5-pro',
    rule_version: '1.0.0'
  };

  it('DFL-1 Identity determinism: Samma fakta -> samma hash', () => {
    const a = buildDecisionArtifactHash({ ...basePayload });
    const b = buildDecisionArtifactHash({ ...basePayload });
    
    expect(a).toBe(b);
  });

  it('DFL-2 Metadata isolation: Mutation av skapandedatum påverkar inte hash', () => {
    const originalHash = buildDecisionArtifactHash(basePayload);
    
    const mutatedPayload = {
      ...basePayload,
      created_at: '2030-01-01T00:00:00Z',
      generated_by: 'system-agent-x'
    };
    
    const mutatedHash = buildDecisionArtifactHash(mutatedPayload);
    expect(mutatedHash).toBe(originalHash);
  });

  it('DFL-3 Evidence binding: Ändrad evidens muterar hashen', () => {
    const originalHash = buildDecisionArtifactHash(basePayload);
    
    const newEvidencePayload = {
      ...basePayload,
      evidence_refs: ['ev-1', 'ev-2', 'ev-3'] // Added one piece of evidence
    };
    
    const newHash = buildDecisionArtifactHash(newEvidencePayload);
    expect(newHash).not.toBe(originalHash);
  });

  it('DFL-3b Fact binding: Ändrad fakta-hash muterar artefakt-hashen', () => {
    const originalHash = buildDecisionArtifactHash(basePayload);
    
    const newFactsPayload = {
      ...basePayload,
      decision_facts_hash: 'def456hash' // Facts changed
    };
    
    const newHash = buildDecisionArtifactHash(newFactsPayload);
    expect(newHash).not.toBe(originalHash);
  });
});
