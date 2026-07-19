import {
  RAA_KSAMSOK_API_GUIDE_URL,
  KSAMSOK_API_BASE_URL,
  buildDataportalDatasetSearchUrl,
} from '../constants/culturalHeritageSources';
import {
  MAP_LAYER_CATALOG,
  MAP_LAYER_DEFAULT_DOCUMENTATION_URLS,
  type MapLayerCatalogEntry,
} from '../datasources/mapLayerCatalog';
import { searchKsamsokBoundingBox } from './ksamsokService';
import { getRaaFornlamningFeatureCollectionForBbox, type HeritageViewportBbox } from './publicUiService';

export type CulturalEnvironmentDownloadBundle = {
  generatedAt: string;
  /** För reproducerbara anrop och juridisk spårbarhet */
  sources: {
    raaKsamsokApiGuide: string;
    ksamsokApiBase: string;
    dataportalSearch: string;
    note: string;
  };
  dataportal: {
    searchQuery: string;
    searchUrl: string;
  };
  ksamsok: { ok: boolean; error?: string; data?: unknown };
  raaWfs: {
    featureCount: number;
    layersTouched: string[];
    collection: Awaited<ReturnType<typeof getRaaFornlamningFeatureCollectionForBbox>>;
  };
  /** Kartlager från katalogen som har dokumentation (t.ex. K-samsök-guide) */
  mapLayersWithDocumentation: Array<
    Pick<MapLayerCatalogEntry, 'key' | 'label' | 'endpoint' | 'provider'> & {
      documentationUrls: string[];
    }
  >;
};

function catalogEntriesWithDocs(): Array<
  Pick<MapLayerCatalogEntry, 'key' | 'label' | 'endpoint' | 'provider'> & {
    documentationUrls: string[];
  }
> {
  return MAP_LAYER_CATALOG.map((e) => ({
    key: e.key,
    label: e.label,
    endpoint: e.endpoint,
    provider: e.provider,
    documentationUrls: e.documentationUrls ?? [...MAP_LAYER_DEFAULT_DOCUMENTATION_URLS],
  }));
}

/**
 * Ett samlat JSON-underlag: dataportal-sök (länk), K-samsök-sök i bbox, WFS Fornsök GeoJSON,
 * plus kartlagerskatalog med officiella API-dokument.
 */
export async function buildCulturalEnvironmentDownloadBundle(params: {
  bbox: HeritageViewportBbox;
  /** Tematisk sökning i dataportalen (dataset) */
  dataportalQuery?: string;
  ksamsokHitsPerPage?: number;
  ksamsokStartRecord?: number;
  /** Extra K-samsök CQL AND-del */
  ksamsokExtraQuery?: string;
  raaWfsLimitPerLayer?: number;
}): Promise<CulturalEnvironmentDownloadBundle> {
  const searchQuery = (params.dataportalQuery ?? 'kulturarv fornlamning miljö').trim();

  const [ksamsok, raaCollection] = await Promise.all([
    searchKsamsokBoundingBox({
      ...params.bbox,
      hitsPerPage: params.ksamsokHitsPerPage,
      startRecord: params.ksamsokStartRecord,
      extraQuery: params.ksamsokExtraQuery,
    }),
    getRaaFornlamningFeatureCollectionForBbox(params.bbox, params.raaWfsLimitPerLayer ?? 500),
  ]);

  const ksamsokPart =
    ksamsok.ok === true
      ? { ok: true as const, data: ksamsok.data }
      : { ok: false as const, error: ksamsok.error };

  const metaLayers = (raaCollection.meta as { layers?: string[] } | undefined)?.layers ?? [];

  return {
    generatedAt: new Date().toISOString(),
    sources: {
      raaKsamsokApiGuide: RAA_KSAMSOK_API_GUIDE_URL,
      ksamsokApiBase: KSAMSOK_API_BASE_URL,
      dataportalSearch: buildDataportalDatasetSearchUrl(searchQuery),
      note: 'Objekt i K-samsök använder beständiga URI:er (se RAA-guide). WFS Fornsök levererar geometrier; K-samsök ger index och metadata.',
    },
    dataportal: {
      searchQuery,
      searchUrl: buildDataportalDatasetSearchUrl(searchQuery),
    },
    ksamsok: ksamsokPart,
    raaWfs: {
      featureCount: raaCollection.features.length,
      layersTouched: metaLayers,
      collection: raaCollection,
    },
    mapLayersWithDocumentation: catalogEntriesWithDocs(),
  };
}
