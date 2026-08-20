import { describe, expect, it } from 'vitest';
import type { RetrievalResultFields } from '@miljobeslut/mps-legal-retrieval-contract';
import {
  buildLegalAnswerContext,
  LegalAnswerContextError,
  type RetrievalResultWithContent,
} from '../src/index';

const QUERY_RUN = 'run-abc123';

function makeResult(overrides: Partial<RetrievalResultFields> = {}): RetrievalResultFields {
  return Object.freeze({
    fragment_id: overrides.fragment_id ?? 'frag:1',
    materialization_id: overrides.materialization_id ?? 'mat:1',
    source_provenance_refs: overrides.source_provenance_refs ?? ['materialization:mat:1'],
    embedding_identity: overrides.embedding_identity ?? {
      fragment_id: overrides.fragment_id ?? 'frag:1',
      materialization_id: overrides.materialization_id ?? 'mat:1',
      chunk_content_hash: 'hash:1',
      embedding_model_id: 'm',
      embedding_model_version: '1',
      embedding_pipeline_version: 'p1',
      contract_version: 'embed-identity-1',
      embedding_identity_hash: 'eih:1',
    },
    retrieval_policy_version: 'legal-ret-policy-1',
    query_run_identity: overrides.query_run_identity ?? QUERY_RUN,
    score: overrides.score ?? 0.9,
    rank: overrides.rank ?? 1,
    contract_version: 'legal-ret-result-1',
    resolved_against_governed_chunk: true,
  }) as RetrievalResultFields;
}

function item(overrides: Partial<RetrievalResultFields> = {}, content = 'some chunk text'): RetrievalResultWithContent {
  return { result: makeResult(overrides), content };
}

describe('LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01 -- LegalAnswerContext', () => {
  it('selects entries directly from the input results, in order, never introducing a fragment not present in the input', () => {
    const items = [
      item({ fragment_id: 'frag:1', rank: 1 }),
      item({ fragment_id: 'frag:2', rank: 2, embedding_identity: { ...makeResult().embedding_identity, chunk_content_hash: 'hash:2' } as any }),
    ];
    const ctx = buildLegalAnswerContext(items);
    expect(ctx.selection_order).toEqual(['frag:1', 'frag:2']);
    const inputFragmentIds = new Set(items.map((i) => i.result.fragment_id));
    for (const entry of ctx.selected) {
      expect(inputFragmentIds.has(entry.fragment_id)).toBe(true);
    }
  });

  it('cannot expand beyond the RetrievalResult set -- selected is always a subset of the input, never a superset', () => {
    const items = [item({ fragment_id: 'frag:only' })];
    const ctx = buildLegalAnswerContext(items);
    expect(ctx.selected.length).toBeLessThanOrEqual(items.length);
    expect(ctx.selected.every((s) => items.some((i) => i.result.fragment_id === s.fragment_id))).toBe(true);
  });

  it('drops a result with zero source_provenance_refs -- not admissible for citation', () => {
    const items = [item({ fragment_id: 'frag:noprov', source_provenance_refs: [] })];
    const ctx = buildLegalAnswerContext(items);
    expect(ctx.selected).toHaveLength(0);
    expect(ctx.excluded_missing_provenance).toEqual(['frag:noprov']);
  });

  it('deduplicates near-duplicate text via chunk_content_hash, keeping only the first (highest-ranked) occurrence', () => {
    const sharedEmbedding = { ...makeResult().embedding_identity, chunk_content_hash: 'hash:shared' };
    const items = [
      item({ fragment_id: 'frag:a', rank: 1, embedding_identity: sharedEmbedding as any }),
      item({ fragment_id: 'frag:b', rank: 2, embedding_identity: sharedEmbedding as any }),
    ];
    const ctx = buildLegalAnswerContext(items);
    expect(ctx.selection_order).toEqual(['frag:a']);
    expect(ctx.excluded_as_duplicate).toEqual(['frag:b']);
  });

  it('respects max_results', () => {
    const items = [1, 2, 3].map((n) =>
      item(
        { fragment_id: `frag:${n}`, rank: n, embedding_identity: { ...makeResult().embedding_identity, chunk_content_hash: `hash:${n}` } as any },
        'x',
      ),
    );
    const ctx = buildLegalAnswerContext(items, { max_results: 2, max_total_chars: 100_000 });
    expect(ctx.selection_order).toEqual(['frag:1', 'frag:2']);
    expect(ctx.excluded_by_budget).toEqual(['frag:3']);
  });

  it('respects the character budget', () => {
    const items = [1, 2].map((n) =>
      item(
        { fragment_id: `frag:${n}`, rank: n, embedding_identity: { ...makeResult().embedding_identity, chunk_content_hash: `hash:${n}` } as any },
        'x'.repeat(60),
      ),
    );
    const ctx = buildLegalAnswerContext(items, { max_results: 10, max_total_chars: 100 });
    expect(ctx.selection_order).toEqual(['frag:1']);
    expect(ctx.excluded_by_budget).toEqual(['frag:2']);
  });

  it('throws on an empty retrieval set -- caller must handle INSUFFICIENT_EVIDENCE before calling here', () => {
    expect(() => buildLegalAnswerContext([])).toThrow(LegalAnswerContextError);
  });

  it('rejects a mixed-query-run input -- one context must never blend two different retrieval runs', () => {
    const items = [item({ fragment_id: 'frag:1', query_run_identity: 'run-1' }), item({ fragment_id: 'frag:2', query_run_identity: 'run-2' })];
    expect(() => buildLegalAnswerContext(items)).toThrow(/QUERY_RUN_IDENTITY_MISMATCH/);
  });

  it('is deterministic: the same input under the same policy produces the same selection twice', () => {
    const items = [
      item({ fragment_id: 'frag:1', rank: 1 }),
      item({ fragment_id: 'frag:2', rank: 2, embedding_identity: { ...makeResult().embedding_identity, chunk_content_hash: 'hash:2' } as any }),
    ];
    const ctxA = buildLegalAnswerContext(items);
    const ctxB = buildLegalAnswerContext(items);
    expect(ctxA.selection_order).toEqual(ctxB.selection_order);
    expect(ctxA.selected).toEqual(ctxB.selected);
  });
});
