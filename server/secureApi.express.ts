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
import { isValidRole, listProjectMembers, removeProjectMember, upsertProjectMember } from "./services/projectMemberService";
import { notifyStageGate, sendProjectNotification } from "./services/notificationService";
import { searchGraph, getGraphStats } from "./services/knowledgeGraphService";
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
  ProjectAccessRole,
  ProjectMemberRecord,
  ProjectPlan,
  ProjectType,
  StageGateType,
} from "../types";
import { getAdminDatabaseDump, getAdminExamSummary, getAppCompletion, getAppStatus, getDbAnalysis, getDbContents, getDbStats } from "./repositories/adminReportRepository";
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
import {
  createInvitation,
  listInvitations,
  acceptInvitation,
  revokeInvitation,
} from "./services/orgInvitationService";
import { submitPermitToAuthority, getSubmission } from "./services/permitAuthorityService";
import { getMarketSnapshot, invalidateMarketCache } from "./services/marketIntelService";
import {
  enqueueExecSummary,
  getJobStatus as getExecSummaryJobStatus,
  listJobsForProject as listExecSummaryJobs,
} from "./services/execSummaryQueueService";
import { getMarkCoverLayer } from "./services/markCoverService";
import {
  triggerIngestionWebhook,
  getSchedulerStatus as getOutlookSchedulerStatus,
} from "./services/outlookSchedulerService";
import { runRagSearch } from "./services/ragSearchService";
import {
  addGpsPosition,
  getGpsTrack,
  getLatestPosition as getLatestGpsPosition,
} from "./services/gpsTrackingService";
import { signDocumentEidas } from "./services/eidasSignatureService";
import { getTerrainData } from "./services/terrainService";
import {
  extractTextFromDocument,
  batchExtractPendingDocuments,
} from "./services/ocrService";
import { autoFetchLimsReports } from "./services/limsAutoFetchService";
import { getMetricsText } from "./services/metricsService";
import { captureException, getRecentErrors } from "./services/errorTrackingService";
import { runBackup, listBackups, getBackup } from "./services/backupService";
import { getFullStatus } from "./services/fullStatusService";

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
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Health check failed" });
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

