import express from "express";
import bodyParser from "body-parser";
import fs from "node:fs";
import { assertSecurityEnv } from "./security/env";
import { createTokenPair, requireAuth } from "./security/auth";
import { rateLimitByOrg, rateLimitByUser } from "./security/rateLimit";
import { requestLogger } from "./security/requestLogging";
import { appendDomainAudit, exportAuditTrail, verifyAuditTrail } from "./security/auditTrail";
import { assertPermission } from "./security/projectAccess";
import { cancelBankIdAuth, collectBankIdAuth, generateAnimatedQrPayload, initiateBankIdAuth, refreshSession } from "./services/bankIdService";
import { getAuditExportRows } from "./repositories/auditRepository";
import { getLantmaterietOpenMapStatus, lookupPropertyByDesignation } from "./services/lantmaterietService";
import { SOURCE_CATALOG } from "./datasources/catalog";
import { fetchImmediateOpenSources } from "./services/openDataSourceService";
import { callSluProductApi, getSluProductStatus, pingSluProduct, searchSluObservations } from "./services/sluService";
import type { PropertyLookupInput } from "./security/types";
import { assertProjectMembership } from "./repositories/projectAccessRepository";
import {
  createOrGetAdminProject,
  enqueueSearchJob,
  getSearchStatus,
  listProjectsForAdmin,
  recoverStaleRunningJobs,
  requeueFailedJobs,
} from "./repositories/searchRepository";
import { getSearchConfig, runSearchQuery } from "./services/searchService";
import { processSearchJobsOnce } from "./services/searchWorker";
import { getDispatchProviderRuntimeStatus } from "./services/transportDispatchService";
import { ensureAdminConsoleUser } from "./repositories/userRepository";
import {
  applyTemplateForProject,
  bookTransportForProject,
  calculateCarbonForProject,
  createDispatchQuoteForProject,
  evaluateGateForProject,
  getProjectPlanSnapshot,
  ingestLimsReportForProject,
  recommendMapLayersForProject,
  saveProjectPlanSnapshot,
  signDriverJournalForProject,
  upsertDriverJournalForProject,
  verifyLimsReportForProject,
} from "./services/projectPlanService";
import type {
  CarbonInput,
  DriverJournalStatus,
  LimsSourceType,
  MapLayerKey,
  ProjectPlan,
  ProjectType,
  StageGateType,
} from "../types";
import { getAdminDatabaseDump, getAdminExamSummary } from "./repositories/adminReportRepository";
import {
  getDocumentById,
  listRequirementCases,
  listRequirementCitations,
  listRequirementRows,
  type RequirementVerificationStatus,
  updateCitationVerification,
  updateRequirementVerification,
} from "./repositories/requirementsRepository";
import {
  buildRequirementsDocxBuffer,
  buildRequirementsExportCsvZip,
  buildRequirementsReportSummary,
  exportFilename,
} from "./services/requirementsReportService";
import { prisma } from "./db/prisma";
import { getPropertyLayer, lookupPropertyByDesignationFromPostgis } from "./services/propertyUnitService";
import { runSpatialAudit } from "./services/spatialAuditService";
import {
  getHydroLayer,
  getProtectedAreaLayer,
  getPublicDatasourceSummary,
  getSguGroundLayerLayer,
  getSguLandslideLayer,
  parseBbox,
  runClimateAudit,
  runHeritageAudit,
  runWaterAudit,
} from "./services/publicUiService";

assertSecurityEnv();

const router = express.Router();
router.use(bodyParser.json({ limit: "1mb" }));
router.use(requestLogger);

const allowedStageGateTypes: StageGateType[] = [
  "PERMIT_REQUIRED",
  "RISK_REVIEW",
  "DOCUMENT_CONTROL",
  "CARBON_CHECK",
];

const allowedProjectTypes: ProjectType[] = ["ENV_PERMIT", "VA", "INFRA", "REMEDIATION", "ENERGY"];

function asOptionalProjectPlan(value: unknown): Partial<ProjectPlan> | undefined {
  if (value && typeof value === "object") {
    return value as Partial<ProjectPlan>;
  }
  return undefined;
}

function parseMapLayerList(value: unknown): MapLayerKey[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item) =>
      typeof item === "string" &&
      ["CADASTRE", "NATURA2000", "FLOOD_RISK", "SOIL", "INFRASTRUCTURE", "GROUNDWATER", "PROTECTED_SPECIES", "NOISE"].includes(item)
    )
    .map((item) => item as MapLayerKey);
}

function parseOptionalDriverJournalStatus(value: unknown): DriverJournalStatus | undefined {
  if (typeof value !== "string") return undefined;
  if (["DRAFT", "SUBMITTED", "VERIFIED", "REJECTED"].includes(value)) {
    return value as DriverJournalStatus;
  }
  return undefined;
}

function parseOptionalLimsSource(value: unknown): LimsSourceType | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "API" || value === "SFTP" || value === "MANUAL") {
    return value;
  }
  return undefined;
}

const requirementStatuses: RequirementVerificationStatus[] = ["AUTO", "REVIEWED", "VERIFIED", "REJECTED"];

