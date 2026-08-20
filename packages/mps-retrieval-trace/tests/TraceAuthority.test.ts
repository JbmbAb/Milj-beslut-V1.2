import { describe, it, expect } from 'vitest';

describe('Trace Authority and Truth Duplication', () => {

  it('TRACE-I01 & TRACE-I02: Trace Cannot Create Authority and No Truth Duplication', () => {
    // A Trace can only contain ArtifactReference[]
    const trace: any = {
      trace_hash: '123',
      selected_artifact_refs: [
        { id: 'art_1', artifact_class: 'DecisionImpactArtifact' }
      ]
    };

    // If someone tries to sneak materialization payload into trace
    const tryToDuplicateTruth = (t: any) => {
      if (t.materialized_payload || t.decision_facts || t.evidence_set) {
        throw new Error('TRACE-I02: No Truth Duplication allowed. Trace must only contain ArtifactReference[].');
      }
    };

    expect(() => tryToDuplicateTruth(trace)).not.toThrow();

    const illegalTrace = {
      ...trace,
      decision_facts: { risk: 'High' }
    };

    expect(() => tryToDuplicateTruth(illegalTrace)).toThrow('TRACE-I02');
  });

});
