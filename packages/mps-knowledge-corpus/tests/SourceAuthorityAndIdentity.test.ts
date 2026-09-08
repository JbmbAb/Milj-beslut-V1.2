import { describe, expect, it } from 'vitest';

import {
  buildRawSourceArtifactRef,
  classifySourceAuthority,
  computeKnowledgeDocumentId,
  createStaticAuthorizedSourceCatalog,
  KNOWLEDGE_DOCUMENT_IDENTITY_VERSION,
  sha256Hex,
  type AuthorizedSourceCatalog,
} from '../src';
import { bytesOf, FIXTURE_CATALOG_ORIGIN, fixtureCatalog, SFS, SFS_HASH } from './fixtures';

describe('K2.2 source authority boundary', () => {
  it('resolves an authorized source and carries the stable content-hash anchor', async () => {
    const outcome = await classifySourceAuthority(fixtureCatalog(), SFS.source_id, SFS_HASH);
    expect(outcome.kind).toBe('AUTHORIZED');
    if (outcome.kind !== 'AUTHORIZED') throw new Error('unreachable');
    expect(outcome.binding.registry_artifact_id).toBe('reg-rk-sfs-1998-808-002');
    expect(outcome.binding.registry_source_content_hash).toBe(SFS_HASH);
  });

  it('classifies an unknown source as SOURCE_AUTHORITY_REQUIRED — a skip, never an admission', async () => {
    const outcome = await classifySourceAuthority(fixtureCatalog(), 'naturvardsverket-handbok-2026');
    expect(outcome).toMatchObject({
      kind: 'SOURCE_AUTHORITY_REQUIRED',
      source_id: 'naturvardsverket-handbok-2026',
    });
  });

  it('refuses to silently re-bind when the signed scope hash differs (SOURCE_SCOPE_CHANGED)', async () => {
    const outcome = await classifySourceAuthority(fixtureCatalog(), SFS.source_id, 'f'.repeat(64));
    expect(outcome.kind).toBe('SOURCE_SCOPE_CHANGED');
  });

  it('fails closed as AUTHORITY_UNAVAILABLE when the catalog itself cannot be loaded', async () => {
    const broken: AuthorizedSourceCatalog = {
      origin: '<fixture:broken>',
      async resolve() {
        throw new Error('signature verification failed for entry 7');
      },
      async list() {
        throw new Error('signature verification failed for entry 7');
      },
    };
    const outcome = await classifySourceAuthority(broken, SFS.source_id);
    expect(outcome.kind).toBe('AUTHORITY_UNAVAILABLE');
    expect(outcome.kind === 'AUTHORITY_UNAVAILABLE' && outcome.detail).toContain(
      'signature verification failed',
    );
  });

  it('refuses a catalog carrying two bindings for one source_id (ambiguity is never resolved by position)', () => {
    expect(() =>
      createStaticAuthorizedSourceCatalog(
        [SFS, { ...SFS, registry_artifact_id: 'reg-rk-sfs-1998-808-003' }],
        FIXTURE_CATALOG_ORIGIN,
      ),
    ).toThrow(/REJECT_AMBIGUOUS_SOURCE_ID/);
  });
});

describe('K2.2 document identity (KNOWLEDGE-DOCUMENT-V1)', () => {
  const raw = sha256Hex(bytesOf('samma bytes'));
  const base = {
    logical_source_id: SFS.source_id,
    registry_source_content_hash: SFS_HASH,
    raw_source_content_hash: raw,
  };

  it('is content-derived, versioned and stable across replays', () => {
    const a = computeKnowledgeDocumentId(base);
    const b = computeKnowledgeDocumentId({ ...base });
    expect(a).toBe(b);
    expect(a).toMatch(/^kdoc:[a-f0-9]{64}$/);
    expect(KNOWLEDGE_DOCUMENT_IDENTITY_VERSION).toBe('knowledge-document-v1');
  });

  it('does not depend on path, file name, timestamp, ordering or the volatile registry artifact id', () => {
    // The identity input has no slot for any of these; the only way to change the id is to change
    // the source, its signed scope, or the bytes.
    const id = computeKnowledgeDocumentId(base);
    expect(computeKnowledgeDocumentId({ ...base })).toBe(id);
    expect(Object.keys(base).sort()).toEqual([
      'logical_source_id',
      'raw_source_content_hash',
      'registry_source_content_hash',
    ]);
  });

  it('distinguishes a new version of the same source (different bytes) and the same file name with different content', () => {
    const v2 = computeKnowledgeDocumentId({
      ...base,
      raw_source_content_hash: sha256Hex(bytesOf('nya bytes')),
    });
    expect(v2).not.toBe(computeKnowledgeDocumentId(base));
  });

  it('refuses malformed hashes rather than hashing garbage into an identity', () => {
    expect(() => computeKnowledgeDocumentId({ ...base, raw_source_content_hash: 'not-a-hash' })).toThrow(
      /REJECT_DOCUMENT_IDENTITY/,
    );
    expect(() => buildRawSourceArtifactRef('short')).toThrow(/REJECT_DOCUMENT_IDENTITY/);
    expect(buildRawSourceArtifactRef(raw)).toEqual({
      artifact_id: `raw:${raw}`,
      artifact_type: 'raw_source',
    });
  });
});
