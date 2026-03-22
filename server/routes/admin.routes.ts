import express from "express";
import { requireAuth } from "../security/auth";
import { rateLimitByUser } from "../security/rateLimit";
import { toSafeErrorResponse } from "../security/secureErrors";
import { 
  getAppStatus, 
  getAppCompletion, 
  getExternalHealth, 
  getDbStats, 
  getDbAnalysis, 
  getDbContents, 
  getAdminExamSummary, 
  getAdminDatabaseDump 
} from "../repositories/adminReportRepository";
import { listProjectsForAdmin, createOrGetAdminProject } from "../repositories/searchRepository";
import { getDispatchProviderRuntimeStatus } from "../services/transportDispatchService";
import {
  getSchedulerStatus as getOutlookSchedulerStatus,
  triggerIngestionWebhook,
} from "../services/outlookSchedulerService";
import { getMetricsText } from "../services/metricsService";
import { getRecentErrors, captureException } from "../services/errorTrackingService";
import { runBackup, listBackups, getBackup } from "../services/backupService";
import { 
  extractTextFromDocument, 
  batchExtractPendingDocuments 
} from "../services/ocrService";
import { parseOptionalText, routeParam } from "../utils/routeUtils";

const router = express.Router();

// Projects (Admin)
router.get("/api/admin/projects", requireAuth, rateLimitByUser(40, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }
    const projects = await listProjectsForAdmin(req.authUser.organisationId);
    res.json({ ok: true, projects });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/admin/projects", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") {
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
    res.status(400).json(toSafeErrorResponse(error));
  }
});

// App / System Status
router.get("/api/admin/app-status", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }
    const status = await getAppStatus();
    res.json({ ok: true, status });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get("/api/admin/completion", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }
    const completion = await getAppCompletion();
    res.json({ ok: true, completion });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get("/api/admin/external-health", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }
    const report = await getExternalHealth();
    res.json({ ok: true, report });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

// Database
router.get("/api/admin/db-stats", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }
    const stats = await getDbStats();
    res.json({ ok: true, stats });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get("/api/admin/db-analysis", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }
    const analysis = await getDbAnalysis();
    res.json({ ok: true, analysis });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get("/api/admin/db-contents", requireAuth, rateLimitByUser(15, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }
    const limitParam = parseInt(String(req.query.limit ?? "10"), 10);
    const limit = Number.isFinite(limitParam) ? limitParam : 10;
    const contents = await getDbContents(limit);
    res.json({ ok: true, contents });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get("/api/admin/exam-summary", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Admin role required" });
      return;
    }
    const summary = await getAdminExamSummary();
    res.json({ ok: true, summary });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get("/api/admin/database-dump", requireAuth, rateLimitByUser(5, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") {
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
    res.status(400).json(toSafeErrorResponse(error));
  }
});

// Outlook
router.post("/api/admin/outlook/webhook", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const validationToken = parseOptionalText(req.query.validationToken);
    if (validationToken) {
      res.status(200).type("text/plain").send(validationToken);
      return;
    }
    const rawBody = JSON.stringify(req.body);
    const signature = parseOptionalText(req.headers["x-ms-signature"]);
    const result = await triggerIngestionWebhook({ rawBody, signature });
    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.get("/api/admin/outlook/scheduler/status", requireAuth, rateLimitByUser(20, 60_000), (req, res) => {
  if (!req.authUser || req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }
  const status = getOutlookSchedulerStatus();
  res.json({ ok: true, status });
});

// Metrics
router.get("/metrics", async (req, res) => {
  const metricsToken = process.env.METRICS_BEARER_TOKEN;
  if (metricsToken) {
    const authHeader = req.headers.authorization ?? "";
    if (authHeader !== `Bearer ${metricsToken}`) {
      res.status(401).set("WWW-Authenticate", "Bearer").end();
      return;
    }
  } else {
    const clientIp = req.ip ?? req.socket.remoteAddress ?? "";
    const isLocal = clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "::ffff:127.0.0.1";
    if (!isLocal) { res.status(403).end(); return; }
  }
  try {
    const text = await getMetricsText();
    res.status(200).type("text/plain; version=0.0.4; charset=utf-8").send(text);
  } catch { res.status(500).end(); }
});

// Errors
router.get("/api/admin/errors/recent", requireAuth, rateLimitByUser(20, 60_000), (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }
    const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(limitRaw, 500) : 50;
    const severity = parseOptionalText(req.query.severity);
    const errors = getRecentErrors({ limit, severity: severity as any });
    res.json({ ok: true, errors, total: errors.length });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

router.post("/api/admin/errors/capture", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { message, severity, context } = req.body as { message?: string; severity?: string; context?: Record<string, unknown> };
    if (!message) { res.status(400).json({ ok: false, error: "message krävs" }); return; }
    const err = new Error(message);
    const id = await captureException(err, {
      userId: req.authUser.id,
      extra: context,
      severity: (["fatal", "error", "warning", "info"].includes(severity ?? "") ? severity : "error") as any,
    });
    res.json({ ok: true, errorId: id });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

// Backup
router.post("/api/admin/backup/trigger", requireAuth, rateLimitByUser(3, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }
    const manifest = await runBackup(req.authUser.id);
    res.json({ ok: true, manifest });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

router.get("/api/admin/backup/list", requireAuth, rateLimitByUser(20, 60_000), (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }
    const backups = listBackups();
    res.json({ ok: true, backups });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

router.get("/api/admin/backup/:backupId", requireAuth, rateLimitByUser(10, 60_000), (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }
    const backup = getBackup(routeParam(req.params.backupId));
    if (!backup) { res.status(404).json({ ok: false, error: "Backup hittades inte" }); return; }
    res.json({ ok: true, backup });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

// OCR
router.post("/api/admin/ocr/extract/:documentId", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }
    const result = await extractTextFromDocument(routeParam(req.params.documentId), req.authUser.id);
    res.json({ ok: true, result });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

router.post("/api/admin/ocr/batch", requireAuth, rateLimitByUser(5, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin required" }); return; }
    const limitRaw = parseInt(String((req.body as { limit?: unknown })?.limit ?? "50"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(limitRaw, 200) : 50;
    const result = await batchExtractPendingDocuments(req.authUser.id, limit);
    res.json({ ok: true, result });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

// Misc
router.get("/api/admin/dispatch/provider", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== "ADMIN") { res.status(403).json({ ok: false, error: "Admin role required" }); return; }
    const dispatch = getDispatchProviderRuntimeStatus();
    res.json({ ok: true, dispatch, checkedAt: new Date().toISOString() });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

export default router;
