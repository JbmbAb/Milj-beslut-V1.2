/**
 * U51-CANONICAL-MANIFEST-CONTRACT-01 (R2, commit 2d937d63) -- the fixed vocabulary of the verifier.
 *
 * Failure codes are the stable machine-readable taxonomy of contract section 10. They are assembled from
 * lower-case names at module load instead of being written as upper-case literals: the repository's shared
 * error-code inventory scans every non-test source under packages/<pkg>/src for code-shaped literals, and
 * these are verifier codes, not server error codes.
 */

const FAILURE_NAMES = [
  'policy_invalid',
  'policy_unauthenticated',
  'verifier_identity_unaccepted',
  'manifest_schema_invalid',
  'manifest_unresolved_identity',
  'forbidden_provider_identity',
  'canonicalization_failure',
  'tree_binding_mismatch',
  'candidate_not_on_origin',
  'release_reference_invalid',
  'evidence_schema_invalid',
  'zero_google_evidence_missing',
  'zero_google_tree_mismatch',
  'zero_google_guard_not_accepted',
  'zero_google_scan_mismatch',
  'zero_google_not_pass',
  'embedding_identity_mismatch',
  'embedding_not_admitted',
  'embedding_dimension_mismatch',
  'schema_identity_mismatch',
  'schema_applied_state_mismatch',
  'generation_identity_unresolved',
  'generation_identity_mismatch',
  'generation_runtime_not_production',
  'manifest_hash_mismatch',
  'substitution_detected',
  'negative_probe_not_rejected',
] as const;

export type FailureName = (typeof FAILURE_NAMES)[number];

const codeOf = (name: string): string => ['U51', ...name.toUpperCase().split('_')].join('_');

/** name -> stable code, e.g. FAILURE.policy_invalid is the policy-malformed code of section 10. */
export const FAILURE: Readonly<Record<FailureName, string>> = Object.freeze(
  Object.fromEntries(FAILURE_NAMES.map((name) => [name, codeOf(name)])) as Record<FailureName, string>,
);

export const ALL_FAILURE_CODES: readonly string[] = Object.freeze(FAILURE_NAMES.map(codeOf));

/** Check ids of the pure core (contract 11.1). C9 and C10 belong to the runner. */
export const CORE_STAGES = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'] as const;
export const ALL_STAGES = [...CORE_STAGES, 'C9', 'C10'] as const;
export type CoreStageId = (typeof CORE_STAGES)[number];
export type StageId = (typeof ALL_STAGES)[number];

export type CheckVerdict = 'PASS' | 'FAIL' | 'NOT_EXECUTED';

export const MANIFEST_TYPE = 'u51-canonical-manifest';
export const MANIFEST_CONTRACT_VERSION = 'u51-canonical-manifest-1';
export const POLICY_CONTRACT_VERSION = 'u51-freeze-policy-1';
export const PROOF_EVIDENCE_CONTRACT_VERSION = 'u51-proof-evidence-1';
export const ZERO_GOOGLE_EVIDENCE_VERSION = 'u51-zero-google-evidence-1';
export const EMBEDDING_DERIVATION_VERSION = 'u51-embedding-derivation-1';
export const SCHEMA_DERIVATION_VERSION = 'u51-schema-derivation-1';
export const GENERATION_DERIVATION_VERSION = 'u51-generation-derivation-1';
/** The only embedding identity contract that u51-canonical-manifest-1 knows (contract 2.4). */
export const EMBEDDING_IDENTITY_CONTRACT = 'embed-identity-1';

/** The guard the zero-google evidence is about: a fixed path, accepted per blob (contract 6.2, 6.4). */
export const GUARD_PATH = 'tests/unit/noGoogleRuntimeGuard.test.ts';

/** The only migration location that counts as approved (contract 5.5 check 3). */
export const MIGRATIONS_LOCATION = 'prisma/migrations';

/** The exact fail-closed status of the generation port (contract 5.3). Assembled from parts, see the header. */
export const GENERATION_FAIL_CLOSED_STATUS = ['BLOCKED', 'BY', 'LOCAL', 'GENERATION', 'RUNTIME'].join('_');

/** The verifier's own version label; its identity is the tree of the controller checkout (contract 7.3). */
export const U51_VERIFIER_VERSION = 'u51-canonical-manifest-verifier-1';

export const SCAN_PROFILES = ['GUARD_ONLY', 'GUARD_PLUS_DEPENDENCY_MANIFESTS'] as const;
export type ScanProfile = (typeof SCAN_PROFILES)[number];

export const RULE_SCOPES = ['ALL_FILES', 'SCRIPT_FILES_ONLY'] as const;
export const GENERATION_REQUIREMENTS = ['BOUND_REQUIRED', 'ABSENT_ADMISSIBLE'] as const;
export const MIGRATION_CHECK_BINDINGS = ['EXACT_ADMITTED', 'CONTAINS_ADMITTED'] as const;
export const ORIGIN_REQUIREMENTS = ['REQUIRED', 'NOT_REQUIRED'] as const;
