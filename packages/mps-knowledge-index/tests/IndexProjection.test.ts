import { describe, expect, it } from 'vitest';

import { buildCorpusSnapshot } from '@miljobeslut/mps-knowledge-corpus';

import {
  buildIndexProjection,
  computeIndexSnapshotIdentity,
  createDeterministicHashEmbeddingProvider,
  deserializeIndexProjection,
  EmbeddingProviderError,
  IndexProjectionError,
  serializeIndexProjection,
  verifyIndexProjection,
  type IndexRow,
  type KnowledgeEmbeddingProvider,
  type KnowledgeIndexProjection,
} from '../src';
import { fixtureCorpus, ORIGIN } from './fixtures';

const provider = createDeterministicHashEmbeddingProvider({ dimensions: 128 });

/** Re-stamps the index identity so the ONLY remaining defense is the governed cross-check (simulates a forger who recomputes hashes). */
function restamp(index: KnowledgeIndexProjection, rows: readonly IndexRow[]): KnowledgeIndexProjection {
  return {
    ...index,
    rows,
    index_snapshot_identity: computeIndexSnapshotIdentity({
      provider: index.provider,
      corpus_snapshot_identity: index.corpus_snapshot_identity,
      catalog_origin: index.catalog_origin,
      skipped_documents: index.skipped_documents,
      rows,
    }),
  };
}

