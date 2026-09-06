import { describe, expect, it } from 'vitest';

import {
  buildIndexProjection,
  computeIndexSnapshotIdentity,
  createDeterministicHashEmbeddingProvider,
  createGovernedKnowledgeLookup,
  fitIdfTable,
  KnowledgeSearchError,
  searchKnowledgeIndex,
  type GovernedKnowledgeLookup,
  type IndexRow,
  type KnowledgeEmbeddingProvider,
  type KnowledgeIndexProjection,
} from '../src';
import { fixtureCorpus, MHN, PUH, SFS, SGU, type FixtureCorpus } from './fixtures';

let provider: KnowledgeEmbeddingProvider;
let corpus: FixtureCorpus;
let index: KnowledgeIndexProjection;
let governed: GovernedKnowledgeLookup;
async function setup(): Promise<void> {
  if (!corpus) {
    corpus = await fixtureCorpus({ includeNearDuplicate: true });
    // Exact-vocabulary fixture provider fitted on this corpus (collision-free, null floor 0).
    provider = createDeterministicHashEmbeddingProvider({
      idf: fitIdfTable(corpus.snapshot.documents.flatMap((d) => d.chunks.map((c) => c.full_text))),
    });
    index = (await buildIndexProjection(corpus.snapshot, provider)).index;
    governed = createGovernedKnowledgeLookup(corpus.snapshot);
  }
}

