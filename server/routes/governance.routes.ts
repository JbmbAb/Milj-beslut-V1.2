import { Router } from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GovernanceRuntime } from "../../packages/mps-governance-runtime/src/GovernanceRuntime.js";
import { DefaultCanonicalPipeline } from "../../packages/mps-canonical/src/CanonicalPipeline.js";
import { SyncMimersReader } from "../utils/SyncMimersReader.js";
import {
  FileCASRepository,
  DiskQuarantineStorage,
  QuarantinePromoter,
  createArtifactAttestation,
  PROMOTION_ACTION,
  PROMOTION_ATTESTATION_PREDICATE_TYPE,
  PROMOTION_ATTESTATION_SCHEMA_VERSION,
  type PromotionAttestationPredicate,
} from "@miljobeslut/mimers-brunn-core";
import { requireAuth } from "../security/auth";
import { rateLimitByUser } from "../security/rateLimit";
import { getGovernanceSigningProvider } from "../security/governanceSigningKey";

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

// Constructed lazily (not at module load) because QuarantinePromoter now requires the
// governance signing key (ADR-042 Level 2), which is separate env config from everything
// else this module needs. Routes unrelated to promotion (session/*, stats, cas/artifact,
// quarantine/candidates) must keep working even when that key isn't configured; the first
// promote request fails closed with a clear error instead.
let promoterInstance: QuarantinePromoter | null = null;
function getPromoter(): QuarantinePromoter {
  if (!promoterInstance) {
    promoterInstance = new QuarantinePromoter(quarantineStorage, cas, getGovernanceSigningProvider());
  }
  return promoterInstance;
}

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

function requireAdminMiddleware(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): void {
  if (!requireAdmin(req, res)) return;
  next();
}

governanceRouter.post("/session/start", requireAuth, rateLimitByUser(20, 60_000), requireAdminMiddleware, (req, res) => {
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

governanceRouter.post("/session/:sessionId/inspect", requireAuth, rateLimitByUser(60, 60_000), requireAdminMiddleware, (req, res) => {
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

governanceRouter.post("/session/:sessionId/export", requireAuth, rateLimitByUser(30, 60_000), requireAdminMiddleware, (req, res) => {
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

governanceRouter.post("/session/:sessionId/resolve-proof", requireAuth, rateLimitByUser(30, 60_000), requireAdminMiddleware, (req, res) => {
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

governanceRouter.post("/session/:sessionId/close", requireAuth, rateLimitByUser(30, 60_000), requireAdminMiddleware, (req, res) => {
  try {
    const runtime = getActiveSession(req.params.sessionId);
    const snap = runtime.closeSession();
    activeSessions.delete(req.params.sessionId);
    res.json(snap);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

governanceRouter.post("/session/:sessionId/terminate", requireAuth, rateLimitByUser(30, 60_000), requireAdminMiddleware, (req, res) => {
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
governanceRouter.get("/quarantine/candidates", requireAuth, rateLimitByUser(30, 60_000), requireAdminMiddleware, async (req, res) => {
  try {
    const list = await quarantineStorage.list();
    res.json({ ok: true, items: list });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * SECURITY CONTAINMENT (2026-08-10) — see
 * docs/architecture/GAP-REPORT-harvest-governance-2026-08-10.md, "URGENT ADDENDUM".
 *
 * Until 2026-08-10 this route had no authentication and read `approvedBy`
 * directly from the request body: any caller who could reach the server could
 * promote any quarantined item to permanent CAS storage by asserting any name
 * as the approver. `requireAuth` + an ADMIN role check close that write path;
 * the approver identity is derived from the authenticated principal, not client input.
 *
 * LEVEL 2 — CRYPTOGRAPHIC PROMOTION AUTHORITY (2026-08-11) — see the same file,
 * "SPEC TIGHTENED". `QuarantinePromoter.promote()` no longer accepts "who approved" as a
 * plain string. This route now builds a `PromotionAttestationPredicate` server-side, after
 * the ADMIN check, binding the exact operation (action, quarantine artifact id, its current
 * content hash, approver id/role, governance_release, signer key id) and signs it with the
 * server's governance Ed25519 key (`server/security/governanceSigningKey.ts`, separate from
 * `JWT_ACCESS_SECRET`). The client never sends or influences the attestation.
 * `QuarantinePromoter.promote()` independently re-verifies the signature and every binding
 * field (steps 1-7) before any CAS write — so the trust boundary is the promoter itself, not
 * this route; a direct in-process call to `promote()` without a valid, correctly-bound
 * attestation fails the same way. This still does not implement per-reviewer individual
 * signing keys/non-repudiation (Level 3, `mps-governance` `ActorArtifact`/`TrustAnchor` —
 * separate architecture-convergence track, not started) or key rotation (documented
 * contract, not implemented).
 */
function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  if (!req.authUser || req.authUser.role !== "ADMIN") {
    res.status(403).json({ ok: false, error: "Admin role required" });
    return false;
  }
  return true;
}

// Promote quarantine item to CAS
governanceRouter.post("/quarantine/:id/promote", requireAuth, rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    // Express types req.params values as `string | string[]` in this project's config, but a
    // named `:id` segment is always a single string at runtime — pre-existing typing quirk,
    // not something this change introduces (the same pattern is already used untyped below in
    // the reject handler). Cast locally rather than widen every downstream signature.
    const id = req.params.id as string;
    const { governanceRelease } = req.body;
    if (!governanceRelease) {
      return res.status(400).json({ ok: false, error: "Missing governanceRelease" });
    }

    const meta = await quarantineStorage.getMetadata(id);
    if (!meta) {
      return res.status(404).json({ ok: false, error: `Quarantine artifact '${id}' not found` });
    }

    // Approver identity, action, and content hash are all derived server-side and bound into
    // the signed predicate — never taken from the request body. See LEVEL 2 note above.
    const signingProvider = getGovernanceSigningProvider();
    const predicate: PromotionAttestationPredicate = {
      action: PROMOTION_ACTION,
      quarantine_artifact_id: id,
      quarantine_content_hash: meta.content_hash,
      approver_actor_id: req.authUser!.id,
      approver_role: req.authUser!.role,
      governance_release: governanceRelease,
      attestation_schema_version: PROMOTION_ATTESTATION_SCHEMA_VERSION,
      signer_key_id: signingProvider.keyId,
    };
    const attestation = await createArtifactAttestation({
      subjectDigest: `sha256:${meta.content_hash}`,
      predicateType: PROMOTION_ATTESTATION_PREDICATE_TYPE,
      // PromotionAttestationPredicate is a specific, closed shape (no index signature) so it's
      // not structurally a Record<string, unknown> — createArtifactAttestation's predicate
      // param is intentionally broad since it's shared across attestation kinds; the closed
      // shape is what buys us type safety when *building* the predicate above.
      predicate: predicate as unknown as Record<string, unknown>,
      signing: signingProvider,
    });

    const result = await getPromoter().promote(id, attestation, governanceRelease);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

// Reject quarantine item
governanceRouter.post("/quarantine/:id/reject", requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const { errors } = req.body;
    await quarantineStorage.updateStatus(id, "rejected", errors || []);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

// High-level statistics on quarantine, CAS, and sessions
governanceRouter.get("/stats", requireAuth, rateLimitByUser(30, 60_000), requireAdminMiddleware, async (req, res) => {
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
governanceRouter.get("/cas/artifact/:hash", requireAuth, rateLimitByUser(20, 60_000), requireAdminMiddleware, async (req, res) => {
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
