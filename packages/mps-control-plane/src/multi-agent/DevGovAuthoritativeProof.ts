import type { RemoteExecutionObservation } from './DevGovTelemetryObservation';

/**
 * AUTHORITY TRUTH — the only thing that may authorize a DEV-GOV gate advance.
 *
 * The control-plane invariant this file exists to enforce:
 *
 *   OBSERVATION MUST NEVER CREATE OR SUBSTITUTE AUTHORITY.
 *
 * Controller state may lag authority. It must never lead it. So the controller
 * is not allowed to conclude "the gate passed" from anything it merely saw on a
 * remote system; it must be handed a proof that names, exactly, what was proven
 * and for which canonical unit identity.
 *
 * A proof is only usable when EVERY dimension below is present and matches the
 * canonical unit the controller holds. A proof missing any dimension is not a
 * weaker proof, it is not a proof:
 *
 *   - unit_id                  which unit this is about
 *   - unit_revision            which exact canonical revision it was produced for
 *   - candidate_sha            which exact commit was proven
 *   - unit_definition_hash     which exact unit definition governed it
 *   - workflow identity        which trusted DEV-GOV workflow produced it
 *   - workflow run identity    which exact run, bound to this unit's own dispatch
 *   - proof identity           the canonical proof/gate reference itself
 *   - result                   the authoritative outcome
 *
 * This module does not know how to *obtain* a proof. Producing one is DEV-GOV's
 * job (the protected gate workflow and its published evidence), which is
 * delivered by separate units. The control plane only consumes it through
 * `DevGovAuthoritativeProofPort`, and when that port cannot yield one, the
 * correct answer is BLOCKED_DEPENDENCY — never a fallback, never an inference
 * from a commit status.
 */

/** The authoritative outcome as reported by DEV-GOV itself, not as interpreted by the controller. */
export type DevGovProofResult = 'PASS' | 'FAIL' | 'BLOCKED_ENVIRONMENT' | 'DENIED_GOVERNANCE';

export interface DevGovAuthoritativeProof {
  /** Canonical proof/gate reference — the identity of the proof artifact itself. */
  readonly proofId: string;
  readonly unitId: string;
  readonly unitRevision: number;
  readonly candidateSha: string;
  readonly unitDefinitionHash: string;
  readonly proofContractHash?: string;
  /**
   * Full ref path of the DEV-GOV workflow that produced this proof, e.g.
   * `owner/repo/.github/workflows/devgov-v0-gate.yml@refs/heads/main`. Compared
   * against the controller's configured trusted identity — a proof from any
   * other workflow, or from the same workflow on another ref, is not trusted.
   */
  readonly workflowIdentity: string;
  readonly workflowRunId: string;
  readonly workflowRunAttempt?: string;
  readonly result: DevGovProofResult;
}

export interface DevGovAuthoritativeProofQuery {
  readonly unitId: string;
  readonly unitRevision: number;
  readonly candidateSha: string;
  /** The run this unit's own dispatch was correlated to. Authority is looked up for that run only. */
  readonly workflowRunId: string;
}

/**
 * Lookup result. Every non-RESOLVED branch is a refusal to advance, and the
 * four are deliberately distinct: "the proof system is not reachable" is a
 * different, differently-actionable fact from "there is no proof yet", and
 * neither may be collapsed into the other.
 */
export type DevGovProofLookup =
  /** The authoritative proof surface itself is not available (e.g. the DEV-GOV proof artifact does not exist on this base/runtime yet). */
  | { readonly status: 'UNAVAILABLE'; readonly reason: string }
  /** Reachable, but no proof has been published for this query yet. */
  | { readonly status: 'NOT_FOUND' }
  /** More than one proof matches. Never resolved by picking one. */
  | { readonly status: 'AMBIGUOUS'; readonly proofIds: readonly string[] }
  | { readonly status: 'RESOLVED'; readonly proof: DevGovAuthoritativeProof };

export interface DevGovAuthoritativeProofPort {
  fetchProof(query: DevGovAuthoritativeProofQuery): Promise<DevGovProofLookup>;
}

export type ProofRejectionReason =
  | 'PROOF_UNIT_MISMATCH'
  | 'PROOF_REVISION_MISMATCH'
  | 'PROOF_CANDIDATE_MISMATCH'
  | 'PROOF_UNIT_DEFINITION_MISMATCH'
  | 'PROOF_CONTRACT_MISMATCH'
  | 'PROOF_WORKFLOW_IDENTITY_UNTRUSTED'
  | 'PROOF_RUN_MISMATCH'
  | 'PROOF_RUN_NOT_SUCCESSFUL'
  | 'PROOF_REFERENCE_MISSING'
  | 'PROOF_RESULT_NOT_SUCCESSFUL';

