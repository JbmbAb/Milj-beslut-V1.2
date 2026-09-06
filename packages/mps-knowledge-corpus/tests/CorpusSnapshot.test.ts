import { describe, expect, it } from 'vitest';

import {
  acquiredAtMs,
  buildCorpusSnapshot,
  CorpusSnapshotError,
  CHUNK_POLICY_TEXT_V23,
  currencyByDocument,
  planIncrementalRebuild,
  projectDocument,
  verifyCorpusSnapshot,
  type CorpusDocumentProjection,
} from '../src';
import {
  bytesOf,
  COURT_TEXT,
  FIXTURE_CATALOG_ORIGIN,
  fixtureCatalog,
  LAW_TEXT,
  PUH,
  SFS,
  SGU,
  STANDARD_TEXT,
  utf8Extractor,
} from './fixtures';

const deps = { catalog: fixtureCatalog(), extractor: utf8Extractor() };
const ORIGIN = { catalog_origin: FIXTURE_CATALOG_ORIGIN };

async function doc(input: Parameters<typeof projectDocument>[0]): Promise<CorpusDocumentProjection> {
  const outcome = await projectDocument(input, deps);
  if (outcome.kind !== 'PROJECTED') throw new Error(JSON.stringify(outcome));
  return outcome.document;
}

const currentOf = (snapshot: ReturnType<typeof buildCorpusSnapshot>, d: CorpusDocumentProjection) =>
  currencyByDocument(snapshot.documents, snapshot.version_lineages).get(d.document_id)!;

