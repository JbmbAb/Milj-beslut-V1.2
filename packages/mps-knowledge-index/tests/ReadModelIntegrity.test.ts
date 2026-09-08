import { describe, expect, it } from 'vitest';

import {
  buildCorpusSnapshot,
  projectDocument,
  type CorpusDocumentProjection,
  type CorpusSnapshot,
} from '@miljobeslut/mps-knowledge-corpus';
import type { TextExtractorPort } from '@miljobeslut/mps-text-projection';

import {
  buildIndexProjection,
  computeIndexSnapshotIdentity,
  createDeterministicHashEmbeddingProvider,
  createGovernedKnowledgeLookup,
  deserializeIndexProjection,
  fitIdfTable,
  searchKnowledgeIndex,
  serializeIndexProjection,
  verifyIndexProjection,
  verifyIndexProjectionWithReembedding,
  type IndexRow,
  type KnowledgeIndexProjection,
} from '../src';
import { catalog, fixtureCorpus, LAW_MB, ORIGIN, SFS, SGU } from './fixtures';

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

const provider = createDeterministicHashEmbeddingProvider({ dimensions: 128 });

describe('K2.2 read-model integrity (round 2) — the governed side is verified, vectors are witnessed, nothing corrupt is scored', () => {
  it('a governed lookup can only be built from a snapshot that verifies: forged chunk text under the original identity is refused, so a re-derived index from a forged snapshot cannot be served', async () => {
    const { snapshot, docs } = await fixtureCorpus();
    const target = docs.guidance_v2!;
    const forgedDoc: CorpusDocumentProjection = {
      ...target,
      chunks: target.chunks.map((c, i) =>
        i === target.chunks.length - 1
          ? { ...c, full_text: `${c.full_text} FORGED TILLÄGG: skyddsavståndet är endast 5 meter.` }
          : c,
      ),
    };
    const forged: CorpusSnapshot = {
      ...snapshot,
      documents: snapshot.documents.map((d) => (d === target ? forgedDoc : d)),
    };
    expect(() => createGovernedKnowledgeLookup(forged)).toThrow(
      /fails verification.*CHUNK_SET_HASH_MISMATCH/,
    );
    await expect(buildIndexProjection(forged, provider)).rejects.toMatchObject({
      code: 'REJECT_GOVERNED_SNAPSHOT',
    });
    const codes = verifyIndexProjection((await buildIndexProjection(snapshot, provider)).index, forged).map(
      (v) => v.code,
    );
    expect(codes).toContain('CORPUS_SNAPSHOT_MISMATCH');
  });

  it('vector CONTENT is witnessed by re-embedding: a swapped-but-valid vector passes the shape checks and is caught as VECTOR_MISMATCH', async () => {
    const { snapshot } = await fixtureCorpus();
    const { index } = await buildIndexProjection(snapshot, provider);
    const swapped = restamp(index, [
      { ...index.rows[0]!, vector: index.rows[1]!.vector },
      { ...index.rows[1]!, vector: index.rows[0]!.vector },
      ...index.rows.slice(2),
    ]);
    expect(verifyIndexProjection(swapped, snapshot)).toEqual([]); // shape-only checks cannot see it
    const withReembed = await verifyIndexProjectionWithReembedding(swapped, snapshot, {
      reembed: { provider },
    });
    expect(withReembed.map((v) => v.code)).toEqual(['VECTOR_MISMATCH', 'VECTOR_MISMATCH']);
    const honest = await verifyIndexProjectionWithReembedding(index, snapshot, { reembed: { provider } });
    expect(honest).toEqual([]);
    // Sampling: a deterministic subset is re-embedded; the sample is the same on every run.
    const sampled = await verifyIndexProjectionWithReembedding(swapped, snapshot, {
      reembed: { provider, sample_size: 2 },
    });
    const again = await verifyIndexProjectionWithReembedding(swapped, snapshot, {
      reembed: { provider, sample_size: 2 },
    });
    expect(again).toEqual(sampled);
  });

  it('the index identity covers the header: catalog_origin and skipped_documents cannot be edited under a stable identity, and verify compares the catalog to the corpus', async () => {
    const { snapshot } = await fixtureCorpus();
    const { index } = await buildIndexProjection(snapshot, provider);
    const json = JSON.parse(serializeIndexProjection(index)) as Record<string, unknown>;
    expect(() =>
      deserializeIndexProjection(JSON.stringify({ ...json, catalog_origin: 'static:evil' })),
    ).toThrow(/index_snapshot_identity/);
    expect(() =>
      deserializeIndexProjection(JSON.stringify({ ...json, skipped_documents: [{ forged: true }] })),
    ).toThrow(/skipped_documents/);
    expect(() => deserializeIndexProjection(JSON.stringify({ ...json, skipped_documents: 'abc' }))).toThrow(
      /knowledge-index-projection-v1/,
    );
    expect(
      verifyIndexProjection({ ...index, catalog_origin: 'static:evil' }, snapshot).map((v) => v.code),
    ).toEqual(expect.arrayContaining(['CATALOG_MISMATCH', 'INDEX_IDENTITY_MISMATCH']));
  });

  it('a candidate that cannot be scored (NaN / holey vector) or that duplicates another candidate makes search fail closed — it can never displace or mis-rank honest hits', async () => {
    const corpus = await fixtureCorpus();
    const p = createDeterministicHashEmbeddingProvider({
      idf: fitIdfTable(corpus.snapshot.documents.flatMap((d) => d.chunks.map((c) => c.full_text))),
    });
    const { index } = await buildIndexProjection(corpus.snapshot, p);
    const governed = createGovernedKnowledgeLookup(corpus.snapshot);
    const query = 'skyddsavstånd mellan brunn och avloppsanläggning';
    const filters = { document_ids: [corpus.keys.guidance_v2!] };
    const honest = await searchKnowledgeIndex(index, p, { query, filters, top_k: 3 }, governed);
    expect(honest.kind).toBe('RESULTS');
    const guidanceRows = index.rows.filter((r) => r.document_id === corpus.keys.guidance_v2);
    // Poison the LOWEST-scoring row of the document: honest search never surfaces it, so a per-hit check alone would miss it.
    const lowest = honest.hits[honest.hits.length - 1]!.row;
    const victim = guidanceRows.find((r) => r !== lowest && !honest.hits.some((h) => h.row === r)) ?? lowest;
    const nan = restamp(
      index,
      index.rows.map((r) =>
        r === victim ? { ...r, vector: r.vector.map((x, i) => (i === 0 ? Number.NaN : x)) } : r,
      ),
    );
    await expect(searchKnowledgeIndex(nan, p, { query, filters, top_k: 3 }, governed)).rejects.toMatchObject({
      code: 'INDEX_ROW_CORRUPT',
    });
    const holey = restamp(
      index,
      index.rows.map((r) =>
        r === victim ? { ...r, vector: Object.assign(new Array(r.vector.length), { 0: 0.1 }) } : r,
      ),
    );
    await expect(
      searchKnowledgeIndex(holey, p, { query, filters, top_k: 3 }, governed),
    ).rejects.toMatchObject({ code: 'INDEX_ROW_CORRUPT' });
    const duplicated = restamp(index, [...index.rows, guidanceRows[0]!]);
    await expect(
      searchKnowledgeIndex(duplicated, p, { query, filters, top_k: 3 }, governed),
    ).rejects.toMatchObject({ code: 'INDEX_ROW_CORRUPT' });
  });

  it('skips non-admitted documents explicitly and records why (a real failed extraction, verifiable snapshot)', async () => {
    const { snapshot } = await fixtureCorpus();
    const failing: TextExtractorPort = {
      async extract() {
        return {
          text: '',
          method: 'pdf_parse',
          version: 'pdf-parse@test',
          succeeded: false,
          notes: 'pdf-parse returned no text',
        };
      },
    };
    const failed = await projectDocument(
      {
        source_id: SFS.source_id,
        doc_name: 'scan.pdf',
        mime_type: 'application/pdf',
        bytes: new TextEncoder().encode(LAW_MB + '\n\nscan'),
      },
      { catalog, extractor: failing },
    );
    expect(failed.kind).toBe('PROJECTED');
    const withFailed = buildCorpusSnapshot(
      [...snapshot.documents, (failed as { document: CorpusDocumentProjection }).document],
      { catalog_origin: ORIGIN },
    );
    const { index, stats } = await buildIndexProjection(withFailed, provider);
    expect(stats.documents_skipped).toBe(1);
    expect(index.skipped_documents[0]).toMatchObject({
      reason: expect.stringContaining('EXTRACTION_FAILED'),
    });
    expect(verifyIndexProjection(index, withFailed)).toEqual([]);
    expect(SGU.source_id).toBeDefined();
  });
});
