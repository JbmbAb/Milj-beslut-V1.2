import type { ArtifactAttestation } from "../../../mimers-brunn-core/src/signing/SignatureEnvelope";
import type { ArtifactContract, ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical";

export const PRODUCT_RELEASE_ISSUER_PURPOSE = "PRODUCT_RELEASE_ISSUER_V1" as const;
export const PRODUCT_RELEASE_CONTRACT_VERSION = "product-release-v1" as const;

export interface ProductReleaseIssuerArtifact extends ArtifactContract {
  readonly artifact_type: "product_release_issuer";
  readonly payload: { readonly key_id: string; readonly purpose: typeof PRODUCT_RELEASE_ISSUER_PURPOSE; readonly contract_version: typeof PRODUCT_RELEASE_CONTRACT_VERSION };
}

export interface ProductReleaseManifestArtifact extends ArtifactContract {
  readonly artifact_type: "product_release_manifest";
  readonly payload: {
    readonly contract_version: typeof PRODUCT_RELEASE_CONTRACT_VERSION;
    readonly product_name: string;
    readonly build_identity: { readonly package_lock_sha256: string; readonly package_manifest_sha256: string; readonly runtime_entrypoint_sha256: string };
    readonly issuer_ref: ArtifactReference;
    readonly issued_at: string;
  };
  readonly release_hash: { readonly algorithm: "sha256"; readonly value: string };
  readonly attestation?: ArtifactAttestation;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_PRODUCT_RELEASE: ${field} is required`);
  return normalized;
}

export function createProductReleaseIssuerArtifact(keyId: string): ProductReleaseIssuerArtifact {
  const payload = { key_id: required(keyId, "key_id"), purpose: PRODUCT_RELEASE_ISSUER_PURPOSE, contract_version: PRODUCT_RELEASE_CONTRACT_VERSION } as const;
  const identity = sha256ContentHash({ artifact_type: "product_release_issuer", payload });
  const artifact = { artifact_id: `product-release-issuer-${identity.value.slice(0, 24)}`, artifact_type: "product_release_issuer" as const, references: [], payload };
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function createProductReleaseManifestArtifact(input: {
  readonly product_name: string;
  readonly package_lock_sha256: string;
  readonly package_manifest_sha256: string;
  readonly runtime_entrypoint_sha256: string;
  readonly issuer_ref: ArtifactReference;
  readonly issued_at: string;
}): ProductReleaseManifestArtifact {
  const payload = {
    contract_version: PRODUCT_RELEASE_CONTRACT_VERSION,
    product_name: required(input.product_name, "product_name"),
    build_identity: {
      package_lock_sha256: required(input.package_lock_sha256, "package_lock_sha256"),
      package_manifest_sha256: required(input.package_manifest_sha256, "package_manifest_sha256"),
      runtime_entrypoint_sha256: required(input.runtime_entrypoint_sha256, "runtime_entrypoint_sha256"),
    },
    issuer_ref: { artifact_id: required(input.issuer_ref.artifact_id, "issuer_ref.artifact_id"), artifact_type: required(input.issuer_ref.artifact_type, "issuer_ref.artifact_type") },
    issued_at: required(input.issued_at, "issued_at"),
  } as const;
  const releaseHash = sha256ContentHash({ contract_version: payload.contract_version, product_name: payload.product_name, build_identity: payload.build_identity });
  const artifact = {
    artifact_id: `product-release-${releaseHash.value.slice(0, 24)}`,
    artifact_type: "product_release_manifest" as const,
    references: [payload.issuer_ref],
    payload,
    release_hash: releaseHash,
  };
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function productReleaseSubjectDigest(artifact: ProductReleaseManifestArtifact): string {
  return artifact.content_hash.value;
}