describe('K2.2 corpus snapshot — duplicates', () => {
  it('collapses byte-identical acquisitions (different path/name/quarantine id) into one document and records every acquisition', async () => {
    const a = await doc({
      source_id: SFS.source_id,
      doc_name: 'sfst',
      bytes: bytesOf(LAW_TEXT),
      acquisition: {
        quarantine_id: '11111111-1111-4111-8111-111111111111',
        acquired_at: '2026-08-01T00:00:00.000Z',
      },
    });
    const b = await doc({
      source_id: SFS.source_id,
      doc_name: 'C:\\somewhere\\else\\sfst.html',
      bytes: bytesOf(LAW_TEXT),
      acquisition: {
        quarantine_id: '22222222-2222-4222-8222-222222222222',
        acquired_at: '2026-09-01T00:00:00.000Z',
      },
    });
    const snapshot = buildCorpusSnapshot([a, b], ORIGIN);
    expect(snapshot.documents).toHaveLength(1);
    expect(snapshot.duplicates).toEqual([
      {
        document_id: a.document_id,
        occurrences: 2,
        doc_names: ['C:\\somewhere\\else\\sfst.html', 'sfst'],
        quarantine_ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
        acquired_at: ['2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'],
        source_version_labels: [],
        source_urls: [],
        version_lineage_keys: [],
      },
    ]);
  });

  it('the surviving acquisition of a byte-identical replay is the NEWEST one, whatever the input order (order-insensitive currency)', async () => {
    const key = 'sgu:vagledning';
    const early = await doc({
      source_id: SGU.source_id,
      doc_name: 'v',
      bytes: bytesOf(STANDARD_TEXT),
      acquisition: {
        quarantine_id: '11111111-1111-4111-8111-111111111111',
        acquired_at: '2026-08-01T00:00:00.000Z',
      },
      source_version_label: 'utgåva 2024',
      version_lineage_key: key,
    });
    const late = await doc({
      source_id: SGU.source_id,
      doc_name: 'v',
      bytes: bytesOf(STANDARD_TEXT),
      acquisition: {
        quarantine_id: '22222222-2222-4222-8222-222222222222',
        acquired_at: '2026-09-10T00:00:00.000Z',
      },
      source_version_label: 're-acquired 2026-09-10',
      version_lineage_key: key,
    });
    const other = await doc({
      source_id: SGU.source_id,
      doc_name: 'v',
      bytes: bytesOf(STANDARD_TEXT + '\n\nReviderad utgåva.'),
      acquisition: {
        quarantine_id: '33333333-3333-4333-8333-333333333333',
        acquired_at: '2026-09-01T00:00:00.000Z',
      },
      version_lineage_key: key,
    });
    const a = buildCorpusSnapshot([early, late, other], ORIGIN);
    const b = buildCorpusSnapshot([late, early, other], ORIGIN);
    const c = buildCorpusSnapshot([other, early, late], ORIGIN);
    expect(b.snapshot_identity).toBe(a.snapshot_identity);
    expect(c.snapshot_identity).toBe(a.snapshot_identity);
    for (const s of [a, b, c]) {
      const survivor = s.documents.find((d) => d.document_id === early.document_id)!;
      expect(survivor.acquisition?.acquired_at).toBe('2026-09-10T00:00:00.000Z');
      expect(survivor.source_version_label).toBe('re-acquired 2026-09-10');
      expect(currentOf(s, early)).toMatchObject({ is_current: true, method: 'ACQUISITION_RECENCY' });
      expect(currentOf(s, other)).toMatchObject({ is_current: false, method: 'ACQUISITION_RECENCY' });
    }
    // Currency is part of the snapshot identity: a snapshot where the older acquisition is the only
    // one seen is a DIFFERENT snapshot, so an index built from it cannot pass as this one.
    const olderOnly = buildCorpusSnapshot([early, other], ORIGIN);
    expect(olderOnly.snapshot_identity).not.toBe(a.snapshot_identity);
    expect(currentOf(olderOnly, other).is_current).toBe(true);
  });

  it('keeps the same file name with different content as two distinct documents', async () => {
    const a = await doc({
      source_id: SGU.source_id,
      doc_name: 'vagledning.html',
      bytes: bytesOf(STANDARD_TEXT),
    });
    const b = await doc({
      source_id: SGU.source_id,
      doc_name: 'vagledning.html',
      bytes: bytesOf(
        STANDARD_TEXT + '\n\nTillägg: brunnen ska besiktigas årligen av en certifierad brunnsborrare.',
      ),
    });
    const snapshot = buildCorpusSnapshot([a, b], ORIGIN);
    expect(snapshot.documents).toHaveLength(2);
    expect(snapshot.duplicates).toHaveLength(0);
  });

  it('two chunk policies over the same bytes are two materializations of ONE document — not a duplicate acquisition, and they share currency', async () => {
    const q = {
      quarantine_id: '11111111-1111-4111-8111-111111111111',
      acquired_at: '2026-08-01T00:00:00.000Z',
    };
    const a = await doc({
      source_id: SFS.source_id,
      doc_name: 'sfst',
      bytes: bytesOf(LAW_TEXT),
      acquisition: q,
      version_lineage_key: 'sfs',
    });
    const b = await doc({
      source_id: SFS.source_id,
      doc_name: 'sfst',
      bytes: bytesOf(LAW_TEXT),
      acquisition: { ...q, acquired_at: '2026-09-10T00:00:00.000Z' },
      chunk_policy_version: CHUNK_POLICY_TEXT_V23,
      version_lineage_key: 'sfs',
    });
    const newer = await doc({
      source_id: SFS.source_id,
      doc_name: 'sfst',
      bytes: bytesOf(LAW_TEXT + '\n\n27 kap. Avgifter'),
      acquisition: {
        quarantine_id: '22222222-2222-4222-8222-222222222222',
        acquired_at: '2026-09-01T00:00:00.000Z',
      },
      version_lineage_key: 'sfs',
    });
    const snapshot = buildCorpusSnapshot([a, b, newer], ORIGIN);
    expect(snapshot.documents).toHaveLength(3);
    expect(new Set(snapshot.documents.map((d) => d.document_id)).size).toBe(2);
    expect(snapshot.duplicates).toHaveLength(0);
    // The document's acquisition instant is the newest across its materializations (2026-09-10 > 2026-09-01),
    // and BOTH materializations of it carry the same currency.
    const lineage = snapshot.version_lineages[0]!;
    expect(lineage.members.filter((m) => m.document_id === a.document_id).map((m) => m.is_current)).toEqual([
      true,
      true,
    ]);
    expect(lineage.members.find((m) => m.document_id === newer.document_id)!.is_current).toBe(false);
  });
});