router.get("/api/search/info", requireAuth, rateLimitByUser(60, 60_000), (_req, res) => {
  res.json({
    ok: true,
    info: {
      description: "Vad är sökbart i dokumentdatabasen",
      modes: [
        {
          id: "hybrid",
          label: "Hybrid (rekommenderat)",
          description: "Kombinerar semantisk (vektorsökning) med lexikal matchning. Ger bäst precision och recall.",
        },
        {
          id: "semantic",
          label: "Semantisk",
          description: "Vektorsökning med pgvector. Hittar dokument med liknande innebörd även utan exakta nyckelord.",
        },
        {
          id: "lexical",
          label: "Lexikal",
          description: "Nyckelordsmatchning mot ämne, filnamn och disk-ID. Snabb och deterministisk.",
        },
      ],
      fullTextFields: [
        { field: "content.searchText", label: "Dokumenttext (fulltext)", source: "Extraherad text ur PDF/bild via OCR eller direktextrahering", searchable: true },
        { field: "chunks[].chunkText", label: "Textstycken (semantiska chunks)", source: "Dokumentet delas in i ~180-ords-stycken för semantisk sökning", searchable: true },
      ],
      metadataFilterFields: [
        { field: "municipality", label: "Kommun", type: "string", example: "Orsa", description: "Exakt matchning (case-insensitive)" },
        { field: "decisionType", label: "Ärendetyp / beslutstyp", type: "string", example: "Tillstånd", description: "Typ av miljöbeslut" },
        { field: "wasteType", label: "Avfallstyp", type: "string", example: "Schaktmassor", description: "Typ av avfall" },
        { field: "legalStatus", label: "Juridisk status", type: "string", example: "Aktiv", description: "Rättslig status för ärendet" },
        { field: "hazardousFlag", label: "Farligt avfall", type: "boolean", example: true, description: "true = farligt avfall, false = icke-farligt" },
        { field: "status", label: "Bearbetningsstatus", type: "enum", values: ["METADATA_ONLY", "TEXT_EXTRACTED", "CHUNKED", "EMBEDDED", "FAILED"], description: "Dokumentets indexeringsstatus" },
        { field: "dateFrom / dateTo", label: "Tidsintervall", type: "date", example: "2023-01-01", description: "Filtrerar på receivedTime (när ärendet inkom)" },
      ],
      lexicalMatchFields: [
        { field: "subject", label: "Ämne / ärendetitel", description: "Rubriken på dokumentet eller e-postmeddelandet" },
        { field: "originalName", label: "Originalfilnamn", description: "Det filnamn som lämnades in med ärendet" },
        { field: "diskName", label: "Diskfilnamn", description: "Internt unikt filnamn på servern" },
      ],
      queryParameters: {
        query: "Fritext att söka efter (obligatorisk för semantik/lexikal)",
        mode: "hybrid | semantic | lexical",
        topK: "Antal träffar att returnera (1–100, default 20)",
        strictEvidence: "true = returnera bara dokument med citeringsstöd (default true)",
        projectId: "Begränsa sökning till ett specifikt projekt (admin kan söka globalt)",
        filters: "Objekt med metadatafilter (se metadataFilterFields ovan)",
      },
    },
  });
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

      // ── Notifiera projektmedlemmar om gate-statusbyte ───────────────────
      void notifyStageGate({
        projectId,
        gateId: evaluated.gate.id,
        status: String(evaluated.gate.status ?? 'BLOCKED'),
        actingUserId: req.authUser.id,
      }).catch(() => {/* best-effort */});
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

// ── Projektmedlemmar ────────────────────────────────────────────────────────

router.get("/api/projects/:projectId/members", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const projectId = String(req.params.projectId || "");
    if (!projectId) { res.status(400).json({ ok: false, error: "projectId is required" }); return; }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const members: ProjectMemberRecord[] = await listProjectMembers(projectId);
    res.json({ ok: true, members });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "list members failed" });
  }
});

router.put("/api/projects/:projectId/members", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const projectId = String(req.params.projectId || "");
    const targetBankidId = String(req.body?.bankidId ?? "").trim();
    const role = String(req.body?.role ?? "") as ProjectAccessRole;

    if (!projectId || !targetBankidId || !role) {
      res.status(400).json({ ok: false, error: "projectId, bankidId and role are required" });
      return;
    }
    if (!isValidRole(role)) {
      res.status(400).json({ ok: false, error: `Invalid role. Must be one of: OWNER, CONTRIBUTOR, REVIEWER, AUDITOR` });
      return;
    }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const member = await upsertProjectMember({
      projectId,
      targetBankidId,
      role,
      actingUserId: req.authUser.id,
    });

    // Notifiera
    void sendProjectNotification({
      projectId,
      event: 'MEMBER_ADDED',
      subjectUserId: member.userId,
      actingUserId: req.authUser.id,
      message: `Användare ${targetBankidId} lades till i projekt ${projectId} med roll ${role}.`,
    }).catch(() => {/* best-effort */});

    res.json({ ok: true, member });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "upsert member failed" });
  }
});

router.delete("/api/projects/:projectId/members/:memberId", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const projectId = String(req.params.projectId || "");
    const memberId = String(req.params.memberId || "");
    if (!projectId || !memberId) { res.status(400).json({ ok: false, error: "projectId and memberId are required" }); return; }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    await removeProjectMember({
      projectId,
      memberId,
      actingUserId: req.authUser.id,
    });

    void sendProjectNotification({
      projectId,
      event: 'MEMBER_REMOVED',
      actingUserId: req.authUser.id,
      message: `Projektmedlem ${memberId} togs bort från projekt ${projectId}.`,
    }).catch(() => {/* best-effort */});

    res.json({ ok: true });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "remove member failed" });
  }
});

// ── Kunskapsgraf-sökning ────────────────────────────────────────────────────

