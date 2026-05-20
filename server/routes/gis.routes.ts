import express from 'express';
import { SOURCE_CATALOG } from '../datasources/catalog';
import { MAP_LAYER_CATALOG, MAP_LAYER_DEFAULT_DOCUMENTATION_URLS } from '../datasources/mapLayerCatalog';
import { logger } from '../logger';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import {
  parseBbox,
  getRaaFornlamningFeatureCollectionForBbox,
  getProtectedAreaLayer,
  getNatura2000Layer,
  getInternationalProtectionLayer,
  getWaterProtectionLayer,
  getSguGroundLayerLayer,
  getSguLandslideLayer,
  getFloodRiskLayer,
  runWaterAudit,
  runHeritageAudit,
  runClimateAudit,
  getPublicDatasourceSummary,
  getHydroLayer,
  getSguWellLayer,
  getSguPermeabilityLayer,
  getSguGroundwaterMagazineLayer,
  getSguGroundwaterBodyLayer,
  getSguCoastalErosionLayer,
  getSguHighestCoastlineLayer,
  getWaterCatchmentLayer,
  getMarkCoverLayer,
  getPropertyLayer,
  buildCulturalEnvironmentDownloadBundle,
  searchKsamsokBoundingBox,
  getLantmaterietOpenMapStatus,
  listOpenDataCatalog,
  pingAllOpenDataProducts,
  pingOpenDataProduct,
  fetchImmediateOpenSources,
  callSluProductApi,
  getSluProductStatus,
  pingSluProduct,
  searchSluObservations,
  getSmhiWeatherRisk,
  runSpatialAudit,
  getPostgisExtendedHealth,
  getTopo10Layer,
  type SluProduct,
} from '../modules/gis/public';
import { parsePositiveInt, parseBooleanFlag } from '../utils/routeUtils';
import { spatialAuditSchema } from '../schemas/api.schemas';

const router = express.Router();

function featureCollectionFallback(warning: string) {
  return {
    type: 'FeatureCollection' as const,
    features: [] as Array<unknown>,
    meta: {
      source: 'unavailable',
      available: false,
      manualReviewRequired: true,
      warning,
    },
  };
}

function toSingleStringParam(v: string | string[] | undefined): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const first = v[0];
    return typeof first === 'string' && first.trim() ? first : null;
  }
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

function parseCoordinate(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLatitude(value: number): boolean {
  return value >= -90 && value <= 90;
}

function isLongitude(value: number): boolean {
  return value >= -180 && value <= 180;
}

function isSluProduct(value: unknown): value is SluProduct {
  return ['species_observations', 'taxonomy', 'artfakta', 'metodkatalog'].includes(String(value || ''));
}

router.get('/api/layers/nvr', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: 'Invalid bbox' });
      return;
    }

    const limit = parsePositiveInt(req.query.limit, 1000, 1, 2000);
    const collection = await getProtectedAreaLayer(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res.status(200).json(featureCollectionFallback(String(safe.error || 'NVR-lager kunde inte laddas.')));
  }
});

router.get('/api/layers/water-protection', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: 'Invalid bbox' });
      return;
    }

    const limit = parsePositiveInt(req.query.limit, 1000, 1, 2000);
    const collection = await getWaterProtectionLayer(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/layers/natura2000', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: 'Invalid bbox' });
      return;
    }

    const limit = parsePositiveInt(req.query.limit, 1000, 1, 2000);
    const collection = await getNatura2000Layer(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'Natura 2000-lager kunde inte laddas.')));
  }
});

router.get('/api/layers/international-protection', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: 'Invalid bbox' });
      return;
    }

    const limit = parsePositiveInt(req.query.limit, 1000, 1, 2000);
    const collection = await getInternationalProtectionLayer(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(
        featureCollectionFallback(String(safe.error || 'Internationellt skyddslager kunde inte laddas.')),
      );
  }
});

router.post('/api/spatial-audit', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const { lat, lng } = req.body ?? {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ error: 'Missing coordinates' });
      return;
    }

    const result = await runSpatialAudit(lat, lng);
    res.json({
      hits: result.protectedAreaHits,
      protectedAreaAvailable: result.protectedAreaAvailable,
      protectedAreaWarning: result.protectedAreaWarning,
      isProtected: result.isProtected,
      manualReviewRequired: result.sgu.manualReviewRequired || !result.protectedAreaAvailable,
      sgu: result.sgu,
      text: result.text,
      sources: result.sources,
    });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/layers/sgu/grundlager', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const collection = await getSguGroundLayerLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'SGU grundlager kunde inte laddas.')));
  }
});

