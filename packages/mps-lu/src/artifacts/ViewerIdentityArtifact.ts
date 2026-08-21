import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";

/**
 * VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01.
 *
 * `viewer_identity_ref` identifies the PRESENTATION/RUNTIME COMPONENT producing a viewer
 * projection's provenance -- e.g. "the governed LU ViewerKernel implementation admitted for
 * release X". It deliberately does NOT identify a project, a property, a project-context
 * binding, a human user, or a ViewerCapability grant -- those are separate concepts
 * (subject/scope vs. actor/runtime-provenance) and collapsing them would make exported
 * provenance semantically false. See
 * docs/architecture/VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1-PROVEN.md's STOP CONDITION for why
 * this artifact exists: V1's `viewer_identity_ref` traced to nothing but a hardcoded test
 * fixture, never a real canonical authority.
 */
export const VIEWER_IDENTITY_ISSUER_PURPOSE = "VIEWER_IDENTITY_ISSUER_V1" as const;
export const VIEWER_IDENTITY_ISSUER_ARTIFACT_TYPE = "viewer_identity_issuer" as const;
export const VIEWER_IDENTITY_ISSUER_VERSION = "viewer-identity-issuer-v1" as const;
export const VIEWER_IDENTITY_ISSUER_ALLOWED_ARTIFACT_TYPE = "viewer_identity" as const;

export const VIEWER_IDENTITY_CONTRACT_VERSION = "VIEWER_IDENTITY_V1" as const;
export const LU_CANONICAL_PRESENTATION_VIEWER = "LU_CANONICAL_PRESENTATION_VIEWER" as const;

function req(v: string, n: string): string {
  const x = v.trim();
  if (!x) throw new Error(`REJECT_VIEWER_IDENTITY: ${n} is required`);
  return x;
}

function reqRef(v: ArtifactReference, n: string): ArtifactReference {
  if (!v || typeof v !== "object") throw new Error(`REJECT_VIEWER_IDENTITY: ${n} is required`);
  return {
    artifact_id: req(String(v.artifact_id ?? ""), `${n}.artifact_id`),
    artifact_type: req(String(v.artifact_type ?? ""), `${n}.artifact_type`),
  };
}

/**
 * A dedicated, narrow issuing authority for `viewer_identity` artifacts only. Deliberately a
 * separate key from VIEWER_CAPABILITY_ISSUER_V1 -- that authority grants presentation rights over
 * a project/context; this one attests to what the presenting runtime component itself is. No
 * explicit delegation model exists elsewhere in this repo between issuer purposes, so this is a
 * new dedicated key, not a silently-reused or implicitly-widened one.
 */
export interface ViewerIdentityIssuerArtifact extends ArtifactContract {
  readonly artifact_type: typeof VIEWER_IDENTITY_ISSUER_ARTIFACT_TYPE;
  readonly payload: {
    readonly issuer_key_id: string;
    readonly purpose: typeof VIEWER_IDENTITY_ISSUER_PURPOSE;
    readonly allowed_artifact_type: typeof VIEWER_IDENTITY_ISSUER_ALLOWED_ARTIFACT_TYPE;
    readonly owner_authority_ref: ArtifactReference;
    readonly issuer_version: typeof VIEWER_IDENTITY_ISSUER_VERSION;
  };
  readonly attestation?: ArtifactAttestation;
}

/**
 * The canonical identity of the governed LU presentation viewer, bound to the exact product
 * release it was admitted for. Deliberately excludes project_id/property_id/
 * project_context_binding_ref/capability_id/any runtime-local UUID/any timestamp from identity --
 * this artifact identifies WHAT is presenting, never WHAT is being presented or WHEN a grant was
 * issued (those are ProductViewerCapabilityArtifact's job).
 */
export interface ViewerIdentityArtifact extends ArtifactContract {
  readonly artifact_type: "viewer_identity";
  readonly payload: {
    readonly contract_version: typeof VIEWER_IDENTITY_CONTRACT_VERSION;
    readonly viewer_kind: typeof LU_CANONICAL_PRESENTATION_VIEWER;
    readonly runtime_component: string;
    readonly product_release_ref: ArtifactReference;
    readonly product_release_hash: string;
    readonly issuer_ref: ArtifactReference;
    readonly issuer_key_id: string;
  };
  readonly attestation?: ArtifactAttestation;
}

