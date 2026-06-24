import { describe, expect, it } from 'vitest';
import {
  getExpectedColumns,
  getRegistryEntry,
  getTargetConfig,
  listRegistryEntries,
  listStacMergeProfiles,
  resolveStacMergeEntry,
} from '../../scripts/import/config/importRegistry';

describe('importRegistry', () => {
  it('resolves legacy LM fastighetsytor path', () => {
    const entry = getRegistryEntry('Lantmateriet', 'Fastighetsindelning/Registerenhetsomradesytor');
    expect(entry.target_schema).toBe('env');
    expect(entry.target_table).toBe('registerenhetsomradesytor');
    expect(entry.expected_columns).toContain('etikett');
    expect(entry.expected_columns).toContain('kommunnamn');
  });

  it('resolves STAC national merge dataset with profile', () => {
    const entry = getRegistryEntry(
      'Lantmateriet',
      'Fastighetsindelning_Nationell/Registerenhetsomradesytor',
    );
    expect(entry.stac_merge?.stac_archive_folder).toBe('fastighetsindelning');
    expect(entry.stac_merge?.output_gpkg).toBe('registerenhetsomradesytor_nationell.gpkg');
    expect(entry.ogr_layer).toBe('registerenhetsomradesyta');
  });

  it('resolves SGU aliases from promoted folder names', () => {
    expect(getTargetConfig('SGU', 'brunnar')).toEqual({
      target_schema: 'env',
      target_table: 'sgu_well',
    });
    expect(getExpectedColumns('SGU', 'jordarter25k-100k')).toContain('jg2');
    expect(getRegistryEntry('SGU', 'Legacy_Archive/Jordskred').target_table).toBe('sgu_landslide_feature');
  });

  it('lists tier-1 STAC + SGU entries', () => {
    const tier1 = listRegistryEntries({ tier: 1 });
    const keys = tier1.map((row) => `${row.provider}/${row.dataset}`);
    expect(keys).toContain('Lantmateriet/Fastighetsindelning_Nationell/Registerenhetsomradesytor');
    expect(keys).toContain('SGU/Brunnar');
    expect(keys).toContain('SGU/Jordskred');
  });

  it('maps STAC archive folder to merge profile', () => {
    const resolved = resolveStacMergeEntry('marktacke');
    expect(resolved?.dataset).toBe('Marktacke_Nationell/Mark');
    expect(resolved?.entry.target_table).toBe('marktacke');
    expect(listStacMergeProfiles()).toHaveLength(4);
  });

  it('throws for unknown provider/dataset', () => {
    expect(() => getRegistryEntry('Okand', 'Pony')).toThrow(/not registered/i);
  });
});
