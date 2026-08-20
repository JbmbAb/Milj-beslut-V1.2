import { describe, it, expect } from 'vitest';
import { calculateRetrievalTraceIdentity } from '../src/RetrievalTraceIdentity';
import { ArtifactReference } from '../src/ArtifactReference';

describe('TRACE-I03: Retrieval Determinism', () => {
  it('Should generate exactly the same trace hash for the same inputs, regardless of metadata', () => {
    const query_hash = 'q_123';
    const policy_version = 'v1.0';
    const snapshot_ref = 'snap_abc';
    
    const refs: ArtifactReference[] = [
      { id: 'art_2', artifact_class: 'DecisionImpactArtifact' },
      { id: 'art_1', artifact_class: 'DecisionImpactArtifact' }
    ];

    const hash1 = calculateRetrievalTraceIdentity(query_hash, policy_version, snapshot_ref, refs);

    // Provide the refs in a different order to ensure sorting logic guarantees determinism
    const refsScrambled: ArtifactReference[] = [
      { id: 'art_1', artifact_class: 'DecisionImpactArtifact' },
      { id: 'art_2', artifact_class: 'DecisionImpactArtifact' }
    ];

    const hash2 = calculateRetrievalTraceIdentity(query_hash, policy_version, snapshot_ref, refsScrambled);

    expect(hash1).toEqual(hash2);
  });
});
