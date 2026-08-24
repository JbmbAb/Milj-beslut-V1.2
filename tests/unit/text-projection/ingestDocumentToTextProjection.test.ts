import { describe, it, expect } from 'vitest';
import { createGovernedTextIngestion, ingestDocumentToTextProjection } from '../../../server/text-projection/createGovernedTextIngestion';

/**
 * DOCUMENT-SOURCE-TO-TEXT-PROJECTION-V1.
 *
 * Focused, repeatable proof of the exact functions
 * scripts/ops/prove-document-source-to-text-projection-01.ts uses against a REAL quarantined
 * MMOD PDF (that script proved the real end-to-end run: 85,480 chars extracted, deterministic
 * content_hash, no OCR needed -- see its own output). This test proves the same contract
 * (determinism, source binding, no fabricated hash) against small, deterministic input so it
 * stays fast and repeatable in CI without depending on real quarantine state.
 */
describe('DOCUMENT-SOURCE-TO-TEXT-PROJECTION-V1: ingestDocumentToTextProjection', () => {
  const source = {
    ref: { artifact_id: 'quarantine-item-test-1', artifact_type: 'RAW_SOURCE' },
    bytes_content_hash: { algorithm: 'sha256' as const, value: 'a'.repeat(64) },
    doc_name: 'MMOD_test_decision.pdf',
    source_system: 'domstolsverket-puh-mmod',
    mime_type: 'application/pdf',
  };

  it('ingestDocumentToTextProjection (the exact function the ops script uses): binds source_artifact_ref and produces a real, non-placeholder content_hash', async () => {
    const deterministicExtractor = {
      extract: async () => ({ method: 'pdf_parse' as const, version: 'test-fixture-v1', text: 'Mark- och miljööverdomstolen fastställer beslutet.', succeeded: true }),
    };
    const result = await ingestDocumentToTextProjection({
      source,
      bytes: new Uint8Array([1, 2, 3]),
      options: { deps: { extractor: deterministicExtractor, enable_ocr_fallback: false } },
    });

    expect(result.projection.source_artifact_ref).toEqual(source.ref);
    expect(result.projection.contract_id).toBe('text_projection');
    expect(result.projection.content_hash.value).toMatch(/^[0-9a-f]{64}$/);
    // The KNOWN_BROKEN DocumentEvidenceService placeholder this unit must never reproduce.
    expect(result.projection.content_hash.value).not.toBe('uncalculated');
  });

  it('binds source_artifact_ref to the caller-supplied source.ref, and is deterministic across two independent runs', async () => {
    const pipeline = createGovernedTextIngestion();
    const text = 'Mark- och miljööverdomstolen fastställer underinstansens beslut. Prövningstillstånd meddelas inte.';

    const run1 = await pipeline.ingest({ source, preextracted_text: text });
    const run2 = await pipeline.ingest({ source, preextracted_text: text });

    expect(run1.projection.content_hash.value).toBe(run2.projection.content_hash.value);
    expect(run1.projection.source_artifact_ref).toEqual(source.ref);
    expect(run1.projection.char_count).toBe(text.length);
  });

  it('a different source text produces a different content_hash (not a constant/fabricated value)', async () => {
    const pipeline = createGovernedTextIngestion();

    const runA = await pipeline.ingest({ source, preextracted_text: 'Text A.' });
    const runB = await pipeline.ingest({ source, preextracted_text: 'Text B, helt annan.' });

    expect(runA.projection.content_hash.value).not.toBe(runB.projection.content_hash.value);
  });
});
