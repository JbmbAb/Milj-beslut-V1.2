import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical";
import type { ActorArtifact } from "./ActorArtifact";
import type { ActorLifecycleArtifact } from "./ActorLifecycleArtifact";
import type { TrustAnchorArtifact } from "./TrustAnchorArtifact";
import type { TrustDomainArtifact } from "./TrustDomainArtifact";

export type AuthorityEvidencePathRole =
  | "root"
  | "issuer"
  | "subject"
  | "delegation"
  | "activation"
  | "expiration"
  | "revocation"
  | "supporting";

export interface AuthorityEvidencePathEntry {
  readonly role: AuthorityEvidencePathRole;
  readonly artifact_ref: ArtifactReference;
  readonly content_hash: ContentHash;
}

export interface AuthorityEvidenceArtifact extends ArtifactContract {
  readonly artifact_type: "authority_evidence";

  readonly actor_ref: ArtifactReference;
  readonly actor_hash: ContentHash;
  readonly trust_domain_ref: ArtifactReference;
  readonly trust_domain_hash: ContentHash;
  readonly trust_anchor_ref: ArtifactReference;
  readonly trust_anchor_hash: ContentHash;
  readonly lifecycle_ref: ArtifactReference;
  readonly lifecycle_hash: ContentHash;

  readonly authority_scope: string;
  readonly action: string;
  readonly decision_time: string;
  readonly authorized_at_decision_time: true;

  /**
   * Ordered, hash-bound source authority path. This is representation only:
   * LU cryptographic verification remains in the LU authority verifier.
   */
  readonly authority_path: readonly AuthorityEvidencePathEntry[];

  readonly trust_delegation_ref?: ArtifactReference;
  readonly trust_delegation_hash?: ContentHash;
  readonly evaluation_profile_ref?: ArtifactReference;
  readonly evaluation_profile_hash?: ContentHash;
}

export interface AuthorityEvidencePathInput {
  readonly role: AuthorityEvidencePathRole;
  readonly artifact: ArtifactContract;
}

function ref(artifact: ArtifactContract): ArtifactReference {
  const artifactId = artifact.artifact_id.trim();
  const artifactType = artifact.artifact_type.trim();
  if (!artifactId || !artifactType) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: artifact reference is empty");
  }
  return { artifact_id: artifactId, artifact_type: artifactType };
}

function sameRef(
  left: ArtifactReference,
  right: ArtifactReference,
): boolean {
  return (
    left.artifact_id === right.artifact_id &&
    left.artifact_type === right.artifact_type
  );
}

function sameHash(left: ContentHash, right: ContentHash): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`REJECT_AUTHORITY_EVIDENCE: ${field} is required`);
  }
  return normalized;
}

function decisionTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: decision_time must be ISO-8601");
  }
  return new Date(parsed).toISOString();
}

