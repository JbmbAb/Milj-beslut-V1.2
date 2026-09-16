import type { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical.js";
import type {
  AuthorityEvidencePathEntry,
  AuthorityEvidencePathInput,
} from "../../../mps-governance/src/actors/AuthorityEvidenceArtifact.js";
import type { ServiceIdentityArtifact } from "../../../mps-governance/src/actors/IdentityArtifacts.js";
import type { TrustAnchorArtifact } from "../../../mps-governance/src/actors/TrustAnchorArtifact.js";
import type { TrustDomainArtifact } from "../../../mps-governance/src/actors/TrustDomainArtifact.js";

export const LU_SOURCE_AUTHORITY_EVIDENCE_CONTRACT_VERSION =
  "lu-source-authority-evidence-v1" as const;

/**
 * 04D-R1 source-authority representation.
 *
 * This is deliberately a different contract from the 04C actor/lifecycle AuthorityEvidence
 * shape. The LU source artifacts prove an immutable cryptographic root -> issuer ->
 * ExecutionIdentity chain, but they do NOT carry signed activation, expiry, revocation, or
 * decision-time facts. Encoding a decision_time here would therefore manufacture temporal
 * semantics and, if sourced from the wall clock, would also destroy assessment determinism.
 *
 * The artifact_type remains "authority_evidence" so ACT-21-I10 can bind the mutation to exactly
 * one authority-evidence artifact. Positive runtime verification never lives in this artifact.
 */
export interface LuSourceAuthorityEvidenceArtifact extends ArtifactContract {
  readonly artifact_type: "authority_evidence";
  readonly authority_evidence_contract_version:
    typeof LU_SOURCE_AUTHORITY_EVIDENCE_CONTRACT_VERSION;

  readonly service_identity_ref: ArtifactReference;
  readonly service_identity_hash: ContentHash;
  readonly trust_domain_ref: ArtifactReference;
  readonly trust_domain_hash: ContentHash;
  readonly trust_anchor_ref: ArtifactReference;
  readonly trust_anchor_hash: ContentHash;

  readonly authority_scope: string;
  readonly action: string;
  readonly authority_claim_state: "UNVERIFIED_REPRESENTATION";
  readonly authority_path: readonly AuthorityEvidencePathEntry[];
}

function ref(artifact: ArtifactContract): ArtifactReference {
  const artifactId = artifact.artifact_id.trim();
  const artifactType = artifact.artifact_type.trim();
  if (!artifactId || !artifactType) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY_EVIDENCE: empty artifact reference");
  }
  return { artifact_id: artifactId, artifact_type: artifactType };
}

function sameRef(left: ArtifactReference, right: ArtifactReference): boolean {
  return left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

function sameHash(left: ContentHash, right: ContentHash): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`REJECT_LU_SOURCE_AUTHORITY_EVIDENCE: ${field} is required`);
  }
  return normalized;
}

function canonicalPath(
  values: readonly AuthorityEvidencePathInput[],
): readonly AuthorityEvidencePathEntry[] {
  if (
    values.length !== 3 ||
    values[0]?.role !== "root" ||
    values[1]?.role !== "issuer" ||
    values[2]?.role !== "subject"
  ) {
    throw new Error(
      "REJECT_LU_SOURCE_AUTHORITY_EVIDENCE: path must be exactly root -> issuer -> subject",
    );
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
    throw new Error("REJECT_LU_SOURCE_AUTHORITY_EVIDENCE: duplicate path artifact");
  }
  return result;
}

function body(input: {
  readonly service_identity: ServiceIdentityArtifact;
  readonly trust_domain: TrustDomainArtifact;
  readonly trust_anchor: TrustAnchorArtifact;
  readonly action: string;
  readonly authority_path: readonly AuthorityEvidencePathInput[];
}): Omit<LuSourceAuthorityEvidenceArtifact, "content_hash"> {
  const identityRef = ref(input.service_identity);
  const domainRef = ref(input.trust_domain);
  const anchorRef = ref(input.trust_anchor);
  const path = canonicalPath(input.authority_path);

  if (
    !sameRef(input.trust_domain.anchor_ref, anchorRef) ||
    !sameHash(input.trust_domain.anchor_hash, input.trust_anchor.content_hash)
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY_EVIDENCE: trust-domain anchor mismatch");
  }
  if (!input.trust_domain.allowed_actor_types.includes("service")) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY_EVIDENCE: trust domain does not allow service identity");
  }
  if (
    !sameRef(path[0]!.artifact_ref, input.trust_anchor.root_ref) ||
    !sameHash(path[0]!.content_hash, input.trust_anchor.root_hash)
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY_EVIDENCE: path root does not match trust anchor");
  }

  const canonical = {
    artifact_type: "authority_evidence" as const,
    authority_evidence_contract_version: LU_SOURCE_AUTHORITY_EVIDENCE_CONTRACT_VERSION,
    service_identity_ref: identityRef,
    service_identity_hash: input.service_identity.content_hash,
    trust_domain_ref: domainRef,
    trust_domain_hash: input.trust_domain.content_hash,
    trust_anchor_ref: anchorRef,
    trust_anchor_hash: input.trust_anchor.content_hash,
    authority_scope: required(input.trust_domain.authority_scope, "authority_scope"),
    action: required(input.action, "action"),
    authority_claim_state: "UNVERIFIED_REPRESENTATION" as const,
    authority_path: path,
  };

  const identity = sha256ContentHash(canonical);
  const references = [
    identityRef,
    domainRef,
    anchorRef,
    ...path.map((entry) => entry.artifact_ref),
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

export function createLuSourceAuthorityEvidenceArtifact(input: {
  readonly service_identity: ServiceIdentityArtifact;
  readonly trust_domain: TrustDomainArtifact;
  readonly trust_anchor: TrustAnchorArtifact;
  readonly action: string;
  readonly authority_path: readonly AuthorityEvidencePathInput[];
}): LuSourceAuthorityEvidenceArtifact {
  const artifact = body(input);
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function validateLuSourceAuthorityEvidenceArtifact(
  artifact: LuSourceAuthorityEvidenceArtifact,
  input: Omit<
    Parameters<typeof createLuSourceAuthorityEvidenceArtifact>[0],
    "action"
  >,
): LuSourceAuthorityEvidenceArtifact {
  const raw = artifact as LuSourceAuthorityEvidenceArtifact & {
    readonly decision_time?: unknown;
    readonly authorized_at_decision_time?: unknown;
    readonly authorized_now?: unknown;
    readonly source_authority_verified?: unknown;
  };
  if (
    raw.decision_time !== undefined ||
    raw.authorized_at_decision_time !== undefined ||
    raw.authorized_now !== undefined ||
    raw.source_authority_verified !== undefined
  ) {
    throw new Error(
      "REJECT_LU_SOURCE_AUTHORITY_EVIDENCE: representation cannot assert temporal or positive authority",
    );
  }

  const rebuilt = createLuSourceAuthorityEvidenceArtifact({
    ...input,
    action: artifact.action,
  });
  if (
    artifact.artifact_id !== rebuilt.artifact_id ||
    artifact.authority_evidence_contract_version !==
      LU_SOURCE_AUTHORITY_EVIDENCE_CONTRACT_VERSION ||
    artifact.authority_claim_state !== "UNVERIFIED_REPRESENTATION" ||
    !sameHash(artifact.content_hash, rebuilt.content_hash)
  ) {
    throw new Error("REJECT_LU_SOURCE_AUTHORITY_EVIDENCE: canonical mismatch");
  }
  return artifact;
}
