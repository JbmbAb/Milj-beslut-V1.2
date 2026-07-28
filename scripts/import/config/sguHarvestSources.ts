/**
 * SGU harvest source catalog — ZIP-first where SGU publishes bulk downloads,
 * OGC API Features pagination as fallback.
 */

export type SguZipSource = {
  zipUrl: string;
  zipFileName: string;
  /** Path inside the ZIP archive (forward slashes). */
  innerGpkg: string;
  /** Primary layer for Librarian / registry import. */
  ogrLayer: string;
  /** Optional row-count QA against ogrinfo after extract. */
  expectedFeatureCount?: number;
};

export type SguHarvestSource = {
  /** Folder name under GEO_Master_Archive/Data/SGU/<id>/ */
  id: string;
  /** Key in importRegistry.ts (manifest.dataset). */
  registryDataset: string;
  license: string;
  /** OGC API Features collection URL (fallback / test harvest). */
  apiCollectionUrl?: string;
  zip?: SguZipSource;
};

export const SGU_HARVEST_SOURCES: SguHarvestSource[] = [
  {
    id: 'Jordarter25k100k',
    registryDataset: 'Jordarters25k100k',
    license: 'CC BY 4.0',
    apiCollectionUrl:
      'https://api.sgu.se/oppnadata/jordarter25k-100k/ogc/features/v1/collections/grundlager',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/jordarter25k-100k/jordarter25k-100k.zip',
      zipFileName: 'jordarter25k-100k.zip',
      innerGpkg: 'jordarter25k_100k.gpkg',
      ogrLayer: 'grundlager',
      expectedFeatureCount: 2_956_837,
    },
  },
  {
    id: 'Brunnar',
    registryDataset: 'Brunnar',
    license: 'CC BY 4.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/brunnar/ogc/features/v1/collections/brunnar',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/brunnar/brunnar.zip',
      zipFileName: 'brunnar.zip',
      innerGpkg: 'brunnar.gpkg',
      ogrLayer: 'brunnar',
      expectedFeatureCount: 836435,
    },
  },
  {
    id: 'Fastmark',
    registryDataset: 'Fastmark',
    license: 'CC BY 4.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/fastmark/ogc/features/v1/collections/fastmark',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/fastmark/fastmark.zip',
      zipFileName: 'fastmark.zip',
      innerGpkg: 'fastmark.gpkg',
      ogrLayer: 'fastmark',
      expectedFeatureCount: 2_956_837,
    },
  },
  {
    id: 'Grundvatten',
    registryDataset: 'Grundvatten',
    license: 'CC BY 4.0',
    apiCollectionUrl:
      'https://api.sgu.se/oppnadata/grundvattenmagasin/ogc/features/v1/collections/grundvattenmagasin',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/grundvattenmagasin/grundvattenmagasin.zip',
      zipFileName: 'grundvattenmagasin.zip',
      innerGpkg: 'grundvattenmagasin.gpkg',
      ogrLayer: 'grundvattenmagasin',
      expectedFeatureCount: 9368,
    },
  },
  {
    id: 'Jordskred',
    registryDataset: 'Jordskred',
    license: 'CC BY 4.0',
    apiCollectionUrl:
      'https://api.sgu.se/oppnadata/jordskred-raviner/ogc/features/v1/collections/jordskred-raviner',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/jordskred-raviner/jordskred-raviner.zip',
      zipFileName: 'jordskred-raviner.zip',
      innerGpkg: 'jordskred_raviner.gpkg',
      ogrLayer: 'jordskred_raviner',
      expectedFeatureCount: 50_373,
    },
  },
  {
    id: 'AktsamhetEfterarbetad',
    registryDataset: 'AktsamhetEfterarbetad',
    license: 'CC BY 4.0',
    apiCollectionUrl:
      'https://api.sgu.se/oppnadata/forutsattningar-skred-finkornig-jordart/ogc/features/v1/collections/aktsam-efterarbetad',
    zip: {
      zipUrl:
        'https://resource.sgu.se/data/oppnadata/forutsattningar-skred-finkornig-jordart/forutsattningar-skred-finkornig-jordart.zip',
      zipFileName: 'forutsattningar-skred-finkornig-jordart.zip',
      innerGpkg: 'forutsattningar_skred_finkornig_jordart.gpkg',
      ogrLayer: 'aktsam_efterarbetad',
      expectedFeatureCount: 242_296,
    },
  },
  {
    id: 'Jorddjupsmodell',
    registryDataset: 'Jorddjup10m',
    license: 'CC0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/jorddjupsmodell/ogc/features/v1',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/jorddjupsmodell/jorddjupsmodell.zip',
      zipFileName: 'jorddjupsmodell.zip',
      innerGpkg: 'jorddjupsmodell.gpkg',
      ogrLayer: 'underlag_jorddjup',
    },
  },
  {
    id: 'StranderosionKust',
    registryDataset: 'StranderosionAktiv',
    license: 'CC BY 4.0',
    apiCollectionUrl:
      'https://api.sgu.se/oppnadata/stranderosion-kust/ogc/features/v1/collections/aktiv-erosion',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/stranderosion-kust/stranderosion-kust.zip',
      zipFileName: 'stranderosion-kust.zip',
      innerGpkg: 'stranderosion_kust.gpkg',
      ogrLayer: 'aktiv_erosion',
    },
  },
  {
    id: 'Jordarter750kBlockighet',
    registryDataset: 'Jordarter750kBlockighet',
    license: 'CC BY 4.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/jordarter750k/ogc/features/v1/collections/blockighet',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/jordarter750k/jordarter750k.zip',
      zipFileName: 'jordarter750k.zip',
      innerGpkg: 'jordarter750k.gpkg',
      ogrLayer: 'blockighet',
    },
  },
  {
    id: 'Jordarter750kLandform',
    registryDataset: 'Jordarter750kLandform',
    license: 'CC BY 4.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/jordarter750k/ogc/features/v1/collections/landform',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/jordarter750k/jordarter750k.zip',
      zipFileName: 'jordarter750k.zip',
      innerGpkg: 'jordarter750k.gpkg',
      ogrLayer: 'landform',
    },
  },
  {
    id: 'Kallor',
    registryDataset: 'Kallor',
    license: 'CC0 1.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/kallor/ogc/features/v1/collections/kallor',
  },
  {
    id: 'Borrhal',
    registryDataset: 'Borrhal',
    license: 'CC0 1.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/borrhal/ogc/features/v1/collections/borrhal',
  },
  {
    id: 'Grundvattenforekomster',
    registryDataset: 'Grundvattenforekomster',
    license: 'CC0 1.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/grundvattenforekomster/ogc/features/v1/collections/grundvattenforekomster',
  },
  {
    id: 'MaringeologiYtsubstrat',
    registryDataset: 'MaringeologiYtsubstrat',
    license: 'CC0 1.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/maringeologi25k/ogc/features/v1/collections/ytsubstrat',
  },
  {
    id: 'MiljogifterAnalysresultat',
    registryDataset: 'MiljogifterAnalysresultat',
    license: 'CC0 1.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/miljogifter-analysresultat-provplatser/ogc/features/v1/collections/analysresultat',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/miljogifter-analysresultat-provplatser/miljogifter-analysresultat-provplatser.zip',
      zipFileName: 'miljogifter-analysresultat-provplatser.zip',
      innerGpkg: 'miljogifter_analysresultat_provplatser.gpkg',
      ogrLayer: 'analysresultat',
    },
  },
  {
    id: 'MiljogifterProvplatser',
    registryDataset: 'MiljogifterProvplatser',
    license: 'CC0 1.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/miljogifter-analysresultat-provplatser/ogc/features/v1/collections/provplatser',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/miljogifter-analysresultat-provplatser/miljogifter-analysresultat-provplatser.zip',
      zipFileName: 'miljogifter-analysresultat-provplatser.zip',
      innerGpkg: 'miljogifter_analysresultat_provplatser.gpkg',
      ogrLayer: 'provplatser',
    },
  },
  {
    id: 'HypeKlimatindikatorerHistorisk',
    registryDataset: 'HypeKlimatindikatorerHistorisk',
    license: 'CC0 1.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/klimatindikatorer-sgu-hype-omraden/ogc/features/v1/collections/klimatindikatorer-historisk',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/klimatindikatorer-sgu-hype-omraden/klimatindikatorer-sgu-hype-omraden.zip',
      zipFileName: 'klimatindikatorer-sgu-hype-omraden.zip',
      innerGpkg: 'klimatindikatorer_sgu_hype_omraden.gpkg',
      ogrLayer: 'klimatindikatorer-historisk',
    },
  },
  {
    id: 'HypeKlimatindikatorerRcp',
    registryDataset: 'HypeKlimatindikatorerRcp',
    license: 'CC0 1.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/klimatindikatorer-sgu-hype-omraden/ogc/features/v1/collections/klimatindikatorer-rcp',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/klimatindikatorer-sgu-hype-omraden/klimatindikatorer-sgu-hype-omraden.zip',
      zipFileName: 'klimatindikatorer-sgu-hype-omraden.zip',
      innerGpkg: 'klimatindikatorer_sgu_hype_omraden.gpkg',
      ogrLayer: 'klimatindikatorer-rcp',
    },
  },
  {
    id: 'HypeOmraden',
    registryDataset: 'HypeOmraden',
    license: 'CC0 1.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/klimatindikatorer-sgu-hype-omraden/ogc/features/v1/collections/omraden',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/klimatindikatorer-sgu-hype-omraden/klimatindikatorer-sgu-hype-omraden.zip',
      zipFileName: 'klimatindikatorer-sgu-hype-omraden.zip',
      innerGpkg: 'klimatindikatorer_sgu_hype_omraden.gpkg',
      ogrLayer: 'omraden',
    },
  },
  {
    id: 'Genomslapplighet',
    registryDataset: 'Genomslapplighet',
    license: 'CC0 1.0',
    apiCollectionUrl: 'https://api.sgu.se/oppnadata/genomslapplighet/ogc/features/v1/collections/genomslapplighet',
    zip: {
      zipUrl: 'https://resource.sgu.se/data/oppnadata/genomslapplighet/genomslapplighet.zip',
      zipFileName: 'genomslapplighet.zip',
      innerGpkg: 'genomslapplighet.gpkg',
      ogrLayer: 'genomslapplighet',
    },
  },
  {
    /** Flyg-gamma översiktlig — ASCII XYZ (200 m). Use write-gamma-manifest + CSV→PostGIS, not GPKG zip verify. */
    id: 'FlygGammaOversiktlig',
    registryDataset: 'FlygGammaOversiktlig',
    license: 'CC0 1.0',
  },
];

/** Tier 2 wave — verified official ZIP URLs (product PDFs 2024–2025). */
export const SGU_TIER2_HARVEST_IDS = [
  'Jorddjupsmodell',
  'StranderosionKust',
  'Jordarter750kBlockighet',
  'Jordarter750kLandform',
] as const;

export function getSguHarvestSource(id: string): SguHarvestSource | undefined {
  return SGU_HARVEST_SOURCES.find((s) => s.id === id);
}
