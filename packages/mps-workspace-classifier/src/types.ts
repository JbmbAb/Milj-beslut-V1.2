/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — classification vocabulary.
 *
 * Three shapes are deliberately ABSENT from every type in this file, and their absence is the
 * design:
 *
 *  - No `severity`. The existing `AgentFinding` requires `severity: 'BLOCKING' | 'NON_BLOCKING'` in
 *    both its TypeScript type and its JSON schema, and that two-valued scalar is roughly isomorphic
 *    to the blockers[]/findings[] split below. It is still the wrong model here: in the workspace
 *    domain, how serious a blocker is depends on WHICH OPERATION is proposed, through blockerScope.
 *    A scalar severity on the record is therefore wrong-by-construction the moment a new scope
 *    appears — which happens in V2. Operational weighting is derived in the REPORT layer as
 *    effectiveSeverity(blockerCode, operation) under policyVersion, where the classifier never sees
 *    it and so cannot trim thresholds against it.
 *  - No `confidence`. A24 requires exactly one authoritative representation per material fact;
 *    `disposition: BLOCKED_REVERIFY_REQUIRED` + `blockers: [LOW_CONFIDENCE]` + `confidence: LOW`
 *    must be impossible to express, and here it is.
 *  - No `REMOVED` and no lifecycle state. SAFE_TO_REMOVE is a point-in-time decision about a named
 *    operation, not a state a workspace enters (A14), and Control Plane already owns canonical unit
 *    state (A15). This package maintains no competing state machine.
 */

/** A21: a disposition is always expressed FOR a named operation. */
export type OperationScope =
  | 'WORKTREE_REMOVAL'
  | 'BRANCH_DELETION'
  | 'METADATA_PRUNE'
  | 'REPOSITORY_REMOVAL'
  | 'GLOBAL_REPOSITORY_MUTATION';

/**
 * How a blocker could stop being one.
 *
 * REOBSERVATION means the world might already have changed, or the observation was inconclusive and
 * a fresh look could settle it. HUMAN means no amount of re-observing helps: someone has to decide.
 */
export type ResolvableBy = 'REOBSERVATION' | 'HUMAN';

export type BlockerCode =
  /** A required observation was attempted and gave no conclusive answer. */
  | 'OBSERVATION_INCONCLUSIVE'
  /** A required observation was never made. Kept distinct from the above: A3 makes conflating them
   *  an implementation error, and they have different owners — one is the world refusing to answer,
   *  the other is this run not asking. */
  | 'OBSERVATION_NOT_ATTEMPTED'
  | 'WORKSPACE_PATH_ABSENT'
  | 'WORKSPACE_PATH_NOT_A_DIRECTORY'
  | 'MAIN_WORKTREE'
  | 'FOREIGN_REPOSITORY'
  | 'DANGLING_GITDIR_POINTER'
  | 'UNREGISTERED_FILESYSTEM_ONLY'
  | 'TOPLEVEL_NOT_CANDIDATE'
  | 'SOURCE_DISAGREEMENT_REGISTRATION'
  | 'WORKTREE_LOCKED'
  | 'LOCK_FILES_PRESENT'
  | 'OPERATION_IN_PROGRESS'
  | 'TRACKED_MODIFICATIONS_PRESENT'
  | 'UNTRACKED_ENTRIES_PRESENT'
  | 'UNIQUE_COMMITS_PRESENT'
  | 'HEAD_COMMIT_MISSING'
  | 'CANONICAL_REFERENCE_UNAVAILABLE'
  | 'CANONICAL_REFERENCE_STALE'
  | 'CANONICAL_REFERENCE_MOVED_DURING_OBSERVATION'
  | 'REPOSITORY_MUTATED_DURING_OBSERVATION'
  | 'STASH_UNATTRIBUTED'
  /** The default arm of the conflict table. Unconditional BLOCKED. */
  | 'UNCLASSIFIED_SOURCE_COMBINATION';

/**
 * A20: always blocking WITHIN ITS SCOPE, and there is no degree.
 *
 * `evidenceRef` points at the recorded request that established the fact, so every blocker is
 * traceable to raw evidence rather than to an assertion.
 */
export interface WorkspaceBlocker {
  readonly code: BlockerCode;
  readonly evidenceRef: string;
  readonly resolvableBy: ResolvableBy;
  readonly blockerScope: OperationScope;
  readonly detail: string;
}

/** A20: a notation with no blocking effect. Same absence of severity, for the same reason. */
export interface WorkspaceFinding {
  readonly code: string;
  readonly evidenceRef: string;
  readonly detail: string;
}

export type Decision = 'SAFE_TO_REMOVE' | 'BLOCKED';

/**
 * A14: `SAFE_TO_REMOVE` is not a state a workspace is in. It is a point-in-time decision about one
 * named operation, bundled with the identityDigest of the snapshot that produced it.
 *
 * V2 deletes IFF a freshly observed identityDigest still equals this one AND observerVersion,
 * classifierVersion and policyVersion are unchanged, under an exclusive cleanup lease. The digest
 * catches the world moving; the version gates catch our logic moving. The gates cost nothing
 * because V2 re-observes under lease immediately before destruction — a disposition's life is
 * measured in seconds — and that rationale is written down here precisely so that nobody later
 * loosens the gates in order to keep long-lived dispositions.
 *
 * The cleanup lease DOES NOT EXIST IN V1. Control Plane's lease-v1 roles are frozen at IMPLEMENTER
 * and VERIFIER; the cleanup lease is a future specialization of that protocol, not a new role, and
 * V1 introduces neither.
 */
export interface Disposition {
  readonly caseId: string;
  readonly decision: Decision;
  readonly operation: OperationScope;
  readonly identityDigest: string;
  readonly blockers: readonly WorkspaceBlocker[];
  readonly findings: readonly WorkspaceFinding[];
  readonly evidence: readonly string[];
}

export interface ClassificationResult {
  readonly operation: OperationScope;
  readonly classifierVersion: string;
  readonly policyVersion: string;
  readonly dispositions: readonly Disposition[];
}

export const CLASSIFIER_VERSION = '1.0.0';
export const POLICY_VERSION = '1.0.0';
