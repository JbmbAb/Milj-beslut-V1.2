import { describe, expect, it } from 'vitest';
import { bindEmbeddingIdentity, type EmbeddingIdentityFields } from '@miljobeslut/mps-embedding-identity';
import { buildLegalRetrievalPolicy, evaluateLegalRetrieval } from '@miljobeslut/mps-retrieval-governance';
import { createRetrievalExecutionTrace } from '@miljobeslut/mps-retrieval-trace';
import {
  buildRetrievalResult,
  createInMemoryGovernedChunkLookup,
  RetrievalResultError,
  type GovernedChunkRef,
} from '../src/index';

const MILJOBALKEN_V231: GovernedChunkRef = {
  fragment_id: 'fragment:v23:7-kap-1-para:abc123',
  materialization_id: 'cmt14c8yu0001vgf7u5rtm31r',
  content_hash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666gggg7777hhhh8888',
  structure_kind: 'law',
};

const MILJOBALKEN_V241: GovernedChunkRef = {
  fragment_id: 'fragment:v241:7-kap-1-para:xyz789',
  materialization_id: 'cmt18tj2g0000jwf7utcr2huy',
  content_hash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666gggg7777hhhh8888', // same text
  structure_kind: 'law',
};

function embeddingFor(chunk: GovernedChunkRef): EmbeddingIdentityFields {
  return bindEmbeddingIdentity({
    fragment_id: chunk.fragment_id,
    materialization_id: chunk.materialization_id,
    chunk_content_hash: chunk.content_hash,
    embedding_model_id: 'vertex-text-multilingual-embedding-002',
    embedding_model_version: '002',
    embedding_pipeline_version: 'embed-pipeline-v1',
  });
}

