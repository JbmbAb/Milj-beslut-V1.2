/**
 * Package 22.4 — CorrelationContext
 * Navigation / observability references only — NOT identity.
 *
 * F22-7: Correlation metadata SHALL NOT participate in artifact identity hashing.
 * MUST NOT affect ExecutionManifest, FailureArtifact, transition, or DecisionImpact hashes.
 *
 * @see ADR-MPS-022 § Correlation / P22-C6
 */

/**
 * Frozen correlation chain (references only — no payload, no diagnostics):
 * request_id → execution_id → event_sequence → artifact_hash → ledger_sequence
 */
export interface CorrelationContext {
  readonly request_id: string;
  readonly execution_id?: string;
  readonly event_sequence?: number;
  readonly artifact_hashes: readonly string[];
  readonly ledger_sequence?: number;
  /**
   * Optional OTEL / distributed-trace root.
   * Transport/observability only — never hashed into identity.
   */
  readonly trace_root_id?: string;
}

/** Partial link used when indexing navigation paths. */
export type CorrelationLink = {
  readonly request_id: string;
  readonly execution_id: string;
  readonly event_sequence?: number;
  readonly artifact_hash?: string;
  readonly ledger_sequence?: number;
  readonly trace_root_id?: string;
};

/**
 * Build a CorrelationContext from known references.
 * Does not validate or invent truth — only assembles navigation handles.
 */
export function createCorrelationContext(input: {
  readonly request_id: string;
  readonly execution_id?: string;
  readonly event_sequence?: number;
  readonly artifact_hashes?: readonly string[];
  readonly ledger_sequence?: number;
  readonly trace_root_id?: string;
}): CorrelationContext {
  if (!input.request_id) {
    throw new CorrelationError(
      "MPS-DIAG-CORR-REQUEST-REQUIRED",
      "CorrelationContext.request_id is required",
    );
  }

  const artifact_hashes = Object.freeze([
    ...new Set(input.artifact_hashes ?? []),
  ]) as readonly string[];

  return Object.freeze({
    request_id: input.request_id,
    execution_id: input.execution_id,
    event_sequence: input.event_sequence,
    artifact_hashes,
    ledger_sequence: input.ledger_sequence,
    trace_root_id: input.trace_root_id,
  });
}

/**
 * Keys that MUST NEVER enter FailureArtifact / transition identity hashes
 * when present on adjacent objects (F22-7).
 */
export const CORRELATION_NON_IDENTITY_KEYS = Object.freeze([
  "request_id",
  "correlation_id",
  "trace_root_id",
  "ledger_sequence",
  "event_sequence",
] as const);

export class CorrelationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CorrelationError";
  }
}
