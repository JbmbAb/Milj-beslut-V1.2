import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical";

export type TrustAnchorRootBindingType = "actor" | "authority_artifact";

export interface TrustAnchorArtifact extends ArtifactContract {
  readonly artifact_type: "trust_anchor";
  readonly anchor_name: string;
  readonly governance_profile: string;

  /**
   * ADR-24-21 defines TrustAnchor as the canonical root of trust, not
   * specifically as an Actor. 04C therefore binds the exact canonical root
   * artifact + hash and derives whether it is an actor or a source-authority
   * artifact. No authority is created by this representation.
   */
  readonly root_binding_type: TrustAnchorRootBindingType;
  readonly root_ref: ArtifactReference;
  readonly root_hash: ContentHash;

  readonly verification_key_id?: string;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_TRUST_ANCHOR: ${field} is required`);
  return normalized;
}

function body(input: {
  readonly anchor_name: string;
  readonly governance_profile: string;
  readonly root: ArtifactContract;
  readonly verification_key_id?: string;
}): Omit<TrustAnchorArtifact, "content_hash"> {
  const rootRef: ArtifactReference = {
    artifact_id: required(input.root.artifact_id, "root.artifact_id"),
    artifact_type: required(input.root.artifact_type, "root.artifact_type"),
  };
  const rootBindingType: TrustAnchorRootBindingType =
    input.root.artifact_type === "actor" ? "actor" : "authority_artifact";
  const verificationKeyId = input.verification_key_id?.trim();
  if (input.verification_key_id !== undefined && !verificationKeyId) {
    throw new Error("REJECT_TRUST_ANCHOR: verification_key_id is empty");
  }

  const canonical = {
    artifact_type: "trust_anchor" as const,
    anchor_name: required(input.anchor_name, "anchor_name"),
    governance_profile: required(input.governance_profile, "governance_profile"),
    root_binding_type: rootBindingType,
    root_ref: rootRef,
    root_hash: input.root.content_hash,
    ...(verificationKeyId ? { verification_key_id: verificationKeyId } : {}),
  };
  const identity = sha256ContentHash(canonical);

  return {
    artifact_id: `trust-anchor-${identity.value.slice(0, 24)}`,
    artifact_type: "trust_anchor",
    references: [rootRef],
    ...canonical,
  };
}

export function createTrustAnchorArtifact(input: {
  readonly anchor_name: string;
  readonly governance_profile: string;
  readonly root: ArtifactContract;
  readonly verification_key_id?: string;
}): TrustAnchorArtifact {
  const artifact = body(input);
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function validateTrustAnchorArtifact(
  artifact: TrustAnchorArtifact,
  root: ArtifactContract,
): TrustAnchorArtifact {
  const rebuilt = createTrustAnchorArtifact({
    anchor_name: artifact.anchor_name,
    governance_profile: artifact.governance_profile,
    root,
    verification_key_id: artifact.verification_key_id,
  });
  if (
    artifact.artifact_type !== "trust_anchor" ||
    artifact.artifact_id !== rebuilt.artifact_id ||
    artifact.root_binding_type !== rebuilt.root_binding_type ||
    artifact.root_ref.artifact_id !== rebuilt.root_ref.artifact_id ||
    artifact.root_ref.artifact_type !== rebuilt.root_ref.artifact_type ||
    artifact.root_hash.algorithm !== rebuilt.root_hash.algorithm ||
    artifact.root_hash.value !== rebuilt.root_hash.value ||
    artifact.content_hash.algorithm !== rebuilt.content_hash.algorithm ||
    artifact.content_hash.value !== rebuilt.content_hash.value
  ) {
    throw new Error("REJECT_TRUST_ANCHOR: canonical mismatch");
  }
  return artifact;
}
