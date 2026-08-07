/**
 * Package 22.2 — Canonical FailureArtifact identity payload + hash.
 * Metadata (timestamps, host, runtime, request_id) MUST NOT enter this payload.
 * @see ADR-MPS-022 rev 022.1 §4
 */

import { hashCanonical } from "./canonicalHash.js";
import type {
  DiagnosticArtifactReference,
  DiagnosticContentReference,
  ExecutionStage,
} from "./types.js";

/** Keys that MUST NEVER influence FailureArtifact identity hash. */
const FORBIDDEN_DIAGNOSTIC_KEYS = new Set([
  "stack",
  "stack_trace",
  "stackTrace",
  "stacktrace",
  "path",
  "file_path",
  "filePath",
  "filepath",
  "hostname",
  "host",
  "created_at",
  "timestamp",
  "occurred_at",
  "uuid",
  "random_id",
  "randomId",
  "request_id",
  "requestId",
  "correlation_id",
  "trace_root_id",
  "ledger_sequence",
  "event_sequence",
  "pid",
  "cwd",
]);

export type FailureIdentityPayload = {
  readonly failure_code: string;
  readonly stage: ExecutionStage;
  readonly execution_id: string;
  readonly input_refs: readonly DiagnosticContentReference[];
  readonly evidence_refs: readonly DiagnosticArtifactReference[];
  readonly failed_controls: readonly string[];
  readonly diagnostics: unknown;
};

function compareContentRef(a: DiagnosticContentReference, b: DiagnosticContentReference): number {
  const byId = a.id.localeCompare(b.id);
  if (byId !== 0) return byId;
  return a.content_hash.digest.localeCompare(b.content_hash.digest);
}

function compareArtifactRef(
  a: DiagnosticArtifactReference,
  b: DiagnosticArtifactReference,
): number {
  const byId = a.artifact_id.localeCompare(b.artifact_id);
  if (byId !== 0) return byId;
  return (a.content_hash?.digest ?? "").localeCompare(b.content_hash?.digest ?? "");
}

/**
 * Strip forbidden diagnostic keys (stack traces, paths, host, timestamps, random IDs).
 * Remaining structure is deep-copied; arrays keep element order (caller may pre-sort).
 */
export function sanitizeDiagnostics(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeDiagnostics);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(obj)) {
    if (FORBIDDEN_DIAGNOSTIC_KEYS.has(key)) continue;
    out[key] = sanitizeDiagnostics(child);
  }
  return out;
}

/**
 * Build the exact identity payload that enters artifact_hash.
 * Refs and failed_controls are sorted for determinism (F22-1 / F22-4).
 */
export function buildFailureIdentityPayload(input: {
  readonly failure_code: string;
  readonly stage: ExecutionStage;
  readonly execution_id: string;
  readonly input_refs: readonly DiagnosticContentReference[];
  readonly evidence_refs: readonly DiagnosticArtifactReference[];
  readonly failed_controls: readonly string[];
  readonly diagnostics: unknown;
}): FailureIdentityPayload {
  return {
    failure_code: input.failure_code,
    stage: input.stage,
    execution_id: input.execution_id,
    input_refs: [...input.input_refs].sort(compareContentRef),
    evidence_refs: [...input.evidence_refs].sort(compareArtifactRef),
    failed_controls: [...input.failed_controls].sort((a, b) => a.localeCompare(b)),
    diagnostics: sanitizeDiagnostics(input.diagnostics),
  };
}

export function computeFailureArtifactHash(payload: FailureIdentityPayload): string {
  return hashCanonical(payload);
}

/**
 * Extract FailureArtifact identity from a possibly wider object.
 * Correlation / metadata keys (request_id, correlation_id, trace_root_id, …)
 * are intentionally ignored (F22-7).
 */
export function canonicalFailureIdentity(source: {
  readonly failure_code: string;
  readonly stage: ExecutionStage;
  readonly execution_id: string;
  readonly input_refs: readonly DiagnosticContentReference[];
  readonly evidence_refs: readonly DiagnosticArtifactReference[];
  readonly failed_controls: readonly string[];
  readonly diagnostics: unknown;
  readonly [key: string]: unknown;
}): FailureIdentityPayload {
  return buildFailureIdentityPayload({
    failure_code: source.failure_code,
    stage: source.stage,
    execution_id: source.execution_id,
    input_refs: source.input_refs,
    evidence_refs: source.evidence_refs,
    failed_controls: source.failed_controls,
    diagnostics: source.diagnostics,
  });
}
