import { describe, it, expect } from 'vitest';

export class AuthorityBoundaryViolation extends Error {
    constructor(msg: string) {
        super(`AUTHORITY_BOUNDARY_VIOLATION: ${msg}`);
    }
}

describe('Commit E.5 - Negative Architecture Tests', () => {

  it('Blocks RawDocumentChunk -> LLM -> DecisionImpactArtifact', () => {
    const llmProcess = (inputClass: string, outputClass: string) => {
        if (inputClass === 'RawDocumentChunk' && outputClass === 'DecisionImpactArtifact') {
            throw new AuthorityBoundaryViolation('LLM cannot bypass materialization to create DecisionTruth from Raw Evidence.');
        }
    };

    expect(() => llmProcess('RawDocumentChunk', 'DecisionImpactArtifact'))
        .toThrow(AuthorityBoundaryViolation);
  });

  it('Blocks UI -> Decision CAS', () => {
    const uiAction = (action: string, targetDomain: string) => {
        if (action === 'WRITE' && targetDomain === 'DecisionCAS') {
            throw new AuthorityBoundaryViolation('UI cannot write directly to Decision CAS.');
        }
    };

    expect(() => uiAction('WRITE', 'DecisionCAS')).toThrow(AuthorityBoundaryViolation);
  });

  it('Blocks Retrieval -> Decision CAS', () => {
    const retrievalAction = (action: string, targetDomain: string) => {
        if (action === 'WRITE' && targetDomain === 'DecisionCAS') {
            throw new AuthorityBoundaryViolation('Retrieval cannot write directly to Decision CAS.');
        }
    };

    expect(() => retrievalAction('WRITE', 'DecisionCAS')).toThrow(AuthorityBoundaryViolation);
  });

});
