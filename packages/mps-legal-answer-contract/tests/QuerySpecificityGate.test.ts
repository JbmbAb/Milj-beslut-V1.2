import { describe, expect, it } from 'vitest';
import { evaluateQuerySpecificity } from '../src/index';

describe('LEGAL-ANSWER-QUERY-SPECIFICITY-GATE-01', () => {
  it('flags the demonstrated gap: "Vad gäller?" is UNDERSPECIFIED', () => {
    const result = evaluateQuerySpecificity('Vad gäller?');
    expect(result.verdict).toBe('UNDERSPECIFIED');
    expect(result.content_word_count).toBe(0);
    expect(result.reason).toMatch(/no content-bearing terms/);
  });

  it('a real, content-bearing legal query is SPECIFIED', () => {
    const result = evaluateQuerySpecificity('Vad är miljöbalkens mål och tillämpningsområde?');
    expect(result.verdict).toBe('SPECIFIED');
    expect(result.content_word_count).toBeGreaterThan(0);
    expect(result.reason).toBeNull();
  });

  it('a short but real query ("Hur borrar man en brunn på rätt sätt?") is SPECIFIED', () => {
    const result = evaluateQuerySpecificity('Hur borrar man en brunn på rätt sätt?');
    expect(result.verdict).toBe('SPECIFIED');
  });

  it('a single content word is enough to be SPECIFIED -- the gate does not require multiple terms', () => {
    const result = evaluateQuerySpecificity('miljöbalken');
    expect(result.verdict).toBe('SPECIFIED');
    expect(result.content_word_count).toBe(1);
  });

  it('an empty or whitespace-only query is UNDERSPECIFIED', () => {
    expect(evaluateQuerySpecificity('').verdict).toBe('UNDERSPECIFIED');
    expect(evaluateQuerySpecificity('   ').verdict).toBe('UNDERSPECIFIED');
  });

  it('pure function words with no content produce UNDERSPECIFIED regardless of length', () => {
    const result = evaluateQuerySpecificity('Vad är det som gäller här och nu för alla?');
    expect(result.verdict).toBe('UNDERSPECIFIED');
  });

  it('is deterministic: the same query always produces the same verdict', () => {
    const a = evaluateQuerySpecificity('Vad gäller?');
    const b = evaluateQuerySpecificity('Vad gäller?');
    expect(a).toEqual(b);
  });

  it('never varies by case or punctuation alone', () => {
    expect(evaluateQuerySpecificity('VAD GÄLLER???').verdict).toBe('UNDERSPECIFIED');
    expect(evaluateQuerySpecificity('vad    gäller').verdict).toBe('UNDERSPECIFIED');
  });

  it('carries its own versioned contract_version', () => {
    expect(evaluateQuerySpecificity('miljöbalken').contract_version).toBe('query-specificity-gate-v1');
  });
});
