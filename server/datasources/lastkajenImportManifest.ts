/**
 * Importmanifest för alla Lastkajen-paket under storage/ingest/lastkajen/.
 * En post = ett PostGIS-mål (tabell) och ev. kartlager.
 */

import type { DatasetLayerGeometry, DatasetLayerStyle } from './platformMapLayerRegistry';

export type LastkajenImportMode =
  | 'single_gpkg_zip'
  | 'merge_gpkg_zips'
  | 'per_gpkg_zip'
  | 'multi_layer_gpkg'
  | 'vilt_hotspots'
  | 'filegdb_in_zip';

export interface LastkajenImportJob {
  key: string;
  label: string;
  packageId: number;
  mode: LastkajenImportMode;
  table: string;
  geometry: DatasetLayerGeometry;
  style: DatasetLayerStyle;
  minZoom?: number;
  /** Välj zip i paketmappen (första träffen). */
  zipGlob?: RegExp;
  /** Exakt filnamn om glob inte används. */
  zipFile?: string;
  innerGpkgPath?: string | ((zipBaseName: string) => string);
  layerName?: string;
  /** per_gpkg_zip: tabellsuffix från zip-filnamn */
  tableSuffixFromZip?: (zipName: string) => string;
  /** merge/per_gpkg_zip: filter på zip-filer i mappen */
  zipFilter?: RegExp;
  /** vilt_hotspots: Viltolyckskartor_* mönster */
  viltPattern?: RegExp;
  /** filegdb_in_zip: sökväg till .gdb i zip */
  gdbPathInZip?: string | ((zipBaseName: string) => string);
  /** multi_layer: importera alla datalager (ej layer_styles) */
  importAllLayers?: boolean;
  /**
   * Importera inte till PostGIS. Paketet kan finnas kvar som råarkiv under storage/ingest/.
   * Används t.ex. för legacy-format som kräver separat importpipeline.
   */
  skipImport?: boolean;
}

