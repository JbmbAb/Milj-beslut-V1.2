/**
 * Canonical import registry — manifest dataset → PostGIS target + QA contract.
 *
 * Väg B (STAC): 290 kommun-ZIP under Data/LM/STAC_Archive/* merges via
 * merge-stac-national.ts → Data/Lantmateriet/*_Nationell/<dataset>/<version>/raw/*.gpkg
 * Librarian importerar sedan den nationella GPKG som vilken annan fil som helst.
 */

export interface TargetConfig {
  target_schema: string;
  target_table: string;
}

export type ImportTier = 1 | 2 | 3;

export interface StacMergeProfile {
  /** Folder under GEO_Master_Archive/Data/LM/STAC_Archive/ */
  stac_archive_folder: string;
  /** Layer name inside each municipal GeoPackage */
  ogr_layer: string;
  /** Output file name (placed under <version>/raw/) */
  output_gpkg: string;
}

export interface ImportRegistryEntry extends TargetConfig {
  expected_columns: readonly string[];
  tier?: ImportTier;
  ogr_layer?: string;
  primary_format?: 'gpkg' | 'geojson' | 'shp';
  source_url?: string;
  license?: string;
  stac_merge?: StacMergeProfile;
  /** Alternate manifest `dataset` values resolving to this entry */
  aliases?: readonly string[];
}

const LM_FASTIGHET_YTOR_COLUMNS = [
  'objektidentitet',
  'registerenhetsreferens',
  'etikett',
  'kommunnamn',
  'trakt',
] as const;

const LM_FASTIGHET_LINJER_COLUMNS = [
  'objektidentitet',
  'registerenhetsreferens',
  'etikett',
  'kommunnamn',
  'trakt',
  'objekttyp',
] as const;

const LM_BYGGNAD_COLUMNS = [
  'objektidentitet',
  'versiongiltigfran',
  'objekttyp',
  'huvudbyggnad',
  'andamal1',
] as const;

const LM_MARK_COLUMNS = ['objektidentitet', 'versiongiltigfran', 'objekttyp', 'vattenytaid'] as const;

const MCF_STABILITY_PILOT_COLUMNS = ['kommun_namn', 'zon_typ'] as const;

const SGU_BRUNNAR_COLUMNS = [
  'brunnsid',
  'obsplatsid',
  'fastighet',
  'kapacitet',
  'totaldjup',
  'anvandning',
] as const;

const SGU_JORDART_25K_COLUMNS = ['jg2', 'jg2_tx', 'kartering', 'karttyp', 'symbol'] as const;

const SGU_JORDSKRED_COLUMNS = ['objectid', 'sl', 'sl_tx', 'symbol'] as const;

const SGU_FASTMARK_COLUMNS = ['objectid', 'fastmark', 'fastmark_tx'] as const;

const SGU_GRUNDVATTEN_COLUMNS = [
  'unik_magasinsidentitet',
  'magasinsidentitet',
  'magasinsnamn',
  'grvbildningstyp',
  'akvifertyp',
] as const;

const SGU_AKTSAMHET_COLUMNS = ['objectid', 'aktskre', 'aktskre_tx'] as const;

const SGU_JORDDJUP_10M_COLUMNS = ['djup', 'avslut'] as const;

const SGU_JORDDJUP_BERGYTA_COLUMNS = ['djup', 'avslut'] as const;

const SGU_EROSION_AKTIV_COLUMNS = ['sl', 'sl_tx'] as const;

const SGU_BLOCKIGHET_750K_COLUMNS = ['bl', 'bl_tx'] as const;

const SGU_LANDFORM_750K_COLUMNS = ['lf', 'lf_tx'] as const;

function entry(
  config: Omit<ImportRegistryEntry, 'expected_columns'> & { expected_columns: readonly string[] },
): ImportRegistryEntry {
  return config;
}