describe('K2.2 index projection — canonical chunk -> embedding read model', () => {
  it('builds one row per admitted governed chunk, bound to embedding identity + registry provenance + role method + derived currency, in deterministic order', async () => {
    const { snapshot, docs } = await fixtureCorpus();
    const { index, stats } = await buildIndexProjection(snapshot, provider);
    const admittedChunks = snapshot.documents.reduce((n, d) => n + d.chunks.length, 0);
    expect(index.rows).toHaveLength(admittedChunks);
    expect(stats).toMatchObject({
      documents_indexed: snapshot.documents.length,
      documents_skipped: 0,
      chunks_embedded: admittedChunks,
      chunks_reused: 0,
    });
    for (const row of index.rows) {
      expect(row.embedding_identity.materialization_id).toBe(row.canonical_record_key);
      expect(row.embedding_identity.embedding_model_id).toBe(provider.model_id);
      expect(row.vector).toHaveLength(128);
      expect(row.registry_artifact_id).toMatch(/^reg-/);
      expect(row.registry_source_content_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(['SOURCE_DECLARED', 'CALLER_DECLARED', 'DETERMINISTIC_CLASSIFIER']).toContain(row.role_method);
      expect(['ACQUISITION_RECENCY', 'NO_LINEAGE']).toContain(row.metadata.currency_method);
    }
    const guidanceRow = index.rows.find((r) => r.document_id === docs.guidance_v2!.document_id)!;
    expect(guidanceRow.metadata).toMatchObject({ is_current: true, currency_method: 'ACQUISITION_RECENCY' });
    const courtRow = index.rows.find((r) => r.document_id === docs.court_a!.document_id)!;
    expect(courtRow.metadata).toMatchObject({
      is_current: true,
      currency_method: 'NO_LINEAGE',
      version_lineage_key: null,
    });
    const again = await buildIndexProjection(snapshot, provider);
    expect(again.index.index_snapshot_identity).toBe(index.index_snapshot_identity);
    expect(again.index.rows.map((r) => r.embedding_identity.embedding_identity_hash)).toEqual(
      index.rows.map((r) => r.embedding_identity.embedding_identity_hash),
    );
  });

  it('rejects mixing embeddings from an incompatible model (reuse across models) instead of silently merging', async () => {
    const { snapshot } = await fixtureCorpus();
    const { index } = await buildIndexProjection(snapshot, provider);
    const other = createDeterministicHashEmbeddingProvider({ dimensions: 64 });
    await expect(buildIndexProjection(snapshot, other, { reuse: index })).rejects.toThrow(
      IndexProjectionError,
    );
  });

  it('rejects a provider that returns the wrong dimension or batch size — fail closed, never pad', async () => {
    const { snapshot } = await fixtureCorpus();
    const lying: KnowledgeEmbeddingProvider = {
      ...provider,
      dimensions: 128,
      async embedDocuments(texts) {
        return texts.map(() => [0.1, 0.2]);
      },
      async embedQuery() {
        return [0.1, 0.2];
      },
    };
    await expect(buildIndexProjection(snapshot, lying)).rejects.toThrow(EmbeddingProviderError);
    const short: KnowledgeEmbeddingProvider = {
      ...provider,
      async embedDocuments(texts) {
        return (await provider.embedDocuments(texts)).slice(0, 1);
      },
      async embedQuery(t) {
        return provider.embedQuery(t);
      },
    };
    await expect(buildIndexProjection(snapshot, short)).rejects.toThrow(
      /requested \d+ embeddings, provider returned/,
    );
  });

  it('a clean index verifies; stale row, tampered content, missing chunk, duplicate row, model mismatch and superseded-active are all detected', async () => {
    const { snapshot, docs } = await fixtureCorpus();
    const { index } = await buildIndexProjection(snapshot, provider);
    expect(verifyIndexProjection(index, snapshot)).toEqual([]);

    const first = index.rows[0]!;
    const tamperedText: KnowledgeIndexProjection = {
      ...index,
      rows: [{ ...first, chunk_text: `${first.chunk_text} (edited)` }, ...index.rows.slice(1)],
    };
    expect(verifyIndexProjection(tamperedText, snapshot).map((v) => v.code)).toContain('STALE_CONTENT_HASH');

    const ghost: KnowledgeIndexProjection = {
      ...index,
      rows: [
        ...index.rows,
        {
          ...first,
          embedding_identity: {
            ...first.embedding_identity,
            fragment_id: 'frag:' + '0'.repeat(64),
            embedding_identity_hash: '1'.repeat(64),
          },
        },
      ],
    };
    expect(verifyIndexProjection(ghost, snapshot).map((v) => v.code)).toEqual(
      expect.arrayContaining(['MISSING_CHUNK', 'IDENTITY_HASH_MISMATCH']),
    );

    const duplicate: KnowledgeIndexProjection = { ...index, rows: [...index.rows, first] };
    expect(verifyIndexProjection(duplicate, snapshot).map((v) => v.code)).toContain('DUPLICATE_ROW');

    const wrongModel: KnowledgeIndexProjection = {
      ...index,
      provider: { ...index.provider, model_version: '2' },
    };
    expect(verifyIndexProjection(wrongModel, snapshot).map((v) => v.code)).toContain('MODEL_MISMATCH');

    const supersededRow = index.rows.find((r) => r.document_id === docs.guidance_v1!.document_id)!;
    const supersededActive: KnowledgeIndexProjection = {
      ...index,
      rows: index.rows.map((r) =>
        r === supersededRow ? { ...r, metadata: { ...r.metadata, is_current: true } } : r,
      ),
    };
    expect(verifyIndexProjection(supersededActive, snapshot).map((v) => v.code)).toContain(
      'SUPERSEDED_ACTIVE',
    );

    const dropped: KnowledgeIndexProjection = { ...index, rows: index.rows.slice(1) };
    expect(verifyIndexProjection(dropped, snapshot).map((v) => v.code)).toEqual(
      expect.arrayContaining(['MISSING_ROW', 'INDEX_IDENTITY_MISMATCH']),
    );
  });

  it('EVERY provenance/role/currency column of a row is bound to the governed document: forging any one of them is a ROW_MISMATCH even after the index identity is re-stamped', async () => {
    const { snapshot, docs } = await fixtureCorpus();
    const { index } = await buildIndexProjection(snapshot, provider);
    const target = index.rows.find((r) => r.document_id === docs.guidance_v1!.document_id)!;
    const otherCurrent = docs.law_mb!.document_id;
    const forgeries: Array<[string, Partial<IndexRow>]> = [
      ['registry_artifact_id', { registry_artifact_id: 'reg-evil-001' }],
      ['source_id', { source_id: 'evil-authority' }],
      ['registry_source_content_hash', { registry_source_content_hash: 'f'.repeat(64) }],
      ['catalog_origin', { catalog_origin: 'signed-source-registry:forged' }],
      ['text_projection_id', { text_projection_id: 'tp:forged' }],
      ['role', { role: 'law' }],
      ['role_method', { role_method: 'CALLER_DECLARED' }],
      ['document_id', { document_id: otherCurrent, metadata: { ...target.metadata, is_current: true } }],
      ['metadata', { metadata: { ...target.metadata, source_version_label: 'utgåva 2026' } }],
      [
        'metadata',
        {
          metadata: {
            ...target.metadata,
            version_lineage_key: null,
            currency_method: 'NO_LINEAGE',
            is_current: true,
          },
        },
      ],
    ];
    for (const [column, patch] of forgeries) {
      const forged = restamp(
        index,
        index.rows.map((r) => (r === target ? ({ ...r, ...patch } as IndexRow) : r)),
      );
      const violations = verifyIndexProjection(forged, snapshot);
      expect(
        violations.map((v) => v.code),
        column,
      ).toContain('ROW_MISMATCH');
      expect(violations.find((v) => v.code === 'ROW_MISMATCH')!.detail, column).toContain(column);
    }
  });

  it('the index identity covers vectors: spliced vectors are refused at deserialize and at reuse; NaN/garbage vectors are refused everywhere', async () => {
    const { snapshot } = await fixtureCorpus();
    const { index } = await buildIndexProjection(snapshot, provider);
    const json = JSON.parse(serializeIndexProjection(index)) as { rows: IndexRow[] };
    const [a, b] = [json.rows[0]!.vector, json.rows[1]!.vector];
    json.rows[0] = { ...json.rows[0]!, vector: b };
    json.rows[1] = { ...json.rows[1]!, vector: a };
    expect(() => deserializeIndexProjection(JSON.stringify(json))).toThrow(/index_snapshot_identity/);

    const swapped = restamp(index, [
      { ...index.rows[0]!, vector: index.rows[1]!.vector },
      { ...index.rows[1]!, vector: index.rows[0]!.vector },
      ...index.rows.slice(2),
    ]);
    // A forger who re-stamps the identity cannot be caught by the identity alone; the swap is only
    // detectable by re-embedding — which is exactly why reuse never trusts an index whose identity
    // was not produced by this builder over these vectors... and why a NaN vector is refused outright.
    const nanRows = index.rows.map((r, i) =>
      i === 0 ? { ...r, vector: r.vector.map((x, j) => (j === 0 ? Number.NaN : x)) } : r,
    );
    expect(verifyIndexProjection(restamp(index, nanRows), snapshot).map((v) => v.code)).toContain(
      'VECTOR_INVALID',
    );
    await expect(
      buildIndexProjection(snapshot, provider, { reuse: restamp(index, nanRows) }),
    ).rejects.toMatchObject({ code: 'REUSE_INDEX_INVALID' });
    const nullRows = JSON.parse(serializeIndexProjection(index)) as { rows: Array<Record<string, unknown>> };
    nullRows.rows[0] = { ...nullRows.rows[0]!, vector: new Array(128).fill(null) };
    expect(() => deserializeIndexProjection(JSON.stringify(nullRows))).toThrow(IndexProjectionError);
    const tamperedIdentity: KnowledgeIndexProjection = {
      ...swapped,
      index_snapshot_identity: index.index_snapshot_identity,
    };
    await expect(buildIndexProjection(snapshot, provider, { reuse: tamperedIdentity })).rejects.toMatchObject(
      { code: 'REUSE_INDEX_INVALID' },
    );
  });

  it('marks only the current version of a keyed lineage as current; documents in no lineage are current by definition', async () => {
    const { snapshot, docs } = await fixtureCorpus();
    const { index } = await buildIndexProjection(snapshot, provider);
    const isCurrent = (docKey: string) =>
      new Set(
        index.rows
          .filter((r) => r.document_id === docs[docKey]!.document_id)
          .map((r) => r.metadata.is_current),
      );
    expect(isCurrent('guidance_v2')).toEqual(new Set([true]));
    expect(isCurrent('guidance_v1')).toEqual(new Set([false]));
    expect(isCurrent('law_mb')).toEqual(new Set([true]));
    // Two distinct court decisions under one source are NOT versions of each other.
    expect(isCurrent('court_a')).toEqual(new Set([true]));
    expect(isCurrent('court_b')).toEqual(new Set([true]));
  });

  it('rebuilds incrementally: a changed document re-embeds only its own chunks; identities of unchanged chunks are preserved and reused', async () => {
    const before = await fixtureCorpus();
    const first = await buildIndexProjection(before.snapshot, provider);
    const after = await fixtureCorpus({ includeNearDuplicate: true });
    const second = await buildIndexProjection(after.snapshot, provider, { reuse: first.index });
    const newDocChunks = after.docs.court_a_near_duplicate!.chunks.length;
    expect(second.stats.chunks_embedded).toBe(newDocChunks);
    expect(second.stats.chunks_reused).toBe(first.index.rows.length);
    const firstHashes = new Set(first.index.rows.map((r) => r.embedding_identity.embedding_identity_hash));
    for (const row of second.index.rows) {
      if (row.document_id !== after.docs.court_a_near_duplicate!.document_id)
        expect(firstHashes.has(row.embedding_identity.embedding_identity_hash)).toBe(true);
    }
    // Rebuilding from scratch yields the same identity as the incremental rebuild: rebuild is idempotent.
    const scratch = await buildIndexProjection(after.snapshot, provider);
    expect(scratch.index.index_snapshot_identity).toBe(second.index.index_snapshot_identity);

    // A removed document's rows disappear from the rebuilt read model (never linger as stale rows).
    const shrunk = buildCorpusSnapshot(
      before.snapshot.documents.filter((d) => d.document_id !== before.docs.court_b!.document_id),
      { catalog_origin: ORIGIN },
    );
    const third = await buildIndexProjection(shrunk, provider, { reuse: second.index });
    expect(third.index.rows.some((r) => r.document_id === before.docs.court_b!.document_id)).toBe(false);
    expect(verifyIndexProjection(third.index, shrunk)).toEqual([]);
  });

  it('serializes and deserializes without loss and refuses a tampered serialized index', async () => {
    const { snapshot } = await fixtureCorpus();
    const { index } = await buildIndexProjection(snapshot, provider);
    const json = serializeIndexProjection(index);
    const back = deserializeIndexProjection(json);
    expect(back.index_snapshot_identity).toBe(index.index_snapshot_identity);
    expect(verifyIndexProjection(back, snapshot)).toEqual([]);
    const tampered = JSON.parse(json) as { rows: IndexRow[] };
    tampered.rows.pop();
    expect(() => deserializeIndexProjection(JSON.stringify(tampered))).toThrow(IndexProjectionError);
    const relabeled = JSON.parse(json) as { rows: IndexRow[] };
    relabeled.rows[0] = { ...relabeled.rows[0]!, source_id: 'evil-authority' };
    expect(() => deserializeIndexProjection(JSON.stringify(relabeled))).toThrow(IndexProjectionError);
    const foreignModel = JSON.parse(json) as { provider: { model_id: string } };
    foreignModel.provider = { ...foreignModel.provider, model_id: 'other-model' };
    expect(() => deserializeIndexProjection(JSON.stringify(foreignModel))).toThrow(
      /different embedding model/,
    );
    expect(() => deserializeIndexProjection('{"projection_version":"other"}')).toThrow(IndexProjectionError);
  });
});