router.get('/api/layers/sgu/brunnar', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const limit = parsePositiveInt(req.query.limit, 2000, 1, 5000);
    const collection = await getSguWellLayer(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'SGU brunnslager kunde inte laddas.')));
  }
});

router.get('/api/layers/sgu/genomslapplighet', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const collection = await getSguPermeabilityLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'SGU genomslapplighet kunde inte laddas.')));
  }
});

router.get('/api/layers/sgu/grundvattenmagasin', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const collection = await getSguGroundwaterMagazineLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'SGU grundvattenmagasin kunde inte laddas.')));
  }
});

router.get('/api/layers/sgu/grundvattenforekomster', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const collection = await getSguGroundwaterBodyLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'SGU grundvattenforekomster kunde inte laddas.')));
  }
});

router.get('/api/layers/sgu/jordskred-raviner', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const collection = await getSguLandslideLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'SGU jordskred/raviner kunde inte laddas.')));
  }
});

router.get('/api/layers/sgu/kusterosion', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const limit = parsePositiveInt(req.query.limit, 1500, 1, 3000);
    const collection = await getSguCoastalErosionLayer(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'SGU kusterosion kunde inte laddas.')));
  }
});

router.get('/api/layers/sgu/hogsta-kustlinjen', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const limit = parsePositiveInt(req.query.limit, 1000, 1, 3000);
    const collection = await getSguHighestCoastlineLayer(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'SGU hogsta kustlinjen kunde inte laddas.')));
  }
});

router.get('/api/layers/property', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const collection = await getPropertyLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'Fastighetslager kunde inte laddas.')));
  }
});

router.get('/api/layers/hydro.lakes', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: 'Invalid bbox' });
      return;
    }

    const collection = await getHydroLayer('lakes', bbox);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/layers/hydro.streams', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: 'Invalid bbox' });
      return;
    }

    const collection = await getHydroLayer('streams', bbox);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/layers/hydro.water-catchments', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const collection = await getWaterCatchmentLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    const safe = toSafeErrorResponse(error);
    res
      .status(200)
      .json(featureCollectionFallback(String(safe.error || 'Avrinningsomraden kunde inte laddas.')));
  }
});

router.get('/api/layers/climate.flood-risk', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: 'Invalid bbox' });
      return;
    }

    const collection = await getFloodRiskLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/layers/markcover', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required' });
      return;
    }

    const collection = await getMarkCoverLayer([bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
    res.json(collection);
  } catch (error: unknown) {
    // Returnera 503 så frontenden visar status='error' (röd prick) i stället för
    // 'empty' (gul). Behåll FeatureCollection-skalet + meta.warning så klienter
    // som inspekterar bodyn fortfarande kan visa kontextuellt felmeddelande.
    const warning = error instanceof Error ? error.message : 'Marktacke kunde inte laddas.';
    logger.error('Marktacke layer fetch failed', { error: String(error) });
    res.status(503).json({
      error: warning,
      type: 'FeatureCollection',
      features: [],
      meta: {
        source: 'unavailable',
        available: false,
        manualReviewRequired: true,
        warning,
      },
    });
  }
});

router.post('/api/hydro/water-audit', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const { lat, lng } = req.body ?? {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ error: 'Missing coordinates' });
      return;
    }

    const result = await runWaterAudit(lat, lng);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.post('/api/culture/heritage-audit', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const { lat, lng } = req.body ?? {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ error: 'Missing coordinates' });
      return;
    }

    const result = await runHeritageAudit(lat, lng);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

// WFS Fornsök – GeoJSON för nedladdning/karta (kompletterar K-samsök URI:er enligt RAA:s guide).
router.get('/api/layers/raa/fornlamning', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'bbox is required (minLng,minLat,maxLng,maxLat)' });
      return;
    }

    const limit = parsePositiveInt(req.query.limit, 500, 1, 2000);
    const collection = await getRaaFornlamningFeatureCollectionForBbox(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

// K-samsök: sökindex (boundingBox WGS84 / CQL). Se RAA:s guide under server/constants/culturalHeritageSources.ts
router.get('/api/datasources/raa/ksamsok/search', rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ ok: false, error: 'bbox is required (minLng,minLat,maxLng,maxLat)' });
      return;
    }

    const hitsPerPage = parsePositiveInt(req.query.hitsPerPage, 50, 1, 500);
    const startRecord = parsePositiveInt(req.query.startRecord, 1, 1, 500_000);
    const extraQuery = typeof req.query.extraQuery === 'string' ? req.query.extraQuery.trim() : undefined;
    const result = await searchKsamsokBoundingBox({
      ...bbox,
      hitsPerPage,
      startRecord,
      extraQuery,
    });
    if (result.ok === false) {
      res.status(502).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true, data: result.data });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