describe('K2.2 corpus snapshot — version lineages are keyed by the logical publication, never by the source alone', () => {
  it('two distinct decisions of a multi-document source are NOT versions of each other: both current, no lineage', async () => {
    const a = await doc({
      source_id: PUH.source_id,
      doc_name: 'MMOD_M_1001-25.pdf',
      bytes: bytesOf(COURT_TEXT),
      acquisition: {
        acquired_at: '2026-09-01T10:00:00.000Z',
        source_url: 'https://rattspraxis.example/bilagor/1001-25',
      },
    });
    const b = await doc({
      source_id: PUH.source_id,
      doc_name: 'MMOD_M_2002-25.pdf',
      bytes: bytesOf(
        COURT_TEXT.replace('DOMSLUT', 'DOMSLUT\nMark- och miljööverdomstolen avvisar överklagandet.'),
      ),
      acquisition: {
        acquired_at: '2026-09-01T10:00:01.000Z',
        source_url: 'https://rattspraxis.example/bilagor/2002-25',
      },
    });
    const undated = await doc({
      source_id: PUH.source_id,
      doc_name: 'MMOD_M_3003-25.pdf',
      bytes: bytesOf(COURT_TEXT + '\nTillägg.'),
    });
    const snapshot = buildCorpusSnapshot([a, b, undated], ORIGIN);
    expect(snapshot.version_lineages).toHaveLength(0);
    for (const d of [a, b, undated])
      expect(currentOf(snapshot, d)).toMatchObject({ is_current: true, method: 'NO_LINEAGE' });
    expect(undated.version_lineage_key).toBeNull();
  });

  it('re-harvesting the SAME publication locator is a version lineage (source_url is the default key); an explicit key overrides it', async () => {
    const url = 'https://www.sgu.se/vagledning-for-att-borra-brunn/';
    const v1 = await doc({
      source_id: SGU.source_id,
      doc_name: 'v',
      bytes: bytesOf(STANDARD_TEXT),
      acquisition: { acquired_at: '2026-08-20T00:00:00.000Z', source_url: url },
      source_version_label: 'utgåva 2024',
    });
    const v2 = await doc({
      source_id: SGU.source_id,
      doc_name: 'v',
      bytes: bytesOf(STANDARD_TEXT + '\n\nReviderad utgåva.'),
      acquisition: { acquired_at: '2026-09-06T00:00:00.000Z', source_url: url },
      source_version_label: 'utgåva 2026',
    });
    const snapshot = buildCorpusSnapshot([v1, v2], ORIGIN);
    expect(snapshot.version_lineages).toHaveLength(1);
    const lineage = snapshot.version_lineages[0]!;
    expect(lineage.version_lineage_key).toBe(url);
    expect(lineage.currency_method).toBe('ACQUISITION_RECENCY');
    expect(lineage.ambiguous_current).toBe(false);
    expect(lineage.members.find((m) => m.document_id === v2.document_id)?.is_current).toBe(true);
    expect(lineage.members.find((m) => m.document_id === v1.document_id)?.is_current).toBe(false);

    // Same URL, but the caller says these are different publications: no lineage.
    const other = await doc({
      source_id: SGU.source_id,
      doc_name: 'v',
      bytes: bytesOf(STANDARD_TEXT + '\n\nReviderad utgåva.'),
      acquisition: { acquired_at: '2026-09-06T00:00:00.000Z', source_url: url },
      version_lineage_key: 'sgu:another-publication',
    });
    expect(buildCorpusSnapshot([v1, other], ORIGIN).version_lineages).toHaveLength(0);
  });

  it('an ambiguous newest acquisition (tie, or an undated member) marks NO member current; instants are compared as instants', async () => {
    const key = 'sgu:v';
    const base = { source_id: SGU.source_id, doc_name: 'v', version_lineage_key: key };
    const v1 = await doc({
      ...base,
      bytes: bytesOf(STANDARD_TEXT),
      acquisition: { acquired_at: '2026-08-20T00:00:00.000Z' },
    });
    const v2 = await doc({
      ...base,
      bytes: bytesOf(STANDARD_TEXT + '\n\nReviderad.'),
      acquisition: { acquired_at: '2026-08-20T00:00:00.000Z' },
    });
    const tie = buildCorpusSnapshot([v1, v2], ORIGIN);
    expect(tie.version_lineages[0]!.ambiguous_current).toBe(true);
    expect(tie.version_lineages[0]!.members.every((m) => m.is_current === false)).toBe(true);

    const undated = await doc({ ...base, bytes: bytesOf(STANDARD_TEXT + '\n\nReviderad.') });
    const mixed = buildCorpusSnapshot([v1, undated], ORIGIN);
    expect(mixed.version_lineages[0]!.ambiguous_current).toBe(true);
    expect(currentOf(mixed, v1).is_current).toBe(false);

    // '2026-09-06T02:00:00+05:00' is an EARLIER instant than '2026-09-06T00:00:00.000Z'.
    const offset = await doc({
      ...base,
      bytes: bytesOf(STANDARD_TEXT),
      acquisition: { acquired_at: '2026-09-06T02:00:00+05:00' },
    });
    const zulu = await doc({
      ...base,
      bytes: bytesOf(STANDARD_TEXT + '\n\nReviderad.'),
      acquisition: { acquired_at: '2026-09-06T00:00:00.000Z' },
    });
    const instants = buildCorpusSnapshot([offset, zulu], ORIGIN);
    expect(currentOf(instants, zulu).is_current).toBe(true);
    expect(currentOf(instants, offset).is_current).toBe(false);
    expect(acquiredAtMs('2026-09-06')).toBeNull();
    expect(acquiredAtMs('yesterday')).toBeNull();
    const garbage = await doc({
      ...base,
      bytes: bytesOf(STANDARD_TEXT),
      acquisition: { acquired_at: 'yesterday' },
    });
    expect(buildCorpusSnapshot([garbage, zulu], ORIGIN).version_lineages[0]!.ambiguous_current).toBe(true);
  });

  it('refuses mixed-authority projections, identity collisions, and one source under two registry scopes', async () => {
    const a = await doc({ source_id: SFS.source_id, doc_name: 'sfst', bytes: bytesOf(LAW_TEXT) });
    expect(() => buildCorpusSnapshot([a], { catalog_origin: 'static:<some-other-catalog>' })).toThrow(
      CorpusSnapshotError,
    );
    const forged = { ...a, chunk_set_content_hash: 'f'.repeat(64) } as CorpusDocumentProjection;
    expect(() => buildCorpusSnapshot([a, forged], ORIGIN)).toThrow(/REJECT_IDENTITY_COLLISION/);
    const rescoped = {
      ...a,
      canonical_record_key: 'canonical:legal-corpus:' + '9'.repeat(64),
      source: { ...a.source, registry_source_content_hash: 'f'.repeat(64) },
    } as CorpusDocumentProjection;
    expect(() => buildCorpusSnapshot([a, rescoped], ORIGIN)).toThrow(/REJECT_SOURCE_SCOPE_MIXED/);
  });

  it('snapshot identity is order-insensitive and deterministic', async () => {
    const a = await doc({ source_id: SFS.source_id, doc_name: 'sfst', bytes: bytesOf(LAW_TEXT) });
    const b = await doc({ source_id: PUH.source_id, doc_name: 'dom.pdf', bytes: bytesOf(COURT_TEXT) });
    const ab = buildCorpusSnapshot([a, b], ORIGIN);
    const ba = buildCorpusSnapshot([b, a], ORIGIN);
    expect(ba.snapshot_identity).toBe(ab.snapshot_identity);
    expect(ba.documents.map((d) => d.document_id)).toEqual(ab.documents.map((d) => d.document_id));
  });
});

