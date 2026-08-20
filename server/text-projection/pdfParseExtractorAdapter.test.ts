import { describe, it, expect } from 'vitest';

import { PdfParseExtractorAdapter } from './pdfParseExtractorAdapter';
import { HTML_EXTRACT_ADAPTER_VERSION } from './versions';

/**
 * LEGAL-CORPUS-MATERIALIZATION-V1 (part A) — governed HTML projection.
 *
 * Root problem this closes: the governed TEXT-L1 path previously did `buffer.toString('utf8')`
 * for text/html, returning raw markup (tags included) as "projected text" -- and, separately,
 * one of our proven-live sources (sgu-well-drilling-guidance) demonstrated a server-generated
 * random UUID inside navigation markup that changes on every fetch. Fixing this at the download
 * layer would mean normalizing raw observation, which HTML-SOURCE-STABILITY-01 explicitly
 * deferred. This is the correct layer: raw quarantine bytes stay exactly what the server sent;
 * only the TEXT-L1 projection derived from them changes.
 */
describe('PdfParseExtractorAdapter — governed HTML projection', () => {
  const adapter = new PdfParseExtractorAdapter();
  const source = { ref: { artifact_id: 'a', artifact_type: 'x' }, doc_name: 'd', mime_type: 'text/html' };

  function html(navId: string, body: string): Uint8Array {
    return new TextEncoder().encode(
      `<!doctype html><html><head><title>T</title></head><body>` +
        `<nav id="navigation-list__737--${navId}" data-render-id="${navId}"><a>Meny</a></nav>` +
        `<main><p>${body}</p></main></body></html>`,
    );
  }

  it('same HTML in -> same projected text and hash-relevant version', async () => {
    const bytes = html('6f66b3b1-5da2-472b-b99f-d6ae31354cb5', 'Vägledning för att borra brunn.');

    const a = await adapter.extract(source, bytes);
    const b = await adapter.extract(source, bytes);

    expect(a.text).toBe(b.text);
    expect(a.version).toBe(HTML_EXTRACT_ADAPTER_VERSION);
    expect(a.method).toBe('html');
  });

  it('a different server-generated nav UUID (the observed volatility) -> identical projected text', async () => {
    const first = html('6f66b3b1-5da2-472b-b99f-d6ae31354cb5', 'Vägledning för att borra brunn.');
    const second = html('d3df1c39-a614-4630-a572-2eb575c866a9', 'Vägledning för att borra brunn.');

    const a = await adapter.extract(source, first);
    const b = await adapter.extract(source, second);

    expect(a.text).toBe(b.text);
    expect(a.text).not.toContain('6f66b3b1');
    expect(b.text).not.toContain('d3df1c39');
  });

  it('a genuine change to the actual body text -> different projected text', async () => {
    const first = html('same-uuid', 'Vägledning för att borra brunn.');
    const second = html('same-uuid', 'Uppdaterad vägledning om filterrör.');

    const a = await adapter.extract(source, first);
    const b = await adapter.extract(source, second);

    expect(a.text).not.toBe(b.text);
  });

  it('strips tags/scripts/styles but preserves the legal/guidance text content', async () => {
    const bytes = new TextEncoder().encode(
      '<html><head><style>.x{color:red}</style><script>track()</script></head>' +
        '<body><p>Grundvatten ska skyddas.</p></body></html>',
    );

    const result = await adapter.extract(source, bytes);

    expect(result.text).toContain('Grundvatten ska skyddas.');
    expect(result.text).not.toContain('<p>');
    expect(result.text).not.toContain('track()');
    expect(result.text).not.toContain('color:red');
  });

  it('never mutates the raw input bytes', async () => {
    const bytes = html('untouched-id', 'Original text.');
    const before = new Uint8Array(bytes);

    await adapter.extract(source, bytes);

    expect(bytes).toEqual(before);
  });
});
