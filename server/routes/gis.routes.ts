import express from "express";
import { SOURCE_CATALOG } from "../datasources/catalog";
import { requireAuth } from "../security/auth";
import { rateLimitByUser } from "../security/rateLimit";
import { toSafeErrorResponse } from "../security/secureErrors";
import {
  parseBbox,
  getProtectedAreaLayer,
  getSguGroundLayerLayer,
  getSguLandslideLayer,
  runWaterAudit,
  runHeritageAudit,
  runClimateAudit,
  getPublicDatasourceSummary,
  getHydroLayer,
} from "../services/publicUiService";
import { getLantmaterietOpenMapStatus } from "../services/lantmaterietService";
import { fetchImmediateOpenSources } from "../services/openDataSourceService";
import { getPropertyLayer } from "../services/propertyUnitService";
import {
  callSluProductApi,
  getSluProductStatus,
  pingSluProduct,
  searchSluObservations,
  type SluProduct,
} from "../services/sluService";
import { getSmhiWeatherRisk } from "../services/smhiWeatherService";
import { runSpatialAudit } from "../services/spatialAuditService";
import { parsePositiveInt, parseBooleanFlag } from "../utils/routeUtils";

const router = express.Router();

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
  return ["species_observations", "taxonomy", "artfakta", "metodkatalog"].includes(String(value || ""));
}