export function createViewerIdentityIssuerArtifact(input: {
  readonly issuer_key_id: string;
  readonly owner_authority_ref: ArtifactReference;
}): Omit<ViewerIdentityIssuerArtifact, "attestation"> {
  const payload = {
    issuer_key_id: req(input.issuer_key_id, "issuer_key_id"),
    purpose: VIEWER_IDENTITY_ISSUER_PURPOSE,
    allowed_artifact_type: VIEWER_IDENTITY_ISSUER_ALLOWED_ARTIFACT_TYPE,
    owner_authority_ref: reqRef(input.owner_authority_ref, "owner_authority_ref"),
    issuer_version: VIEWER_IDENTITY_ISSUER_VERSION,
  } as const;
  const i = sha256ContentHash({ artifact_type: VIEWER_IDENTITY_ISSUER_ARTIFACT_TYPE, payload });
  const a = {
    artifact_id: `viewer-identity-issuer-${i.value.slice(0, 24)}`,
    artifact_type: VIEWER_IDENTITY_ISSUER_ARTIFACT_TYPE,
    references: [payload.owner_authority_ref],
    payload,
  };
  return { ...a, content_hash: sha256ContentHash(a) };
}

export function createViewerIdentityArtifact(input: {
  readonly runtime_component: string;
  readonly product_release_ref: ArtifactReference;
  readonly product_release_hash: string;
  readonly issuer_ref: ArtifactReference;
  readonly issuer_key_id: string;
}): Omit<ViewerIdentityArtifact, "attestation"> {
  const payload = {
    contract_version: VIEWER_IDENTITY_CONTRACT_VERSION,
    viewer_kind: LU_CANONICAL_PRESENTATION_VIEWER,
    runtime_component: req(input.runtime_component, "runtime_component"),
    product_release_ref: reqRef(input.product_release_ref, "product_release_ref"),
    product_release_hash: req(input.product_release_hash, "product_release_hash"),
    issuer_ref: reqRef(input.issuer_ref, "issuer_ref"),
    issuer_key_id: req(input.issuer_key_id, "issuer_key_id"),
  } as const;
  const i = sha256ContentHash({ artifact_type: "viewer_identity", payload });
  const a = {
    artifact_id: `viewer-identity-${i.value.slice(0, 24)}`,
    artifact_type: "viewer_identity" as const,
    references: [payload.product_release_ref, payload.issuer_ref],
    payload,
  };
  return { ...a, content_hash: sha256ContentHash(a) };
}

/**
 * Structural validation: recomputes canonical identity/content_hash from the artifact's current
 * payload and rejects any mismatch. Without this, a payload could be mutated after signing while
 * leaving the (unrelated) declared content_hash field untouched -- the attestation would still
 * verify against that stale content_hash, silently accepting tampered data. Does NOT verify the
 * attestation signature itself.
 */
export function validateViewerIdentityArtifact(artifact: ViewerIdentityArtifact): ViewerIdentityArtifact {
  if (!artifact || typeof artifact !== "object" || artifact.artifact_type !== "viewer_identity") {
    throw new Error("REJECT_VIEWER_IDENTITY: artifact_type must be viewer_identity");
  }
  if (!artifact.payload || typeof artifact.payload !== "object") {
    throw new Error("REJECT_VIEWER_IDENTITY: payload is required");
  }
  const rebuilt = createViewerIdentityArtifact(artifact.payload);
  if (artifact.artifact_id !== rebuilt.artifact_id) {
    throw new Error("REJECT_VIEWER_IDENTITY: artifact_id does not match canonical identity");
  }
  if (artifact.content_hash?.algorithm !== rebuilt.content_hash.algorithm || artifact.content_hash?.value !== rebuilt.content_hash.value) {
    throw new Error("REJECT_VIEWER_IDENTITY: content_hash does not match canonical payload (tampered)");
  }
  return artifact;
}
