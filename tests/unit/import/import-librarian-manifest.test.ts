import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { findPrimaryFile } from '../../../scripts/import/import-librarian-manifest';
import { masterArchiveFixtureRoot } from '../../helpers/integrationAuth';

describe('import-librarian-manifest (offline file fixtures)', () => {
  it('findPrimaryFile resolves geojson from master-archive fixture', async () => {
    const dataDir = path.join(
      masterArchiveFixtureRoot(),
      'Data/Lantmateriet/Fastighetsindelning/Registerenhetsomradesytor',
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8'));

    const primary = await findPrimaryFile(manifest, dataDir);
    expect(primary).toContain('parcel.geojson');
  });

  it('findPrimaryFile rejects incomplete shapefile bundle', async () => {
    const manifest = {
      schema_version: '2.0' as const,
      provider: 'LM',
      dataset: 'Fastighet',
      version: '1',
      provenance: 'test',
      content_bundle_sha256: 'hash1',
      total_bytes: 0,
      files: ['fastighet.shp'],
      qa_status: 'pending' as const,
    };

    await expect(findPrimaryFile(manifest, '/data')).rejects.toThrow(
      'Shapefile bundle missing .shx or .dbf components!',
    );
  });
});
