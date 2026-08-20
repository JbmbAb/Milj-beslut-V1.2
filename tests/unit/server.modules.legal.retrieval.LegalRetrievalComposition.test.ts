import { describe, expect, it } from 'vitest';
import {
  LegalRetrievalRequestError,
  performLegalRetrieval,
  type ChunkRefLookup,
  type LegalRetrievalDeps,
  type SearchChunks,
  type SearchHit,
} from '../../server/modules/legal/retrieval/LegalRetrievalComposition';
import type { EmbeddingProvider } from '../../server/modules/legal/retrieval/GeminiEmbeddingProvider';
import type { GovernedChunkRef } from '@miljobeslut/mps-legal-retrieval-contract';

const FAKE_VECTOR = [0.1, 0.2, 0.3];

function fakeProvider(): EmbeddingProvider {
  return {
    model_id: 'fake-model',
    model_version: '1',
    pipeline_version: 'fake-pipeline-v1',
    async embedBatch(texts) {
      return texts.map(() => FAKE_VECTOR);
    },
  };
}

function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    fragment_id: 'frag:abc',
    materialization_id: 'mat:1',
    chunk_content_hash: 'hash:abc',
    structure_kind: 'law',
    distance: 0.1,
    ...overrides,
  };
}

function makeRef(overrides: Partial<GovernedChunkRef> = {}): GovernedChunkRef {
  return {
    fragment_id: 'frag:abc',
    materialization_id: 'mat:1',
    content_hash: 'hash:abc',
    structure_kind: 'law',
    ...overrides,
  };
}