router.get("/api/admin/knowledge-graph/search", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    if (req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin role required" }); return; }

    const query = String(req.query.q ?? "").trim();
    if (!query) { res.status(400).json({ ok: false, error: "Query parameter 'q' is required" }); return; }

    const nodeTypes = req.query.nodeTypes
      ? String(req.query.nodeTypes).split(",").map(t => t.trim()).filter(Boolean)
      : undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;

    const [result, stats] = await Promise.all([
      searchGraph({ query, nodeTypes, limit }),
      getGraphStats(),
    ]);

    res.json({ ok: true, query, nodes: result.nodes, edges: result.edges, stats });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "knowledge graph search failed" });
  }
});

router.get("/api/admin/knowledge-graph/stats", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    if (req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin role required" }); return; }

    const stats = await getGraphStats();
    res.json({ ok: true, stats });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "knowledge graph stats failed" });
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

// ── Fältanalys — spara AI-analysresultat ───────────────────────────────────

router.post("/api/projects/:projectId/field-analysis", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const projectId = String(req.params.projectId || "");
    if (!projectId) { res.status(400).json({ ok: false, error: "projectId is required" }); return; }

    await assertProjectMembership({
      projectId,
      userId: req.authUser.id,
      organisationId: req.authUser.organisationId,
      role: req.authUser.role,
    });

    const mode = String(req.body?.mode ?? "site");
    const analysisType = String(req.body?.analysisType ?? "standard");
    const result = String(req.body?.result ?? "");
    const filename = req.body?.filename ? String(req.body.filename) : undefined;

    if (!result) { res.status(400).json({ ok: false, error: "result is required" }); return; }

    const record = await appendDomainAudit({
      entityType: "FieldAnalysis",
      entityId: projectId,
      action: "FIELD_ANALYSIS_SAVED",
      userId: req.authUser.id,
      payload: { projectId, mode, analysisType, resultLength: result.length, filename: filename ?? null },
    });

    res.json({ ok: true, saved: true, auditId: record.id, projectId, mode, analysisType });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "field analysis save failed" });
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

router.get("/api/admin/app-status", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const status = await getAppStatus();
    res.json({ ok: true, status });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "app status check failed" });
  }
});

router.get("/api/admin/completion", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const completion = await getAppCompletion();
    res.json({ ok: true, completion });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "completion check failed" });
  }
});

router.get("/api/admin/db-stats", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const stats = await getDbStats();
    res.json({ ok: true, stats });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "db stats failed" });
  }
});

router.get("/api/admin/db-analysis", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const analysis = await getDbAnalysis();
    res.json({ ok: true, analysis });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "db analysis failed" });
  }
});

router.get("/api/admin/db-contents", requireAuth, rateLimitByUser(15, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const limitParam = parseInt(String(req.query.limit ?? "10"), 10);
    const limit = Number.isFinite(limitParam) ? limitParam : 10;
    const contents = await getDbContents(limit);
    res.json({ ok: true, contents });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "db contents failed" });
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

// ─────────────────────────────────────────────────────────────────────────────
// Organisation Invitations  (auth-org-management)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/api/orgs/:orgId/invitations", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { email, role } = req.body as { email?: string; role?: string };
    if (!email || !role) { res.status(400).json({ ok: false, error: "email och role krävs" }); return; }

    const invitation = await createInvitation({
      orgId: req.params.orgId,
      email,
      role,
      actingUserId: req.authUser.userId,
    });
    res.json({ ok: true, invitation });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "invitation create failed" });
  }
});

router.get("/api/orgs/:orgId/invitations", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const invitations = listInvitations(req.params.orgId);
    res.json({ ok: true, invitations });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "list invitations failed" });
  }
});

router.post("/api/orgs/:orgId/invitations/accept", rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    const { token, bankidId } = req.body as { token?: string; bankidId?: string };
    if (!token || !bankidId) { res.status(400).json({ ok: false, error: "token och bankidId krävs" }); return; }

    const result = await acceptInvitation({ orgId: req.params.orgId, token, bankidId });
    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "accept invitation failed" });
  }
});

