import { beforeEach, describe, expect, it, vi } from 'vitest';

const ksamsokMock = vi.hoisted(() => ({
  searchKsamsokBoundingBox: vi.fn(),
}));
const raaMock = vi.hoisted(() => ({
  getRaaFornlamningFeatureCollectionForBbox: vi.fn(),
}));

vi.mock('../../server/services/ksamsokService', () => ksamsokMock);
vi.mock('../../server/services/publicUiService', () => raaMock);

import { buildCulturalEnvironmentDownloadBundle } from '../../server/services/culturalEnvironmentBundleService';
import {
  isSubPath,
  resolveImportArchiveRoot,
  resolveImportCacheRoot,
  resolveImportSourceRoot,
  resolveKnowledgeBaseRoot,
  resolveReimportScanRoots,
} from '../../server/services/importPathService';

describe('zero/low coverage services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('buildCulturalEnvironmentDownloadBundle aggregates ksamsok + raa + catalog', async () => {
    ksamsokMock.searchKsamsokBoundingBox.mockResolvedValueOnce({ ok: true, data: { hits: 1 } });
    raaMock.getRaaFornlamningFeatureCollectionForBbox.mockResolvedValueOnce({
      features: [{ type: 'Feature' }],
      meta: { layers: ['fornlamning'] },
    });

    const bundle = await buildCulturalEnvironmentDownloadBundle({
      bbox: { minLat: 59, minLng: 17, maxLat: 60, maxLng: 18 },
      dataportalQuery: 'fornlamning',
    });

    expect(bundle.ksamsok.ok).toBe(true);
    expect(bundle.raaWfs.featureCount).toBe(1);
    expect(bundle.dataportal.searchQuery).toBe('fornlamning');
    expect(bundle.mapLayersWithDocumentation.length).toBeGreaterThan(0);
    expect(typeof bundle.generatedAt).toBe('string');
  });

  it('buildCulturalEnvironmentDownloadBundle surfaces ksamsok errors', async () => {
    ksamsokMock.searchKsamsokBoundingBox.mockResolvedValueOnce({ ok: false, error: 'timeout' });
    raaMock.getRaaFornlamningFeatureCollectionForBbox.mockResolvedValueOnce({
      features: [],
      meta: {},
    });

    const bundle = await buildCulturalEnvironmentDownloadBundle({
      bbox: { minLat: 59, minLng: 17, maxLat: 60, maxLng: 18 },
    });

    expect(bundle.ksamsok).toEqual({ ok: false, error: 'timeout' });
  });

  it('importPathService resolves roots and subpaths', () => {
    vi.stubEnv('KNOWLEDGE_BASE_ROOT', 'C:/kb');
    vi.stubEnv('IMPORT_ARCHIVE_ROOT', 'C:/archive');
    vi.stubEnv('IMPORT_SOURCE_ROOT', 'C:/sources');
    vi.stubEnv('IMPORT_CACHE_ROOT', 'C:/cache');
    vi.stubEnv('IMPORT_REIMPORT_SCAN_ROOTS', 'C:/one;C:/two');

    expect(resolveKnowledgeBaseRoot()).toContain('kb');
    expect(resolveImportArchiveRoot()).toContain('archive');
    expect(resolveImportSourceRoot()).toContain('sources');
    expect(resolveImportCacheRoot()).toContain('cache');
    expect(resolveReimportScanRoots()).toEqual(expect.arrayContaining([expect.stringContaining('one')]));

    expect(isSubPath('C:/parent', 'C:/parent/child/file.txt')).toBe(true);
    expect(isSubPath('C:/parent', 'C:/other/file.txt')).toBe(false);
  });
});
