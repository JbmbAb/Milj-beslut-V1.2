import { describe, expect, it } from 'vitest';

import {
  acquiredAtMs,
  buildCorpusSnapshot,
  CHUNK_POLICY_TEXT_V23,
  currencyByDocument,
  projectDocument,
  type CorpusDocumentProjection,
} from '../src';
import {
  bytesOf,
  FIXTURE_CATALOG_ORIGIN,
  fixtureCatalog,
  LAW_TEXT,
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
const currentOf = (s: ReturnType<typeof buildCorpusSnapshot>, d: CorpusDocumentProjection) =>
  currencyByDocument(s.documents, s.version_lineages).get(d.document_id)!;

describe('K2.2 corpus snapshot — round-2 currency semantics', () => {
  it('one document may carry only ONE non-null lineage key across its materializations and replays; a null key adopts the keyed one', async () => {
    const q = {
      quarantine_id: '11111111-1111-4111-8111-111111111111',
      acquired_at: '2026-08-01T00:00:00.000Z',
    };
    const a = await doc({
      source_id: SFS.source_id,
      doc_name: 'sfst',
      bytes: bytesOf(LAW_TEXT),
      acquisition: q,
      version_lineage_key: 'K1',
    });
    const b = await doc({
      source_id: SFS.source_id,
      doc_name: 'sfst',
      bytes: bytesOf(LAW_TEXT),
      acquisition: q,
      chunk_policy_version: CHUNK_POLICY_TEXT_V23,
      version_lineage_key: 'K2',
    });
    expect(() => buildCorpusSnapshot([a, b], ORIGIN)).toThrow(/REJECT_LINEAGE_KEY_CONFLICT/);
    // A byte-identical replay from a mirror with a different locator is the same conflict...
    const mirror = await doc({
      source_id: SFS.source_id,
      doc_name: 'sfst',
      bytes: bytesOf(LAW_TEXT),
      acquisition: {
        quarantine_id: '22222222-2222-4222-8222-222222222222',
        acquired_at: '2026-08-15T00:00:00.000Z',
        source_url: 'https://mirror.example/sfst',
      },
    });
    expect(() => buildCorpusSnapshot([a, mirror], ORIGIN)).toThrow(/REJECT_LINEAGE_KEY_CONFLICT/);
    // ...while a replay with NO key adopts the keyed one and joins its lineage.
    const unkeyed = await doc({
      source_id: SFS.source_id,
      doc_name: 'sfst',
      bytes: bytesOf(LAW_TEXT),
      acquisition: {
        quarantine_id: '33333333-3333-4333-8333-333333333333',
        acquired_at: '2026-08-15T00:00:00.000Z',
      },
    });
    const newer = await doc({
      source_id: SFS.source_id,
      doc_name: 'sfst',
      bytes: bytesOf(LAW_TEXT + '\n\n27 kap. Avgifter'),
      acquisition: {
        quarantine_id: '44444444-4444-4444-8444-444444444444',
        acquired_at: '2026-09-01T00:00:00.000Z',
      },
      version_lineage_key: 'K1',
    });
    const s = buildCorpusSnapshot([unkeyed, a, newer], ORIGIN);
    expect(s.version_lineages).toHaveLength(1);
    expect(currentOf(s, a)).toMatchObject({ is_current: false, reason: 'SUPERSEDED' });
    expect(currentOf(s, newer)).toMatchObject({ is_current: true, reason: 'NEWEST' });
  });

  it('an older acquisition whose chunk set is byte-identical to the newest one is CONTENT_IDENTICAL_TO_NEWEST — current, not superseded — and the lineage reports it', async () => {
    const key = 'sgu:v';
    const base = { source_id: SGU.source_id, doc_name: 'v', version_lineage_key: key };
    // Two harvests of the same page whose HTML differs only in a nonce the extractor strips: different
    // raw bytes (different document ids), identical projected text, identical admitted chunks.
    const first = await doc({
      ...base,
      bytes: bytesOf(`${STANDARD_TEXT}<!-- nonce 1 -->`),
      preextracted_text: STANDARD_TEXT,
      acquisition: { acquired_at: '2026-08-19T13:45:33.671Z' },
    });
    const second = await doc({
      ...base,
      bytes: bytesOf(`${STANDARD_TEXT}<!-- nonce 2 -->`),
      preextracted_text: STANDARD_TEXT,
      acquisition: { acquired_at: '2026-08-19T13:45:33.844Z' },
    });
    expect(first.document_id).not.toBe(second.document_id);
    expect(first.chunk_set_content_hash).toBe(second.chunk_set_content_hash);
    const s = buildCorpusSnapshot([first, second], ORIGIN);
    const lineage = s.version_lineages[0]!;
    expect(lineage.content_identical_members).toBe(1);
    expect(currentOf(s, second)).toMatchObject({ is_current: true, reason: 'NEWEST' });
    expect(currentOf(s, first)).toMatchObject({ is_current: true, reason: 'CONTENT_IDENTICAL_TO_NEWEST' });
    // A genuinely different older version is still superseded.
    const older = await doc({
      ...base,
      bytes: bytesOf(`${STANDARD_TEXT}\n\nGammal utgåva.`),
      acquisition: { acquired_at: '2026-01-01T00:00:00.000Z' },
    });
    const s2 = buildCorpusSnapshot([first, second, older], ORIGIN);
    expect(currentOf(s2, older)).toMatchObject({ is_current: false, reason: 'SUPERSEDED' });
  });

  it('calendar-invalid instants are undated (ambiguous), not silently normalized', async () => {
    expect(acquiredAtMs('2026-02-30T00:00:00Z')).toBeNull();
    expect(acquiredAtMs('2026-09-06T24:00:00Z')).toBeNull();
    expect(acquiredAtMs('2026-13-01T00:00:00Z')).toBeNull();
    expect(acquiredAtMs('2026-09-06T00:00:00+25:00')).toBeNull();
    expect(acquiredAtMs('2024-02-29T00:00:00Z')).toBe(Date.UTC(2024, 1, 29));
    expect(acquiredAtMs('2026-09-06T02:00:00+02:00')).toBe(Date.UTC(2026, 8, 6, 0, 0, 0));
    const base = { source_id: SGU.source_id, doc_name: 'v', version_lineage_key: 'k' };
    const bad = await doc({
      ...base,
      bytes: bytesOf(STANDARD_TEXT),
      acquisition: { acquired_at: '2026-02-30T00:00:00Z' },
    });
    const good = await doc({
      ...base,
      bytes: bytesOf(`${STANDARD_TEXT}\n\nReviderad.`),
      acquisition: { acquired_at: '2026-01-01T00:00:00Z' },
    });
    const s = buildCorpusSnapshot([bad, good], ORIGIN);
    expect(s.version_lineages[0]!.ambiguous_current).toBe(true);
    expect(currentOf(s, good)).toMatchObject({ is_current: false, reason: 'AMBIGUOUS' });
  });

  it('a full rank tie between byte-identical replays (no quarantine id, same name and instant) is still order-insensitive', async () => {
    const url = 'https://a.example/x';
    const x = await doc({
      source_id: SGU.source_id,
      doc_name: 'v',
      bytes: bytesOf(STANDARD_TEXT),
      acquisition: { acquired_at: '2026-08-01T00:00:00.000Z', source_url: url },
      source_version_label: 'label-X',
    });
    const y = await doc({
      source_id: SGU.source_id,
      doc_name: 'v',
      bytes: bytesOf(STANDARD_TEXT),
      acquisition: { acquired_at: '2026-08-01T00:00:00.000Z', source_url: url },
      source_version_label: 'label-Y',
    });
    const other = await doc({
      source_id: SGU.source_id,
      doc_name: 'v',
      bytes: bytesOf(`${STANDARD_TEXT}\n\nReviderad.`),
      acquisition: { acquired_at: '2026-09-01T00:00:00.000Z', source_url: url },
    });
    const xy = buildCorpusSnapshot([x, y, other], ORIGIN);
    const yx = buildCorpusSnapshot([y, x, other], ORIGIN);
    expect(yx.snapshot_identity).toBe(xy.snapshot_identity);
    expect(yx.documents.find((d) => d.document_id === x.document_id)!.source_version_label).toBe(
      xy.documents.find((d) => d.document_id === x.document_id)!.source_version_label,
    );
    expect(xy.version_lineages).toHaveLength(1);
  });
});