export const LASTKAJEN_IMPORT_JOBS: LastkajenImportJob[] = [
  {
    key: 'tv_isa_hastighet',
    label: 'ISA hastighet väg (Trafikverket)',
    packageId: 5052,
    mode: 'single_gpkg_zip',
    zipGlob: /^ISA_GPKG_.*\.zip$/i,
    innerGpkgPath: 'ISA.gpkg',
    layerName: 'ISA',
    table: 'transport.tv_isa_hastighet',
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_atk_matplats',
    label: 'ATK matplats (Trafikverket)',
    packageId: 10139,
    mode: 'single_gpkg_zip',
    zipFile: 'ATK_matplats_GeoPackage.zip',
    layerName: 'ATK_matplats',
    table: 'transport.tv_atk_matplats',
    geometry: 'point',
    style: 'default_point',
    minZoom: 9,
  },
  {
    key: 'tv_trafikplats_vag',
    label: 'Trafikplats väg (Trafikverket)',
    packageId: 10092,
    mode: 'single_gpkg_zip',
    zipGlob: /Trafikplats_vag_GeoPackage\.zip$/i,
    layerName: 'Trafikplats_vag',
    table: 'transport.tv_trafikplats_vag',
    geometry: 'mixed',
    style: 'default_polygon',
    minZoom: 10,
  },
  {
    key: 'tv_trafikplats_jvg',
    label: 'Trafikplats järnväg (Trafikverket)',
    packageId: 10091,
    mode: 'single_gpkg_zip',
    zipGlob: /Trafikplats_j.*GeoPackage\.zip$/i,
    layerName: 'Trafikplats_jvg_förenklad',
    table: 'transport.tv_trafikplats_jvg',
    geometry: 'mixed',
    style: 'default_polygon',
    minZoom: 10,
  },
  {
    key: 'tv_rastplats',
    label: 'Rastplats (Trafikverket)',
    packageId: 10140,
    mode: 'single_gpkg_zip',
    zipGlob: /Rastplats_GeoPackage\.zip$/i,
    layerName: 'Rastplats',
    table: 'transport.tv_rastplats',
    geometry: 'point',
    style: 'default_point',
    minZoom: 10,
  },
  {
    key: 'tv_cykelvagnat',
    label: 'Cykelvägnät (Trafikverket)',
    packageId: 10124,
    mode: 'single_gpkg_zip',
    zipGlob: /Cykel.*GeoPackage\.zip$/i,
    table: 'transport.tv_cykelvagnat',
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_viltolycka_vag',
    label: 'Viltolyckor väg – hotspots (Trafikverket)',
    packageId: 10094,
    mode: 'vilt_hotspots',
    viltPattern: /^Viltolyckskartor_.*_\d+\.zip$/i,
    table: 'transport.tv_viltolycka_vag_hotspot',
    geometry: 'line',
    style: 'default_line',
    minZoom: 9,
  },
  {
    key: 'tv_viltolycka_vag_hist',
    label: 'Viltolyckor väg – hotspots historik (Trafikverket)',
    packageId: 10175,
    mode: 'vilt_hotspots',
    viltPattern: /^Viltolyckskartor_.*_\d+\.zip$/i,
    table: 'transport.tv_viltolycka_vag_hotspot_hist',
    geometry: 'line',
    style: 'default_line',
    minZoom: 9,
    skipImport: true,
  },
  {
    key: 'tv_vagbelaggning',
    label: 'Vägbeläggning per län (Trafikverket)',
    packageId: 10125,
    mode: 'merge_gpkg_zips',
    zipFilter: /gpkg/i,
    table: 'transport.tv_vagbelaggning',
    geometry: 'line',
    style: 'default_line',
    minZoom: 12,
  },
  {
    key: 'tv_tillganglighetsvagnat',
    label: 'Tillgänglighetsvägnät historik (Trafikverket)',
    packageId: 10142,
    mode: 'merge_gpkg_zips',
    zipFilter: /^Tillganglighetsvagnat_/i,
    table: 'transport.tv_tillganglighetsvagnat',
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_vagdata_transportplanering',
    label: 'Vägdata transportplanering (Trafikverket)',
    packageId: 10084,
    mode: 'multi_layer_gpkg',
    zipGlob: /Geopackage\.zip$/i,
    table: 'transport.lk_10084',
    importAllLayers: true,
    geometry: 'mixed',
    style: 'default_line',
    minZoom: 10,
  },
  {
    key: 'tv_drift_underhall',
    label: 'Drift och underhåll NVDB (Trafikverket)',
    packageId: 10085,
    mode: 'multi_layer_gpkg',
    zipGlob: /GeoPackage\.zip$/i,
    innerGpkgPath: 'SverigePaket Drift och Underhåll_GeoPackage.gpkg',
    table: 'transport.lk_10085_dou',
    importAllLayers: true,
    geometry: 'mixed',
    style: 'default_polygon',
    minZoom: 11,
  },
  {
    key: 'tv_noise_layers',
    label: 'Buller HH (Trafikverket)',
    packageId: 10088,
    mode: 'per_gpkg_zip',
    zipFilter: /_gpkg\.zip$/i,
    table: 'transport.lk_10088_noise',
    tableSuffixFromZip: (n) => n.replace(/\.zip$/i, '').toLowerCase(),
    geometry: 'polygon',
    style: 'default_polygon',
    minZoom: 10,
  },
  {
    key: 'tv_tn_road',
    label: 'TN väg INSPIRE (Trafikverket)',
    packageId: 10096,
    mode: 'per_gpkg_zip',
    zipFilter: /TN_ROAD_.*_gpkg\.zip$/i,
    table: 'transport.lk_10096_tn_road',
    tableSuffixFromZip: (n) => n.replace(/_gpkg\.zip$/i, '').toLowerCase(),
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_tn_rail',
    label: 'TN järnväg INSPIRE (Trafikverket)',
    packageId: 10095,
    mode: 'per_gpkg_zip',
    zipFilter: /TN_RAIL_.*_gpkg\.zip$/i,
    table: 'transport.lk_10095_tn_rail',
    tableSuffixFromZip: (n) => n.replace(/_gpkg\.zip$/i, '').toLowerCase(),
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_vagnummer',
    label: 'Vägnummer (Trafikverket)',
    packageId: 10093,
    mode: 'per_gpkg_zip',
    zipFilter: /GeoPackage\.zip$/i,
    table: 'transport.lk_10093_vagnummer',
    tableSuffixFromZip: (n) => n.replace(/_GeoPackage\.zip$/i, '').toLowerCase(),
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_nvdb_utvald',
    label: 'NVDB utvald riksdata (Trafikverket)',
    packageId: 10180,
    mode: 'per_gpkg_zip',
    zipFilter: /GeoPackage\.zip$/i,
    table: 'transport.lk_10180_nvdb',
    tableSuffixFromZip: (n) => n.replace(/_GeoPackage\.zip$/i, '').toLowerCase(),
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_jvg_bandel',
    label: 'Järnvägsnät bandel aggregat (Trafikverket)',
    packageId: 10143,
    mode: 'single_gpkg_zip',
    zipGlob: /bandel_aggregat_GeoPackage\.zip$/i,
    table: 'transport.tv_jvg_bandel_aggregat',
    geometry: 'line',
    style: 'default_line',
    minZoom: 10,
  },
  {
    key: 'tv_jvg_grund',
    label: 'Järnvägsnät grundegenskaper (Trafikverket)',
    packageId: 10144,
    mode: 'per_gpkg_zip',
    zipFilter: /GeoPackage\.zip$/i,
    table: 'transport.lk_10144_jvg',
    tableSuffixFromZip: (n) => n.replace(/_GeoPackage\.zip$/i, '').toLowerCase(),
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_jvg_langdmätning',
    label: 'Järnvägsnät längdmätning (Trafikverket)',
    packageId: 10145,
    mode: 'single_gpkg_zip',
    zipGlob: /GeoPackage\.zip$/i,
    table: 'transport.tv_jvg_langdmatning',
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_barriaranalys',
    label: 'Barriärkartor större däggdjur (Trafikverket)',
    packageId: 10177,
    mode: 'multi_layer_gpkg',
    zipGlob: /Barri.*2024\.zip$/i,
    innerGpkgPath: 'Geopackagefiler/Barriaranalys.gpkg',
    table: 'transport.lk_10177_barriar',
    importAllLayers: true,
    geometry: 'mixed',
    style: 'default_line',
    minZoom: 10,
  },
  {
    key: 'tv_hojddata_vagnat',
    label: 'Höjddata statligt vägnät (Trafikverket)',
    packageId: 10181,
    mode: 'single_gpkg_zip',
    zipGlob: /Höjddata.*\.zip$/i,
    innerGpkgPath: (base) => base.replace(/\.zip$/i, '.gpkg'),
    table: 'transport.tv_hojddata_vagnat',
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_vagtrummor_punkt',
    label: 'Vägtrummor punkter (Trafikverket)',
    packageId: 10472,
    mode: 'merge_gpkg_zips',
    zipFilter: /län\.zip$/i,
    innerGpkgPath: (base) => base.replace(/\.zip$/i, '.gpkg'),
    table: 'transport.tv_vagtrummor_punkt',
    geometry: 'point',
    style: 'default_point',
    minZoom: 12,
  },
  {
    key: 'tv_vagtrummor_linje',
    label: 'Vägtrummor linjer (Trafikverket)',
    packageId: 10473,
    mode: 'merge_gpkg_zips',
    zipFilter: /län\.zip$/i,
    innerGpkgPath: (base) => base.replace(/\.zip$/i, '.gpkg'),
    table: 'transport.tv_vagtrummor_linje',
    geometry: 'line',
    style: 'default_line',
    minZoom: 12,
  },
  {
    key: 'tv_blaljus_nav',
    label: 'Blåljusnavigering (Trafikverket)',
    packageId: 10498,
    mode: 'single_gpkg_zip',
    zipGlob: /rescue vehicle navigation\.zip$/i,
    table: 'transport.tv_blaljus_nav',
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_viltolycka_jvg',
    label: 'Viltolyckor järnväg (Trafikverket)',
    packageId: 10178,
    mode: 'filegdb_in_zip',
    zipGlob: /Viltolyckskartor_j.*\.zip$/i,
    gdbPathInZip: (base) => {
      const folder = base.replace(/\.zip$/i, '');
      return `${folder}/Viltolyckor_jarnvag_201923.gdb`;
    },
    table: 'transport.tv_viltolycka_jvg',
    geometry: 'line',
    style: 'default_line',
    minZoom: 10,
  },
  {
    key: 'tv_blaljus_trafiknat',
    label: 'Trafiknät blåljus (Trafikverket)',
    packageId: 10169,
    mode: 'merge_gpkg_zips',
    zipFilter: /Blaljus.*\.zip$/i,
    table: 'transport.tv_blaljus_trafiknat',
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_water_transport',
    label: 'Sjöfart INSPIRE (Trafikverket)',
    packageId: 10089,
    mode: 'per_gpkg_zip',
    zipFilter: /_gpkg\.zip$/i,
    table: 'transport.lk_10089_water',
    tableSuffixFromZip: (n) => n.replace(/_gpkg\.zip$/i, '').toLowerCase(),
    geometry: 'line',
    style: 'water',
    minZoom: 11,
  },
  {
    key: 'tv_barriaranalys_2021',
    label: 'Barriärkartor 2021 (Trafikverket)',
    packageId: 10499,
    mode: 'multi_layer_gpkg',
    zipGlob: /Barri.*2021\.zip$/i,
    innerGpkgPath: 'Geopackagefiler/Barriaranalys.gpkg',
    table: 'transport.lk_10499_barriar',
    importAllLayers: true,
    geometry: 'mixed',
    style: 'default_line',
    minZoom: 10,
  },
  {
    key: 'tv_virkesupplag_vagar',
    label: 'Vägar utan länsvis tillstånd virkesupplag (Trafikverket)',
    packageId: 10497,
    mode: 'merge_gpkg_zips',
    zipFilter: /virkesupplag.*\.zip$/i,
    table: 'transport.tv_virkesupplag_vagar',
    geometry: 'line',
    style: 'default_line',
    minZoom: 11,
  },
  {
    key: 'tv_vilt_ren_jvg',
    label: 'Vilt- och renolyckor järnväg (Trafikverket)',
    packageId: 10179,
    mode: 'merge_gpkg_zips',
    zipFilter: /^Vilt-.*\.zip$/i,
    table: 'transport.tv_vilt_ren_jvg',
    geometry: 'line',
    style: 'default_line',
    minZoom: 10,
  },
];

/** Jobb som ska köras mot PostGIS (exkluderar skipImport). */
export function getImportableLastkajenJobs(jobs: LastkajenImportJob[] = LASTKAJEN_IMPORT_JOBS): LastkajenImportJob[] {
  return jobs.filter((job) => !job.skipImport);
}

export function listLastkajenImportJobsForPackage(packageId: number): LastkajenImportJob[] {
  return getImportableLastkajenJobs().filter((j) => j.packageId === packageId);
}
