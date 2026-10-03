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
/**
 * W-U42 (owner decision 2026-10-02, row 4): a release is identified per candidate -- commit, source tree, the
 * digest MEASURED over the delivered source files, the composition manifest and the build flags -- not only by
 * three file hashes. Forward-only: V1 and V2 stay historical and verifiable; new producers emit V3.
 */
export const PRODUCT_RELEASE_CONTRACT_VERSION_V3 = 'product-release-v3' as const;
export const PRODUCT_RELEASE_CONTRACT_VERSION = PRODUCT_RELEASE_CONTRACT_VERSION_V3;

type ProductReleaseBuildIdentity = {
  readonly package_lock_sha256: string;
  readonly package_manifest_sha256: string;
  readonly runtime_entrypoint_sha256: string;
};

/**
 * The V3 build identity. The three V1/V2 hashes are kept (now measured over the DELIVERED files at process start,
 * see server/modules/release/productReleaseBuildIdentity.ts), plus:
 *  - source_commit_sha / source_tree_sha: the git commit and tree the build was made from (40 hex);
 *  - source_digest_sha256: sha256 over the sorted (path, sha256) listing of server/, src/, packages/, prisma/,
 *    components/ and dist/ as delivered (scripts/release/buildIdentityDigest.mjs is the ONE algorithm);
 *  - composition_manifest_sha256: the same listing form over Dockerfile, .dockerignore and deploy/onprem/**;
 *  - build_args_sha256: sha256 over the canonical JSON of the build-time VITE_* variables (baked into dist/).
 * All values are canonical lower-case hex; a release with a malformed or missing value is never created.
 */
export type ProductReleaseBuildIdentityV3 = ProductReleaseBuildIdentity & {
  readonly source_commit_sha: string;
  readonly source_tree_sha: string;
  readonly source_digest_sha256: string;
  readonly composition_manifest_sha256: string;
  readonly build_args_sha256: string;
};

/** Every field of the V3 build identity, with its canonical hex length. Pinned by tests; consumers iterate this. */
export const PRODUCT_RELEASE_BUILD_IDENTITY_V3_FIELDS = [
  'package_lock_sha256',
  'package_manifest_sha256',
  'runtime_entrypoint_sha256',
  'source_commit_sha',
  'source_tree_sha',
  'source_digest_sha256',
  'composition_manifest_sha256',
  'build_args_sha256',
] as const satisfies readonly (keyof ProductReleaseBuildIdentityV3)[];

const V3_FIELD_HEX_LENGTH: Readonly<Record<keyof ProductReleaseBuildIdentityV3, 40 | 64>> = Object.freeze({
  package_lock_sha256: 64,
  package_manifest_sha256: 64,
  runtime_entrypoint_sha256: 64,
  source_commit_sha: 40,
  source_tree_sha: 40,
  source_digest_sha256: 64,
  composition_manifest_sha256: 64,
  build_args_sha256: 64,
});

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

export interface ProductReleaseManifestArtifactV3 extends ArtifactContract {
  readonly artifact_type: 'product_release_manifest';
  readonly payload: {
    readonly contract_version: typeof PRODUCT_RELEASE_CONTRACT_VERSION_V3;
    readonly product_name: string;
    readonly build_identity: ProductReleaseBuildIdentityV3;
    readonly issuer_ref: ArtifactReference;
  };
  readonly release_hash: { readonly algorithm: 'sha256'; readonly value: string };
  readonly attestation?: ArtifactAttestation;
}

