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

export type PromoteStrategy = 'replace' | 'append';

export interface ImportRegistryEntry extends TargetConfig {
  expected_columns: readonly string[];
  tier?: ImportTier;
  ogr_layer?: string;
  primary_format?: 'gpkg' | 'geojson' | 'shp' | 'tif' | 'csv' | 'xyz';
  source_url?: string;
  license?: string;
  stac_merge?: StacMergeProfile;
  /** Alternate manifest `dataset` values resolving to this entry */
  aliases?: readonly string[];
  /** replace = TRUNCATE+INSERT (default); append = INSERT into existing prod table */
  promote_strategy?: PromoteStrategy;
  /** Force GDAL/ogr2ogr to invert axis order during import (e.g. for SGU Northing/Easting GPKGs) */
  invert_axis_order?: boolean;
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
    'Ortnamn_Nationell/Ortnamn': entry({
      target_schema: 'core',
      target_table: 'ortnamn',
      expected_columns: ['ortnamn', 'kommunkod', 'detaljtyp'],
      tier: 2,
      ogr_layer: 'ortnamn',
      primary_format: 'gpkg',
      source_url: 'https://api.lantmateriet.se/stac-vektor/v1/collections/ortnamn',
      license: 'CC0',
      stac_merge: {
        stac_archive_folder: 'ortnamn',
        ogr_layer: 'ortnamn',
        output_gpkg: 'ortnamn_nationell.gpkg',
      },
    }),
    'AdministrativIndelning_Nationell/Kommun': entry({
      target_schema: 'core',
      target_table: 'kommuner',
      expected_columns: ['objektidentitet', 'beslutatnamn', 'kommunkod'],
      tier: 2,
      ogr_layer: 'kommun',
      primary_format: 'gpkg',
      source_url: 'https://api.lantmateriet.se/stac-vektor/v1/collections/kommun-lan-rike',
      license: 'CC0',
      stac_merge: {
        stac_archive_folder: 'kommun-lan-rike',
        ogr_layer: 'kommun',
        output_gpkg: 'kommun_nationell.gpkg',
      },
    }),
    'AdministrativIndelning_Nationell/Lan': entry({
      target_schema: 'core',
      target_table: 'lan',
      expected_columns: ['objektidentitet', 'beslutatnamn', 'lanskod'],
      tier: 2,
      ogr_layer: 'lan',
      primary_format: 'gpkg',
      stac_merge: {
        stac_archive_folder: 'kommun-lan-rike',
        ogr_layer: 'lan',
        output_gpkg: 'lan_nationell.gpkg',
      },
    }),
    'AdministrativIndelning_Nationell/Rike': entry({
      target_schema: 'core',
      target_table: 'rike',
      expected_columns: ['objektidentitet', 'beslutatnamn'],
      tier: 2,
      ogr_layer: 'rike',
      primary_format: 'gpkg',
      stac_merge: {
        stac_archive_folder: 'kommun-lan-rike',
        ogr_layer: 'rike',
        output_gpkg: 'rike_nationell.gpkg',
      },
    }),
    'Belagenhetsadress_Nationell/Belagenhetsadress': entry({
      target_schema: 'core',
      target_table: 'belagenhetsadress',
      expected_columns: ['belagenhetsadress_objektidentitet', 'adressplatsnummer', 'postort', 'kommunkod'],
      tier: 2,
      ogr_layer: 'belagenhetsadress',
      primary_format: 'gpkg',
      source_url: 'https://api.lantmateriet.se/stac-vektor/v1/collections/belagenhetsadresser',
      license: 'CC0',
      stac_merge: {
        stac_archive_folder: 'belagenhetsadresser',
        ogr_layer: 'belagenhetsadress',
        output_gpkg: 'belagenhetsadress_nationell.gpkg',
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
      // Master GPKG layer name (not the older "grundlager" label)
      ogr_layer: 'Jordarter25k100k',
      primary_format: 'gpkg',
      source_url: 'https://resource.sgu.se/data/oppnadata/jordarter25k-100k/jordarter25k-100k.zip',
      license: 'CC BY 4.0',
      aliases: ['jordarter25k-100k', 'Jordarter25k100k', 'Legacy_Archive/Jordarter25k100k'],
      invert_axis_order: true,
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
    Kallor: entry({
      target_schema: 'env',
      target_table: 'sgu_kallor',
      expected_columns: ['id', 'namn', 'kommun', 'kalltyp', 'kalltyp_tx', 'akvtyp', 'obsdat', 'objectid'],
      tier: 2,
      ogr_layer: 'kallor',
      primary_format: 'gpkg',
      source_url: 'https://api.sgu.se/oppnadata/kallor/ogc/features/v1/collections/kallor',
      license: 'CC0 1.0',
    }),
    Borrhal: entry({
      target_schema: 'env',
      target_table: 'sgu_borrhal',
      expected_columns: ['idcode', 'name', 'drillhole', 'drillyear', 'tot_depth', 'commune'],
      tier: 2,
      ogr_layer: 'borrhal',
      primary_format: 'gpkg',
      source_url: 'https://api.sgu.se/oppnadata/borrhal/ogc/features/v1/collections/borrhal',
      license: 'CC0 1.0',
    }),
    Grundvattenforekomster: entry({
      target_schema: 'env',
      target_table: 'sgu_grundvattenforekomst',
      expected_columns: ['eu_cd', 'ms_cd', 'name', 'district', 'comp_auth', 'wb_type', 'url_viss'],
      tier: 2,
      ogr_layer: 'grundvattenforekomster',
      primary_format: 'gpkg',
      source_url:
        'https://api.sgu.se/oppnadata/grundvattenforekomster/ogc/features/v1/collections/grundvattenforekomster',
      license: 'CC0 1.0',
    }),
    MaringeologiYtsubstrat: entry({
      target_schema: 'env',
      target_table: 'sgu_maringeologi_ytsubstrat',
      expected_columns: ['ysub', 'ysub_txt', 'objectid'],
      tier: 2,
      ogr_layer: 'MaringeologiYtsubstrat',
      primary_format: 'gpkg',
      source_url: 'https://api.sgu.se/oppnadata/maringeologi25k/ogc/features/v1/collections/ytsubstrat',
      license: 'CC0 1.0',
    }),
    MiljogifterAnalysresultat: entry({
      target_schema: 'env',
      target_table: 'sgu_miljogifter_analys',
      expected_columns: [],
      tier: 2,
      ogr_layer: 'analysresultat',
      primary_format: 'gpkg',
      source_url: 'https://api.sgu.se/oppnadata/miljogifter-analysresultat-provplatser/ogc/features/v1/collections/analysresultat',
      license: 'CC0 1.0',
    }),
    MiljogifterProvplatser: entry({
      target_schema: 'env',
      target_table: 'sgu_miljogifter_provplats',
      expected_columns: [],
      tier: 2,
      ogr_layer: 'provplatser',
      primary_format: 'gpkg',
      source_url: 'https://api.sgu.se/oppnadata/miljogifter-analysresultat-provplatser/ogc/features/v1/collections/provplatser',
      license: 'CC0 1.0',
    }),
    HypeKlimatindikatorerHistorisk: entry({
      target_schema: 'env',
      target_table: 'sgu_hype_klimatindikatorer_historisk',
      expected_columns: [],
      tier: 2,
      ogr_layer: 'klimatindikatorer_historisk',
      primary_format: 'gpkg',
      source_url: 'https://api.sgu.se/oppnadata/klimatindikatorer-sgu-hype-omraden/ogc/features/v1/collections/klimatindikatorer-historisk',
      license: 'CC0 1.0',
    }),
    HypeKlimatindikatorerRcp: entry({
      target_schema: 'env',
      target_table: 'sgu_hype_klimatindikatorer_rcp',
      expected_columns: [],
      tier: 2,
      ogr_layer: 'klimatindikatorer_rcp',
      primary_format: 'gpkg',
      source_url: 'https://api.sgu.se/oppnadata/klimatindikatorer-sgu-hype-omraden/ogc/features/v1/collections/klimatindikatorer-rcp',
      license: 'CC0 1.0',
    }),
    FlygGammaOversiktlig: entry({
      target_schema: 'env',
      target_table: 'sgu_flyg_gamma_oversiktlig',
      expected_columns: ['e_swr99tm', 'n_swr99tm', 'k', 'u', 'th'],
      tier: 2,
      ogr_layer: 'geofysik_flyg_gammastralning_oversiktlig',
      primary_format: 'csv',
      source_url:
        'https://resource.sgu.se/data/oppnadata/geofysik-flyg-gammastralning-oversiktlig/geofysik-flyg-gammastralning-oversiktlig.zip',
      license: 'CC0 1.0',
    }),
    HypeOmraden: entry({
      target_schema: 'env',
      target_table: 'sgu_hype_omraden',
      expected_columns: [],
      tier: 2,
      ogr_layer: 'omraden',
      primary_format: 'gpkg',
      source_url: 'https://api.sgu.se/oppnadata/klimatindikatorer-sgu-hype-omraden/ogc/features/v1/collections/omraden',
      license: 'CC0 1.0',
    }),
    Genomslapplighet: entry({
      target_schema: 'env',
      target_table: 'sgu_permeability',
      expected_columns: [],
      tier: 2,
      ogr_layer: 'genomslapplighet',
      primary_format: 'gpkg',
      source_url: 'https://api.sgu.se/oppnadata/genomslapplighet/ogc/features/v1/collections/genomslapplighet',
      license: 'CC0 1.0',
      aliases: ['Genomsläpplighet'],
    }),
  },
  Naturvardsverket: {
    'SkyddadeOmraden/Naturreservat': entry({
      target_schema: 'env',
      target_table: 'protected_area',
      // NV SHP uses NVRID/NAMN/SKYDDSTYP/FORVALTARE (case-insensitive match)
      expected_columns: ['nvrid', 'namn', 'skyddstyp', 'forvaltare'],
      tier: 2,
      primary_format: 'shp',
    }),
    'Natura2000/Omrade': entry({
      target_schema: 'env',
      target_table: 'natura2000_area',
      // SPA rikstäckande SHP (Admit v1)
      expected_columns: ['site_code', 'namn'],
      tier: 2,
      primary_format: 'shp',
      aliases: ['Natura2000/SPA_Rikstackande', 'Natura2000/2026-05-08/SPA_Rikstackande'],
    }),
    'Vatten/Vattenskyddsomrade': entry({
      target_schema: 'env',
      target_table: 'water_protection_area',
      // NV VSO SHP — never VISS/lst_vattenskydd
      expected_columns: ['nvrid', 'namn', 'skyddstyp'],
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
    oversvamning_nationell: entry({
      target_schema: 'climate',
      target_table: 'flood_risk_area',
      expected_columns: ['return_period', 'typeofhazard', 'objectid', 'likelihoodofoccurence'],
      tier: 1,
      ogr_layer: 'oversvamningszon',
      primary_format: 'gpkg',
      source_url: 'https://inspire.msb.se/geoserver/oversvamning/wfs',
      promote_strategy: 'replace',
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
    'stabilitetskartering-nationell/finkorniga-jordar': entry({
      target_schema: 'env',
      target_table: 'msb_stabilitetszon',
      expected_columns: ['kommun_namn', 'zon_typ', 'kategori', 'source_zip'],
      tier: 2,
      ogr_layer: 'stabilitetszon',
      primary_format: 'gpkg',
      source_url: 'https://lastkaj.mcf.se/Karteringar/finkorniga-jordar/',
      license: 'CC0',
    }),
    'stabilitetskartering-nationell/oversiktlig-stabilitetskartering-finkorniga-jordarter': entry({
      target_schema: 'env',
      target_table: 'msb_stabilitetszon',
      expected_columns: ['kommun_namn', 'zon_typ', 'kategori', 'source_zip'],
      tier: 2,
      ogr_layer: 'stabilitetszon',
      primary_format: 'gpkg',
      promote_strategy: 'append',
    }),
    'stabilitetskartering-nationell/moran-grovkorninga-jordar': entry({
      target_schema: 'env',
      target_table: 'msb_stabilitetszon',
      expected_columns: ['kommun_namn', 'zon_typ', 'kategori', 'source_zip'],
      tier: 2,
      ogr_layer: 'stabilitetszon',
      primary_format: 'gpkg',
      promote_strategy: 'append',
    }),
    'stabilitetskartering-nationell/oversiktlig-stabilitetskartering-i-moran-och-grova-jordar': entry({
      target_schema: 'env',
      target_table: 'msb_stabilitetszon',
      expected_columns: ['kommun_namn', 'zon_typ', 'kategori', 'source_zip'],
      tier: 2,
      ogr_layer: 'stabilitetszon',
      primary_format: 'gpkg',
      promote_strategy: 'append',
    }),
  },
  VISS: {
    viss_vattenforekomster: entry({
      target_schema: 'env',
      target_table: 'viss_vattenforekomst',
      expected_columns: ['eu_cd', 'viss_lank'],
      tier: 1,
      ogr_layer: 'viss_vattenforekomster',
      primary_format: 'gpkg',
      source_url: 'https://ext-geodata.lansstyrelsen.se/viss/wfs',
    }),
    smed_belastning_vatten: entry({
      target_schema: 'env',
      target_table: 'smed_belastning_vatten',
      expected_columns: ['objektid'],
      tier: 2,
      ogr_layer: 'smed_belastning_vatten',
      primary_format: 'gpkg',
    }),
    lst_vattenskydd: entry({
      target_schema: 'env',
      target_table: 'water_protection_area',
      expected_columns: ['vso_id', 'namn'],
      tier: 1,
      ogr_layer: 'lst_vattenskydd',
      primary_format: 'gpkg',
    }),
  },
  SMHI: {
    huvudavrinningsomraden_svar_2022: entry({
      target_schema: 'hydro',
      target_table: 'huvudavrinningsomraden',
      expected_columns: ['gml_id', 'NAME', 'HARO'],
      tier: 1,
      ogr_layer: 'huvudavrinningsomraden',
      primary_format: 'gpkg',
      source_url:
        'https://opendata-view.smhi.se/SMHI_vatten_RiverBasin/HY.PhysicalWaters.Catchments/wfs',
    }),
    water_catchment_svar_2022: entry({
      target_schema: 'hydro',
      target_table: 'water_catchment',
      expected_columns: ['varoid', 'ms_cd', 'name', 'category', 'area'],
      tier: 1,
      ogr_layer: 'SVAR2022_Vattenförekomstavrinningsområden_2022',
      primary_format: 'gpkg',
    }),
  },
  LST: {
    EBH_Potentiellt_fororenade_omraden: entry({
      target_schema: 'env',
      target_table: 'ebh_potentiellt_fororenade_omraden',
      expected_columns: ['ebh_id', 'status'],
      tier: 1,
      ogr_layer: 'ebh_potentiellt_fororenade_omraden',
      primary_format: 'gpkg',
      source_url:
        'https://ext-dokument.lansstyrelsen.se/Gemensamt/Geodata/Datadistribution/SWEREF99TM/EBH_Potentiellt_fororenade_omraden.zip',
    }),
  },
  Skogsstyrelsen: {
    SksNyckelbiotoper: entry({
      target_schema: 'env',
      target_table: 'sks_nyckelbiotoper',
      expected_columns: [], // Skip exact column validation to be robust
      tier: 2,
      ogr_layer: 'NyckelbiotopYta',
      primary_format: 'gpkg',
      source_url: 'https://geodpags.skogsstyrelsen.se/geodataport/feeds/Nyckelbiotoper.xml',
      license: 'Öppen data (Skogsstyrelsen)',
    }),
    SksBiotopskydd: entry({
      target_schema: 'env',
      target_table: 'sks_biotopskydd',
      expected_columns: [],
      tier: 2,
      ogr_layer: 'BiotopskyddYta',
      primary_format: 'gpkg',
      source_url: 'https://geodpags.skogsstyrelsen.se/geodataport/feeds/biotopskydd.xml',
      license: 'Öppen data (Skogsstyrelsen)',
    }),
    SksNaturvardsavtal: entry({
      target_schema: 'env',
      target_table: 'sks_naturvardsavtal',
      expected_columns: [],
      tier: 2,
      ogr_layer: 'NaturvardsavtalYta',
      primary_format: 'gpkg',
      source_url: 'https://geodpags.skogsstyrelsen.se/geodataport/feeds/Naturvardsavtal.xml',
      license: 'Öppen data (Skogsstyrelsen)',
    }),
    SksAvverkningsanmalan: entry({
      target_schema: 'env',
      target_table: 'sks_avverkningsanmalan',
      expected_columns: [],
      tier: 2,
      ogr_layer: 'AvverkningsAnmalanYta',
      primary_format: 'gpkg',
      source_url: 'https://geodpags.skogsstyrelsen.se/geodataport/feeds/AvverkAnm.xml',
      license: 'Öppen data (Skogsstyrelsen)',
    }),
    SLUMarkfuktighetKlassad: entry({
      target_schema: 'env',
      target_table: 'sks_slu_markfuktighet_klassad',
      expected_columns: [],
      tier: 2,
      primary_format: 'tif',
      source_url: 'https://geodpags.skogsstyrelsen.se/geodataport/feeds/SLUMarkfuktighetKlassad.xml',
      license: 'Öppen data (SLU/Skogsstyrelsen)',
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
  /**
   * Trafikverket — county packs live under Data/Trafikverket/{Mätdata,Beläggning,Avvattning,Buller}/.
   * Per-county dataset keys are folder names; family keys below are canonical product types.
   * New provider folders require ARCHIVE_PROVIDERS + SAN registration (ProviderInvariant).
   */
  Trafikverket: {
    Matdata: entry({
      target_schema: 'env',
      target_table: 'tv_matdata',
      expected_columns: ['objektidentitet'],
      tier: 3,
      primary_format: 'gpkg',
      license: 'Trafikverket open data',
      aliases: ['Mätdata', 'matdata'],
    }),
    Belaggning: entry({
      target_schema: 'env',
      target_table: 'tv_belaggning',
      expected_columns: ['objektidentitet'],
      tier: 3,
      primary_format: 'gpkg',
      license: 'Trafikverket open data',
      aliases: ['Beläggning', 'belaggning'],
    }),
    Avvattning: entry({
      target_schema: 'env',
      target_table: 'tv_avvattning',
      expected_columns: ['objektidentitet'],
      tier: 3,
      primary_format: 'gpkg',
      license: 'Trafikverket open data',
      aliases: ['avvattning'],
    }),
    Buller: entry({
      target_schema: 'env',
      target_table: 'tv_buller',
      expected_columns: ['objektidentitet'],
      tier: 3,
      primary_format: 'gpkg',
      license: 'Trafikverket open data',
      aliases: [
        'HH_NOISE_ROAD_LDEN_gpkg',
        'HH_NOISE_ROAD_LNIGHT_gpkg',
        'HH_NOISE_RAIL_LDEN_gpkg',
        'HH_NOISE_RAIL_LNIGHT_gpkg',
        'HH_NOISE_AIR_LDEN_gpkg',
        'HH_NOISE_AIR_LNIGHT_gpkg',
      ],
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

function normalizeProvider(provider: string): string {
  const p = provider.trim().toLowerCase();
  if (p === 'lm') return 'Lantmateriet';
  if (p === 'naturvårdsverket' || p === 'naturvardsverket') return 'Naturvardsverket';
  if (p === 'trafikverket' || p === 'trv') return 'Trafikverket';
  for (const key of Object.keys(IMPORT_REGISTRY)) {
    if (key.toLowerCase() === p) return key;
  }
  return provider;
}

function resolveDatasetKey(provider: string, dataset: string): string | null {
  const normProvider = normalizeProvider(provider);
  const providerConfigs = IMPORT_REGISTRY[normProvider];
  if (!providerConfigs) return null;

  if (providerConfigs[dataset]) return dataset;

  const normalized = normalizeDatasetKey(dataset);
  for (const key of Object.keys(providerConfigs)) {
    if (normalizeDatasetKey(key) === normalized) return key;
  }

  const aliasHit = ALIAS_INDEX.get(normProvider)?.get(normalized);
  if (aliasHit && providerConfigs[aliasHit]) return aliasHit;

  return null;
}

/**
 * Slår upp full registry-post utifrån provider och dataset name.
 */
export function getRegistryEntry(provider: string, dataset: string): ImportRegistryEntry {
  const normProvider = normalizeProvider(provider);
  const datasetKey = resolveDatasetKey(normProvider, dataset);
  const providerConfigs = IMPORT_REGISTRY[normProvider];

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