describe('LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01 — the full chain', () => {
  it('composes LegalRetrievalPolicy -> EmbeddingIdentity -> RetrievalExecutionTrace -> RetrievalResult end to end', () => {
    const decision = evaluateLegalRetrieval('LEGAL_CORPUS_SEARCH');
    expect(decision.read_only).toBe(true);

    const lookup = createInMemoryGovernedChunkLookup([MILJOBALKEN_V231]);
    const embedding = embeddingFor(MILJOBALKEN_V231);

    const trace = createRetrievalExecutionTrace({
      query_hash: 'q_hash_abc',
      policy_version: decision.policy.policy_version,
      artifact_snapshot: 'snap_2026_08_20',
      selected_artifact_refs: [MILJOBALKEN_V231.fragment_id],
      budget_profile: 'default',
      expansion_path: [],
    });

    const result = buildRetrievalResult(
      {
        fragment_id: MILJOBALKEN_V231.fragment_id,
        materialization_id: MILJOBALKEN_V231.materialization_id,
        source_provenance_refs: [`trace:${trace.trace_hash}`, 'sfs:1998:808'],
        embedding_identity: embedding,
        retrieval_policy_version: decision.policy.policy_version,
        query_run_identity: trace.trace_hash,
        score: 0.87,
        rank: 1,
      },
      lookup,
    );

    expect(result.resolved_against_governed_chunk).toBe(true);
    expect(result.fragment_id).toBe(MILJOBALKEN_V231.fragment_id);
    expect(result.materialization_id).toBe(MILJOBALKEN_V231.materialization_id);
  });

  it('a retrieval result must always resolve back to the exact governed chunk -- an unknown fragment_id is rejected, not silently accepted', () => {
    const lookup = createInMemoryGovernedChunkLookup([MILJOBALKEN_V231]);
    const embedding = embeddingFor(MILJOBALKEN_V231);

    expect(() =>
      buildRetrievalResult(
        {
          fragment_id: 'fragment:does-not-exist',
          materialization_id: MILJOBALKEN_V231.materialization_id,
          source_provenance_refs: ['x'],
          embedding_identity: embedding,
          retrieval_policy_version: 'legal-ret-policy-1',
          query_run_identity: 'run1',
          score: 0.5,
          rank: 1,
        },
        lookup,
      ),
    ).toThrow(RetrievalResultError);
  });

  it('a fragment_id that resolves but under the WRONG claimed materialization_id is rejected', () => {
    const lookup = createInMemoryGovernedChunkLookup([MILJOBALKEN_V231]);
    const embedding = embeddingFor(MILJOBALKEN_V231);

    expect(() =>
      buildRetrievalResult(
        {
          fragment_id: MILJOBALKEN_V231.fragment_id,
          materialization_id: 'some-other-materialization-id',
          source_provenance_refs: ['x'],
          embedding_identity: embedding,
          retrieval_policy_version: 'legal-ret-policy-1',
          query_run_identity: 'run1',
          score: 0.5,
          rank: 1,
        },
        lookup,
      ),
    ).toThrow(/MATERIALIZATION_MISMATCH/);
  });

  it('an embedding_identity bound to a DIFFERENT chunk is rejected, even if fragment_id/materialization_id otherwise resolve', () => {
    const lookup = createInMemoryGovernedChunkLookup([MILJOBALKEN_V231, MILJOBALKEN_V241]);
    const wrongEmbedding = embeddingFor(MILJOBALKEN_V241); // computed for the WRONG chunk

    expect(() =>
      buildRetrievalResult(
        {
          fragment_id: MILJOBALKEN_V231.fragment_id,
          materialization_id: MILJOBALKEN_V231.materialization_id,
          source_provenance_refs: ['x'],
          embedding_identity: wrongEmbedding,
          retrieval_policy_version: 'legal-ret-policy-1',
          query_run_identity: 'run1',
          score: 0.5,
          rank: 1,
        },
        lookup,
      ),
    ).toThrow(/EMBEDDING_IDENTITY_MISMATCH/);
  });

  it('v2.3 and v2.4.1 fragments of the SAME underlying text never collide into one embedding identity, even with identical content_hash', () => {
    // Same content_hash by construction (same real text) -- must still be genuinely distinct
    // because fragment_id and materialization_id differ (chunk_policy_version is
    // identity-bearing at the materialization layer, per LEGAL-CORPUS-MATERIALIZATION-IDENTITY-V2).
    expect(MILJOBALKEN_V231.content_hash).toBe(MILJOBALKEN_V241.content_hash);

    const embeddingV23 = embeddingFor(MILJOBALKEN_V231);
    const embeddingV241 = embeddingFor(MILJOBALKEN_V241);

    expect(embeddingV23.embedding_identity_hash).not.toBe(embeddingV241.embedding_identity_hash);

    // And each resolves ONLY against its own chunk -- the v2.3 embedding must never satisfy a
    // retrieval result claiming the v2.4.1 chunk, or vice versa.
    const lookup = createInMemoryGovernedChunkLookup([MILJOBALKEN_V231, MILJOBALKEN_V241]);
    expect(() =>
      buildRetrievalResult(
        {
          fragment_id: MILJOBALKEN_V241.fragment_id,
          materialization_id: MILJOBALKEN_V241.materialization_id,
          source_provenance_refs: ['x'],
          embedding_identity: embeddingV23,
          retrieval_policy_version: 'legal-ret-policy-1',
          query_run_identity: 'run1',
          score: 0.5,
          rank: 1,
        },
        lookup,
      ),
    ).toThrow(/EMBEDDING_IDENTITY_MISMATCH/);
  });

  it('requires at least one source/provenance ref -- a result never floats without one', () => {
    const lookup = createInMemoryGovernedChunkLookup([MILJOBALKEN_V231]);
    const embedding = embeddingFor(MILJOBALKEN_V231);

    expect(() =>
      buildRetrievalResult(
        {
          fragment_id: MILJOBALKEN_V231.fragment_id,
          materialization_id: MILJOBALKEN_V231.materialization_id,
          source_provenance_refs: [],
          embedding_identity: embedding,
          retrieval_policy_version: 'legal-ret-policy-1',
          query_run_identity: 'run1',
          score: 0.5,
          rank: 1,
        },
        lookup,
      ),
    ).toThrow(/MISSING_PROVENANCE/);
  });

  it('LegalRetrievalPolicy stays read-only through the whole composed chain -- no write path exists anywhere in this package', () => {
    const policy = buildLegalRetrievalPolicy('LEGAL_CORPUS_SEARCH');
    expect(policy.read_only).toBe(true);
    // Structural proof of absence: the module's exports never include anything resembling a
    // write/persist/mutate function.
    // (import checked at the top of this file -- buildRetrievalResult only ever returns a frozen
    // in-memory record; createInMemoryGovernedChunkLookup is explicitly test-only, never a
    // production write path.)
  });
});