function parseOptionalRequirementStatus(value: unknown): RequirementVerificationStatus | undefined {
  if (typeof value !== "string") return undefined;
  return requirementStatuses.includes(value as RequirementVerificationStatus)
    ? (value as RequirementVerificationStatus)
    : undefined;
}

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function parseBooleanFlag(value: unknown, fallback: boolean = false): boolean {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "ja"].includes(normalized)) return true;
  if (["0", "false", "no", "nej"].includes(normalized)) return false;
  return fallback;
}

function parseOptionalText(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
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
    res.status(500).json({ error: "Failed to fetch data from PostGIS", details: String(error) });
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
    res.status(500).json({ error: "Database query failed", details: String(error) });
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
    res.status(500).json({ error: "Failed to fetch SGU grundlager", details: String(error) });
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
    res.status(500).json({ error: "Failed to fetch SGU jordskred-raviner", details: String(error) });
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
    res.status(500).json({ error: "Failed to fetch property layers", details: String(error) });
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
    res.status(500).json({ error: "Failed to fetch hydro lakes", details: String(error) });
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
    res.status(500).json({ error: "Failed to fetch hydro streams", details: String(error) });
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
    res.status(500).json({ error: "Water audit failed", details: String(error) });
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
    res.status(500).json({ error: "Heritage audit failed", details: String(error) });
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
    res.status(500).json({ error: "Climate audit failed", details: String(error) });
  }
});

router.get("/api/datasources/public-summary", rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const refresh = parseBooleanFlag(req.query.refresh, false);
    const summary = await getPublicDatasourceSummary(refresh);
    res.json({ ok: true, summary });
  } catch (error: unknown) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Public summary failed" });
  }
});

router.post("/api/auth/bankid/init", rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    const endUserIp = String(req.body?.endUserIp ?? req.ip);
    const orderTime = new Date();
    const order = await initiateBankIdAuth(endUserIp);
    const qrPayload = generateAnimatedQrPayload({
      qrStartToken: order.qrStartToken,
      qrStartSecret: order.qrStartSecret,
      orderTime,
    });
    res.json({ ok: true, ...order, orderTime: orderTime.toISOString(), qrPayload });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "bankid init failed" });
  }
});

router.post("/api/auth/bankid/collect", rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    const orderRef = String(req.body?.orderRef ?? "");
    const result = await collectBankIdAuth(orderRef);
    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "collect failed" });
  }
});

router.post("/api/auth/bankid/cancel", rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const orderRef = String(req.body?.orderRef ?? "");
    const result = await cancelBankIdAuth(orderRef);
    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "cancel failed" });
  }
});

router.post("/api/auth/refresh", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const token = String(req.body?.refreshToken ?? "");
    const rotated = await refreshSession(token);
    res.json({ ok: true, ...rotated });
  } catch (error: unknown) {
    res.status(401).json({ ok: false, error: error instanceof Error ? error.message : "refresh failed" });
  }
});

router.post("/api/admin/auth/login", rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");

    const expectedUsername = String(process.env.ADMIN_CONSOLE_USERNAME || "admin").trim();
    const expectedPassword = String(process.env.ADMIN_CONSOLE_PASSWORD || "");
    if (!expectedPassword) {
      res.status(503).json({ ok: false, error: "Admin login is not configured (ADMIN_CONSOLE_PASSWORD missing)." });
      return;
    }

    if (!username || username !== expectedUsername || password !== expectedPassword) {
      res.status(401).json({ ok: false, error: "Invalid admin credentials" });
      return;
    }

    const user = await ensureAdminConsoleUser(username);
    const tokens = createTokenPair(user);
    res.json({
      ok: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        role: user.role,
        organisationId: user.organisationId,
      },
    });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "admin login failed" });
  }
});

router.post("/api/property/lookup", requireAuth, rateLimitByUser(30, 5 * 60_000), rateLimitByOrg(200, 60 * 60_000), async (req, res) => {
  try {
    const input = req.body as PropertyLookupInput;
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    const result = await lookupPropertyByDesignation(input, req.authUser);
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "lookup failed" });
  }
});

router.post("/api/property/lookup/postgis", requireAuth, rateLimitByUser(30, 5 * 60_000), rateLimitByOrg(200, 60 * 60_000), async (req, res) => {
  try {
    const input = req.body as PropertyLookupInput;
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    const result = await lookupPropertyByDesignationFromPostgis(input, req.authUser);
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "postgis lookup failed" });
  }
});

router.get("/api/system/postgis", async (_req, res) => {
  try {
    const result = await prisma.$queryRaw<Array<{ postgis_full_version: string }>>`
      SELECT postgis_full_version()
    `;
    res.json({
      ok: true,
      version: result[0]?.postgis_full_version,
      message: "PostGIS ar korrekt installerat och svarar.",
    });
  } catch (error: unknown) {
    res.status(500).json({
      ok: false,
      message: "PostGIS verkar saknas eller databasen ar inte konfigurerad.",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

router.get("/api/datasources/lantmateriet/open/status", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    assertPermission(req.authUser, "AUDIT_EXPORT");
    const result = await getLantmaterietOpenMapStatus();
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Lantmateriet open status failed",
    });
  }
});

router.get("/api/audit/export", requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    assertPermission(req.authUser, "AUDIT_EXPORT");
    const integrity = verifyAuditTrail();
    const dbRecords = await getAuditExportRows();
    res.json({
      ok: true,
      integrity,
      memoryRecords: exportAuditTrail(),
      records: dbRecords,
    });
  } catch (error: unknown) {
    res.status(403).json({ ok: false, error: error instanceof Error ? error.message : "forbidden" });
  }
});