describe('K2.2 corpus snapshot — verification and incremental rebuild', () => {
  it('verifies a clean snapshot and detects tampered chunk text, tampered identity, and a broken chain', async () => {
    const a = await doc({ source_id: SFS.source_id, doc_name: 'sfst', bytes: bytesOf(LAW_TEXT) });
    const clean = buildCorpusSnapshot([a], ORIGIN);
    expect(verifyCorpusSnapshot(clean)).toEqual([]);

    const tamperedChunks = {
      ...a,
      chunks: a.chunks.map((c, i) => (i === 0 ? { ...c, full_text: `${c.full_text} (ändrad)` } : c)),
    } as CorpusDocumentProjection;
    expect(verifyCorpusSnapshot({ ...clean, documents: [tamperedChunks] }).map((v) => v.code)).toContain(
      'CHUNK_SET_HASH_MISMATCH',
    );

    const tamperedId = { ...a, document_id: 'kdoc:' + '0'.repeat(64) } as CorpusDocumentProjection;
    expect(verifyCorpusSnapshot({ ...clean, documents: [tamperedId] }).map((v) => v.code)).toContain(
      'DOCUMENT_ID_MISMATCH',
    );

    const brokenChain = {
      ...a,
      provenance_chain: a.provenance_chain.map((l, i) =>
        i === 1 ? { ...l, content_hash: '1'.repeat(64) } : l,
      ),
    } as CorpusDocumentProjection;
    expect(verifyCorpusSnapshot({ ...clean, documents: [brokenChain] }).map((v) => v.code)).toContain(
      'PROVENANCE_CHAIN_BROKEN',
    );

    // Version state is part of the identity: a relabelled document is a different snapshot.
    const relabelled = { ...a, source_version_label: 'utgåva 2025-RELABELED' } as CorpusDocumentProjection;
    expect(verifyCorpusSnapshot({ ...clean, documents: [relabelled] }).map((v) => v.code)).toContain(
      'SNAPSHOT_IDENTITY_MISMATCH',
    );
  });

  it('plans incrementally: unchanged / changed / added / removed, and names registry relabels explicitly', async () => {
    const law = await doc({ source_id: SFS.source_id, doc_name: 'sfst', bytes: bytesOf(LAW_TEXT) });
    const court = await doc({ source_id: PUH.source_id, doc_name: 'dom.pdf', bytes: bytesOf(COURT_TEXT) });
    const guidance = await doc({ source_id: SGU.source_id, doc_name: 'v', bytes: bytesOf(STANDARD_TEXT) });
    const before = buildCorpusSnapshot([law, court, guidance], ORIGIN);

    const guidanceV2 = await doc({
      source_id: SGU.source_id,
      doc_name: 'v',
      bytes: bytesOf(STANDARD_TEXT + '\n\nReviderad.'),
    });
    const after = buildCorpusSnapshot([law, court, guidanceV2], ORIGIN);

    const plan = planIncrementalRebuild(before, after);
    expect([...plan.unchanged].sort()).toEqual([law.canonical_record_key, court.canonical_record_key].sort());
    expect(plan.added).toEqual([guidanceV2.canonical_record_key]);
    expect(plan.removed).toEqual([guidance.canonical_record_key]);
    expect(plan.changed).toEqual([]);
    expect(plan.relabeled).toEqual([]);

    expect(planIncrementalRebuild(after, after)).toEqual({
      unchanged: [...after.documents.map((d) => d.canonical_record_key)].sort(),
      changed: [],
      added: [],
      removed: [],
      relabeled: [],
    });
    expect(planIncrementalRebuild(null, after).added).toHaveLength(3);

    // Same key, different chunk-set content (the chunker behind a policy label changed): CHANGED,
    // i.e. rebuild AND drop the old rows — never reported as merely "added".
    const changed = planIncrementalRebuild(
      {
        documents: [
          {
            document_id: law.document_id,
            canonical_record_key: law.canonical_record_key,
            chunk_set_content_hash: 'a'.repeat(64),
          },
        ],
      },
      {
        documents: [
          {
            document_id: law.document_id,
            canonical_record_key: law.canonical_record_key,
            chunk_set_content_hash: 'b'.repeat(64),
          },
        ],
      },
    );
    expect(changed).toEqual({
      unchanged: [],
      changed: [law.canonical_record_key],
      added: [],
      removed: [],
      relabeled: [],
    });

    // A registry re-attestation relabel (-002 -> -003, same signed content hash, same bytes): the K2.1b
    // materialization identity binds the artifact id, so the record key changes while document_id and
    // chunk-set content do not. The plan says so instead of presenting it as a content change.
    const relabeled = planIncrementalRebuild(
      {
        documents: [
          {
            document_id: law.document_id,
            canonical_record_key: 'canonical:legal-corpus:' + '1'.repeat(64),
            chunk_set_content_hash: law.chunk_set_content_hash,
          },
        ],
      },
      {
        documents: [
          {
            document_id: law.document_id,
            canonical_record_key: 'canonical:legal-corpus:' + '2'.repeat(64),
            chunk_set_content_hash: law.chunk_set_content_hash,
          },
        ],
      },
    );
    expect(relabeled.relabeled).toEqual([
      {
        document_id: law.document_id,
        previous_key: 'canonical:legal-corpus:' + '1'.repeat(64),
        next_key: 'canonical:legal-corpus:' + '2'.repeat(64),
      },
    ]);
    expect(relabeled.added).toHaveLength(1);
    expect(relabeled.removed).toHaveLength(1);
  });
});
