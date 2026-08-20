import { describe, expect, it } from 'vitest';
import { buildCitation, CitationError, type LegalAnswerContextV1 } from '../src/index';

function makeContext(overrides: Partial<LegalAnswerContextV1> = {}): LegalAnswerContextV1 {
  return {
    contract_version: 'legal-answer-context-v1',
    context_policy_version: 'legal-answer-context-v1',
    query_run_identity: 'run-abc',
    policy: { max_results: 8, max_total_chars: 24000 },
    selected: [
      {
        fragment_id: 'frag:1',
        materialization_id: 'mat:1',
        source_provenance_refs: ['materialization:mat:1'],
        content: 'text',
        rank: 1,
        score: 0.9,
      },
    ],
    selection_order: ['frag:1'],
    excluded_as_duplicate: [],
    excluded_by_budget: [],
    excluded_missing_provenance: [],
    ...overrides,
  } as LegalAnswerContextV1;
}

describe('LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01 -- Citation', () => {
  it('ACCEPT: a citation referencing a fragment actually present in the context', () => {
    const ctx = makeContext();
    const citation = buildCitation({ fragment_id: 'frag:1', materialization_id: 'mat:1' }, ctx);
    expect(citation.fragment_id).toBe('frag:1');
    expect(citation.materialization_id).toBe('mat:1');
    expect(citation.query_run_identity).toBe('run-abc');
    expect(citation.citation_id).toHaveLength(64);
  });

  it('FAIL CLOSED: a nonexistent fragment_id is rejected, never fabricated', () => {
    const ctx = makeContext();
    expect(() => buildCitation({ fragment_id: 'frag:does-not-exist', materialization_id: 'mat:1' }, ctx)).toThrow(
      /CITATION_OUTSIDE_RETRIEVAL_SET/,
    );
  });

  it('FAIL CLOSED: a real fragment_id claimed under the WRONG materialization_id is rejected', () => {
    const ctx = makeContext();
    expect(() => buildCitation({ fragment_id: 'frag:1', materialization_id: 'mat:WRONG' }, ctx)).toThrow(
      /CITATION_MATERIALIZATION_MISMATCH/,
    );
  });

  it('FAIL CLOSED: an entry with no provenance is not admissible for citation even if somehow present in the context', () => {
    const ctx = makeContext({
      selected: [
        {
          fragment_id: 'frag:noprov',
          materialization_id: 'mat:1',
          source_provenance_refs: [],
          content: 'text',
          rank: 1,
          score: 0.9,
        },
      ],
    });
    expect(() => buildCitation({ fragment_id: 'frag:noprov', materialization_id: 'mat:1' }, ctx)).toThrow(/MISSING_PROVENANCE/);
  });

  it('citation_id is a pure representation of already-verified refs, not a new authority -- deterministic for the same inputs', () => {
    const ctx = makeContext();
    const a = buildCitation({ fragment_id: 'frag:1', materialization_id: 'mat:1' }, ctx);
    const b = buildCitation({ fragment_id: 'frag:1', materialization_id: 'mat:1' }, ctx);
    expect(a.citation_id).toBe(b.citation_id);
  });

  it('throws CitationError (a typed error), not a generic Error, on every failure mode', () => {
    const ctx = makeContext();
    try {
      buildCitation({ fragment_id: 'nope', materialization_id: 'mat:1' }, ctx);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CitationError);
    }
  });
});