// Samlat underlag: dataportal-söklänk + K-samsök + RAA WFS GeoJSON + kartlager med dokumentation.
router.get(
  '/api/datasources/open/cultural-environment-bundle',
  rateLimitByUser(10, 60_000),
  async (req, res) => {
    try {
      const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
      const bbox = parseBbox(rawBbox);
      if (!bbox) {
        res.status(400).json({
          ok: false,
          error: 'bbox query parameter is required (minLng,minLat,maxLng,maxLat)',
        });
        return;
      }
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const bundle = await buildCulturalEnvironmentDownloadBundle({ bbox, dataportalQuery: q });
      res.json({ ok: true, bundle });
    } catch (error: unknown) {
      res.status(500).json(toSafeErrorResponse(error));
    }
  },
);

router.post('/api/climate/smhi-audit', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const { lat, lng } = req.body ?? {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ error: 'Missing coordinates' });
      return;
    }

    const result = await runClimateAudit(lat, lng);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/datasources/public-summary', rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const refresh = parseBooleanFlag(req.query.refresh, false);
    const summary = await getPublicDatasourceSummary(refresh);
    res.json({ ok: true, summary });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/datasources/health', rateLimitByUser(30, 60_000), async (_req, res) => {
  try {
    const summary = await getPublicDatasourceSummary(false);
    const cards = summary.cards;
    const total = cards.length;
    const connected = cards.filter((c) => c.status === 'CONNECTED').length;
    const disconnected = cards.filter((c) => c.status === 'DISCONNECTED').length;
    const errors = cards.filter((c) => c.status === 'ERROR').length;
    const permitRequired = cards.filter((c) => c.activation === 'PERMIT_REQUIRED').length;
    const immediateSources = cards.filter((c) => c.activation === 'IMMEDIATE');
    const allOpenSourcesActive = immediateSources.every((c) => c.status === 'CONNECTED');
    const notResponding = immediateSources
      .filter((c) => c.status !== 'CONNECTED')
      .map((c) => ({ name: c.name, provider: c.provider, status: c.status, reason: c.reason }));
    res.json({
      ok: true,
      allOpenSourcesActive,
      connected,
      disconnected,
      errors,
      total,
      permitRequired,
      notResponding,
      checkedAt: summary.checkedAt,
    });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/weather/smhi-risk', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const lat = parseCoordinate(req.query.lat);
    const lng = parseCoordinate(req.query.lng);
    const municipality =
      typeof req.query.municipality === 'string' ? req.query.municipality.trim() : undefined;

    if (lat === null || lng === null) {
      res.status(400).json({ ok: false, error: 'lat and lng are required' });
      return;
    }
    if (!isLatitude(lat) || !isLongitude(lng)) {
      res.status(400).json({ ok: false, error: 'Invalid coordinates' });
      return;
    }

    const result = await getSmhiWeatherRisk({ lat, lng, municipality });
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get('/api/datasources/catalog', requireAuth, rateLimitByUser(30, 60_000), (_req, res) => {
  res.json({ ok: true, sources: SOURCE_CATALOG });
});

// Publik katalog över alla BBOX-baserade kartlager-endpoints.
// Frontend (MapConfig.ts) hämtar denna utan inloggning för att visa korrekta
// labels. AVSIKTLIGT UTAN requireAuth — om en framtida regression kräver auth
// här kommer `useMapLayerCatalog` att retrya 3 ggr per session och ge tom
// katalog. Den tidigare dubbletten i secureApi.express.ts (med requireAuth)
// är borttagen — håll den här som källa.
router.get('/api/reference/map-layers', rateLimitByUser(30, 60_000), (_req, res) => {
  res.json({
    ok: true,
    layers: MAP_LAYER_CATALOG.map((layer) => ({
      ...layer,
      documentationUrls: layer.documentationUrls ?? [...MAP_LAYER_DEFAULT_DOCUMENTATION_URLS],
    })),
    generatedAt: new Date().toISOString(),
  });
});

// Utökad PostGIS-hälsokontroll: version, SRID-stöd, antal GIST-index, senaste
// spatial-migration. Ersätter den enklare varianten i secureApi (som inte nås
// eftersom gisRouter monteras först).
router.get('/api/system/postgis', async (_req, res) => {
  try {
    const payload = await getPostgisExtendedHealth();
    res.json({
      ok: true,
      postgis: {
        version: payload.postgis.version,
        sridCount: payload.postgis.sridCount,
        gistIndexCount: payload.postgis.gistIndexCount,
      },
      extensions: payload.extensions,
      lastSpatialMigration: payload.lastSpatialMigration,
      checkedAt: payload.checkedAt,
    });
  } catch (error: unknown) {
    logger.error('PostGIS extended check failed', { error: String(error) });
    res.status(500).json({
      ok: false,
      message: 'PostGIS verkar saknas eller databasen ar inte konfigurerad.',
      details: process.env.NODE_ENV === 'production' ? undefined : String(error),
    });
  }
});

router.get(
  '/api/datasources/lantmateriet/open/status',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (_req, res) => {
    try {
      const result = await getLantmaterietOpenMapStatus();
      res.json({ ok: true, result });
    } catch (error: unknown) {
      res
        .status(503)
        .json({ ok: false, error: error instanceof Error ? error.message : 'Lantmateriet status failed' });
    }
  },
);

// Avgiftsfria Lantmäteriet-tjänster: katalog + status per produkt.
router.get('/api/datasources/lantmateriet/open/catalog', rateLimitByUser(20, 60_000), (_req, res) => {
  res.json({ ok: true, products: listOpenDataCatalog() });
});

router.get(
  '/api/datasources/lantmateriet/open/ping',
  requireAuth,
  rateLimitByUser(10, 60_000),
  async (_req, res) => {
    try {
      const results = await pingAllOpenDataProducts();
      res.json({ ok: true, results });
    } catch (error: unknown) {
      res.status(500).json(toSafeErrorResponse(error));
    }
  },
);

router.get(
  '/api/datasources/lantmateriet/open/ping/:product',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      const result = await pingOpenDataProduct(req.params.product as any);
      res.json({ ok: true, result });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.get('/api/datasources/slu/status', requireAuth, rateLimitByUser(30, 60_000), (_req, res) => {
  res.json({ ok: true, products: getSluProductStatus() });
});

router.get(
  '/api/datasources/slu/ping/:product',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req, res) => {
    try {
      const { product } = req.params;
      if (!isSluProduct(product)) {
        res.status(400).json({ ok: false, error: 'Unsupported SLU product' });
        return;
      }

      const result = await pingSluProduct(product);
      res.json({ ok: true, result });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.post(
  '/api/datasources/slu/observations',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req, res) => {
    try {
      const { projectId, purpose, payload } = req.body ?? {};
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      if (typeof projectId !== 'string' || !projectId.trim()) {
        res.status(400).json({ ok: false, error: 'projectId is required' });
        return;
      }
      if (typeof purpose !== 'string' || !purpose.trim()) {
        res.status(400).json({ ok: false, error: 'purpose is required' });
        return;
      }

      const result = await searchSluObservations({
        projectId,
        purpose,
        payload: typeof payload === 'object' && payload ? payload : {},
        user: req.authUser,
      });
      res.json({ ok: true, result });
    } catch (error: unknown) {
      res.status(400).json(toSafeErrorResponse(error));
    }
  },
);

router.post('/api/datasources/slu/proxy', requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const { product, method, pathSuffix, query, payload, projectId, purpose } = req.body ?? {};
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    if (!isSluProduct(product)) {
      res.status(400).json({ ok: false, error: 'Unsupported SLU product' });
      return;
    }
    if (method !== 'GET' && method !== 'POST') {
      res.status(400).json({ ok: false, error: 'method must be GET or POST' });
      return;
    }
    if (typeof purpose !== 'string' || !purpose.trim()) {
      res.status(400).json({ ok: false, error: 'purpose is required' });
      return;
    }

    const result = await callSluProductApi({
      product,
      method,
      pathSuffix: typeof pathSuffix === 'string' ? pathSuffix : '',
      query: typeof query === 'object' && query ? query : undefined,
      payload: typeof payload === 'object' && payload ? payload : undefined,
      projectId: typeof projectId === 'string' && projectId.trim() ? projectId : undefined,
      purpose,
      user: req.authUser,
    });
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post('/api/datasources/open/sync', requireAuth, rateLimitByUser(10, 60_000), async (_req, res) => {
  try {
    const results = await fetchImmediateOpenSources();
    res.json({ ok: true, results });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get('/api/layers/topo10/:layerName', rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const layerName = toSingleStringParam(req.params.layerName);
    if (!layerName) {
      res.status(400).json({ error: 'layerName is required' });
      return;
    }
    const rawBbox = typeof req.query.bbox === 'string' ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: 'Bbox is required for topo10 layers' });
      return;
    }
    const collection = await getTopo10Layer(bbox, layerName);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

export default router;