router.delete("/api/orgs/:orgId/invitations/:inviteId", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    await revokeInvitation({ orgId: req.params.orgId, inviteId: req.params.inviteId, actingUserId: req.authUser.userId });
    res.json({ ok: true });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "revoke invitation failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Permit Authority Submission  (permit-application-wizard + permit-authority-submit)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/api/projects/:projectId/permit/authority-submit", requireAuth, rateLimitByUser(10, 60_000), rateLimitByOrg(50, 60 * 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    await assertPermission(req.authUser, req.params.projectId);

    const { permitType, applicantName, propertyDesignation, documentIds, authorityName } =
      req.body as {
        permitType?: string;
        applicantName?: string;
        propertyDesignation?: string;
        documentIds?: string[];
        authorityName?: string;
      };

    if (!permitType || !applicantName || !propertyDesignation) {
      res.status(400).json({ ok: false, error: "permitType, applicantName och propertyDesignation krävs" });
      return;
    }

    const submission = await submitPermitToAuthority({
      projectId: req.params.projectId,
      orgId: req.authUser.orgId,
      actingUserId: req.authUser.userId,
      permitType,
      applicantName,
      propertyDesignation,
      documentIds: Array.isArray(documentIds) ? documentIds : [],
      authorityName,
    });

    res.json({ ok: true, submission });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "permit authority submit failed" });
  }
});

router.get("/api/projects/:projectId/permit/submissions/:referenceId", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const submission = getSubmission(req.params.referenceId);
    if (!submission) { res.status(404).json({ ok: false, error: "Inlämning hittades inte" }); return; }
    res.json({ ok: true, submission });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "get submission failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Market Intelligence  (logistics-market-view)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/api/market-intel/prices", requireAuth, rateLimitByUser(60, 60_000), async (_req, res) => {
  try {
    const snapshot = await getMarketSnapshot();
    res.json({ ok: true, snapshot });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "market intel failed" });
  }
});

router.post("/api/market-intel/cache/invalidate", requireAuth, rateLimitByUser(5, 60_000), (req, res) => {
  if (!req.authUser || req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }
  invalidateMarketCache();
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Executive Summary Queue  (compliance-executive-summary)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/api/projects/:projectId/exec-summary/enqueue", requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    await assertPermission(req.authUser, req.params.projectId);

    const job = await enqueueExecSummary({ projectId: req.params.projectId, userId: req.authUser.userId });
    res.json({ ok: true, job });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "enqueue exec summary failed" });
  }
});

router.get("/api/projects/:projectId/exec-summary/status/:jobId", requireAuth, rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const job = getExecSummaryJobStatus(req.params.jobId);
    if (!job) { res.status(404).json({ ok: false, error: "Jobb hittades inte" }); return; }
    res.json({ ok: true, job });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "exec summary status failed" });
  }
});

router.get("/api/projects/:projectId/exec-summary/jobs", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    await assertPermission(req.authUser, req.params.projectId);
    const jobs = listExecSummaryJobs(req.params.projectId);
    res.json({ ok: true, jobs });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "list exec summary jobs failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LULC Marktäcke Layer  (geo-markcover)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/api/geo/markcover", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    const bboxStr = String(req.query.bbox ?? "");
    const bbox = parseBbox(bboxStr);
    if (!bbox) { res.status(400).json({ ok: false, error: "bbox krävs: minLng,minLat,maxLng,maxLat" }); return; }

    const layer = await getMarkCoverLayer(bbox as [number, number, number, number]);
    res.json({ ok: true, layer });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "markcover failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Outlook Ingestion Webhook + Scheduler Status  (search-outlook-ingestion)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/api/admin/outlook/webhook", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    // Microsoft Graph validation token handshake
    const validationToken = req.query.validationToken as string | undefined;
    if (validationToken) {
      res.status(200).type("text/plain").send(validationToken);
      return;
    }

    const rawBody = JSON.stringify(req.body);
    const signature = req.headers["x-ms-signature"] as string | undefined;

    const result = await triggerIngestionWebhook({ rawBody, signature });
    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "webhook trigger failed" });
  }
});

