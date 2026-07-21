import { describe, expect, it } from 'vitest';
import {
  getImportableLastkajenJobs,
  LASTKAJEN_IMPORT_JOBS,
} from '../../server/datasources/lastkajenImportManifest';
import { LASTKAJEN_MAP_LAYERS } from '../../server/datasources/lastkajenLayerCatalog';

describe('lastkajenLayerCatalog', () => {
  it('har unika layer keys och tabeller', () => {
    const keys = LASTKAJEN_MAP_LAYERS.map((l) => l.key);
    const tables = LASTKAJEN_MAP_LAYERS.map((l) => `${l.schema}.${l.table}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it('exponerar importjobb för vilt och ATK', () => {
    expect(LASTKAJEN_IMPORT_JOBS.find((j) => j.key === 'tv_viltolycka_vag')?.mode).toBe('vilt_hotspots');
    expect(LASTKAJEN_IMPORT_JOBS.find((j) => j.key === 'tv_atk_matplats')?.mode).toBe('single_gpkg_zip');
    expect(getImportableLastkajenJobs().length).toBeGreaterThanOrEqual(10);
  });

  it('skippar vilt historik (10175) i import och kartlager', () => {
    const hist = LASTKAJEN_IMPORT_JOBS.find((j) => j.key === 'tv_viltolycka_vag_hist');
    expect(hist?.skipImport).toBe(true);
    expect(getImportableLastkajenJobs().some((j) => j.key === 'tv_viltolycka_vag_hist')).toBe(false);
    expect(LASTKAJEN_MAP_LAYERS.some((l) => l.key === 'tv_viltolycka_vag_hist')).toBe(false);
  });
});