router.get("/api/datasources/catalog", requireAuth, rateLimitByUser(30, 60_000), (_req, res) => {
  res.json({ ok: true, sources: SOURCE_CATALOG });
});

router.post("/api/datasources/open/sync", requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    assertPermission(req.authUser, "AUDIT_EXPORT");
    const results = await fetchImmediateOpenSources();
    res.json({ ok: true, results });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "sync failed" });
  }
});

router.get("/api/datasources/slu/status", requireAuth, rateLimitByUser(10, 60_000), (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    assertPermission(req.authUser, "AUDIT_EXPORT");
    res.json({ ok: true, products: getSluProductStatus() });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "SLU status failed" });
  }
});

router.get("/api/datasources/slu/ping/:product", requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    assertPermission(req.authUser, "AUDIT_EXPORT");
    const product = String(req.params.product || "") as "species_observations" | "taxonomy" | "artfakta" | "metodkatalog";
    const result = await pingSluProduct(product);
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "SLU ping failed" });
  }
});

router.post("/api/datasources/slu/observations", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    const projectId = String(req.body?.projectId ?? "");
    const purpose = String(req.body?.purpose ?? "");
    const payload = (req.body?.payload ?? {}) as Record<string, unknown>;
    const result = await searchSluObservations({ projectId, purpose, payload, user: req.authUser });
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "SLU observation search failed" });
  }
});

router.post("/api/datasources/slu/proxy", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const product = String(req.body?.product ?? "") as "species_observations" | "taxonomy" | "artfakta" | "metodkatalog";
    const method = String(req.body?.method ?? "GET").toUpperCase() as "GET" | "POST";
    const purpose = String(req.body?.purpose ?? "");
    const projectId = req.body?.projectId ? String(req.body.projectId) : undefined;
    const pathSuffix = req.body?.pathSuffix ? String(req.body.pathSuffix) : undefined;
    const payload = (req.body?.payload ?? {}) as Record<string, unknown>;
    const query = (req.body?.query ?? {}) as Record<string, string | number | boolean>;

    const result = await callSluProductApi({
      product,
      method,
      pathSuffix,
      payload,
      query,
      purpose,
      projectId,
      user: req.authUser,
    });
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "SLU proxy failed" });
  }
});

router.post("/api/search/sync-manifest", requireAuth, rateLimitByUser(10, 60_000), rateLimitByOrg(120, 60 * 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.body?.projectId ?? "");
    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const config = getSearchConfig();
    const manifestPath = req.body?.manifestPath ? String(req.body.manifestPath) : config.manifestPath;
    const outlookBaseDir = req.body?.outlookBaseDir ? String(req.body.outlookBaseDir) : config.outlookBaseDir;

    const job = await enqueueSearchJob({
      type: "SYNC_MANIFEST",
      projectId,
      payload: {
        projectId,
        organisationId: req.authUser.organisationId,
        manifestPath,
        outlookBaseDir,
      },
    });

    const processedImmediately = await processSearchJobsOnce(1);
    res.json({
      ok: true,
      jobId: job.id,
      processedImmediately,
      config: {
        manifestPath,
        outlookBaseDir,
      },
    });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "sync manifest failed" });
  }
});

router.post("/api/search/query", requireAuth, rateLimitByUser(80, 60_000), rateLimitByOrg(800, 60 * 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectIdRaw = String(req.body?.projectId ?? "").trim();
    const projectId = projectIdRaw || undefined;
    const query = String(req.body?.query ?? "");
    const mode = req.body?.mode === "semantic" || req.body?.mode === "lexical" ? req.body.mode : "hybrid";
    const topK = Number(req.body?.topK ?? 20);
    const strictEvidenceRaw = String(req.body?.strictEvidence ?? "true").trim().toLowerCase();
    const strictEvidence = !["false", "0", "no"].includes(strictEvidenceRaw);
    const filters = (req.body?.filters ?? {}) as Record<string, unknown>;

    if (projectId) {
      await assertProjectMembership({
        projectId,
        userId: req.authUser.id,
        organisationId: req.authUser.organisationId,
        role: req.authUser.role,
      });
    } else if (req.authUser.role !== "ADMIN") {
      res.status(400).json({ ok: false, error: "projectId is required for non-admin users" });
      return;
    }

    const result = await runSearchQuery({
      projectId,
      userId: req.authUser.id,
      query,
      mode,
      topK,
      strictEvidence,
      filters: {
        municipality: typeof filters.municipality === "string" ? filters.municipality : undefined,
        decisionType: typeof filters.decisionType === "string" ? filters.decisionType : undefined,
        wasteType: typeof filters.wasteType === "string" ? filters.wasteType : undefined,
        status: typeof filters.status === "string" ? filters.status : undefined,
        legalStatus: typeof filters.legalStatus === "string" ? filters.legalStatus : undefined,
        hazardousFlag: typeof filters.hazardousFlag === "boolean" ? filters.hazardousFlag : undefined,
        dateFrom: typeof filters.dateFrom === "string" ? filters.dateFrom : undefined,
        dateTo: typeof filters.dateTo === "string" ? filters.dateTo : undefined,
      },
    });

    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "search query failed" });
  }
});