export const IMPORT_REGISTRY: Record<string, Record<string, ImportRegistryEntry>> = {
  Lantmateriet: {
    'Fastighetsindelning/Registerenhetsomradesytor': entry({
      target_schema: 'env',
      target_table: 'registerenhetsomradesytor',
      expected_columns: LM_FASTIGHET_YTOR_COLUMNS,
      tier: 1,
      ogr_layer: 'registerenhetsomradesyta',
      primary_format: 'gpkg',
      source_url:
        'https://api.lantmateriet.se/stac-vektor/v1/collections/fastighetsindelning',
      license: 'CC0',
    }),
    'Fastighetsindelning_Nationell/Registerenhetsomradesytor': entry({
      target_schema: 'env',
      target_table: 'registerenhetsomradesytor',
      expected_columns: LM_FASTIGHET_YTOR_COLUMNS,
      tier: 1,
      ogr_layer: 'registerenhetsomradesyta',
      primary_format: 'gpkg',
      source_url:
        'https://api.lantmateriet.se/stac-vektor/v1/collections/fastighetsindelning',
      license: 'CC0',
      stac_merge: {
        stac_archive_folder: 'fastighetsindelning',
        ogr_layer: 'registerenhetsomradesyta',
        output_gpkg: 'registerenhetsomradesytor_nationell.gpkg',
      },
      aliases: ['Fastighetsindelning/Registerenhetsomradesytor'],
    }),
    'Fastighetsindelning/Registerenhetsomradeslinjer': entry({
      target_schema: 'env',
      target_table: 'registerenhetsomradeslinjer',
      expected_columns: LM_FASTIGHET_LINJER_COLUMNS,
      tier: 2,
      ogr_layer: 'registerenhetsomradeslinje',
      primary_format: 'gpkg',
      source_url:
        'https://api.lantmateriet.se/stac-vektor/v1/collections/fastighetsindelning',
      license: 'CC0',
    }),
    'Fastighetsindelning_Nationell/Registerenhetsomradeslinjer': entry({
      target_schema: 'env',
      target_table: 'registerenhetsomradeslinjer',
      expected_columns: LM_FASTIGHET_LINJER_COLUMNS,
      tier: 2,
      ogr_layer: 'registerenhetsomradeslinje',
      primary_format: 'gpkg',
      source_url:
        'https://api.lantmateriet.se/stac-vektor/v1/collections/fastighetsindelning',
      license: 'CC0',
      stac_merge: {
        stac_archive_folder: 'fastighetsindelning',
        ogr_layer: 'registerenhetsomradeslinje',
        output_gpkg: 'registerenhetsomradeslinjer_nationell.gpkg',
      },
    }),
    'Byggnader_Nationell/Byggnad': entry({
      target_schema: 'topo10',
      target_table: 'byggnad',
      expected_columns: LM_BYGGNAD_COLUMNS,
      tier: 1,
      ogr_layer: 'byggnad',
      primary_format: 'gpkg',
      source_url: 'https://api.lantmateriet.se/stac-vektor/v1/collections/byggnader',
      license: 'CC0',
      stac_merge: {
        stac_archive_folder: 'byggnader',
        ogr_layer: 'byggnad',
        output_gpkg: 'byggnad_nationell.gpkg',
      },
    }),
    'Marktacke_Nationell/Mark': entry({
      target_schema: 'env',
      target_table: 'marktacke',
      expected_columns: LM_MARK_COLUMNS,
      tier: 1,
      ogr_layer: 'mark',
      primary_format: 'gpkg',
      source_url: 'https://api.lantmateriet.se/stac-vektor/v1/collections/marktacke',
      license: 'CC0',
      stac_merge: {
        stac_archive_folder: 'marktacke',
        ogr_layer: 'mark',
        output_gpkg: 'marktacke_nationell.gpkg',
      },
    }),
  },
  SGU: {
    Brunnar: entry({
      target_schema: 'env',
      target_table: 'sgu_well',
      expected_columns: SGU_BRUNNAR_COLUMNS,
      tier: 1,
      ogr_layer: 'brunnar',
      primary_format: 'gpkg',
      source_url: 'https://api.sgu.se/oppnadata/brunnar/ogc/features/v1/collections/brunnar',
      license: 'CC BY 4.0',
      aliases: ['brunnar', 'Legacy_Archive/Brunnar'],
    }),
    Jordarters25k100k: entry({
      target_schema: 'env',
      target_table: 'sgu_soil_type_25k_100k',
      expected_columns: SGU_JORDART_25K_COLUMNS,
      tier: 1,
      ogr_layer: 'grundlager',
      primary_format: 'gpkg',
      source_url: 'https://resource.sgu.se/data/oppnadata/jordarter25k-100k/jordarter25k-100k.zip',
      license: 'CC BY 4.0',
      aliases: ['jordarter25k-100k', 'Jordarter25k100k', 'Legacy_Archive/Jordarter25k100k'],
    }),
    Jorddjup10m: entry({
      target_schema: 'env',
      target_table: 'sgu_jorddjupsmodell_10m',
      expected_columns: SGU_JORDDJUP_10M_COLUMNS,
      tier: 2,
      ogr_layer: 'underlag_jorddjup',
      primary_format: 'gpkg',
      source_url: 'https://resource.sgu.se/data/oppnadata/jorddjupsmodell/jorddjupsmodell.zip',
      license: 'CC0',
      aliases: ['Legacy_Archive/Jorddjup10m', 'jorddjupsmodell'],
    }),
    JorddjupBergyta50m: entry({
      target_schema: 'env',
      target_table: 'sgu_jorddjupsmodell_bergyta_50m',
      expected_columns: SGU_JORDDJUP_BERGYTA_COLUMNS,
      tier: 2,
      ogr_layer: 'underlag_jorddjup',
      primary_format: 'gpkg',
      source_url: 'https://resource.sgu.se/data/oppnadata/jorddjupsmodell/jorddjupsmodell.zip',
      license: 'CC0',
      aliases: ['Legacy_Archive/JorddjupBergyta50m'],
    }),
    StranderosionAktiv: entry({
      target_schema: 'env',
      target_table: 'sgu_erosion_aktiv',
      expected_columns: SGU_EROSION_AKTIV_COLUMNS,
      tier: 2,
      ogr_layer: 'aktiv_erosion',
      primary_format: 'gpkg',
      source_url: 'https://resource.sgu.se/data/oppnadata/stranderosion-kust/stranderosion-kust.zip',
      license: 'CC BY 4.0',
      aliases: ['stranderosion-kust', 'aktiv_erosion'],
    }),
    Jordarter750kBlockighet: entry({
      target_schema: 'env',
      target_table: 'sgu_blockighet_750k',
      expected_columns: SGU_BLOCKIGHET_750K_COLUMNS,
      tier: 2,
      ogr_layer: 'blockighet',
      primary_format: 'gpkg',
      source_url: 'https://resource.sgu.se/data/oppnadata/jordarter750k/jordarter750k.zip',
      license: 'CC BY 4.0',
      aliases: ['jordarter750k', 'Legacy_Archive/Jordarter750k'],
    }),
    Jordarter750kLandform: entry({
      target_schema: 'env',
      target_table: 'sgu_landform_750k',
      expected_columns: SGU_LANDFORM_750K_COLUMNS,
      tier: 2,
      ogr_layer: 'landform',
      primary_format: 'gpkg',
      source_url: 'https://resource.sgu.se/data/oppnadata/jordarter750k/jordarter750k.zip',
      license: 'CC BY 4.0',
      aliases: ['Legacy_Archive/Jordarter750kLandform'],
    }),
    Fastmark: entry({
      target_schema: 'env',
      target_table: 'sgu_fastmark_stabilitet',
      expected_columns: SGU_FASTMARK_COLUMNS,
      tier: 1,
      ogr_layer: 'fastmark',
      primary_format: 'gpkg',
      source_url: 'https://api.sgu.se/oppnadata/fastmark/ogc/features/v1/collections/fastmark',
      license: 'CC BY 4.0',
      aliases: ['fastmark', 'Legacy_Archive/Fastmark'],
    }),
    Grundvatten: entry({
      target_schema: 'env',
      target_table: 'env_sgu_grundvatten_sarbarhet',
      expected_columns: SGU_GRUNDVATTEN_COLUMNS,
      tier: 1,
      ogr_layer: 'grundvattenmagasin',
      primary_format: 'gpkg',
      source_url:
        'https://api.sgu.se/oppnadata/grundvattenmagasin/ogc/features/v1/collections/grundvattenmagasin',
      license: 'CC BY 4.0',
      aliases: ['grundvattenmagasin', 'Legacy_Archive/Grundvatten'],
    }),
    Jordskred: entry({
      target_schema: 'env',
      target_table: 'sgu_landslide_feature',
      expected_columns: SGU_JORDSKRED_COLUMNS,
      tier: 1,
      ogr_layer: 'jordskred_raviner',
      primary_format: 'gpkg',
      source_url:
        'https://api.sgu.se/oppnadata/jordskred-raviner/ogc/features/v1/collections/jordskred-raviner',
      license: 'CC BY 4.0',
      aliases: ['jordskred-raviner', 'Legacy_Archive/Jordskred'],
    }),
    AktsamhetEfterarbetad: entry({
      target_schema: 'env',
      target_table: 'sgu_aktsamhet_efterarbetad',
      expected_columns: SGU_AKTSAMHET_COLUMNS,
      tier: 1,
      ogr_layer: 'aktsam_efterarbetad',
      primary_format: 'gpkg',
      source_url:
        'https://api.sgu.se/oppnadata/forutsattningar-skred-finkornig-jordart/ogc/features/v1/collections/aktsam-efterarbetad',
      license: 'CC BY 4.0',
      aliases: ['Legacy_Archive/AktsamhetEfterarbetad'],
    }),
  },
  Naturvardsverket: {
    'SkyddadeOmraden/Naturreservat': entry({
      target_schema: 'env',
      target_table: 'protected_area',
      expected_columns: ['nvr_id', 'namn', 'skyddstyp', 'forvaltare'],
      tier: 2,
      primary_format: 'shp',
    }),
    'Natura2000/Omrade': entry({
      target_schema: 'env',
      target_table: 'natura2000_area',
      expected_columns: ['sitecode', 'sitename', 'spa_code'],
      tier: 2,
      primary_format: 'shp',
    }),
    'Vatten/Vattenskyddsomrade': entry({
      target_schema: 'env',
      target_table: 'water_protection_area',
      expected_columns: ['vso_id', 'namn', 'skyddstyp'],
      tier: 1,
      primary_format: 'shp',
    }),
  },
  MSB: {
    PFRA_PastEvent: entry({
      target_schema: 'env',
      target_table: 'msb_pfra_pastevent',
      expected_columns: ['objektid', 'handelse_ar'],
      tier: 2,
    }),
    StoraOlyckor: entry({
      target_schema: 'env',
      target_table: 'msb_stora_olyckor',
      expected_columns: ['objektid', 'olyckstyp'],
      tier: 2,
    }),
    Stabilitetszon: entry({
      target_schema: 'env',
      target_table: 'msb_stabilitetszon',
      expected_columns: ['zon_id', 'klass'],
      tier: 2,
    }),
    FloodRisk: entry({
      target_schema: 'climate',
      target_table: 'flood_risk_area',
      expected_columns: ['riskklass', 'scenario'],
      tier: 2,
    }),
  },
  MCF: {
    'finkorniga-jordar-pilot': entry({
      target_schema: 'env',
      target_table: 'msb_stabilitetszon_mcf_pilot',
      expected_columns: MCF_STABILITY_PILOT_COLUMNS,
      tier: 2,
      ogr_layer: 'stabilitetszon',
      primary_format: 'gpkg',
      source_url: 'https://lastkaj.mcf.se/Karteringar/finkorniga-jordar/',
      license: 'CC0',
    }),
  },
  legacy_adopted: {
    InspireMSB_PFRA_PastEvent: entry({
      target_schema: 'env',
      target_table: 'msb_pfra_pastevent',
      expected_columns: ['objektid'],
      tier: 3,
    }),
    InspireMSB_StoraOlyckor: entry({
      target_schema: 'env',
      target_table: 'msb_stora_olyckor',
      expected_columns: ['objektid'],
      tier: 3,
    }),
    jorddjupsmodell_10x10m: entry({
      target_schema: 'env',
      target_table: 'sgu_jorddjupsmodell_10m',
      expected_columns: SGU_JORDDJUP_10M_COLUMNS,
      tier: 3,
    }),
    jorddjupsmodell_bergyta_hojd_50x50m: entry({
      target_schema: 'env',
      target_table: 'sgu_jorddjupsmodell_bergyta_50m',
      expected_columns: SGU_JORDDJUP_BERGYTA_COLUMNS,
      tier: 3,
    }),
    SVARO_2016: entry({
      target_schema: 'env',
      target_table: 'svaro_2016',
      expected_columns: ['aro_id', 'namn'],
      tier: 3,
    }),
    'vm.VISS_SW_VARO_2016_1_RISK_TOTALT': entry({
      target_schema: 'env',
      target_table: 'viss_sw_varo_risk',
      expected_columns: ['viss_id', 'riskklass'],
      tier: 3,
    }),
  },
};

