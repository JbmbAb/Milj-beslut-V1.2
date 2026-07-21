import { describe, expect, it } from 'vitest';
import {
  applyQaPatch,
  buildArchiveManifestV2,
  ensureArchiveManifestV2,
  isImportEligible,
  readQaStatus,
  validateArchiveManifestStructure,
} from '../../scripts/import/types/manifestSchema.ts';

const BASE = {
  provider: 'Lantmateriet',
  dataset: 'Byggnad',
  version: '2026-06-23',
  total_bytes: 100,
  files: ['byggnad.shp', 'byggnad.dbf'],
  content_bundle_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

describe('manifestSchema', () => {
  it('buildArchiveManifestV2 sets schema_version and pending qa_status', () => {
    const m = buildArchiveManifestV2({
      ...BASE,
      provenance: 'archive_manifest_audit_proposal',
    });
    expect(m.schema_version).toBe('2.0');
    expect(m.qa_status).toBe('pending');
    expect(m.provenance).toBe('archive_manifest_audit_proposal');
  });

  it('ensureArchiveManifestV2 upgrades legacy v1 proposals', () => {
    const v1 = {
      provider: 'SGU',
      dataset: 'Brunnar',
      version: '2026-06-22',
      provenance: 'archive_manifest_audit_proposal',
      content_bundle_sha256: BASE.content_bundle_sha256,
      files: ['Brunnar.gpkg'],
      total_bytes: 999,
      files_detail: [{ name: 'Brunnar.gpkg', sha256: BASE.content_bundle_sha256, size_bytes: 999 }],
    };
    const v2 = ensureArchiveManifestV2(v1);
    expect(v2.schema_version).toBe('2.0');
    expect(v2.qa_status).toBe('pending');
    expect(v2.files_detail).toHaveLength(1);
  });

  it('validateArchiveManifestStructure rejects empty files', () => {
    const result = validateArchiveManifestStructure({
      schema_version: '2.0',
      ...BASE,
      files: [],
      provenance: 'test',
      qa_status: 'pending',
    });
    expect(result.ok).toBe(false);
  });

  it('isImportEligible blocks failed manifests', () => {
    const failed = buildArchiveManifestV2({
      ...BASE,
      qa_status: 'failed',
      qa_error: 'SCHEMA_MISMATCH',
    });
    expect(isImportEligible(failed)).toBe(false);
    expect(readQaStatus(failed)).toBe('failed');
  });

  it('applyQaPatch writes qa_at and error', () => {
    const pending = buildArchiveManifestV2({ ...BASE, provenance: 'test' });
    const failed = applyQaPatch(pending, {
      qa_status: 'failed',
      qa_error: "Missing required column 'andamal'",
    });
    expect(failed.qa_status).toBe('failed');
    expect(failed.qa_at).toBeTruthy();
    expect(failed.qa_error).toContain('andamal');
  });
});
