import express from "express";
import { requireAuth } from "../security/auth";
import { rateLimitByUser, rateLimitByOrg } from "../security/rateLimit";
import { toSafeErrorResponse } from "../security/secureErrors";
import { runRagSearch } from "../services/ragSearchService";
import { enqueueExecSummary, getJobStatus as getExecSummaryJobStatus, listJobsForProject as listExecSummaryJobs } from "../services/execSummaryQueueService";
import { assertPermission } from "../security/projectAccess";
import { routeParam } from "../utils/routeUtils";

const router = express.Router();

// RAG Search
router.post("/api/search/rag", requireAuth, rateLimitByUser(30, 60_000), rateLimitByOrg(300, 60 * 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { query, projectId, limit, language } =
      req.body as { query?: string; projectId?: string; limit?: number; language?: "sv" | "en" };

    if (!query || String(query).trim().length === 0) { res.status(400).json({ ok: false, error: "query krävs" }); return; }

    const result = await runRagSearch({
      query: String(query).trim(),
      organisationId: req.authUser.organisationId,
      projectId,
      limit: typeof limit === "number" ? limit : undefined,
      language: language === "en" ? "en" : "sv",
    });
    res.json({ ok: true, result });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

// Executive Summary
router.post("/api/projects/:projectId/exec-summary/enqueue", requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    await assertPermission(req.authUser, routeParam(req.params.projectId));
    const job = await enqueueExecSummary({ projectId: routeParam(req.params.projectId), userId: req.authUser.id });
    res.json({ ok: true, job });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

router.get("/api/projects/:projectId/exec-summary/status/:jobId", requireAuth, rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const job = getExecSummaryJobStatus(routeParam(req.params.jobId));
    if (!job) { res.status(404).json({ ok: false, error: "Jobb hittades inte" }); return; }
    res.json({ ok: true, job });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

router.get("/api/projects/:projectId/exec-summary/jobs", requireAuth, rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    if (!req.authUser) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    await assertPermission(req.authUser, routeParam(req.params.projectId));
    const jobs = listExecSummaryJobs(routeParam(req.params.projectId));
    res.json({ ok: true, jobs });
  } catch (error: unknown) { res.status(400).json(toSafeErrorResponse(error)); }
});

export default router;
