import { describe, expect, it } from 'vitest';

import { admitWithPolicy, CHUNK_POLICY_LAW_V241, DEFAULT_CONTENT_BUDGET, projectDocument } from '../src';
import { bytesOf, fixtureCatalog, LAW_TEXT, SFS, SGU, STANDARD_TEXT, utf8Extractor } from './fixtures';

const deps = { catalog: fixtureCatalog(), extractor: utf8Extractor() };

describe('K2.2 corpus projection — input guards (round 2)', () => {
  it('a chunk_policy_version that is not a string is REJECTED_INPUT, never coerced into a registered label', async () => {
    const out = await projectDocument(
      {
        source_id: SFS.source_id,
        doc_name: 'sfst',
        bytes: bytesOf(LAW_TEXT),
        chunk_policy_version: [CHUNK_POLICY_LAW_V241] as never,
      },
      deps,
    );
    expect(out.kind).toBe('REJECTED_INPUT');
    expect(() =>
      admitWithPolicy({
        chunkPolicyVersion: [CHUNK_POLICY_LAW_V241] as never,
        structureKind: 'law',
        text: LAW_TEXT,
        sourceProjectionRef: 'sha256:x',
      }),
    ).toThrow(/must be a string label/);
    expect(() =>
      admitWithPolicy({
        chunkPolicyVersion: Symbol('x') as never,
        structureKind: 'law',
        text: LAW_TEXT,
        sourceProjectionRef: 'sha256:x',
      }),
    ).toThrow(/must be a string label/);
  });

  it('an empty or whitespace version_lineage_key / source_url is REJECTED_INPUT; keys are trimmed', async () => {
    for (const key of ['', ' ', '\n']) {
      const out = await projectDocument(
        { source_id: SGU.source_id, doc_name: 'v', bytes: bytesOf(STANDARD_TEXT), version_lineage_key: key },
        deps,
      );
      expect(out.kind, JSON.stringify(key)).toBe('REJECTED_INPUT');
    }
    const viaUrl = await projectDocument(
      {
        source_id: SGU.source_id,
        doc_name: 'v',
        bytes: bytesOf(STANDARD_TEXT),
        acquisition: { source_url: '   ' },
      },
      deps,
    );
    expect(viaUrl.kind).toBe('REJECTED_INPUT');
    const trimmed = await projectDocument(
      {
        source_id: SGU.source_id,
        doc_name: 'v',
        bytes: bytesOf(STANDARD_TEXT),
        version_lineage_key: '  k1  ',
      },
      deps,
    );
    expect(trimmed.kind === 'PROJECTED' && trimmed.document.version_lineage_key).toBe('k1');
  });

  it('acquisition metadata is copied field by field: arbitrary keys (including a JSON-parsed own __proto__) never reach the projection', async () => {
    const acquisition = JSON.parse(
      '{"acquired_at":"2026-08-01T00:00:00.000Z","__proto__":{"evil":1},"extra":"keep?"}',
    ) as Record<string, unknown>;
    const out = await projectDocument(
      {
        source_id: SGU.source_id,
        doc_name: 'v',
        bytes: bytesOf(STANDARD_TEXT),
        acquisition: acquisition as never,
      },
      deps,
    );
    expect(out.kind).toBe('PROJECTED');
    const a = out.kind === 'PROJECTED' ? out.document.acquisition! : undefined;
    expect(Object.keys(a!)).toEqual(['acquired_at']);
    expect(Object.hasOwn(a!, '__proto__')).toBe(false);
    expect((a as Record<string, unknown>).extra).toBeUndefined();
  });

  it('text/html bytes above the html budget are REJECTED_INPUT before the (quadratic) stripper runs; the same bytes as text/plain are governed by the raw budget only', async () => {
    const big = bytesOf('<html>' + '<script>'.repeat(DEFAULT_CONTENT_BUDGET.max_html_bytes / 8 + 8));
    const html = await projectDocument(
      { source_id: SGU.source_id, doc_name: 'page', mime_type: 'text/html', bytes: big },
      deps,
    );
    expect(html.kind).toBe('REJECTED_INPUT');
    expect(html.kind === 'REJECTED_INPUT' && html.detail).toMatch(/html budget/);
    const small = await projectDocument(
      {
        source_id: SGU.source_id,
        doc_name: 'page',
        mime_type: 'text/html',
        bytes: bytesOf('<html><body><p>Vägledning om brunnar.</p></body></html>'),
      },
      deps,
    );
    expect(small.kind).toBe('PROJECTED');
  });
});