router.get("/api/search/status", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectIdRaw = String(req.query?.projectId ?? "").trim();
    const projectId = projectIdRaw || undefined;

    if (projectId) {
      await assertProjectMembership({
        projectId,
        userId: req.authUser.id,
        organisationId: req.authUser.organisationId,
        role: req.authUser.role,
      });
    } else if (req.authUser.role !== "ADMIN") {
      res.status(400).json({ ok: false, error: "projectId is required for non-admin users" });
      return;
    }

    const status = await getSearchStatus(projectId);
    res.json({ ok: true, status });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "search status failed" });
  }
});

router.get("/api/search/status/:projectId", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const status = await getSearchStatus(projectId);
    res.json({ ok: true, status });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "search status failed" });
  }
});

router.post("/api/search/recover-stale", requireAuth, rateLimitByUser(6, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectIdRaw = String(req.body?.projectId ?? "").trim();
    const projectId = projectIdRaw || undefined;
    if (projectId) {
      await assertProjectMembership({
        projectId,
        userId: req.authUser.id,
        organisationId: req.authUser.organisationId,
        role: req.authUser.role,
      });
    } else if (req.authUser.role !== "ADMIN") {
      res.status(400).json({ ok: false, error: "projectId is required for non-admin users" });
      return;
    }

    const maxAgeMinutes = Math.max(5, Math.min(24 * 60, Number(req.body?.maxAgeMinutes ?? 30)));
    const limit = Math.max(1, Math.min(1000, Number(req.body?.limit ?? 200)));
    const recovered = await recoverStaleRunningJobs({ projectId, maxAgeMinutes, limit });
    const processedImmediately = await processSearchJobsOnce(2);
    res.json({ ok: true, recovered, processedImmediately });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "recover stale jobs failed" });
  }
});

router.post("/api/search/retry-failed", requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.body?.projectId ?? "");
    const limit = Number(req.body?.limit ?? 100);
    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const requeued = await requeueFailedJobs(projectId, Math.max(1, Math.min(limit, 500)));
    const processedImmediately = await processSearchJobsOnce(2);
    res.json({ ok: true, requeued, processedImmediately });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "retry failed jobs failed" });
  }
});

router.get("/api/projects/:projectId/plan", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const plan = await getProjectPlanSnapshot(projectId);
    res.json({ ok: true, plan });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "project plan load failed" });
  }
});

router.post("/api/projects/:projectId/plan/save", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const plan = await saveProjectPlanSnapshot({
      projectId,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:save`,
      action: "PLAN_SAVE",
      userId: req.authUser.id,
      payload: {
        projectId,
        templateId: plan.templateId,
        projectType: plan.projectType,
      },
    });

    res.json({ ok: true, plan });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "project plan save failed" });
  }
});

router.post("/api/projects/:projectId/template/apply", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const templateId = String(req.body?.templateId || "");
    if (!projectId || !templateId) {
      res.status(400).json({ ok: false, error: "projectId and templateId are required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const plan = await applyTemplateForProject({
      projectId,
      templateId,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:template:${templateId}`,
      action: "TEMPLATE_APPLY",
      userId: req.authUser.id,
      payload: {
        projectId,
        templateId,
        projectType: plan.projectType,
      },
    });

    res.json({ ok: true, plan });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "template apply failed" });
  }
});

router.post("/api/projects/:projectId/stage-gates/:gateId/evaluate", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const gateId = String(req.params.gateId || "");
    if (!projectId || !gateId) {
      res.status(400).json({ ok: false, error: "projectId and gateId are required" });
      return;
    }

    const gateType = gateId.startsWith("gate-") ? gateId.replace(/^gate-/, "") : gateId;
    if (!allowedStageGateTypes.includes(gateType as StageGateType)) {
      res.status(400).json({ ok: false, error: "Invalid gateId" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const evaluated = await evaluateGateForProject({
      projectId,
      gateId,
      plan: asOptionalProjectPlan(req.body?.plan),
      context: {
        permitType: req.body?.permitType ? String(req.body.permitType) : undefined,
        codeType:
          req.body?.codeType === "SNI" || req.body?.codeType === "EWC"
            ? req.body.codeType
            : undefined,
        permitSubmitted: typeof req.body?.permitSubmitted === "boolean" ? req.body.permitSubmitted : undefined,
        mapLayerAvailable: parseMapLayerList(req.body?.mapLayerAvailable),
        note: req.body?.note ? String(req.body.note) : undefined,
      },
    });

    if (!evaluated.idempotent) {
      await appendDomainAudit({
        entityType: "ProjectPlan",
        entityId: `${projectId}:${evaluated.gate.id}`,
        action: "STAGE_GATE_EVALUATE",
        userId: req.authUser.id,
        payload: {
          projectId,
          gateId: evaluated.gate.id,
          status: evaluated.gate.status,
          changed: evaluated.changed,
        },
      });
    }

    res.json({
      ok: true,
      gate: evaluated.gate,
      changed: evaluated.changed,
      idempotent: evaluated.idempotent,
      plan: evaluated.plan,
    });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "stage gate evaluation failed" });
  }
});

