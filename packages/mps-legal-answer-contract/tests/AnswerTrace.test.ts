import { describe, expect, it } from 'vitest';
import { buildAnswerTrace } from '../src/index';

describe('LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01 -- AnswerTrace', () => {
  it('binds query_run_identity, cited fragments, and model identity together', () => {
    const trace = buildAnswerTrace({
      query_run_identity: 'run-abc',
      context_policy_version: 'legal-answer-context-v1',
      mode: 'ANSWERED',
      cited_fragment_ids: ['frag:1', 'frag:2'],
      answer_model_id: 'gemini-2.5-flash',
      answer_model_version: '001',
      answer_pipeline_version: 'answer-pipeline-gemini-v1',
    });
    expect(trace.query_run_identity).toBe('run-abc');
    expect(trace.cited_fragment_ids).toEqual(['frag:1', 'frag:2']);
    expect(trace.answer_model_id).toBe('gemini-2.5-flash');
    expect(trace.answer_trace_hash).toHaveLength(64);
  });

  it('INSUFFICIENT_EVIDENCE mode carries zero cited fragments and is still a real, hashed trace', () => {
    const trace = buildAnswerTrace({
      query_run_identity: 'run-empty',
      context_policy_version: 'legal-answer-context-v1',
      mode: 'INSUFFICIENT_EVIDENCE',
      cited_fragment_ids: [],
      answer_model_id: 'gemini-2.5-flash',
      answer_model_version: '001',
      answer_pipeline_version: 'answer-pipeline-gemini-v1',
    });
    expect(trace.mode).toBe('INSUFFICIENT_EVIDENCE');
    expect(trace.cited_fragment_ids).toEqual([]);
    expect(trace.answer_trace_hash).toHaveLength(64);
  });

  it('is deterministic for identical inputs -- same trace hash', () => {
    const input = {
      query_run_identity: 'run-abc',
      context_policy_version: 'legal-answer-context-v1',
      mode: 'ANSWERED' as const,
      cited_fragment_ids: ['frag:1'],
      answer_model_id: 'gemini-2.5-flash',
      answer_model_version: '001',
      answer_pipeline_version: 'answer-pipeline-gemini-v1',
    };
    expect(buildAnswerTrace(input).answer_trace_hash).toBe(buildAnswerTrace(input).answer_trace_hash);
  });

  it('a different cited-fragment set produces a different trace hash', () => {
    const base = {
      query_run_identity: 'run-abc',
      context_policy_version: 'legal-answer-context-v1',
      mode: 'ANSWERED' as const,
      answer_model_id: 'gemini-2.5-flash',
      answer_model_version: '001',
      answer_pipeline_version: 'answer-pipeline-gemini-v1',
    };
    const a = buildAnswerTrace({ ...base, cited_fragment_ids: ['frag:1'] });
    const b = buildAnswerTrace({ ...base, cited_fragment_ids: ['frag:1', 'frag:2'] });
    expect(a.answer_trace_hash).not.toBe(b.answer_trace_hash);
  });
});