/** Reverse lookup: alias → canonical registry key per provider */
const ALIAS_INDEX: Map<string, Map<string, string>> = (() => {
  const index = new Map<string, Map<string, string>>();
  for (const [provider, datasets] of Object.entries(IMPORT_REGISTRY)) {
    const providerMap = new Map<string, string>();
    for (const [datasetKey, config] of Object.entries(datasets)) {
      for (const alias of config.aliases ?? []) {
        providerMap.set(normalizeDatasetKey(alias), datasetKey);
      }
    }
    index.set(provider, providerMap);
  }
  return index;
})();

function normalizeDatasetKey(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, '/');
}

function resolveDatasetKey(provider: string, dataset: string): string | null {
  const providerConfigs = IMPORT_REGISTRY[provider];
  if (!providerConfigs) return null;

  if (providerConfigs[dataset]) return dataset;

  const normalized = normalizeDatasetKey(dataset);
  for (const key of Object.keys(providerConfigs)) {
    if (normalizeDatasetKey(key) === normalized) return key;
  }

  const aliasHit = ALIAS_INDEX.get(provider)?.get(normalized);
  if (aliasHit && providerConfigs[aliasHit]) return aliasHit;

  return null;
}

/**
 * Slår upp full registry-post utifrån provider och dataset name.
 */