export interface ProofExpectation {
  readonly unitId: string;
  readonly unitRevision: number;
  readonly candidateSha: string;
  readonly unitDefinitionHash: string;
  readonly proofContractHash?: string;
  readonly trustedWorkflowIdentity: string;
  /** The run bound to this unit's dispatch by the durable correlation ledger. */
  readonly boundRun: RemoteExecutionObservation;
}

/**
 * A refusal to accept a proof. `verifyAuthoritativeProof` returns one of these,
 * or `null` when every dimension bound.
 *
 * Deliberately not modelled as a `{ ok: true } | { ok: false, ... }` union: this
 * repository compiles without `strict`, where narrowing on a boolean-literal
 * discriminant does not hold, so such a union would force callers into casts at
 * exactly the point where the authority decision is read. "A rejection, or
 * nothing" needs no narrowing to stay type-safe in either mode.
 */
export interface ProofRejection {
  readonly reason: ProofRejectionReason;
  readonly detail: string;
}

/**
 * Pure, total verification of one proof against one canonical expectation.
 *
 * Deliberately has no notion of "close enough" and no default-allow branch:
 * every check below is an equality against a value the controller already holds
 * canonically, and anything unrecognised falls through to a rejection. The run
 * check is the one place remote truth participates, and it can only subtract —
 * a run GitHub reports as unsuccessful vetoes a proof claiming success, while a
 * successful run grants nothing by itself.
 */
export function verifyAuthoritativeProof(
  proof: DevGovAuthoritativeProof,
  expectation: ProofExpectation,
): ProofRejection | null {
  if (typeof proof.proofId !== 'string' || proof.proofId.length === 0) {
    return {
      reason: 'PROOF_REFERENCE_MISSING',
      detail: 'proof carries no canonical proof/gate reference',
    };
  }
  if (proof.unitId !== expectation.unitId) {
    return {
      reason: 'PROOF_UNIT_MISMATCH',
      detail: `proof names unit '${proof.unitId}', canonical unit is '${expectation.unitId}'`,
    };
  }
  if (proof.unitRevision !== expectation.unitRevision) {
    return {
      reason: 'PROOF_REVISION_MISMATCH',
      detail: `proof was produced for revision ${proof.unitRevision}, canonical revision is ${expectation.unitRevision}`,
    };
  }
  if (proof.candidateSha !== expectation.candidateSha) {
    return {
      reason: 'PROOF_CANDIDATE_MISMATCH',
      detail: 'proof names a different candidate SHA than the canonical candidate',
    };
  }
  if (proof.unitDefinitionHash !== expectation.unitDefinitionHash) {
    return {
      reason: 'PROOF_UNIT_DEFINITION_MISMATCH',
      detail: 'proof was produced under a different unit definition than the canonical one',
    };
  }
  if (expectation.proofContractHash && proof.proofContractHash !== expectation.proofContractHash) {
    return {
      reason: 'PROOF_CONTRACT_MISMATCH',
      detail: 'proof was produced under a different proof contract than the canonical one',
    };
  }
  if (proof.workflowIdentity !== expectation.trustedWorkflowIdentity) {
    return {
      reason: 'PROOF_WORKFLOW_IDENTITY_UNTRUSTED',
      detail: `proof was produced by '${proof.workflowIdentity}', which is not the trusted DEV-GOV workflow identity`,
    };
  }
  if (proof.workflowRunId !== expectation.boundRun.runId) {
    return {
      reason: 'PROOF_RUN_MISMATCH',
      detail: `proof names run ${proof.workflowRunId}, but this unit's dispatch is bound to run ${expectation.boundRun.runId}`,
    };
  }
  if (expectation.boundRun.status !== 'completed' || expectation.boundRun.conclusion !== 'success') {
    return {
      reason: 'PROOF_RUN_NOT_SUCCESSFUL',
      detail: `bound run ${expectation.boundRun.runId} is ${expectation.boundRun.status}/${expectation.boundRun.conclusion ?? 'null'}`,
    };
  }
  if (proof.result !== 'PASS') {
    return {
      reason: 'PROOF_RESULT_NOT_SUCCESSFUL',
      detail: `authoritative result is ${proof.result}`,
    };
  }
  return null;
}