router.get("/api/layers/nvr", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === "string" ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: "Invalid bbox" });
      return;
    }

    const limit = parsePositiveInt(req.query.limit, 1000, 1, 2000);
    const collection = await getProtectedAreaLayer(bbox, limit);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.post("/api/spatial-audit", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const { lat, lng } = req.body ?? {};
    if (typeof lat !== "number" || typeof lng !== "number") {
      res.status(400).json({ error: "Missing coordinates" });
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

router.get("/api/layers/sgu/grundlager", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === "string" ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: "bbox is required" });
      return;
    }

    const collection = await getSguGroundLayerLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get("/api/layers/sgu/jordskred-raviner", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === "string" ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: "bbox is required" });
      return;
    }

    const collection = await getSguLandslideLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get("/api/layers/property", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === "string" ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (!bbox) {
      res.status(400).json({ error: "bbox is required" });
      return;
    }

    const collection = await getPropertyLayer(bbox);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get("/api/layers/hydro.lakes", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === "string" ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: "Invalid bbox" });
      return;
    }

    const collection = await getHydroLayer("lakes", bbox);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get("/api/layers/hydro.streams", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const rawBbox = typeof req.query.bbox === "string" ? req.query.bbox : null;
    const bbox = parseBbox(rawBbox);
    if (rawBbox && !bbox) {
      res.status(400).json({ error: "Invalid bbox" });
      return;
    }

    const collection = await getHydroLayer("streams", bbox);
    res.json(collection);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.post("/api/hydro/water-audit", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const { lat, lng } = req.body ?? {};
    if (typeof lat !== "number" || typeof lng !== "number") {
      res.status(400).json({ error: "Missing coordinates" });
      return;
    }

    const result = await runWaterAudit(lat, lng);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.post("/api/culture/heritage-audit", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const { lat, lng } = req.body ?? {};
    if (typeof lat !== "number" || typeof lng !== "number") {
      res.status(400).json({ error: "Missing coordinates" });
      return;
    }

    const result = await runHeritageAudit(lat, lng);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.post("/api/climate/smhi-audit", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const { lat, lng } = req.body ?? {};
    if (typeof lat !== "number" || typeof lng !== "number") {
      res.status(400).json({ error: "Missing coordinates" });
      return;
    }

    const result = await runClimateAudit(lat, lng);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get("/api/datasources/public-summary", rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const refresh = parseBooleanFlag(req.query.refresh, false);
    const summary = await getPublicDatasourceSummary(refresh);
    res.json({ ok: true, summary });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

router.get("/api/datasources/health", rateLimitByUser(30, 60_000), async (_req, res) => {
  try {
    const summary = await getPublicDatasourceSummary(false);
    const cards = summary.cards;
    const total = cards.length;
    const connected = cards.filter((c) => c.status === "CONNECTED").length;
    const disconnected = cards.filter((c) => c.status === "DISCONNECTED").length;
    const errors = cards.filter((c) => c.status === "ERROR").length;
    const permitRequired = cards.filter((c) => c.activation === "PERMIT_REQUIRED").length;
    const immediateSources = cards.filter((c) => c.activation === "IMMEDIATE");
    const allOpenSourcesActive = immediateSources.every((c) => c.status === "CONNECTED");
    const notResponding = immediateSources
      .filter((c) => c.status !== "CONNECTED")
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

router.get("/api/weather/smhi-risk", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const lat = parseCoordinate(req.query.lat);
    const lng = parseCoordinate(req.query.lng);
    const municipality = typeof req.query.municipality === "string" ? req.query.municipality.trim() : undefined;

    if (lat === null || lng === null) {
      res.status(400).json({ ok: false, error: "lat and lng are required" });
      return;
    }
    if (!isLatitude(lat) || !isLongitude(lng)) {
      res.status(400).json({ ok: false, error: "Invalid coordinates" });
      return;
    }

    const result = await getSmhiWeatherRisk({ lat, lng, municipality });
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get("/api/datasources/catalog", requireAuth, rateLimitByUser(30, 60_000), (_req, res) => {
  res.json({ ok: true, sources: SOURCE_CATALOG });
});

router.get("/api/datasources/lantmateriet/open/status", requireAuth, rateLimitByUser(30, 60_000), async (_req, res) => {
  try {
    const result = await getLantmaterietOpenMapStatus();
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Lantmateriet status failed" });
  }
});

router.get("/api/datasources/slu/status", requireAuth, rateLimitByUser(30, 60_000), (_req, res) => {
  res.json({ ok: true, products: getSluProductStatus() });
});

router.get("/api/datasources/slu/ping/:product", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const { product } = req.params;
    if (!isSluProduct(product)) {
      res.status(400).json({ ok: false, error: "Unsupported SLU product" });
      return;
    }

    const result = await pingSluProduct(product);
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/datasources/slu/observations", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const { projectId, purpose, payload } = req.body ?? {};
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (typeof projectId !== "string" || !projectId.trim()) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }
    if (typeof purpose !== "string" || !purpose.trim()) {
      res.status(400).json({ ok: false, error: "purpose is required" });
      return;
    }

    const result = await searchSluObservations({
      projectId,
      purpose,
      payload: typeof payload === "object" && payload ? payload : {},
      user: req.authUser,
    });
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/datasources/slu/proxy", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const { product, method, pathSuffix, query, payload, projectId, purpose } = req.body ?? {};
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (!isSluProduct(product)) {
      res.status(400).json({ ok: false, error: "Unsupported SLU product" });
      return;
    }
    if (method !== "GET" && method !== "POST") {
      res.status(400).json({ ok: false, error: "method must be GET or POST" });
      return;
    }
    if (typeof purpose !== "string" || !purpose.trim()) {
      res.status(400).json({ ok: false, error: "purpose is required" });
      return;
    }

    const result = await callSluProductApi({
      product,
      method,
      pathSuffix: typeof pathSuffix === "string" ? pathSuffix : "",
      query: typeof query === "object" && query ? query : undefined,
      payload: typeof payload === "object" && payload ? payload : undefined,
      projectId: typeof projectId === "string" && projectId.trim() ? projectId : undefined,
      purpose,
      user: req.authUser,
    });
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/datasources/open/sync", requireAuth, rateLimitByUser(10, 60_000), async (_req, res) => {
  try {
    const results = await fetchImmediateOpenSources();
    res.json({ ok: true, results });
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

export default router;