export function getRegistryEntry(provider: string, dataset: string): ImportRegistryEntry {
  const datasetKey = resolveDatasetKey(provider, dataset);
  const providerConfigs = IMPORT_REGISTRY[provider];

  if (!providerConfigs || !datasetKey) {
    throw new Error(`Dataset "${dataset}" for provider "${provider}" is not registered in Import Registry.`);
  }

  return providerConfigs[datasetKey];
}

/**
 * Slår upp target config utifrån provider och dataset name.
 * Kastar ett fel om datasetet inte är registrerat, vilket skyddar mot okända manifests.
 */
export function getTargetConfig(provider: string, dataset: string): TargetConfig {
  const entry = getRegistryEntry(provider, dataset);
  return {
    target_schema: entry.target_schema,
    target_table: entry.target_table,
  };
}

export function getExpectedColumns(provider: string, dataset: string): readonly string[] {
  return getRegistryEntry(provider, dataset).expected_columns;
}

export function listRegistryEntries(filter?: { tier?: ImportTier; provider?: string }): Array<{
  provider: string;
  dataset: string;
  entry: ImportRegistryEntry;
}> {
  const rows: Array<{ provider: string; dataset: string; entry: ImportRegistryEntry }> = [];
  for (const [provider, datasets] of Object.entries(IMPORT_REGISTRY)) {
    if (filter?.provider && provider !== filter.provider) continue;
    for (const [dataset, entry] of Object.entries(datasets)) {
      if (filter?.tier !== undefined && entry.tier !== filter.tier) continue;
      rows.push({ provider, dataset, entry });
    }
  }
  return rows.sort((a, b) =>
    `${a.provider}/${a.dataset}`.localeCompare(`${b.provider}/${b.dataset}`, 'sv'),
  );
}