router.post("/api/projects/:projectId/carbon/calculate", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const rawInput = (req.body?.carbonInput || {}) as Partial<CarbonInput>;
    const transportMode = String(rawInput.transportMode || "TRUCK") as CarbonInput["transportMode"];
    const materialType = String(rawInput.materialType || "SOIL") as CarbonInput["materialType"];
    if (!["TRUCK", "RAIL", "SHIP"].includes(transportMode) || !["SOIL", "ROCK", "WASTE", "MIXED"].includes(materialType)) {
      res.status(400).json({ ok: false, error: "Invalid carbon input mode or material type" });
      return;
    }

    const carbonInput: CarbonInput = {
      tons: Math.max(0, Number(rawInput.tons || 0)),
      distanceKm: rawInput.distanceKm ? Number(rawInput.distanceKm) : undefined,
      manualDistanceKm: rawInput.manualDistanceKm ? Number(rawInput.manualDistanceKm) : undefined,
      transportMode,
      materialType,
      emissionFactorKgCo2ePerTonKm: rawInput.emissionFactorKgCo2ePerTonKm
        ? Number(rawInput.emissionFactorKgCo2ePerTonKm)
        : undefined,
    };

    const payload = await calculateCarbonForProject({
      projectId,
      carbonInput,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:carbon`,
      action: "CARBON_CALCULATE",
      userId: req.authUser.id,
      payload: {
        projectId,
        totalKgCo2e: payload.result.totalKgCo2e,
        quality: payload.result.quality,
        method: payload.result.method,
      },
    });

    res.json({ ok: true, result: payload.result, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "carbon calculation failed" });
  }
});

router.post("/api/projects/:projectId/map-layers/recommend", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const requestedProjectType = req.body?.projectType ? String(req.body.projectType) : undefined;
    if (requestedProjectType && !allowedProjectTypes.includes(requestedProjectType as ProjectType)) {
      res.status(400).json({ ok: false, error: "Invalid projectType" });
      return;
    }

    const payload = await recommendMapLayersForProject({
      projectId,
      projectType: requestedProjectType as ProjectType | undefined,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:map-layers`,
      action: "MAP_LAYER_RECOMMEND",
      userId: req.authUser.id,
      payload: {
        projectId,
        projectType: payload.plan.projectType,
        enabledLayers: payload.recommendation.enabled,
      },
    });

    res.json({ ok: true, recommendation: payload.recommendation, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "map layer recommendation failed" });
  }
});

router.post("/api/projects/:projectId/dispatch/quote", requireAuth, rateLimitByUser(50, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const receiverId = String(req.body?.receiverId || "").trim();
    const receiverNameRaw = String(req.body?.receiverName || "").trim();
    const receiverName = receiverNameRaw || receiverId;
    const wasteCode = String(req.body?.wasteCode || "").trim();
    const tons = Number(req.body?.tons ?? 0);
    const distanceKmRaw = req.body?.distanceKm;
    const distanceKm =
      distanceKmRaw == null || distanceKmRaw === ""
        ? undefined
        : Math.max(0, Number(distanceKmRaw));

    if (!projectId || !receiverId || !wasteCode || !Number.isFinite(tons) || tons <= 0) {
      res.status(400).json({ ok: false, error: "projectId, receiverId, wasteCode and tons > 0 are required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await createDispatchQuoteForProject({
      projectId,
      receiverId,
      receiverName,
      wasteCode,
      tons,
      distanceKm,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:dispatch:quote:${payload.quote.id}`,
      action: "DISPATCH_QUOTE_CREATE",
      userId: req.authUser.id,
      payload: {
        projectId,
        quoteId: payload.quote.id,
        receiverId: payload.quote.receiverId,
        wasteCode: payload.quote.wasteCode,
        tons: payload.quote.tons,
      },
    });

    res.json({ ok: true, quote: payload.quote, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "dispatch quote failed" });
  }
});

router.post("/api/projects/:projectId/dispatch/book", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const quoteId = String(req.body?.quoteId || "").trim();
    const plannedPickupAt = req.body?.plannedPickupAt ? String(req.body.plannedPickupAt) : undefined;

    if (!projectId || !quoteId) {
      res.status(400).json({ ok: false, error: "projectId and quoteId are required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await bookTransportForProject({
      projectId,
      quoteId,
      plannedPickupAt,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:dispatch:booking:${payload.booking.id}`,
      action: "DISPATCH_BOOK",
      userId: req.authUser.id,
      payload: {
        projectId,
        bookingId: payload.booking.id,
        quoteId: payload.booking.quoteId,
        receiverId: payload.booking.receiverId,
        wasteCode: payload.booking.wasteCode,
        tons: payload.booking.tons,
      },
    });

    res.json({ ok: true, booking: payload.booking, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "dispatch booking failed" });
  }
});