function path(
  values: readonly AuthorityEvidencePathInput[],
): readonly AuthorityEvidencePathEntry[] {
  if (values.length === 0) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: authority_path is required");
  }
  if (values[0]?.role !== "root") {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: authority_path must start at root");
  }

  const result = values.map(({ role, artifact }) => ({
    role,
    artifact_ref: ref(artifact),
    content_hash: artifact.content_hash,
  }));

  const keys = result.map(
    (entry) =>
      `${entry.artifact_ref.artifact_type}\u0000${entry.artifact_ref.artifact_id}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: duplicate authority_path artifact");
  }
  return result;
}

function body(input: {
  readonly actor: ActorArtifact;
  readonly trust_domain: TrustDomainArtifact;
  readonly trust_anchor: TrustAnchorArtifact;
  readonly lifecycle: ActorLifecycleArtifact;
  readonly action: string;
  readonly decision_time: string;
  readonly authority_path: readonly AuthorityEvidencePathInput[];
  readonly trust_delegation?: ArtifactContract;
  readonly evaluation_profile?: ArtifactContract;
}): Omit<AuthorityEvidenceArtifact, "content_hash"> {
  const actorRef = ref(input.actor);
  const domainRef = ref(input.trust_domain);
  const anchorRef = ref(input.trust_anchor);
  const lifecycleRef = ref(input.lifecycle);
  const canonicalPath = path(input.authority_path);
  const normalizedDecisionTime = decisionTime(input.decision_time);

  if (!input.actor.trust_domain_refs.some((candidate) => sameRef(candidate, domainRef))) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: actor does not participate in trust domain");
  }
  if (!sameRef(input.actor.lifecycle_ref, lifecycleRef)) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: actor lifecycle mismatch");
  }
  if (
    !input.actor.identity_ref ||
    !input.actor.identity_hash ||
    !sameRef(input.lifecycle.identity_ref, input.actor.identity_ref) ||
    !sameHash(input.lifecycle.identity_hash, input.actor.identity_hash)
  ) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: lifecycle identity mismatch");
  }
  if (input.lifecycle.state !== "ACTIVE") {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: actor was not ACTIVE at decision boundary");
  }
  if (Date.parse(normalizedDecisionTime) < Date.parse(input.lifecycle.effective_from)) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: decision predates ACTIVE lifecycle state");
  }
  if (
    !sameRef(input.trust_domain.anchor_ref, anchorRef) ||
    !sameHash(input.trust_domain.anchor_hash, input.trust_anchor.content_hash)
  ) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: trust domain anchor mismatch");
  }
  if (!input.trust_domain.allowed_actor_types.includes(input.actor.kind)) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: actor kind is not allowed by trust domain");
  }

  const pathRoot = canonicalPath[0]!;
  if (
    !sameRef(pathRoot.artifact_ref, input.trust_anchor.root_ref) ||
    !sameHash(pathRoot.content_hash, input.trust_anchor.root_hash)
  ) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: authority path root does not match trust anchor");
  }

  const trustDelegationRef = input.trust_delegation
    ? ref(input.trust_delegation)
    : undefined;
  const evaluationProfileRef = input.evaluation_profile
    ? ref(input.evaluation_profile)
    : undefined;

  const canonical = {
    artifact_type: "authority_evidence" as const,
    actor_ref: actorRef,
    actor_hash: input.actor.content_hash,
    trust_domain_ref: domainRef,
    trust_domain_hash: input.trust_domain.content_hash,
    trust_anchor_ref: anchorRef,
    trust_anchor_hash: input.trust_anchor.content_hash,
    lifecycle_ref: lifecycleRef,
    lifecycle_hash: input.lifecycle.content_hash,
    authority_scope: input.trust_domain.authority_scope,
    action: required(input.action, "action"),
    decision_time: normalizedDecisionTime,
    authorized_at_decision_time: true as const,
    authority_path: canonicalPath,
    ...(trustDelegationRef
      ? {
          trust_delegation_ref: trustDelegationRef,
          trust_delegation_hash: input.trust_delegation!.content_hash,
        }
      : {}),
    ...(evaluationProfileRef
      ? {
          evaluation_profile_ref: evaluationProfileRef,
          evaluation_profile_hash: input.evaluation_profile!.content_hash,
        }
      : {}),
  };

  const identity = sha256ContentHash(canonical);
  const references: ArtifactReference[] = [
    actorRef,
    domainRef,
    anchorRef,
    lifecycleRef,
    ...canonicalPath.map((entry) => entry.artifact_ref),
    ...(trustDelegationRef ? [trustDelegationRef] : []),
    ...(evaluationProfileRef ? [evaluationProfileRef] : []),
  ];

  const seen = new Set<string>();
  const uniqueReferences = references.filter((reference) => {
    const key = `${reference.artifact_type}\u0000${reference.artifact_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    artifact_id: `authority-evidence-${identity.value.slice(0, 24)}`,
    references: uniqueReferences,
    ...canonical,
  };
}

export function createAuthorityEvidenceArtifact(input: {
  readonly actor: ActorArtifact;
  readonly trust_domain: TrustDomainArtifact;
  readonly trust_anchor: TrustAnchorArtifact;
  readonly lifecycle: ActorLifecycleArtifact;
  readonly action: string;
  readonly decision_time: string;
  readonly authority_path: readonly AuthorityEvidencePathInput[];
  readonly trust_delegation?: ArtifactContract;
  readonly evaluation_profile?: ArtifactContract;
}): AuthorityEvidenceArtifact {
  const artifact = body(input);
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function validateAuthorityEvidenceArtifact(
  artifact: AuthorityEvidenceArtifact,
  input: Omit<
    Parameters<typeof createAuthorityEvidenceArtifact>[0],
    "action" | "decision_time"
  >,
): AuthorityEvidenceArtifact {
  const rebuilt = createAuthorityEvidenceArtifact({
    ...input,
    action: artifact.action,
    decision_time: artifact.decision_time,
  });
  if (
    artifact.artifact_id !== rebuilt.artifact_id ||
    artifact.authorized_at_decision_time !== true ||
    artifact.content_hash.algorithm !== rebuilt.content_hash.algorithm ||
    artifact.content_hash.value !== rebuilt.content_hash.value
  ) {
    throw new Error("REJECT_AUTHORITY_EVIDENCE: canonical mismatch");
  }
  return artifact;
}