export function listStacMergeProfiles(): Array<{
  provider: string;
  dataset: string;
  entry: ImportRegistryEntry;
  profile: StacMergeProfile;
}> {
  return listRegistryEntries({ provider: 'Lantmateriet' })
    .filter((row): row is typeof row & { entry: ImportRegistryEntry & { stac_merge: StacMergeProfile } } =>
      Boolean(row.entry.stac_merge),
    )
    .map((row) => ({
      provider: row.provider,
      dataset: row.dataset,
      entry: row.entry,
      profile: row.entry.stac_merge,
    }));
}

export function listStacMergeEntriesForFolder(stacArchiveFolder: string): Array<{
  provider: string;
  dataset: string;
  entry: ImportRegistryEntry;
  profile: StacMergeProfile;
}> {
  const folder = normalizeDatasetKey(stacArchiveFolder);
  return listStacMergeProfiles().filter(
    (row) => normalizeDatasetKey(row.profile.stac_archive_folder) === folder,
  );
}

export function resolveStacMergeEntry(
  stacArchiveFolder: string,
  dataset?: string,
): {
  provider: string;
  dataset: string;
  entry: ImportRegistryEntry;
  profile: StacMergeProfile;
} | null {
  const matches = listStacMergeEntriesForFolder(stacArchiveFolder);
  if (matches.length === 0) return null;

  if (dataset) {
    const datasetKey = resolveDatasetKey('Lantmateriet', dataset);
    const hit = matches.find((row) => row.dataset === datasetKey);
    return hit ?? null;
  }

  if (matches.length === 1) return matches[0];

  const preferred = matches.find(
    (row) => row.dataset === 'Fastighetsindelning_Nationell/Registerenhetsomradesytor',
  );
  if (preferred) return preferred;

  throw new Error(
    `Ambiguous STAC folder "${stacArchiveFolder}" maps to ${matches.length} merge profiles. ` +
      `Pass --dataset explicitly. Options: ${matches.map((m) => m.dataset).join(', ')}`,
  );
}

export function resolveStacMergeEntryByDataset(dataset: string): {
  provider: string;
  dataset: string;
  entry: ImportRegistryEntry;
  profile: StacMergeProfile;
} | null {
  const datasetKey = resolveDatasetKey('Lantmateriet', dataset);
  if (!datasetKey) return null;
  return listStacMergeProfiles().find((row) => row.dataset === datasetKey) ?? null;
}