router.post("/api/projects/:projectId/driver-journals/upsert", requireAuth, rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const journalPayload = (req.body?.journal || {}) as Record<string, unknown>;
    const bookingId = String(journalPayload.bookingId || "").trim();
    const driverName = String(journalPayload.driverName || "").trim();
    const vehicleId = String(journalPayload.vehicleId || "").trim();
    const origin = String(journalPayload.origin || "").trim();
    const destination = String(journalPayload.destination || "").trim();
    const wasteCode = String(journalPayload.wasteCode || "").trim();
    const tons = Number(journalPayload.tons ?? 0);
    const odometerStartKm = Number(journalPayload.odometerStartKm ?? 0);
    const odometerEndKmRaw = journalPayload.odometerEndKm;
    const odometerEndKm =
      odometerEndKmRaw == null || odometerEndKmRaw === ""
        ? undefined
        : Number(odometerEndKmRaw);

    if (!projectId || !bookingId || !driverName || !vehicleId || !origin || !destination) {
      res.status(400).json({ ok: false, error: "projectId and mandatory journal fields are required" });
      return;
    }
    if (!Number.isFinite(tons) || tons <= 0 || !Number.isFinite(odometerStartKm) || odometerStartKm < 0) {
      res.status(400).json({ ok: false, error: "journal tons and odometerStartKm must be valid numbers" });
      return;
    }
    if (odometerEndKm != null && (!Number.isFinite(odometerEndKm) || odometerEndKm < odometerStartKm)) {
      res.status(400).json({ ok: false, error: "odometerEndKm must be >= odometerStartKm" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await upsertDriverJournalForProject({
      projectId,
      journal: {
        id: journalPayload.id ? String(journalPayload.id) : undefined,
        bookingId,
        driverName,
        vehicleId,
        origin,
        destination,
        wasteCode,
        tons,
        startedAt: journalPayload.startedAt ? String(journalPayload.startedAt) : undefined,
        endedAt:
          journalPayload.endedAt == null || journalPayload.endedAt === ""
            ? null
            : String(journalPayload.endedAt),
        odometerStartKm,
        odometerEndKm,
        gpsTrackHash: journalPayload.gpsTrackHash ? String(journalPayload.gpsTrackHash) : undefined,
        status: parseOptionalDriverJournalStatus(journalPayload.status),
      },
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:journal:${payload.journal.id}`,
      action: "DRIVER_JOURNAL_UPSERT",
      userId: req.authUser.id,
      payload: {
        projectId,
        journalId: payload.journal.id,
        bookingId: payload.journal.bookingId,
        status: payload.journal.status,
      },
    });

    res.json({ ok: true, journal: payload.journal, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "driver journal upsert failed" });
  }
});

router.post("/api/projects/:projectId/driver-journals/:journalId/sign", requireAuth, rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const journalId = String(req.params.journalId || "");
    const signerRoleRaw = String(req.body?.signerRole || "").toUpperCase();
    const signerRole =
      signerRoleRaw === "DRIVER" || signerRoleRaw === "REVIEWER"
        ? (signerRoleRaw as "DRIVER" | "REVIEWER")
        : null;
    const signatureId = String(req.body?.signatureId || "").trim();

    if (!projectId || !journalId || !signerRole || !signatureId) {
      res.status(400).json({ ok: false, error: "projectId, journalId, signerRole and signatureId are required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await signDriverJournalForProject({
      projectId,
      journalId,
      signerRole,
      signatureId,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:journal:${payload.journal.id}`,
      action: "DRIVER_JOURNAL_SIGN",
      userId: req.authUser.id,
      payload: {
        projectId,
        journalId: payload.journal.id,
        signerRole,
        status: payload.journal.status,
      },
    });

    res.json({ ok: true, journal: payload.journal, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "driver journal sign failed" });
  }
});

router.post("/api/projects/:projectId/lims/ingest", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const reportPayload = (req.body?.report || {}) as Record<string, unknown>;
    const sampleId = String(reportPayload.sampleId || "").trim();
    const labName = String(reportPayload.labName || "").trim();
    const rawReference = String(reportPayload.rawReference || "").trim();
    const source = parseOptionalLimsSource(reportPayload.source) || "MANUAL";
    const bookingIdRaw = reportPayload.bookingId;
    const bookingId =
      bookingIdRaw == null || String(bookingIdRaw).trim() === ""
        ? undefined
        : String(bookingIdRaw).trim();
    const metricsRaw = Array.isArray(reportPayload.metrics) ? reportPayload.metrics : [];
    const metrics = metricsRaw
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const typed = item as Record<string, unknown>;
        return {
          key: String(typed.key || "").trim(),
          value: Number(typed.value ?? 0),
          unit: String(typed.unit || "").trim(),
          maxAllowed:
            typed.maxAllowed == null || typed.maxAllowed === ""
              ? undefined
              : Number(typed.maxAllowed),
        };
      })
      .filter((metric) => metric.key.length > 0 && Number.isFinite(metric.value) && metric.unit.length > 0);

    if (!projectId || !sampleId || !labName || !rawReference) {
      res.status(400).json({ ok: false, error: "projectId, sampleId, labName and rawReference are required" });
      return;
    }
    if (metrics.length === 0) {
      res.status(400).json({ ok: false, error: "At least one LIMS metric is required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await ingestLimsReportForProject({
      projectId,
      report: {
        bookingId,
        sampleId,
        labName,
        source,
        analyzedAt: reportPayload.analyzedAt ? String(reportPayload.analyzedAt) : undefined,
        rawReference,
        metrics,
        passed: typeof reportPayload.passed === "boolean" ? reportPayload.passed : undefined,
      },
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:lims:${payload.report.id}`,
      action: "LIMS_REPORT_INGEST",
      userId: req.authUser.id,
      payload: {
        projectId,
        reportId: payload.report.id,
        bookingId: payload.report.bookingId,
        sampleId: payload.report.sampleId,
        source: payload.report.source,
        passed: payload.report.passed,
      },
    });

    res.json({ ok: true, report: payload.report, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "lims ingest failed" });
  }
});

router.post("/api/projects/:projectId/lims/:reportId/verify", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const projectId = String(req.params.projectId || "");
    const reportId = String(req.params.reportId || "");
    const reviewer = String(req.body?.reviewer || "").trim();
    const signatureId = String(req.body?.signatureId || "").trim();
    const approved =
      typeof req.body?.approved === "boolean" ? req.body.approved : undefined;

    if (!projectId || !reportId || !reviewer || !signatureId) {
      res.status(400).json({ ok: false, error: "projectId, reportId, reviewer and signatureId are required" });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const payload = await verifyLimsReportForProject({
      projectId,
      reportId,
      reviewer,
      signatureId,
      approved,
      plan: asOptionalProjectPlan(req.body?.plan),
    });

    await appendDomainAudit({
      entityType: "ProjectPlan",
      entityId: `${projectId}:lims:${payload.report.id}`,
      action: "LIMS_REPORT_VERIFY",
      userId: req.authUser.id,
      payload: {
        projectId,
        reportId: payload.report.id,
        reviewer: payload.report.reviewer,
        passed: payload.report.passed,
        verifiedAt: payload.report.verifiedAt,
      },
    });

    res.json({ ok: true, report: payload.report, plan: payload.plan });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "lims verification failed" });
  }
});

router.get("/api/admin/projects", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const projects = await listProjectsForAdmin();
    res.json({ ok: true, projects });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "admin project list failed" });
  }
});

router.post("/api/admin/projects", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const propertyDesignationRaw = String(req.body?.propertyDesignation ?? "").trim();
    const propertyDesignation = propertyDesignationRaw || `ADMIN-INDEX-${new Date().toISOString().slice(0, 10)}`;

    const result = await createOrGetAdminProject({
      organisationId: req.authUser.organisationId,
      userId: req.authUser.id,
      propertyDesignation,
    });

    res.json({ ok: true, project: result.project, created: result.created });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "admin project create failed" });
  }
});

router.get("/api/admin/dispatch/provider", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const dispatch = getDispatchProviderRuntimeStatus();
    res.json({ ok: true, dispatch, checkedAt: new Date().toISOString() });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "dispatch status failed" });
  }
});

router.get("/api/admin/requirements/cases", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const page = parsePositiveInt(req.query?.page, 1, 1, 10_000);
    const pageSize = parsePositiveInt(req.query?.pageSize, 25, 1, 200);
    const payload = await listRequirementCases({
      page,
      pageSize,
      municipality: parseOptionalText(req.query?.municipality),
      documentType: parseOptionalText(req.query?.documentType),
      verificationStatus: parseOptionalRequirementStatus(req.query?.verificationStatus),
    });

    res.json({ ok: true, ...payload });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "requirements cases failed" });
  }
});

router.get("/api/admin/requirements/rows", requireAuth, rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const page = parsePositiveInt(req.query?.page, 1, 1, 10_000);
    const pageSize = parsePositiveInt(req.query?.pageSize, 25, 1, 200);
    const includePreliminary = parseBooleanFlag(req.query?.includePreliminary, true);
    const payload = await listRequirementRows({
      page,
      pageSize,
      municipality: parseOptionalText(req.query?.municipality),
      documentType: parseOptionalText(req.query?.documentType),
      category: parseOptionalText(req.query?.category),
      caseId: parseOptionalText(req.query?.caseId),
      requirementCode: parseOptionalText(req.query?.requirementCode),
      verificationStatus: parseOptionalRequirementStatus(req.query?.verificationStatus),
      includePreliminary,
    });

    res.json({ ok: true, ...payload });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "requirements rows failed" });
  }
});

router.get("/api/admin/requirements/citations", requireAuth, rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const page = parsePositiveInt(req.query?.page, 1, 1, 10_000);
    const pageSize = parsePositiveInt(req.query?.pageSize, 25, 1, 200);
    const includePreliminary = parseBooleanFlag(req.query?.includePreliminary, true);
    const payload = await listRequirementCitations({
      page,
      pageSize,
      requirementCode: parseOptionalText(req.query?.requirementCode),
      verificationStatus: parseOptionalRequirementStatus(req.query?.verificationStatus),
      includePreliminary,
    });

    res.json({ ok: true, ...payload });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "requirements citations failed" });
  }
});

router.patch("/api/admin/requirements/rows/:requirementCode/verify", requireAuth, rateLimitByUser(50, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const requirementCode = String(req.params.requirementCode || "").trim();
    const verificationStatus = parseOptionalRequirementStatus(req.body?.verificationStatus);
    const verifiedBy = parseOptionalText(req.body?.verifiedBy);
    const validationComment = parseOptionalText(req.body?.validationComment);
    const errorType = parseOptionalText(req.body?.errorType);

    if (!requirementCode || !verificationStatus) {
      res.status(400).json({ ok: false, error: "requirementCode and verificationStatus are required" });
      return;
    }

    const updated = await updateRequirementVerification({
      requirementCode,
      verificationStatus,
      verifiedBy,
      validationComment,
      errorType,
    });

    await appendDomainAudit({
      entityType: "RequirementRecord",
      entityId: updated.id,
      action: "REQUIREMENT_VERIFY",
      userId: req.authUser.id,
      payload: {
        requirementCode: updated.requirementCode,
        verificationStatus: updated.verificationStatus,
        verifiedBy: updated.verifiedBy,
      },
    });

    res.json({ ok: true, row: updated });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "requirement verify failed" });
  }
});

router.patch(
  "/api/admin/requirements/citations/:citationCode/verify",
  requireAuth,
  rateLimitByUser(50, 60_000),
  async (req, res) => {
    try {
      if (!req.authUser) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }
      if (req.authUser.role !== "ADMIN") {
        res.status(403).json({ ok: false, error: "Admin role required" });
        return;
      }

      const citationCode = String(req.params.citationCode || "").trim();
      const verificationStatus = parseOptionalRequirementStatus(req.body?.verificationStatus);
      const verifiedBy = parseOptionalText(req.body?.verifiedBy);
      const comment = parseOptionalText(req.body?.comment);
      const pageNumber =
        req.body?.pageNumber == null || req.body?.pageNumber === ""
          ? undefined
          : parsePositiveInt(req.body?.pageNumber, 1, 1, 10_000);

      if (!citationCode || !verificationStatus) {
        res.status(400).json({ ok: false, error: "citationCode and verificationStatus are required" });
        return;
      }

      const updated = await updateCitationVerification({
        citationCode,
        verificationStatus,
        verifiedBy,
        comment,
        pageNumber,
      });

      await appendDomainAudit({
        entityType: "RequirementCitation",
        entityId: updated.id,
        action: "CITATION_VERIFY",
        userId: req.authUser.id,
        payload: {
          citationCode: updated.citationCode,
          verificationStatus: updated.verificationStatus,
          verifiedBy: updated.verifiedBy,
        },
      });

      res.json({ ok: true, citation: updated });
    } catch (error: unknown) {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "citation verify failed" });
    }
  }
);

router.get("/api/admin/requirements/documents/:documentId/view", requireAuth, rateLimitByUser(50, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const documentId = String(req.params.documentId || "").trim();
    if (!documentId) {
      res.status(400).json({ ok: false, error: "documentId is required" });
      return;
    }

    const document = await getDocumentById(documentId);
    if (!document || !document.absolutePath) {
      res.status(404).json({ ok: false, error: "Document not found" });
      return;
    }
    if (!fs.existsSync(document.absolutePath)) {
      res.status(404).json({ ok: false, error: "Document file missing on server" });
      return;
    }

    await appendDomainAudit({
      entityType: "DocumentRecord",
      entityId: document.id,
      action: "REQUIREMENT_DOCUMENT_VIEW",
      userId: req.authUser.id,
      payload: {
        documentId: document.id,
        mimeType: document.mimeType || "application/pdf",
      },
    });

    const stream = fs.createReadStream(document.absolutePath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(document.originalName || "document.pdf")}"`);
    stream.pipe(res);
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "document view failed" });
  }
});