describe('LEGAL-RETRIEVAL-PRODUCTION-COMPOSITION-01', () => {
  it('family=law engages the law metadata router, and passes its decision to search', async () => {
    let capturedFamily: string | undefined;
    let capturedRoutingSourceCount = -1;
    const searchChunks: SearchChunks = async (_v, _m, _p, family, routing) => {
      capturedFamily = family;
      capturedRoutingSourceCount = routing?.source_candidates.length ?? -1;
      return [];
    };
    const lookupChunkRef: ChunkRefLookup = async () => null;
    const deps: LegalRetrievalDeps = { embeddingProvider: fakeProvider(), searchChunks, lookupChunkRef };

    const outcome = await performLegalRetrieval({ query: 'Vad säger miljöbalken om detta?', family: 'law' }, deps);

    expect(capturedFamily).toBe('law');
    expect(capturedRoutingSourceCount).toBe(1); // miljöbalken recognized
    expect(outcome.routing).not.toBeNull();
    expect(outcome.trace.identity.expansion_path[0]).toContain('regeringskansliet-sfs-1998-808');
  });

  it('family=court bypasses the router entirely -- routing is null, court stays on the plain vector path', async () => {
    let capturedRouting: unknown = 'not-set';
    const searchChunks: SearchChunks = async (_v, _m, _p, _family, routing) => {
      capturedRouting = routing;
      return [];
    };
    const deps: LegalRetrievalDeps = { embeddingProvider: fakeProvider(), searchChunks, lookupChunkRef: async () => null };

    const outcome = await performLegalRetrieval({ query: 'Mark- och miljööverdomstolens dom i mål M 307-24', family: 'court' }, deps);

    expect(capturedRouting).toBeNull();
    expect(outcome.routing).toBeNull();
  });

  it('family=standard also bypasses the router', async () => {
    const searchChunks: SearchChunks = async (_v, _m, _p, _family, routing) => {
      expect(routing).toBeNull();
      return [];
    };
    const deps: LegalRetrievalDeps = { embeddingProvider: fakeProvider(), searchChunks, lookupChunkRef: async () => null };
    await performLegalRetrieval({ query: 'Hur borrar man en brunn?', family: 'standard' }, deps);
  });

  it('no family specified -> unconstrained search across all families, routing stays null', async () => {
    let capturedFamily: string | undefined = 'unset';
    const searchChunks: SearchChunks = async (_v, _m, _p, family) => {
      capturedFamily = family;
      return [];
    };
    const deps: LegalRetrievalDeps = { embeddingProvider: fakeProvider(), searchChunks, lookupChunkRef: async () => null };
    const outcome = await performLegalRetrieval({ query: 'något generellt' }, deps);
    expect(capturedFamily).toBeUndefined();
    expect(outcome.routing).toBeNull();
  });

  it('a hit that resolves to a real governed chunk produces a RetrievalResult carrying exact fragment_id/materialization_id/provenance', async () => {
    const hit = makeHit();
    const ref = makeRef();
    const searchChunks: SearchChunks = async () => [hit];
    const lookupChunkRef: ChunkRefLookup = async () => ref;
    const deps: LegalRetrievalDeps = { embeddingProvider: fakeProvider(), searchChunks, lookupChunkRef };

    const outcome = await performLegalRetrieval({ query: 'test query' }, deps);

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]!.fragment_id).toBe(hit.fragment_id);
    expect(outcome.results[0]!.materialization_id).toBe(hit.materialization_id);
    expect(outcome.results[0]!.source_provenance_refs).toEqual([`materialization:${hit.materialization_id}`]);
    expect(outcome.results[0]!.resolved_against_governed_chunk).toBe(true);
  });

  it('FAIL CLOSED: an unresolvable hit (no governed chunk found) is dropped, never fabricated as a result', async () => {
    const hit = makeHit();
    const searchChunks: SearchChunks = async () => [hit];
    const lookupChunkRef: ChunkRefLookup = async () => null; // does not resolve
    const deps: LegalRetrievalDeps = { embeddingProvider: fakeProvider(), searchChunks, lookupChunkRef };

    const outcome = await performLegalRetrieval({ query: 'test query' }, deps);

    expect(outcome.results).toHaveLength(0);
  });

  it('FAIL CLOSED: a hit whose embedding identity does not match the governed chunk (stale/tampered content_hash) is dropped', async () => {
    const hit = makeHit({ chunk_content_hash: 'hash:STALE' });
    const ref = makeRef({ content_hash: 'hash:CURRENT' }); // real chunk's hash differs from the embedding's recorded hash
    const searchChunks: SearchChunks = async () => [hit];
    const lookupChunkRef: ChunkRefLookup = async () => ref;
    const deps: LegalRetrievalDeps = { embeddingProvider: fakeProvider(), searchChunks, lookupChunkRef };

    const outcome = await performLegalRetrieval({ query: 'test query' }, deps);

    expect(outcome.results).toHaveLength(0);
  });

  it('the trace records query_hash, policy_version, and selected_artifact_refs matching the ACTUAL returned results, not the raw hit list', async () => {
    const goodHit = makeHit({ fragment_id: 'frag:good' });
    const badHit = makeHit({ fragment_id: 'frag:bad', materialization_id: 'mat:bad' });
    const searchChunks: SearchChunks = async () => [goodHit, badHit];
    const lookupChunkRef: ChunkRefLookup = async (fragmentId) =>
      fragmentId === 'frag:good' ? makeRef({ fragment_id: 'frag:good', materialization_id: 'mat:1' }) : null;
    const deps: LegalRetrievalDeps = { embeddingProvider: fakeProvider(), searchChunks, lookupChunkRef };

    const outcome = await performLegalRetrieval({ query: 'q' }, deps);

    expect(outcome.results).toHaveLength(1);
    expect(outcome.trace.identity.selected_artifact_refs).toEqual(['frag:good']);
    expect(outcome.trace.identity.policy_version).toBe('legal-ret-policy-1');
    expect(outcome.trace.identity.query_hash).toHaveLength(64); // sha256 hex
  });

  it('a caller-supplied sourceConstraintOverride REPLACES the automatic law router decision entirely', async () => {
    let capturedRouting: { source_candidates: readonly { logicalSourceId: string }[] } | null = null;
    const searchChunks: SearchChunks = async (_v, _m, _p, _family, routing) => {
      capturedRouting = routing;
      return [];
    };
    const deps: LegalRetrievalDeps = { embeddingProvider: fakeProvider(), searchChunks, lookupChunkRef: async () => null };

    await performLegalRetrieval(
      {
        query: 'Vad säger miljöbalken om detta?', // would normally auto-route to miljöbalken alone
        family: 'law',
        sourceConstraintOverride: ['regeringskansliet-sfs-2010-900', 'regeringskansliet-sfs-2020-614'],
      },
      deps,
    );

    expect(capturedRouting!.source_candidates.map((c) => c.logicalSourceId)).toEqual([
      'regeringskansliet-sfs-2010-900',
      'regeringskansliet-sfs-2020-614',
    ]);
  });

  it('sourceConstraintOverride for a non-law family is rejected, not silently ignored', async () => {
    const deps: LegalRetrievalDeps = { embeddingProvider: fakeProvider(), searchChunks: async () => [], lookupChunkRef: async () => null };
    await expect(
      performLegalRetrieval({ query: 'x', family: 'court', sourceConstraintOverride: ['a'] }, deps),
    ).rejects.toThrow(LegalRetrievalRequestError);
  });
});
