import { describe, expect, it } from 'vitest';
import {
  bindEmbeddingIdentity,
  computeEmbeddingIdentityHash,
  EmbeddingIdentityError,
  type EmbeddingIdentityInput,
} from '../src/EmbeddingIdentity';

/** Realistic shapes -- sha256-hex-like fragment_id/content_hash, cuid-like materialization_id --
 *  matching what LegalCorpusMaterializedChunk actually produces (see prisma/schema.prisma and
 *  packages/mps-legal-corpus/src/ChunkIdentity.ts), not arbitrary test strings. */
const BASE: EmbeddingIdentityInput = {
  fragment_id: 'fragment:sha256:9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a',
  materialization_id: 'cmt14c8yu0001vgf7u5rtm31r',
  chunk_content_hash: 'a1b2c3d4e5f6070819202122232425262728293031323334353637383940ab',
  embedding_model_id: 'vertex-text-multilingual-embedding-002',
  embedding_model_version: '002',
  embedding_pipeline_version: 'embed-pipeline-v1',
};

describe('LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01 — embedding identity', () => {
  it('same chunk + same model + same pipeline -> same embedding identity', () => {
    const a = computeEmbeddingIdentityHash(BASE);
    const b = computeEmbeddingIdentityHash({ ...BASE });
    expect(a).toBe(b);
  });

  it('is stable regardless of the caller\'s object key insertion order', () => {
    const reordered: EmbeddingIdentityInput = {
      embedding_pipeline_version: BASE.embedding_pipeline_version,
      embedding_model_version: BASE.embedding_model_version,
      embedding_model_id: BASE.embedding_model_id,
      chunk_content_hash: BASE.chunk_content_hash,
      materialization_id: BASE.materialization_id,
      fragment_id: BASE.fragment_id,
    };
    expect(computeEmbeddingIdentityHash(reordered)).toBe(computeEmbeddingIdentityHash(BASE));
  });

  it('same chunk + changed embedding_model_id -> different embedding identity', () => {
    const changed = { ...BASE, embedding_model_id: 'openai-text-embedding-3-large' };
    expect(computeEmbeddingIdentityHash(changed)).not.toBe(computeEmbeddingIdentityHash(BASE));
  });

  it('same chunk + changed embedding_model_version -> different embedding identity', () => {
    const changed = { ...BASE, embedding_model_version: '003' };
    expect(computeEmbeddingIdentityHash(changed)).not.toBe(computeEmbeddingIdentityHash(BASE));
  });

  it('same chunk + changed embedding_pipeline_version -> different embedding identity', () => {
    const changed = { ...BASE, embedding_pipeline_version: 'embed-pipeline-v2' };
    expect(computeEmbeddingIdentityHash(changed)).not.toBe(computeEmbeddingIdentityHash(BASE));
  });

  it('changed fragment_id (a different governed chunk) -> different embedding identity', () => {
    const changed = { ...BASE, fragment_id: BASE.fragment_id.replace(/a$/, 'f') };
    expect(computeEmbeddingIdentityHash(changed)).not.toBe(computeEmbeddingIdentityHash(BASE));
  });

  it('changed materialization_id (e.g. v2.3 vs v2.4.1 of the same source) -> different embedding identity', () => {
    const changed = { ...BASE, materialization_id: 'cmt16lnsb0000xgf7kbmhf2t5' };
    expect(computeEmbeddingIdentityHash(changed)).not.toBe(computeEmbeddingIdentityHash(BASE));
  });

  it('changed chunk_content_hash (stale/wrong content for this fragment_id) -> different embedding identity, never silently reused', () => {
    const changed = { ...BASE, chunk_content_hash: BASE.chunk_content_hash.replace(/ab$/, 'cd') };
    expect(computeEmbeddingIdentityHash(changed)).not.toBe(computeEmbeddingIdentityHash(BASE));
  });

  it('bindEmbeddingIdentity returns a frozen record carrying all six input fields plus the hash and contract version', () => {
    const bound = bindEmbeddingIdentity(BASE);
    expect(Object.isFrozen(bound)).toBe(true);
    expect(bound.fragment_id).toBe(BASE.fragment_id);
    expect(bound.materialization_id).toBe(BASE.materialization_id);
    expect(bound.chunk_content_hash).toBe(BASE.chunk_content_hash);
    expect(bound.embedding_model_id).toBe(BASE.embedding_model_id);
    expect(bound.embedding_model_version).toBe(BASE.embedding_model_version);
    expect(bound.embedding_pipeline_version).toBe(BASE.embedding_pipeline_version);
    expect(bound.embedding_identity_hash).toBe(computeEmbeddingIdentityHash(BASE));
  });

  it('rejects an incomplete input rather than silently hashing a partial identity', () => {
    const incomplete = { ...BASE, embedding_model_id: '' };
    expect(() => computeEmbeddingIdentityHash(incomplete)).toThrow(EmbeddingIdentityError);
    expect(() => computeEmbeddingIdentityHash(incomplete)).toThrow(/embedding_model_id/);
  });
});