router.get("/api/admin/requirements/reports/summary", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const includePreliminary = parseBooleanFlag(req.query?.includePreliminary, false);
    const payload = await buildRequirementsReportSummary({ includePreliminary });
    res.json({ ok: true, summary: payload.summary });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "report summary failed" });
  }
});

router.get("/api/admin/requirements/reports/export.csv", requireAuth, rateLimitByUser(15, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const includePreliminary = parseBooleanFlag(req.query?.includePreliminary, false);
    const stream = await buildRequirementsExportCsvZip({ includePreliminary });
    const filename = exportFilename("kravrapport", "zip");

    await appendDomainAudit({
      entityType: "RequirementReport",
      entityId: "requirements-export-csv",
      action: "REPORT_EXPORT_CSV",
      userId: req.authUser.id,
      payload: { includePreliminary, filename },
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    stream.pipe(res);
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "csv export failed" });
  }
});

router.post("/api/admin/requirements/reports/export.docx", requireAuth, rateLimitByUser(15, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const includePreliminary = parseBooleanFlag(req.body?.includePreliminary, false);
    const buffer = await buildRequirementsDocxBuffer({ includePreliminary });
    const filename = exportFilename("kravrapport", "docx");

    await appendDomainAudit({
      entityType: "RequirementReport",
      entityId: "requirements-export-docx",
      action: "REPORT_EXPORT_DOCX",
      userId: req.authUser.id,
      payload: { includePreliminary, filename },
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "docx export failed" });
  }
});

router.get("/api/admin/exam-summary", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const summary = await getAdminExamSummary();
    res.json({ ok: true, summary });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "admin exam summary failed" });
  }
});

router.get("/api/admin/database-dump", requireAuth, rateLimitByUser(5, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const limitRaw = Number(req.query?.limitPerTable ?? 0);
    const includeSearchTextRaw = String(req.query?.includeSearchText ?? "true").toLowerCase();
    const includeChunkTextRaw = String(req.query?.includeChunkText ?? "true").toLowerCase();
    const includeSearchText = !["false", "0", "no"].includes(includeSearchTextRaw);
    const includeChunkText = !["false", "0", "no"].includes(includeChunkTextRaw);

    const dump = await getAdminDatabaseDump({
      limitPerTable: Number.isFinite(limitRaw) ? limitRaw : undefined,
      includeSearchText,
      includeChunkText,
    });
    res.json({ ok: true, dump });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "admin database dump failed" });
  }
});

export default router;
