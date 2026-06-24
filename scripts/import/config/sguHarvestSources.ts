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
      expectedFeatureCount: 832_535,
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
      expectedFeatureCount: 9_340,
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
];

export function getSguHarvestSource(id: string): SguHarvestSource | undefined {
  return SGU_HARVEST_SOURCES.find((s) => s.id === id);
}
