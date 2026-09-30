/**
 * PATTERN-PROOF-ENGINE-01 V1 -- coded errors.
 *
 * Every validator, transition and probe in this package fails closed with a `PatternProofError`
 * carrying a stable `code`. Codes are part of the package contract (fixtures assert on them);
 * messages are for humans and may change.
 */
export type PatternProofErrorCode =
  // schema / shape
  | 'PPE_SCHEMA_INVALID'
  | 'PPE_UNKNOWN_FIELD'
  | 'PPE_EVIDENCE_REQUIRED'
  | 'PPE_EVIDENCE_KIND_INVALID'
  // artifact invariants (frozen design section 2)
  | 'PPE_GRAPH_DANGLING_EDGE'
  | 'PPE_GRAPH_DUPLICATE_NODE'
  | 'PPE_DECISION_ITEM_INCOMPLETE'
  | 'PPE_PROBE_AUTHORITY_REQUIRED'
  | 'PPE_PROBE_ID_DUPLICATE'
  | 'PPE_CANDIDATE_SHA_INVALID'
  | 'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT'
  | 'PPE_ALLOWLIST_COVERS_PROOF_POLICY'
  | 'PPE_MATERIAL_CLAIM_WEAK_GROUND'
  | 'PPE_REASON_CODE_REQUIRED'
  | 'PPE_ISOLATION_EVIDENCE_REQUIRED'
  | 'PPE_MANIFEST_SECRET_MATERIAL'
  | 'PPE_MANIFEST_INVALID'
  // identity / persistence
  | 'PPE_DIGEST_INPUT_INVALID'
  | 'PPE_CONTENT_HASH_MISMATCH'
  | 'PPE_ARTIFACT_NOT_FOUND'
  // state machine (frozen design section 3)
  | 'PPE_PHASE_VIOLATION'
  | 'PPE_RUN_TERMINAL'
  | 'PPE_RUN_STOPPED'
  | 'PPE_REPLAY_UNBOUND'
  // isolation (frozen design section 4)
  | 'PPE_ISOLATION_UNDECLARED_INPUT'
  | 'PPE_ISOLATION_SIGNER_IN_VERIFIER_LANE'
  | 'PPE_ISOLATION_ATTESTATION_INVALID'
  | 'PPE_ISOLATION_SIGNER_MISMATCH'
  | 'PPE_ISOLATION_BUNDLE_DIGEST_MISMATCH'
  // docker probes (BOOTSTRAP design section 5.4)
  | 'PPE_DOCKERFILE_PARSE'
  | 'PPE_STAGE_NOT_FOUND'
  | 'PPE_INSTALL_STEP_NOT_FOUND'
  | 'PPE_PROBE_BLOCKED';

export class PatternProofError extends Error {
  readonly code: PatternProofErrorCode;
  readonly path?: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: PatternProofErrorCode,
    message: string,
    options: { readonly path?: string; readonly details?: Readonly<Record<string, unknown>> } = {},
  ) {
    super(`[${code}]${options.path ? ` ${options.path}:` : ''} ${message}`);
    this.name = 'PatternProofError';
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function isPatternProofError(
  value: unknown,
  code?: PatternProofErrorCode,
): value is PatternProofError {
  return value instanceof PatternProofError && (code === undefined || value.code === code);
}
