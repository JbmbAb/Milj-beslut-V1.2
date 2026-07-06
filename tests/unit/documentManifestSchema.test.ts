import { describe, expect, it } from 'vitest';
import {
  ensureDocumentManifestV2,
  isDocumentManifestV2,
  supersedeDocument,
  validateDocumentManifest,
} from '../../scripts/import/types/documentManifestSchema.ts';

const BASE_DOC_MANIFEST = {
  document_id: 'doc-viss-gv-2026-v1.4',
  provider: 'VISS',
  dataset: 'Grundvattenutredningar',
  filename: 'VISS_Guide_2026.pdf',
  source_url: 'https://viss.lansstyrelsen.se/VISS_Guide_2026.pdf',
  version: '1.4',
  publish_date: '2025-11-12',
  validity_period: { from: '2026-01-01', to: null },
  downloaded_at: '2026-07-04T14:43:34Z',
  sha256: '8f3e23456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  superseded_by: null,
};

describe('documentManifestSchema', () => {
  it('identifies valid v2 document manifests', () => {
    const valid: any = {
      schema_version: '2.0',
      ...BASE_DOC_MANIFEST,
    };
    expect(isDocumentManifestV2(valid)).toBe(true);
  });

  it('validates a correct document manifest structure', () => {
    const res = validateDocumentManifest(BASE_DOC_MANIFEST);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.manifest.schema_version).toBe('2.0');
      expect(res.manifest.document_id).toBe('doc-viss-gv-2026-v1.4');
      expect(res.manifest.superseded_by).toBeNull();
    }
  });

  it('rejects invalid document manifests', () => {
    const invalid = {
      ...BASE_DOC_MANIFEST,
      document_id: '', // Empty ID
    };
    const res = validateDocumentManifest(invalid);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors).toContain('missing or invalid document_id');
    }
  });

  it('upgrades legacy v1 document manifests to v2', () => {
    const legacy = {
      provider: 'SGU',
      filename: 'SGU_Report.pdf',
      version: '1.0',
    };
    const upgraded = ensureDocumentManifestV2(legacy);
    expect(upgraded.schema_version).toBe('2.0');
    expect(upgraded.document_id).toBe('doc-sgu-sgu-report-pdf');
    expect(upgraded.dataset).toBe('Legacy_Documents');
    expect(upgraded.superseded_by).toBeNull();
  });

  it('supports version superseding', () => {
    const original: any = {
      schema_version: '2.0',
      ...BASE_DOC_MANIFEST,
    };
    const superseded = supersedeDocument(original, 'doc-viss-gv-2027-v2.0');
    expect(superseded.superseded_by).toBe('doc-viss-gv-2027-v2.0');
    expect(superseded.validity_period.to).toBe(new Date().toISOString().substring(0, 10));
  });
});
