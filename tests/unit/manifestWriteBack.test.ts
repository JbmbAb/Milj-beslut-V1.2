import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  formatQaError,
  mergeManifestQaUpdate,
  resolveManifestRemotePath,
  updateManifestStateLocal,
} from '../../scripts/import/utils/manifestWriteBack';
import { buildArchiveManifestV2 } from '../../scripts/import/types/manifestSchema.ts';

describe('manifestWriteBack', () => {
  it('resolveManifestRemotePath handles nested dataset paths', () => {
    expect(resolveManifestRemotePath('Lantmateriet', 'KommunHistorik/krok', '2026-06-22')).toBe(
      'drive:GEO_Master_Archive/Data/Lantmateriet/KommunHistorik/krok/2026-06-22/manifest.json',
    );
  });

  it('mergeManifestQaUpdate sets qa fields without dropping core hash', () => {
    const base = buildArchiveManifestV2({
      provider: 'SGU',
      dataset: 'Brunnar',
      version: '2026-06-22',
      total_bytes: 1,
      files: ['Brunnar.gpkg'],
      content_bundle_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      provenance: 'test',
    });
    const merged = mergeManifestQaUpdate(base, {
      qa_status: 'failed',
      qa_at: '2026-06-23T14:48:00.000Z',
      qa_error: "SCHEMA_MISMATCH: Missing required column 'andamal'",
    });
    expect(merged.qa_status).toBe('failed');
    expect(merged.qa_at).toBe('2026-06-23T14:48:00.000Z');
    expect(merged.content_bundle_sha256).toBe(base.content_bundle_sha256);
  });

  it('formatQaError includes code when present', () => {
    const err = Object.assign(new Error('boom'), { code: 'SCHEMA_MISMATCH' });
    expect(formatQaError(err)).toBe('[SCHEMA_MISMATCH] boom');
  });

  it('updateManifestStateLocal writes qa_status to manifest.json on disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-local-'));
    const manifestPath = path.join(dir, 'manifest.json');
    const base = buildArchiveManifestV2({
      provider: 'Lantmateriet',
      dataset: 'Test',
      version: '2026-06-18',
      total_bytes: 1,
      files: ['raw/test.gpkg'],
      content_bundle_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      provenance: 'test',
      qa_status: 'pending',
    });
    fs.writeFileSync(manifestPath, JSON.stringify(base, null, 2), 'utf8');

    const updated = updateManifestStateLocal(manifestPath, base, {
      qa_status: 'passed',
      qa_at: '2026-06-23T21:30:00.000Z',
    });

    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { qa_status: string; qa_at: string };
    expect(updated.qa_status).toBe('passed');
    expect(onDisk.qa_status).toBe('passed');
    expect(onDisk.qa_at).toBe('2026-06-23T21:30:00.000Z');
  });
});