/** V1 and V2 are historical-only. New producers emit V3. */
export type ProductReleaseManifestArtifact =
  ProductReleaseManifestArtifactV1 | ProductReleaseManifestArtifactV2 | ProductReleaseManifestArtifactV3;

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_PRODUCT_RELEASE: ${field} is required`);
  return normalized;
}

/** Canonical lower-case hex of exactly `length` characters; nothing is trimmed or case-folded into validity. */
function requiredHex(value: unknown, field: string, length: 40 | 64): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`REJECT_PRODUCT_RELEASE: ${field} is required`);
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw new Error(`REJECT_PRODUCT_RELEASE: ${field} must be ${length} lower-case hex characters`);
  }
  return value;
}

function releaseHashForPayload(payload: ProductReleaseManifestArtifact['payload']) {
  if (payload.contract_version === PRODUCT_RELEASE_CONTRACT_VERSION_V1) {
    return sha256ContentHash({
      contract_version: payload.contract_version,
      product_name: payload.product_name,
      build_identity: payload.build_identity,
    });
  }

  // V2 and V3 share the hash domain shape; they differ by contract_version and by the build_identity fields.
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

/**
 * HISTORICAL V2 producer. Kept so V2 fixtures and the V2 verification semantics stay reproducible; it keeps
 * emitting V2 and is NOT the producer of a running product release (that is `createProductReleaseManifestArtifactV3`,
 * and the process start-up gate requires V3). Forward-only: new producers move, old artifacts do not.
 */
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

/**
 * Validates and canonicalizes a V3 build identity: every field present, canonical hex of the right length. Also
 * the ONE check a process applies to its release-identity.json before comparing it (productReleaseBuildIdentity.ts).
 */
export function canonicalProductReleaseBuildIdentityV3(input: unknown): ProductReleaseBuildIdentityV3 {
  if (!input || typeof input !== 'object') throw new Error('REJECT_PRODUCT_RELEASE: build_identity is required');
  const source = input as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const field of PRODUCT_RELEASE_BUILD_IDENTITY_V3_FIELDS) {
    out[field] = requiredHex(source[field], `build_identity.${field}`, V3_FIELD_HEX_LENGTH[field]);
  }
  return out as unknown as ProductReleaseBuildIdentityV3;
}

/** The V3 producer: the ONLY producer of a release a product process may start under. */
export function createProductReleaseManifestArtifactV3(input: {
  readonly product_name: string;
  readonly build_identity: ProductReleaseBuildIdentityV3;
  readonly issuer_ref: ArtifactReference;
}): ProductReleaseManifestArtifactV3 {
  const payload = {
    contract_version: PRODUCT_RELEASE_CONTRACT_VERSION_V3,
    product_name: required(input.product_name, 'product_name'),
    build_identity: canonicalProductReleaseBuildIdentityV3(input.build_identity),
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

export function isProductReleaseManifestArtifactV3(
  artifact: ProductReleaseManifestArtifact,
): artifact is ProductReleaseManifestArtifactV3 {
  return artifact.payload.contract_version === PRODUCT_RELEASE_CONTRACT_VERSION_V3;
}

/** The canonical-payload check shared by V2 and V3: hashes, id and issuer reference all derive from the payload. */
function assertCanonicalPayload(artifact: ProductReleaseManifestArtifactV2 | ProductReleaseManifestArtifactV3): void {
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

/** Validates V2 self-consistency. V1 verification semantics remain historical and frozen. */
export function validateProductReleaseManifestArtifactV2(
  artifact: ProductReleaseManifestArtifact,
): asserts artifact is ProductReleaseManifestArtifactV2 {
  if (artifact.payload.contract_version !== PRODUCT_RELEASE_CONTRACT_VERSION_V2) {
    throw new Error('REJECT_PRODUCT_RELEASE_CONTRACT_VERSION');
  }
  assertCanonicalPayload(artifact);
}

/**
 * Validates V3 self-consistency: the contract version, a complete canonical build identity (every field, canonical
 * hex) and the derived hashes/id. A V3-labelled artifact with a missing field is rejected even when its hashes are
 * self-consistent: the identity would otherwise silently cover less than the contract promises.
 */
export function validateProductReleaseManifestArtifactV3(
  artifact: ProductReleaseManifestArtifact,
): asserts artifact is ProductReleaseManifestArtifactV3 {
  if (artifact.payload.contract_version !== PRODUCT_RELEASE_CONTRACT_VERSION_V3) {
    throw new Error('REJECT_PRODUCT_RELEASE_CONTRACT_VERSION');
  }
  canonicalProductReleaseBuildIdentityV3(artifact.payload.build_identity);
  assertCanonicalPayload(artifact);
}

export function productReleaseSubjectDigest(artifact: ProductReleaseManifestArtifact): string {
  return artifact.content_hash.value;
}
