import { Router } from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GovernanceRuntime } from "../../packages/mps-governance-runtime/src/GovernanceRuntime.js";
import { DefaultCanonicalPipeline } from "../../packages/mps-canonical/src/CanonicalPipeline.js";
import { SyncMimersReader } from "../utils/SyncMimersReader.js";
import { FileCASRepository, DiskQuarantineStorage, QuarantinePromoter } from "@miljobeslut/mimers-brunn-core";

export const governanceRouter = Router();

// Store active sessions in-memory for Phase 23B MVP
const activeSessions = new Map<string, GovernanceRuntime>();

// Prepare dependencies
const mimersRoot = process.env.MIMERS_ROOT || path.resolve(".data/mimers");
const syncReader = new SyncMimersReader(mimersRoot);
const canonicalPipeline = new DefaultCanonicalPipeline();
// Ensure hasher is initialized
await canonicalPipeline.initHasher();

const durabilityMode = process.env.MIMERS_DURABILITY_MODE || "best-effort";
const cas = new FileCASRepository(path.join(mimersRoot, "cas"), { durabilityMode: durabilityMode as any });
await cas.initialize();

const quarantineRoot = process.env.QUARANTINE_ROOT || path.resolve(".quarantine");
const quarantineStorage = new DiskQuarantineStorage(quarantineRoot);
const promoter = new QuarantinePromoter(quarantineStorage, cas);

// Extract release hash from environment or fallback
const EXPECTED_RELEASE_HASH =
  process.env.FROZEN_CORE_RELEASE_HASH || process.env.LU_MPS_RELEASE_HASH || "dev-release-hash";

/**
 * Helper to get active session
 */
function getActiveSession(sessionId: string): GovernanceRuntime {
  const runtime = activeSessions.get(sessionId);
  if (!runtime) {
    throw new Error(`Session ${sessionId} not found or inactive`);
  }
  return runtime;
}

governanceRouter.post("/session/start", (req, res) => {
  try {
    const { capability } = req.body;
    
    if (!capability) {
      return res.status(400).json({ error: "Missing capability" });
    }

    const sessionId = randomUUID();
    const contentHash = canonicalPipeline.hashCanonical({ _temp: sessionId } as any, "JSON").digest;

    const runtime = new GovernanceRuntime({
      reader: syncReader,
      canonicalPipeline,
      release_hash: EXPECTED_RELEASE_HASH,
    });

    const sessionArtifact = runtime.startSession({
      session_id: sessionId,
      contentHash: contentHash,
      release_ref: { artifact_id: EXPECTED_RELEASE_HASH, artifact_type: "frozen_core_release_manifest" },
      capability,
      now: new Date(),
    } as any);

    activeSessions.set(sessionId, runtime);
    res.json(sessionArtifact);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

governanceRouter.post("/session/:sessionId/inspect", (req, res) => {
  try {
    const { artifact_id, artifact_type } = req.body;
    if (!artifact_id || !artifact_type) {
      return res.status(400).json({ error: "Missing artifact_id or artifact_type" });
    }
    const runtime = getActiveSession(req.params.sessionId);
    const snap = runtime.inspect({ artifact_id, artifact_type });
    res.json(snap);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

governanceRouter.post("/session/:sessionId/export", (req, res) => {
  try {
    const { artifact_id, artifact_type } = req.body;
    if (!artifact_id || !artifact_type) {
      return res.status(400).json({ error: "Missing artifact_id or artifact_type" });
    }
    const runtime = getActiveSession(req.params.sessionId);
    const snap = runtime.recordExport({ artifact_id, artifact_type });
    res.json(snap);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

governanceRouter.post("/session/:sessionId/resolve-proof", (req, res) => {
  try {
    const { target, question, validate_completeness } = req.body;
    if (!target || !question) {
      return res.status(400).json({ error: "Missing target or question" });
    }
    const runtime = getActiveSession(req.params.sessionId);
    const result = runtime.resolveProofPath({
      target,
      question,
      validate_completeness: validate_completeness ?? true,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

governanceRouter.post("/session/:sessionId/close", (req, res) => {
  try {
    const runtime = getActiveSession(req.params.sessionId);
    const snap = runtime.closeSession();
    activeSessions.delete(req.params.sessionId);
    res.json(snap);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

governanceRouter.post("/session/:sessionId/terminate", (req, res) => {
  try {
    const { reason } = req.body;
    const runtime = getActiveSession(req.params.sessionId);
    const snap = runtime.terminateSession(reason || "timeout");
    activeSessions.delete(req.params.sessionId);
    res.json(snap);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * Human Governance / Quarantine Review Endpoints
 */

// List all quarantine candidates
governanceRouter.get("/quarantine/candidates", async (req, res) => {
  try {
    const list = await quarantineStorage.list();
    res.json({ ok: true, items: list });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

// Promote quarantine item to CAS
governanceRouter.post("/quarantine/:id/promote", async (req, res) => {
  try {
    const { id } = req.params;
    const { approvedBy, governanceRelease } = req.body;
    if (!approvedBy || !governanceRelease) {
      return res.status(400).json({ ok: false, error: "Missing approvedBy or governanceRelease" });
    }
    const result = await promoter.promote(id, approvedBy, governanceRelease);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

// Reject quarantine item
governanceRouter.post("/quarantine/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { errors } = req.body;
    await quarantineStorage.updateStatus(id, "rejected", errors || []);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

// High-level statistics on quarantine, CAS, and sessions
governanceRouter.get("/stats", async (req, res) => {
  try {
    const list = await quarantineStorage.list();
    const stats = {
      quarantined: list.filter(item => item.status === "quarantined").length,
      validated: list.filter(item => item.status === "validated").length,
      rejected: list.filter(item => item.status === "rejected").length,
      promoted: list.filter(item => item.status === "promoted").length,
      activeSessions: activeSessions.size,
      expectedReleaseHash: EXPECTED_RELEASE_HASH,
    };
    res.json({ ok: true, stats });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

// Get artifact content from CAS by hash
governanceRouter.get("/cas/artifact/:hash", async (req, res) => {
  try {
    const { hash } = req.params;
    const bytes = await cas.getBytes(hash);
    if (!bytes) {
      return res.status(404).json({ ok: false, error: `Artifact ${hash} not found in CAS` });
    }
    const text = new TextDecoder().decode(bytes);
    try {
      const parsed = JSON.parse(text);
      res.json({ ok: true, format: "json", data: parsed });
    } catch {
      res.json({ ok: true, format: "text", data: text });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