router.get("/api/admin/outlook/scheduler/status", requireAuth, rateLimitByUser(20, 60_000), (req, res) => {
  if (!req.authUser || req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }
  const status = getOutlookSchedulerStatus();
  res.json({ ok: true, status });
});

// ─────────────────────────────────────────────────────────────────────────────
// General RAG Search  (ai-rag-search)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/api/search/rag", requireAuth, rateLimitByUser(30, 60_000), rateLimitByOrg(300, 60 * 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { query, projectId, limit, language } =
      req.body as { query?: string; projectId?: string; limit?: number; language?: "sv" | "en" };

    if (!query || String(query).trim().length === 0) {
      res.status(400).json({ ok: false, error: "query krävs" });
      return;
    }

    const result = await runRagSearch({
      query: String(query).trim(),
      projectId,
      limit: typeof limit === "number" ? limit : undefined,
      language: language === "en" ? "en" : "sv",
    });

    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "rag search failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GPS Tracking  (logistics-gps-tracking)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/api/projects/:projectId/transport/:bookingId/gps/update", requireAuth, rateLimitByUser(120, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { lat, lng, altitude, speedKmh, heading, accuracy } =
      req.body as {
        lat?: number;
        lng?: number;
        altitude?: number;
        speedKmh?: number;
        heading?: number;
        accuracy?: number;
      };

    if (typeof lat !== "number" || typeof lng !== "number") {
      res.status(400).json({ ok: false, error: "lat och lng (number) krävs" });
      return;
    }

    const position = await addGpsPosition({
      bookingId: req.params.bookingId,
      projectId: req.params.projectId,
      lat,
      lng,
      altitude,
      speedKmh,
      heading,
      accuracy,
      actingUserId: req.authUser.userId,
    });

    res.json({ ok: true, position });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "gps update failed" });
  }
});

router.get("/api/projects/:projectId/transport/:bookingId/gps", requireAuth, rateLimitByUser(60, 60_000), (req, res) => {
  try {
    const track = getGpsTrack(req.params.bookingId);
    res.json({ ok: true, track });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "gps track failed" });
  }
});

router.get("/api/projects/:projectId/transport/:bookingId/gps/latest", requireAuth, rateLimitByUser(120, 60_000), (req, res) => {
  try {
    const position = getLatestGpsPosition(req.params.bookingId);
    if (!position) { res.status(404).json({ ok: false, error: "Ingen position registrerad" }); return; }
    res.json({ ok: true, position });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "gps latest failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// eIDAS Digital Signature  (compliance-digital-signature)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/api/documents/:documentId/sign/eidas", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { signerPersonalNumber, signerName, signatureText, format, level } =
      req.body as {
        signerPersonalNumber?: string;
        signerName?: string;
        signatureText?: string;
        format?: "PAdES" | "XAdES" | "CAdES";
        level?: "ADVANCED" | "QUALIFIED";
      };

    if (!signerPersonalNumber || !signerName) {
      res.status(400).json({ ok: false, error: "signerPersonalNumber och signerName krävs" });
      return;
    }

    const result = await signDocumentEidas(
      {
        documentId: req.params.documentId,
        signerPersonalNumber,
        signerName,
        signatureText,
        format,
        level,
      },
      req.authUser.userId,
    );

    res.json({ ok: true, signature: result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "eidas sign failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3D Terrain  (geo-3d-terrain)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/api/geo/terrain", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const bboxStr = String(req.query.bbox ?? "");
    const bbox = parseBbox(bboxStr);
    if (!bbox) { res.status(400).json({ ok: false, error: "bbox krävs: minLng,minLat,maxLng,maxLat" }); return; }

    const resolutionRaw = parseInt(String(req.query.resolution ?? "32"), 10);
    const resolution = Number.isFinite(resolutionRaw) ? resolutionRaw : 32;

    const terrain = await getTerrainData(bbox as [number, number, number, number], resolution);
    res.json({ ok: true, terrain });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "terrain data failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// OCR  (search-ocr)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/api/admin/ocr/extract/:documentId", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    if (req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }

    const result = await extractTextFromDocument(req.params.documentId, req.authUser.userId);
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "ocr extract failed" });
  }
});

