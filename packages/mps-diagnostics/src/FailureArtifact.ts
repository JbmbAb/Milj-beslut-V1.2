/**
 * Package 22.2 — FailureArtifact
 * Verifiable root-cause evidence for terminal BLOCKED (and other) failures.
 * Observe/prove only — MUST NOT modify Package 21 replay identity.
 * @see ADR-MPS-022 rev 022.1 §4
 */

import {
  buildFailureIdentityPayload,
  computeFailureArtifactHash,
  type FailureIdentityPayload,
} from "./canonicalFailureIdentity.js";
import { hashCanonical } from "./canonicalHash.js";
import type {
  DiagnosticArtifactReference,
  DiagnosticContentReference,
  ExecutionStage,
  Timestamp,
} from "./types.js";

/** Fields that enter artifact_hash. */
export type FailureArtifactIdentity = {
  readonly failure_code: string;
  readonly stage: ExecutionStage;
  readonly execution_id: string;
  readonly input_refs: readonly DiagnosticContentReference[];
  readonly evidence_refs: readonly DiagnosticArtifactReference[];
  readonly failed_controls: readonly string[];
  /** Canonical governance diagnostics JSON (no stacks/paths/host/timestamps/random IDs). */
  readonly diagnostics: unknown;
};

/** Metadata — MUST NOT enter artifact_hash. */
export type FailureArtifactMetadata = {
  readonly created_at: Timestamp;
  readonly host?: string;
  readonly runtime_version?: string;
  readonly request_id?: string;
};

export type FailureArtifact = FailureArtifactIdentity &
  FailureArtifactMetadata & {
    /** Deterministic id derived from artifact_hash (not a random UUID). */
    readonly artifact_id: string;
    readonly artifact_hash: string;
  };

/** Compact reference used on ExecutionEvent / BLOCKED binding. */
export type FailureArtifactReference = {
  readonly artifact_id: string;
  readonly artifact_hash: string;
};

export type FailureArtifactInput = FailureArtifactIdentity & FailureArtifactMetadata;

export function toFailureArtifactReference(artifact: FailureArtifact): FailureArtifactReference {
  return {
    artifact_id: artifact.artifact_id,
    artifact_hash: artifact.artifact_hash,
  };
}

export function createFailureArtifact(input: FailureArtifactInput): FailureArtifact {
  const identityPayload = buildFailureIdentityPayload({
    failure_code: input.failure_code,
    stage: input.stage,
    execution_id: input.execution_id,
    input_refs: input.input_refs,
    evidence_refs: input.evidence_refs,
    failed_controls: input.failed_controls,
    diagnostics: input.diagnostics,
  });

  const artifact_hash = computeFailureArtifactHash(identityPayload);
  const artifact_id = hashCanonical({ kind: "FailureArtifact", artifact_hash });

  return Object.freeze({
    artifact_id,
    artifact_hash,
    failure_code: identityPayload.failure_code,
    stage: identityPayload.stage,
    execution_id: identityPayload.execution_id,
    input_refs: Object.freeze([...identityPayload.input_refs]),
    evidence_refs: Object.freeze([...identityPayload.evidence_refs]),
    failed_controls: Object.freeze([...identityPayload.failed_controls]),
    diagnostics: identityPayload.diagnostics,
    created_at: input.created_at,
    host: input.host,
    runtime_version: input.runtime_version,
    request_id: input.request_id,
  }) as FailureArtifact;
}

/** Recompute artifact_hash from identity fields and verify match. */
export function verifyFailureArtifactIntegrity(artifact: FailureArtifact): boolean {
  const expected = computeFailureArtifactHash(
    buildFailureIdentityPayload({
      failure_code: artifact.failure_code,
      stage: artifact.stage,
      execution_id: artifact.execution_id,
      input_refs: artifact.input_refs,
      evidence_refs: artifact.evidence_refs,
      failed_controls: artifact.failed_controls,
      diagnostics: artifact.diagnostics,
    }),
  );
  return expected === artifact.artifact_hash;
}

/**
 * F22-5 / P22-C4 (strengthened for diagnostic track):
 * Terminal BLOCKED transitions REQUIRE a FailureArtifactReference.
 * Lives in Diagnostic Governance — NOT in ReplayEngine.
 */
export function assertBlockedFailureArtifactRequired(
  to_state: string,
  failure_artifact_ref: FailureArtifactReference | undefined | null,
): asserts failure_artifact_ref is FailureArtifactReference {
  if (to_state !== "BLOCKED") return;
  if (
    !failure_artifact_ref ||
    !failure_artifact_ref.artifact_id ||
    !failure_artifact_ref.artifact_hash
  ) {
    throw new FailureArtifactError(
      "MPS-DIAG-BLOCKED-FAILURE-REQUIRED",
      "HarvestExecutionState.BLOCKED requires FailureArtifactReference (F22-5)",
    );
  }
}

export function failureRefAsOutputArtifact(
  ref: FailureArtifactReference,
): DiagnosticArtifactReference {
  return {
    artifact_id: ref.artifact_id,
    content_hash: {
      algorithm: "sha256",
      digest: ref.artifact_hash,
    },
  };
}

export class FailureArtifactError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FailureArtifactError";
  }
}

export type { FailureIdentityPayload };