describe('K2.2 knowledge search — metadata narrowing + deterministic ranking + governed provenance', () => {
  it('returns the correct governed source for a golden query, with full registry-bound provenance resolved from the GOVERNED corpus on every hit', async () => {
    await setup();
    // "enligt miljöbalken" is a SOURCE qualifier: K2.2 narrows it as metadata (source_ids), it is
    // not left to lexical luck — unfiltered, the ordinance that cites "miljöbalken" by name
    // outranks the balk itself under a lexical fixture model.
    const out = await searchKnowledgeIndex(
      index,
      provider,
      {
        query: 'Vad avses med miljöfarlig verksamhet enligt 9 kap. miljöbalken?',
        filters: { source_ids: [SFS.source_id], roles: ['law'] },
        top_k: 5,
      },
      governed,
    );
    expect(out.kind).toBe('RESULTS');
    expect(out.hits.every((h) => h.provenance.source_id === SFS.source_id)).toBe(true);
    // Content-based: chapter labels on real/legal text carry the chunker's documented
    // trailing-heading timing limitation (a "26 kap." heading glued to the tail of 9 kap. 6 §
    // relabels that fragment), so the assertion binds to the governed text, not the label.
    expect(out.hits[0]!.row.chunk_text.toLowerCase()).toContain('miljöfarlig verksamhet');
    expect(
      out.hits.slice(0, 3).some((h) => h.row.chunk_text.includes('Med miljöfarlig verksamhet avses')),
    ).toBe(true);
    for (const hit of out.hits) {
      expect(hit.result.resolved_against_governed_chunk).toBe(true);
      const governedDoc = corpus.snapshot.documents.find(
        (d) => d.canonical_record_key === hit.provenance.canonical_record_key,
      )!;
      expect(hit.provenance.registry_artifact_id).toBe(governedDoc.source.registry_artifact_id);
      expect(hit.provenance.role_method).toBe(governedDoc.role.method);
      expect(hit.result.source_provenance_refs).toEqual([
        `registry:${governedDoc.source.registry_artifact_id}`,
        `source:${governedDoc.source.source_id}`,
        `document:${governedDoc.document_id}`,
        `materialization:${governedDoc.canonical_record_key}`,
        `projection:${governedDoc.text_projection.projection_id}`,
      ]);
      expect(hit.result.embedding_identity.embedding_identity_hash).toBe(
        hit.row.embedding_identity.embedding_identity_hash,
      );
    }
    expect(out.trace.identity.artifact_snapshot).toBe(index.index_snapshot_identity);
    expect(out.trace.identity.policy_version).toBe('legal-ret-policy-1');
  });

  it('a metadata filter excludes the wrong source even when its text is lexically closer', async () => {
    await setup();
    const query = 'bullervillkor 50 dBA vid bostäder för bergtäkt';
    const unrestricted = await searchKnowledgeIndex(index, provider, { query, top_k: 10 }, governed);
    expect(new Set(unrestricted.hits.map((h) => h.provenance.source_id)).size).toBeGreaterThan(1);
    const onlyDecisions = await searchKnowledgeIndex(
      index,
      provider,
      { query, filters: { source_ids: [MHN.source_id] }, top_k: 10 },
      governed,
    );
    expect(onlyDecisions.hits.length).toBeGreaterThan(0);
    expect(onlyDecisions.hits.every((h) => h.provenance.source_id === MHN.source_id)).toBe(true);
    expect(onlyDecisions.hits.some((h) => h.row.metadata.evidence_anchor === 'VILLKOR')).toBe(true);
  });

  it('version=current excludes a superseded document of a keyed lineage; an explicit label selects exactly that version; unrelated decisions of one source stay current', async () => {
    await setup();
    const query = 'skyddsavstånd mellan brunn och avloppsanläggning';
    const current = await searchKnowledgeIndex(
      index,
      provider,
      { query, filters: { source_ids: [SGU.source_id], version: 'current' }, top_k: 10 },
      governed,
    );
    expect(current.hits.length).toBeGreaterThan(0);
    expect(current.hits.every((h) => h.provenance.document_id === corpus.keys.guidance_v2)).toBe(true);
    expect(current.hits[0]!.provenance).toMatchObject({
      is_current: true,
      currency_method: 'ACQUISITION_RECENCY',
    });
    const old = await searchKnowledgeIndex(
      index,
      provider,
      { query, filters: { version: { source_version_label: 'utgåva 2024' } }, top_k: 10 },
      governed,
    );
    expect(old.hits.every((h) => h.provenance.document_id === corpus.keys.guidance_v1)).toBe(true);
    const any = await searchKnowledgeIndex(
      index,
      provider,
      { query, filters: { source_ids: [SGU.source_id], version: 'any' }, top_k: 10 },
      governed,
    );
    expect(new Set(any.hits.map((h) => h.provenance.document_id)).size).toBe(2);
    // Two different court decisions under one source are not versions of each other: both are served as current.
    const courts = await searchKnowledgeIndex(
      index,
      provider,
      {
        query: 'Mark- och miljööverdomstolen',
        filters: { source_ids: [PUH.source_id], version: 'current' },
        top_k: 10,
      },
      governed,
    );
    expect(new Set(courts.hits.map((h) => h.provenance.document_id)).size).toBeGreaterThanOrEqual(2);
    expect(courts.hits.every((h) => h.provenance.currency_method === 'NO_LINEAGE')).toBe(true);
  });

  it('a near-duplicate wrong document does not outrank the exact expected result when the query quotes the exact wording', async () => {
    await setup();
    const out = await searchKnowledgeIndex(
      index,
      provider,
      {
        query:
          'avslår överklagandet och fastställer mark- och miljödomstolens dom om bullervillkor för bergtäkten',
        filters: { source_ids: [PUH.source_id], court_sections: ['DOMSLUT'] },
        top_k: 3,
      },
      governed,
    );
    expect(out.hits[0]!.provenance.document_id).toBe(corpus.keys.court_a);
  });

  it('abstains with NO_EVIDENCE instead of fabricating evidence for an unsupported query', async () => {
    await setup();
    const query = 'kvantmekanisk supraledning i grafenlager vid kryogena temperaturer';
    // The abstention threshold is an explicit, reported search parameter (calibrated by the eval
    // harness from a null model); the search itself only enforces it and reports it.
    const probe = await searchKnowledgeIndex(
      index,
      provider,
      { query, top_k: 1, abstain_below_score: 0 },
      governed,
    );
    expect(
      probe.hits[0]?.score ?? 0,
      `top score for an unsupported query was ${probe.hits[0]?.score}`,
    ).toBeLessThan(0.3);
    const out = await searchKnowledgeIndex(
      index,
      provider,
      { query, top_k: 5, abstain_below_score: 0.3 },
      governed,
    );
    expect(out.kind).toBe('NO_EVIDENCE');
    expect(out.hits).toHaveLength(0);
    expect(out.trace.identity.selected_artifact_refs).toEqual([]);
  });

  it('filter values are structural data: SQL/glob/regex metacharacters match nothing rather than everything', async () => {
    await setup();
    for (const evil of [
      "' OR 1=1 --",
      '%',
      '*',
      '.*',
      '__proto__',
      'regeringskansliet-sfs-1998-808 OR 1=1',
    ]) {
      const out = await searchKnowledgeIndex(
        index,
        provider,
        { query: 'miljöfarlig verksamhet', filters: { source_ids: [evil] }, top_k: 5 },
        governed,
      );
      expect(out.candidate_count, evil).toBe(0);
      expect(out.kind, evil).toBe('NO_EVIDENCE');
    }
  });

  it('malformed filters are REFUSED, never widened to unrestricted', async () => {
    await setup();
    const cases: unknown[] = [
      { sourceIds: [SFS.source_id] }, // misspelled key
      { source_ids: 'regeringskansliet-sfs-1998-808,domstolsverket-puh-mmod' }, // string instead of array
      { roles: 'law,court' },
      { roles: ['lawyer'] },
      { version: 'CURRENT' },
      { version: "' OR 1=1" },
      { version: {} },
      { version: { source_version_label: '' } },
      { chapter: 9 },
      'unrestricted',
      null,
    ];
    for (const filters of cases) {
      await expect(
        searchKnowledgeIndex(
          index,
          provider,
          { query: 'miljöfarlig verksamhet', filters: filters as never, top_k: 5 },
          governed,
        ),
        JSON.stringify(filters),
      ).rejects.toThrow(/REJECT_FILTERS|must be|unknown filter|unknown role|unknown kind/);
    }
  });

  it('ranking is deterministic and does not depend on row insertion order', async () => {
    await setup();
    const a = await searchKnowledgeIndex(
      index,
      provider,
      { query: 'tillsynsmyndighet föreläggande och förbud', top_k: 10 },
      governed,
    );
    const reversed: KnowledgeIndexProjection = { ...index, rows: [...index.rows].reverse() };
    const b = await searchKnowledgeIndex(
      reversed,
      provider,
      { query: 'tillsynsmyndighet föreläggande och förbud', top_k: 10 },
      governed,
    );
    expect(b.hits.map((h) => h.result.fragment_id)).toEqual(a.hits.map((h) => h.result.fragment_id));
    expect(b.trace.trace_hash).toBe(a.trace.trace_hash);
  });

  it('refuses to search an index with a provider whose binding differs from the one the index was built with', async () => {
    await setup();
    const other = createDeterministicHashEmbeddingProvider({ dimensions: 64 });
    await expect(searchKnowledgeIndex(index, other, { query: 'x' }, governed)).rejects.toThrow(
      /INDEX_MODEL_MISMATCH|never mixed/,
    );
  });

  it('never serves a row that disagrees with the governed corpus: a forged provenance column, role, currency or text on a hit fails closed even when the index identity was re-stamped', async () => {
    await setup();
    const query = 'skyddsavstånd mellan brunn och avloppsanläggning';
    const honest = await searchKnowledgeIndex(
      index,
      provider,
      { query, filters: { source_ids: [SGU.source_id] }, top_k: 3 },
      governed,
    );
    const target = honest.hits[0]!.row;
    const forgeries: Array<[string, Partial<IndexRow>]> = [
      ['registry_artifact_id', { registry_artifact_id: 'reg-evil-001' }],
      ['source_id', { source_id: SGU.source_id }], // unchanged source but...
      ['role', { role: 'law' }],
      ['is_current', { metadata: { ...target.metadata, is_current: !target.metadata.is_current } }],
      ['chunk_text', { chunk_text: 'FORGED TEXT: skyddsavstånd är 5 meter.' }],
      ['document_id', { document_id: corpus.keys.law_mb! }],
    ];
    for (const [label, patch] of forgeries) {
      const rows = index.rows.map((r) => (r === target ? ({ ...r, ...patch } as IndexRow) : r));
      const forged: KnowledgeIndexProjection = {
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
      const attempt = searchKnowledgeIndex(
        forged,
        provider,
        { query, filters: { source_ids: [SGU.source_id] }, top_k: 3 },
        governed,
      );
      if (label === 'source_id')
        await expect(attempt).resolves.toBeDefined(); // no-op patch: control
      else await expect(attempt, label).rejects.toThrow(KnowledgeSearchError);
    }
  });

  it('refuses a governed lookup from a different corpus snapshot, and a non-finite query embedding', async () => {
    await setup();
    const otherCorpus = await fixtureCorpus();
    const otherGoverned = createGovernedKnowledgeLookup(otherCorpus.snapshot);
    await expect(searchKnowledgeIndex(index, provider, { query: 'x' }, otherGoverned)).rejects.toMatchObject({
      code: 'CORPUS_SNAPSHOT_MISMATCH',
    });
    const nanProvider: KnowledgeEmbeddingProvider = {
      ...provider,
      async embedDocuments(texts) {
        return provider.embedDocuments(texts);
      },
      async embedQuery() {
        return new Array(provider.dimensions).fill(Number.NaN);
      },
    };
    await expect(searchKnowledgeIndex(index, nanProvider, { query: 'x' }, governed)).rejects.toMatchObject({
      code: 'REJECT_QUERY_EMBEDDING',
    });
  });
});
