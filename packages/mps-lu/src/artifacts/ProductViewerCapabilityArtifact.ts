import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";

export const VIEWER_CAPABILITY_ISSUER_PURPOSE = "VIEWER_CAPABILITY_ISSUER_V1" as const;
export const VIEWER_CAPABILITY_ISSUER_ARTIFACT_TYPE = "viewer_capability_issuer" as const;
export const VIEWER_CAPABILITY_ISSUER_VERSION = "viewer-capability-issuer-v1" as const;
export const VIEWER_CAPABILITY_ISSUER_ALLOWED_ARTIFACT_TYPE = "viewer_capability" as const;

export const PRODUCT_VIEWER_CAPABILITY_VERSION = "product-viewer-capability-v2" as const;
export const PRESENT_PERSISTED_CANONICAL_LU_RESULTS = "PRESENT_PERSISTED_CANONICAL_LU_RESULTS" as const;

function req(v: string, n: string): string {
  const x = v.trim();
  if (!x) throw new Error(`REJECT_PRODUCT_VIEWER_CAPABILITY: ${n} is required`);
  return x;
}

function reqRef(v: ArtifactReference, n: string): ArtifactReference {
  if (!v || typeof v !== "object") throw new Error(`REJECT_PRODUCT_VIEWER_CAPABILITY: ${n} is required`);
  return {
    artifact_id: req(String(v.artifact_id ?? ""), `${n}.artifact_id`),
    artifact_type: req(String(v.artifact_type ?? ""), `${n}.artifact_type`),
  };
}

function reqIso(v: string, n: string): string {
  const x = req(v, n);
  if (Number.isNaN(Date.parse(x))) throw new Error(`REJECT_PRODUCT_VIEWER_CAPABILITY: ${n} must be a valid ISO8601 timestamp`);
  return x;
}

/**
 * VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1.
 *
 * A dedicated, self-signed issuing authority for `viewer_capability` artifacts. Possession of the
 * private key alone does not establish authority: the issuer artifact itself carries a
 * self-attestation (proving private-key possession at minting time) and an explicit
 * `owner_authority_ref` naming who authorized installing this key as trusted -- both are checked
 * by the runtime verifier (server/modules/localization/productViewerCapabilityAuthority.ts)
 * alongside the env-configured trusted key_id (the actual root of trust: an issuer artifact
 * signed by any key other than the one the verifier was configured with is rejected regardless
 * of internal consistency).
 */
export interface ViewerCapabilityIssuerArtifact extends ArtifactContract {
  readonly artifact_type: typeof VIEWER_CAPABILITY_ISSUER_ARTIFACT_TYPE;
  readonly payload: {
    readonly issuer_key_id: string;
    readonly purpose: typeof VIEWER_CAPABILITY_ISSUER_PURPOSE;
    readonly allowed_artifact_type: typeof VIEWER_CAPABILITY_ISSUER_ALLOWED_ARTIFACT_TYPE;
    readonly owner_authority_ref: ArtifactReference;
    readonly issuer_version: typeof VIEWER_CAPABILITY_ISSUER_VERSION;
  };
  readonly attestation?: ArtifactAttestation;
}

/**
 * A single, immutable, time-bounded grant to present persisted canonical LU results for one
 * project/context. `viewer_identity_ref` and `project_context_binding_ref` are deliberately
 * distinct and both required: the former answers "which viewer/presentation identity stands
 * behind this export's provenance", the latter "which project/context this capability may
 * present" -- collapsing them would make exported provenance semantically false.
 */
export interface ProductViewerCapabilityArtifact extends ArtifactContract {
  readonly artifact_type: "viewer_capability";
  readonly payload: {
    readonly capability_contract_version: typeof PRODUCT_VIEWER_CAPABILITY_VERSION;
    readonly issuer_key_id: string;
    readonly issuer_ref: ArtifactReference;
    readonly subject_project_id: string;
    readonly project_context_binding_ref: ArtifactReference;
    readonly viewer_identity_ref: ArtifactReference;
    readonly product_release_ref: ArtifactReference;
    readonly product_release_hash: string;
    readonly permitted_presentation_capability: typeof PRESENT_PERSISTED_CANONICAL_LU_RESULTS;
    readonly valid_from: string;
    readonly valid_until: string;
  };
  readonly attestation?: ArtifactAttestation;
}

export function createViewerCapabilityIssuerArtifact(input: {
  readonly issuer_key_id: string;
  readonly owner_authority_ref: ArtifactReference;
}): Omit<ViewerCapabilityIssuerArtifact, "attestation"> {
  const payload = {
    issuer_key_id: req(input.issuer_key_id, "issuer_key_id"),
    purpose: VIEWER_CAPABILITY_ISSUER_PURPOSE,
    allowed_artifact_type: VIEWER_CAPABILITY_ISSUER_ALLOWED_ARTIFACT_TYPE,
    owner_authority_ref: reqRef(input.owner_authority_ref, "owner_authority_ref"),
    issuer_version: VIEWER_CAPABILITY_ISSUER_VERSION,
  } as const;
  const i = sha256ContentHash({ artifact_type: VIEWER_CAPABILITY_ISSUER_ARTIFACT_TYPE, payload });
  const a = {
    artifact_id: `viewer-capability-issuer-${i.value.slice(0, 24)}`,
    artifact_type: VIEWER_CAPABILITY_ISSUER_ARTIFACT_TYPE,
    references: [payload.owner_authority_ref],
    payload,
  };
  return { ...a, content_hash: sha256ContentHash(a) };
}

export function createProductViewerCapabilityArtifact(input: {
  readonly issuer_key_id: string;
  readonly issuer_ref: ArtifactReference;
  readonly subject_project_id: string;
  readonly project_context_binding_ref: ArtifactReference;
  readonly viewer_identity_ref: ArtifactReference;
  readonly product_release_ref: ArtifactReference;
  readonly product_release_hash: string;
  readonly valid_from: string;
  readonly valid_until: string;
}): Omit<ProductViewerCapabilityArtifact, "attestation"> {
  const validFrom = reqIso(input.valid_from, "valid_from");
  const validUntil = reqIso(input.valid_until, "valid_until");
  if (Date.parse(validUntil) <= Date.parse(validFrom)) {
    throw new Error("REJECT_PRODUCT_VIEWER_CAPABILITY: valid_until must be after valid_from");
  }
  const payload = {
    capability_contract_version: PRODUCT_VIEWER_CAPABILITY_VERSION,
    issuer_key_id: req(input.issuer_key_id, "issuer_key_id"),
    issuer_ref: reqRef(input.issuer_ref, "issuer_ref"),
    subject_project_id: req(input.subject_project_id, "subject_project_id"),
    project_context_binding_ref: reqRef(input.project_context_binding_ref, "project_context_binding_ref"),
    viewer_identity_ref: reqRef(input.viewer_identity_ref, "viewer_identity_ref"),
    product_release_ref: reqRef(input.product_release_ref, "product_release_ref"),
    product_release_hash: req(input.product_release_hash, "product_release_hash"),
    permitted_presentation_capability: PRESENT_PERSISTED_CANONICAL_LU_RESULTS,
    valid_from: validFrom,
    valid_until: validUntil,
  } as const;
  const i = sha256ContentHash({ artifact_type: "viewer_capability", payload });
  const a = {
    artifact_id: `viewer-capability-${i.value.slice(0, 24)}`,
    artifact_type: "viewer_capability" as const,
    references: [payload.issuer_ref, payload.project_context_binding_ref, payload.viewer_identity_ref, payload.product_release_ref],
    payload,
  };
  return { ...a, content_hash: sha256ContentHash(a) };
}