router.post("/api/admin/ocr/batch", requireAuth, rateLimitByUser(5, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    if (req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }

    const limitRaw = parseInt(String((req.body as { limit?: unknown })?.limit ?? "50"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(limitRaw, 200) : 50;

    const result = await batchExtractPendingDocuments(req.authUser.userId, limit);
    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "ocr batch failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Automatic LIMS Fetch  (field-lims-integration)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/api/projects/:projectId/lims/auto-fetch", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    await assertPermission(req.authUser, req.params.projectId);

    const { since } = req.body as { since?: string };

    const result = await autoFetchLimsReports({
      projectId: req.params.projectId,
      actingUserId: req.authUser.userId,
      since,
    });

    res.json({ ok: true, result });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "lims auto-fetch failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Prometheus Metrics  (admin-monitoring)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/metrics", async (req, res) => {
  // Protect metrics endpoint: require Bearer token or restrict to localhost
  const metricsToken = process.env.METRICS_BEARER_TOKEN;
  if (metricsToken) {
    const authHeader = req.headers.authorization ?? "";
    if (authHeader !== `Bearer ${metricsToken}`) {
      res.status(401).set("WWW-Authenticate", "Bearer").end();
      return;
    }
  } else {
    // Only allow from loopback if no token configured
    const clientIp = req.ip ?? req.socket.remoteAddress ?? "";
    const isLocal = clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "::ffff:127.0.0.1";
    if (!isLocal) {
      res.status(403).end();
      return;
    }
  }

  try {
    const text = await getMetricsText();
    res.status(200).type("text/plain; version=0.0.4; charset=utf-8").send(text);
  } catch (error: unknown) {
    res.status(500).end();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Tracking  (admin-error-tracking)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/api/admin/errors/recent", requireAuth, rateLimitByUser(20, 60_000), (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    if (req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }

    const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(limitRaw, 500) : 50;
    const severity = req.query.severity as string | undefined;

    const errors = getRecentErrors({ limit, severity: severity as Parameters<typeof getRecentErrors>[0]["severity"] });
    res.json({ ok: true, errors, total: errors.length });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "get errors failed" });
  }
});

router.post("/api/admin/errors/capture", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { message, severity, context } =
      req.body as { message?: string; severity?: string; context?: Record<string, unknown> };

    if (!message) { res.status(400).json({ ok: false, error: "message krävs" }); return; }

    const err = new Error(message);
    const id = await captureException(err, {
      userId: req.authUser.userId,
      extra: context,
      severity: (["fatal", "error", "warning", "info"].includes(severity ?? "") ? severity : "error") as Parameters<typeof captureException>[1]["severity"],
    });

    res.json({ ok: true, errorId: id });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "capture error failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Database Backup  (admin-backup)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/api/admin/backup/trigger", requireAuth, rateLimitByUser(3, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    if (req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }

    const manifest = await runBackup(req.authUser.userId);
    res.json({ ok: true, manifest });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "backup failed" });
  }
});

router.get("/api/admin/backup/list", requireAuth, rateLimitByUser(20, 60_000), (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    if (req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }

    const backups = listBackups();
    res.json({ ok: true, backups });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "list backups failed" });
  }
});

router.get("/api/admin/backup/:backupId", requireAuth, rateLimitByUser(10, 60_000), (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    if (req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }

    const backup = getBackup(req.params.backupId);
    if (!backup) { res.status(404).json({ ok: false, error: "Backup hittades inte" }); return; }
    res.json({ ok: true, backup });
  } catch (error: unknown) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "get backup failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Full Status Analysis
// GET /api/admin/full-status
// Fullständig statusanalys av alla funktioner, integrationer och DB-innehåll.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/api/admin/full-status", requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }

    const report = await getFullStatus();
    res.json({ ok: true, report });
  } catch (error: unknown) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "full status analysis failed" });
  }
});

export default router;
