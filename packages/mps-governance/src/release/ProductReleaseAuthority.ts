import type { ArtifactAttestation } from '../../../mimers-brunn-core/src/signing/SignatureEnvelope';
import type {
  ArtifactContract,
  ArtifactReference,
} from '../../../mps-compliance/src/artifacts/ArtifactContract';
import { sha256ContentHash } from '../../../mps-compliance/src/canonical/sha256Canonical';

export const PRODUCT_RELEASE_ISSUER_PURPOSE = 'PRODUCT_RELEASE_ISSUER_V1' as const;
export const PRODUCT_RELEASE_ISSUER_CONTRACT_VERSION = 'product-release-v1' as const;
export const PRODUCT_RELEASE_CONTRACT_VERSION_V1 = 'product-release-v1' as const;
export const PRODUCT_RELEASE_CONTRACT_VERSION_V2 = 'product-release-v2' as const;
export const PRODUCT_RELEASE_CONTRACT_VERSION = PRODUCT_RELEASE_CONTRACT_VERSION_V2;

type ProductReleaseBuildIdentity = {
  readonly package_lock_sha256: string;
  readonly package_manifest_sha256: string;
  readonly runtime_entrypoint_sha256: string;
};

export interface ProductReleaseIssuerArtifact extends ArtifactContract {
  readonly artifact_type: 'product_release_issuer';
  readonly payload: {
    readonly key_id: string;
    readonly purpose: typeof PRODUCT_RELEASE_ISSUER_PURPOSE;
    readonly contract_version: typeof PRODUCT_RELEASE_ISSUER_CONTRACT_VERSION;
  };
}

export interface ProductReleaseManifestArtifactV1 extends ArtifactContract {
  readonly artifact_type: 'product_release_manifest';
  readonly payload: {
    readonly contract_version: typeof PRODUCT_RELEASE_CONTRACT_VERSION_V1;
    readonly product_name: string;
    readonly build_identity: ProductReleaseBuildIdentity;
    readonly issuer_ref: ArtifactReference;
    readonly issued_at: string;
  };
  readonly release_hash: { readonly algorithm: 'sha256'; readonly value: string };
  readonly attestation?: ArtifactAttestation;
}

export interface ProductReleaseManifestArtifactV2 extends ArtifactContract {
  readonly artifact_type: 'product_release_manifest';
  readonly payload: {
    readonly contract_version: typeof PRODUCT_RELEASE_CONTRACT_VERSION_V2;
    readonly product_name: string;
    readonly build_identity: ProductReleaseBuildIdentity;
    readonly issuer_ref: ArtifactReference;
  };
  readonly release_hash: { readonly algorithm: 'sha256'; readonly value: string };
  readonly attestation?: ArtifactAttestation;
}

/** V1 is historical-only. New producers emit V2. */
export type ProductReleaseManifestArtifact =
  ProductReleaseManifestArtifactV1 | ProductReleaseManifestArtifactV2;

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_PRODUCT_RELEASE: ${field} is required`);
  return normalized;
}

function releaseHashForPayload(payload: ProductReleaseManifestArtifact['payload']) {
  if (payload.contract_version === PRODUCT_RELEASE_CONTRACT_VERSION_V1) {
    return sha256ContentHash({
      contract_version: payload.contract_version,
      product_name: payload.product_name,
      build_identity: payload.build_identity,
    });
  }

  return sha256ContentHash({
    contract_version: payload.contract_version,
    product_name: payload.product_name,
    build_identity: payload.build_identity,
    issuer_ref: payload.issuer_ref,
  });
}

export function createProductReleaseIssuerArtifact(keyId: string): ProductReleaseIssuerArtifact {
  const payload = {
    key_id: required(keyId, 'key_id'),
    purpose: PRODUCT_RELEASE_ISSUER_PURPOSE,
    contract_version: PRODUCT_RELEASE_ISSUER_CONTRACT_VERSION,
  } as const;
  const identity = sha256ContentHash({ artifact_type: 'product_release_issuer', payload });
  const artifact = {
    artifact_id: `product-release-issuer-${identity.value.slice(0, 24)}`,
    artifact_type: 'product_release_issuer' as const,
    references: [],
    payload,
  };
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function createProductReleaseManifestArtifact(input: {
  readonly product_name: string;
  readonly package_lock_sha256: string;
  readonly package_manifest_sha256: string;
  readonly runtime_entrypoint_sha256: string;
  readonly issuer_ref: ArtifactReference;
  /**
   * V1 compatibility input only. Issuance time is operational audit metadata,
   * never part of the V2 immutable release representation.
   */
  readonly issued_at?: string;
}): ProductReleaseManifestArtifactV2 {
  const payload = {
    contract_version: PRODUCT_RELEASE_CONTRACT_VERSION_V2,
    product_name: required(input.product_name, 'product_name'),
    build_identity: {
      package_lock_sha256: required(input.package_lock_sha256, 'package_lock_sha256'),
      package_manifest_sha256: required(input.package_manifest_sha256, 'package_manifest_sha256'),
      runtime_entrypoint_sha256: required(input.runtime_entrypoint_sha256, 'runtime_entrypoint_sha256'),
    },
    issuer_ref: {
      artifact_id: required(input.issuer_ref.artifact_id, 'issuer_ref.artifact_id'),
      artifact_type: required(input.issuer_ref.artifact_type, 'issuer_ref.artifact_type'),
    },
  } as const;
  const releaseHash = releaseHashForPayload(payload);
  const artifact = {
    artifact_id: `product-release-${releaseHash.value.slice(0, 24)}`,
    artifact_type: 'product_release_manifest' as const,
    references: [payload.issuer_ref],
    payload,
    release_hash: releaseHash,
  };
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

/** Validates V2 self-consistency. V1 verification semantics remain historical and frozen. */
export function validateProductReleaseManifestArtifactV2(
  artifact: ProductReleaseManifestArtifact,
): asserts artifact is ProductReleaseManifestArtifactV2 {
  if (artifact.payload.contract_version !== PRODUCT_RELEASE_CONTRACT_VERSION_V2) {
    throw new Error('REJECT_PRODUCT_RELEASE_CONTRACT_VERSION');
  }

  const expectedReleaseHash = releaseHashForPayload(artifact.payload);
  const expectedArtifactId = `product-release-${expectedReleaseHash.value.slice(0, 24)}`;
  const unsignedArtifact = {
    artifact_id: artifact.artifact_id,
    artifact_type: artifact.artifact_type,
    references: artifact.references,
    payload: artifact.payload,
    release_hash: artifact.release_hash,
  };
  const expectedContentHash = sha256ContentHash(unsignedArtifact);

  if (
    artifact.release_hash.value !== expectedReleaseHash.value ||
    artifact.artifact_id !== expectedArtifactId ||
    artifact.content_hash.value !== expectedContentHash.value ||
    artifact.references.length !== 1 ||
    artifact.references[0]?.artifact_id !== artifact.payload.issuer_ref.artifact_id ||
    artifact.references[0]?.artifact_type !== artifact.payload.issuer_ref.artifact_type
  ) {
    throw new Error('REJECT_PRODUCT_RELEASE_CANONICAL_PAYLOAD');
  }
}

export function productReleaseSubjectDigest(artifact: ProductReleaseManifestArtifact): string {
  return artifact.content_hash.value;
}
