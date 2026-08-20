import { describe, expect, it } from 'vitest';
import { evaluateNamedSourceConsistency } from '../src/index';

describe('LEGAL-ANSWER-NAMED-SOURCE-CONSISTENCY-GATE-01', () => {
  it('query does not name a statute -> NOT_APPLICABLE, never a fabricated source constraint', () => {
    const result = evaluateNamedSourceConsistency({
      namedKnownSourceIds: [],
      unrecognizedStatuteMentions: [],
      contextSourceIds: ['some-source'],
    });
    expect(result.verdict).toBe('NOT_APPLICABLE');
    expect(result.missing_source_ids).toEqual([]);
  });

  it('"fiskelagen" (unrecognized statute mention) -> NAMED_SOURCE_NOT_AVAILABLE, regardless of what IS in context', () => {
    const result = evaluateNamedSourceConsistency({
      namedKnownSourceIds: [],
      unrecognizedStatuteMentions: ['fiskelagen'],
      contextSourceIds: ['regeringskansliet-sfs-2013-251'], // an unrelated real source present
    });
    expect(result.verdict).toBe('NAMED_SOURCE_NOT_AVAILABLE');
    expect(result.reason).toMatch(/fiskelagen/);
  });

  it('"miljöbalken" named and present in context -> CONSISTENT, normal answer path', () => {
    const result = evaluateNamedSourceConsistency({
      namedKnownSourceIds: ['regeringskansliet-sfs-1998-808'],
      unrecognizedStatuteMentions: [],
      contextSourceIds: ['regeringskansliet-sfs-1998-808', 'regeringskansliet-sfs-2013-251'],
    });
    expect(result.verdict).toBe('CONSISTENT');
  });

  it('query names statute A, only statute B retrieved -> NAMED_SOURCE_NOT_AVAILABLE, never a silent substitution', () => {
    const result = evaluateNamedSourceConsistency({
      namedKnownSourceIds: ['statute-A'],
      unrecognizedStatuteMentions: [],
      contextSourceIds: ['statute-B'],
    });
    expect(result.verdict).toBe('NAMED_SOURCE_NOT_AVAILABLE');
    expect(result.missing_source_ids).toEqual(['statute-A']);
  });

  it('multiple named sources: ALL must be accounted for -- one present, one missing still fails', () => {
    const result = evaluateNamedSourceConsistency({
      namedKnownSourceIds: ['statute-A', 'statute-B'],
      unrecognizedStatuteMentions: [],
      contextSourceIds: ['statute-A'], // statute-B missing
    });
    expect(result.verdict).toBe('NAMED_SOURCE_NOT_AVAILABLE');
    expect(result.missing_source_ids).toEqual(['statute-B']);
  });

  it('multiple named sources: all present -> CONSISTENT', () => {
    const result = evaluateNamedSourceConsistency({
      namedKnownSourceIds: ['statute-A', 'statute-B'],
      unrecognizedStatuteMentions: [],
      contextSourceIds: ['statute-A', 'statute-B', 'statute-C'],
    });
    expect(result.verdict).toBe('CONSISTENT');
    expect(result.missing_source_ids).toEqual([]);
  });

  it('is a pure function: identical input always produces identical output', () => {
    const input = { namedKnownSourceIds: ['x'], unrecognizedStatuteMentions: [], contextSourceIds: ['y'] };
    expect(evaluateNamedSourceConsistency(input)).toEqual(evaluateNamedSourceConsistency(input));
  });

  it('carries its own versioned contract_version', () => {
    const result = evaluateNamedSourceConsistency({ namedKnownSourceIds: [], unrecognizedStatuteMentions: [], contextSourceIds: [] });
    expect(result.contract_version).toBe('named-source-consistency-gate-v1');
  });
});
