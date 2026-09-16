import type { ArtifactContract } from "../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ContentHash } from "../../mps-compliance/src/artifacts/ContentHash.js";
import type { ActorArtifact } from "../../mps-governance/src/actors/ActorArtifact.js";
import type { ActorLifecycleArtifact } from "../../mps-governance/src/actors/ActorLifecycleArtifact.js";
import {
  validateAuthorityEvidenceArtifact,
  type AuthorityEvidenceArtifact,
} from "../../mps-governance/src/actors/AuthorityEvidenceArtifact.js";
import type { TrustAnchorArtifact } from "../../mps-governance/src/actors/TrustAnchorArtifact.js";
import type { TrustDomainArtifact } from "../../mps-governance/src/actors/TrustDomainArtifact.js";

export interface VerifiedSourceAuthorityPath {
  readonly root: ArtifactContract;
  readonly issuer: ArtifactContract;
  readonly subject: ArtifactContract;
}

/**
 * A positive authority decision is deliberately NOT an artifact field. It exists only as the
 * result of executing a source verifier in this process. AuthorityEvidence remains a canonical,
 * replayable representation and can never mint this decision by construction.
 */
export interface VerifiedSourceAuthorityDecision {
  readonly authorized_at_decision_time: true;
  readonly decision_time: string;
  readonly action: string;
  readonly authority_scope: string;
  readonly evidence_ref: {
    readonly artifact_id: string;
    readonly artifact_type: "authority_evidence";
  };
  readonly evidence_hash: ContentHash;
}

const verifiedDecisions = new WeakSet<object>();

function isoInstant(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error("REJECT_SOURCE_AUTHORITY: decision_time must be ISO-8601");
  }
  return new Date(parsed).toISOString();
}

function sameRef(
  left: { readonly artifact_id: string; readonly artifact_type: string },
  right: { readonly artifact_id: string; readonly artifact_type: string },
): boolean {
  return left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

function sameHash(
  left: ContentHash,
  right: ContentHash,
): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function assertPathEntry(
  evidence: AuthorityEvidenceArtifact,
  index: number,
  role: "root" | "issuer" | "subject",
  artifact: ArtifactContract,
): void {
  const entry = evidence.authority_path[index];
  if (
    !entry ||
    entry.role !== role ||
    !sameRef(entry.artifact_ref, artifact) ||
    !sameHash(entry.content_hash, artifact.content_hash)
  ) {
    throw new Error(`REJECT_SOURCE_AUTHORITY: authority_path ${role} binding mismatch`);
  }
}

/**
 * Generic source-authority evaluation boundary introduced by 04D.
 *
 * The callback is the authority-bearing operation. It must cryptographically verify the source
 * chain and return the exact artifacts it verified. Only after that succeeds do we validate that
 * the representation points at those exact bytes and mint an ephemeral positive decision.
 *
 * This function intentionally does not replace the actor-root delegation evaluator. Source-root
 * and actor-root models remain separate fail-closed paths.
 */
export async function verifySourceAuthorityAtDecisionTime(input: {
  readonly evidence: AuthorityEvidenceArtifact;
  readonly actor: ActorArtifact;
  readonly lifecycle: ActorLifecycleArtifact;
  readonly trust_domain: TrustDomainArtifact;
  readonly trust_anchor: TrustAnchorArtifact;
  readonly decision_time: string;
  readonly required_action: string;
  readonly required_scope: string;
  readonly verify_source_path: () => Promise<VerifiedSourceAuthorityPath>;
}): Promise<VerifiedSourceAuthorityDecision> {
  const decisionTime = isoInstant(input.decision_time);
  if (input.trust_anchor.root_binding_type !== "authority_artifact") {
    throw new Error("REJECT_SOURCE_AUTHORITY: trust anchor is not a source-authority root");
  }
  if (
    input.evidence.authority_claim_state !== "UNVERIFIED_REPRESENTATION" ||
    input.evidence.decision_time !== decisionTime ||
    input.evidence.action !== input.required_action ||
    input.evidence.authority_scope !== input.required_scope ||
    input.trust_domain.authority_scope !== input.required_scope
  ) {
    throw new Error("REJECT_SOURCE_AUTHORITY: decision binding mismatch");
  }
  if (input.evidence.authority_path.length !== 3) {
    throw new Error("REJECT_SOURCE_AUTHORITY: source path must be exactly root -> issuer -> subject");
  }

  // Load-bearing point: no positive result can exist until the domain-specific cryptographic
  // verifier has actually executed successfully.
  const verified = await input.verify_source_path();

  assertPathEntry(input.evidence, 0, "root", verified.root);
  assertPathEntry(input.evidence, 1, "issuer", verified.issuer);
  assertPathEntry(input.evidence, 2, "subject", verified.subject);

  validateAuthorityEvidenceArtifact(input.evidence, {
    actor: input.actor,
    trust_domain: input.trust_domain,
    trust_anchor: input.trust_anchor,
    lifecycle: input.lifecycle,
    authority_path: [
      { role: "root", artifact: verified.root },
      { role: "issuer", artifact: verified.issuer },
      { role: "subject", artifact: verified.subject },
    ],
  });

  const decision: VerifiedSourceAuthorityDecision = Object.freeze({
    authorized_at_decision_time: true as const,
    decision_time: decisionTime,
    action: input.required_action,
    authority_scope: input.required_scope,
    evidence_ref: {
      artifact_id: input.evidence.artifact_id,
      artifact_type: "authority_evidence" as const,
    },
    evidence_hash: input.evidence.content_hash,
  });
  verifiedDecisions.add(decision);
  return decision;
}

/**
 * Runtime provenance check. A structurally identical caller-created object is not a verified
 * decision; only this module can insert an object into the private WeakSet above.
 */
export function isVerifiedSourceAuthorityDecision(
  value: unknown,
): value is VerifiedSourceAuthorityDecision {
  return typeof value === "object" && value !== null && verifiedDecisions.has(value as object);
}
