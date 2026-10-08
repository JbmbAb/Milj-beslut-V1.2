/**
 * The proof evidence record `u51-proof-evidence-1` (contract 12.1).
 *
 *   evidence_sha256 = SHA-256(JCS(identity))      -- only `identity` is hashed
 *
 * `audit` (timestamps, runtime, probe report ...) is never hashed and never authority. Same inputs and verifier
 * give the same evidence_sha256: that determinism is what makes the freeze gate's reproduction check meaningful.
 */
import { hashJcs, tryHashJcs } from './canonical';
import { isRecord, type Rec } from './json';
import type { CheckRecord, Evaluation } from './types';
import { ALL_STAGES, MANIFEST_CONTRACT_VERSION, PROOF_EVIDENCE_CONTRACT_VERSION, type CheckVerdict } from './vocabulary';

export interface ProofEvidenceIdentity {
  readonly contract_version: string;
  readonly manifest_contract_version: string;
  readonly manifest_sha256: string | null;
  readonly subject: { readonly commit_sha: string; readonly tree_sha: string };
  readonly policy_sha256: string;
  readonly policy_trust_root_ref: string | null;
  readonly inputs: {
    readonly zero_google_evidence_sha256: string | null;
    readonly embedding_evidence_sha256: string | null;
    readonly schema_evidence_sha256: string | null;
    readonly generation_evidence_sha256: string | null;
    readonly release_resolution_sha256: string | null;
    readonly origin_observation_sha256: string | null;
  };
  readonly checks: readonly CheckRecord[];
  readonly result: CheckVerdict;
  readonly failure_code?: string;
  readonly verifier: { readonly verifier_version: string; readonly implementation_tree_sha1: string };
}

export interface ProofEvidence {
  readonly identity: ProofEvidenceIdentity;
  readonly audit: Rec;
  readonly evidence_sha256: string;
}

const hashOrNull = (value: unknown): string | null => (value === undefined || value === null ? null : tryHashJcs(value) ?? null);

/** hash of an observation's payload, or of the observation itself when it carries no payload wrapper */
const observed = (observations: unknown, key: string, wrapped: boolean): string | null => {
  if (!isRecord(observations)) return null;
  const v = observations[key];
  if (wrapped) return isRecord(v) ? hashOrNull(v.payload) : null;
  return hashOrNull(v);
};

export interface BuildEvidenceArgs {
  readonly evaluation: Evaluation;
  /** C9 and C10 of the runner; the core supplies C0..C8 */
  readonly runnerChecks: readonly CheckRecord[];
  readonly overallResult: CheckVerdict;
  readonly overallFailureCode?: string;
  readonly subject: { readonly commit_sha: string; readonly tree_sha: string };
  readonly policy: unknown;
  readonly policyTrustRootRef: string | null;
  readonly observations: unknown;
  readonly verifier: { readonly verifier_version: string; readonly implementation_tree_sha1: string };
  readonly audit: Rec;
}

export function buildProofEvidence(args: BuildEvidenceArgs): ProofEvidence {
  const checks = [...args.evaluation.checks, ...args.runnerChecks];
  const ids = checks.map((c) => c.id);
  if (ids.length !== ALL_STAGES.length || ids.some((id, i) => id !== ALL_STAGES[i])) {
    throw new Error('proof evidence needs the checks C0..C10 in fixed order');
  }
  const identity: ProofEvidenceIdentity = {
    contract_version: PROOF_EVIDENCE_CONTRACT_VERSION,
    manifest_contract_version: MANIFEST_CONTRACT_VERSION,
    manifest_sha256: args.evaluation.manifest_sha256 ?? null,
    subject: { commit_sha: args.subject.commit_sha, tree_sha: args.subject.tree_sha },
    policy_sha256: hashJcs(args.policy),
    policy_trust_root_ref: args.policyTrustRootRef,
    inputs: {
      zero_google_evidence_sha256: observed(args.observations, 'zero_google', true),
      embedding_evidence_sha256: observed(args.observations, 'embedding', true),
      schema_evidence_sha256: observed(args.observations, 'schema', true),
      generation_evidence_sha256: observed(args.observations, 'generation', true),
      release_resolution_sha256: observed(args.observations, 'release', false),
      origin_observation_sha256: observed(args.observations, 'origin', false),
    },
    checks,
    result: args.overallResult,
    ...(args.overallFailureCode !== undefined ? { failure_code: args.overallFailureCode } : {}),
    verifier: { verifier_version: args.verifier.verifier_version, implementation_tree_sha1: args.verifier.implementation_tree_sha1 },
  };
  return { identity, audit: args.audit, evidence_sha256: hashJcs(identity) };
}

/** The record as written to disk: identity, audit and its own identity hash. */
export function evidenceDocument(evidence: ProofEvidence): Rec {
  return { identity: evidence.identity, audit: evidence.audit, evidence_sha256: evidence.evidence_sha256 };
}

/** Re-derives the hash from a stored record; true iff the stored hash is the hash of the stored identity. */
export function evidenceIsSelfConsistent(document: unknown): boolean {
  return isRecord(document) && typeof document.evidence_sha256 === 'string' && tryHashJcs(document.identity) === document.evidence_sha256;
}
