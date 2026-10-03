import {
  createArtifactAttestation,
  verifyArtifactAttestation,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import type { ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import {
  PRODUCT_RELEASE_CONTRACT_VERSION_V1,
  PRODUCT_RELEASE_CONTRACT_VERSION_V2,
  PRODUCT_RELEASE_CONTRACT_VERSION_V3,
  PRODUCT_RELEASE_ISSUER_PURPOSE,
  productReleaseSubjectDigest,
  validateProductReleaseManifestArtifactV2,
  validateProductReleaseManifestArtifactV3,
  type ProductReleaseIssuerArtifact,
  type ProductReleaseManifestArtifact,
} from '../../../packages/mps-governance/src/release/ProductReleaseAuthority.js';

const PREDICATE_V1 = 'product-release-authority-v1';
const PREDICATE_V2 = 'product-release-authority-v2';
// W-U42: the v3 contract has its own predicate type; v1/v2 attestations keep theirs (forward-only).
const PREDICATE_V3 = 'product-release-authority-v3';

function predicateType(release: ProductReleaseManifestArtifact): typeof PREDICATE_V1 | typeof PREDICATE_V2 | typeof PREDICATE_V3 {
  if (release.payload.contract_version === PRODUCT_RELEASE_CONTRACT_VERSION_V1) return PREDICATE_V1;
  if (release.payload.contract_version === PRODUCT_RELEASE_CONTRACT_VERSION_V2) return PREDICATE_V2;
  if (release.payload.contract_version === PRODUCT_RELEASE_CONTRACT_VERSION_V3) return PREDICATE_V3;
  throw new Error('REJECT_PRODUCT_RELEASE_CONTRACT_VERSION');
}

/** V2 and V3 validate their own self-consistency before signing or trusting; V1 stays frozen (no validator). */
function validateSelfConsistency(release: ProductReleaseManifestArtifact): void {
  if (release.payload.contract_version === PRODUCT_RELEASE_CONTRACT_VERSION_V2) validateProductReleaseManifestArtifactV2(release);
  else if (release.payload.contract_version === PRODUCT_RELEASE_CONTRACT_VERSION_V3) validateProductReleaseManifestArtifactV3(release);
  else if (release.payload.contract_version !== PRODUCT_RELEASE_CONTRACT_VERSION_V1) throw new Error('REJECT_PRODUCT_RELEASE_CONTRACT_VERSION');
}

function predicate(issuer: ProductReleaseIssuerArtifact, release: ProductReleaseManifestArtifact) {
  if (release.payload.contract_version === PRODUCT_RELEASE_CONTRACT_VERSION_V1) {
    return {
      action: 'ISSUE_PRODUCT_RELEASE',
      issuer_purpose: PRODUCT_RELEASE_ISSUER_PURPOSE,
      artifact_type: release.artifact_type,
      release_hash: release.release_hash.value,
    };
  }

  return {
    action: 'ISSUE_PRODUCT_RELEASE',
    issuer_purpose: PRODUCT_RELEASE_ISSUER_PURPOSE,
    artifact_type: release.artifact_type,
    release_contract_version: release.payload.contract_version,
    release_hash: release.release_hash.value,
  };
}

export async function attestProductRelease(args: {
  release: ProductReleaseManifestArtifact;
  issuer: ProductReleaseIssuerArtifact;
  signing: SigningKeyProvider;
}) {
  if (args.signing.keyId !== args.issuer.payload.key_id) throw new Error('REJECT_PRODUCT_RELEASE_ISSUER_KEY');
  validateSelfConsistency(args.release);
  return createArtifactAttestation({
    subjectDigest: productReleaseSubjectDigest(args.release),
    predicateType: predicateType(args.release),
    predicate: predicate(args.issuer, args.release),
    signing: args.signing,
  });
}
export async function verifyProductRelease(args: {
  release: ProductReleaseManifestArtifact;
  artifactRepository: ArtifactRepositoryPort;
  verification: VerificationKeyProvider;
}): Promise<void> {
  validateSelfConsistency(args.release);
  const issuer = await args.artifactRepository.resolve<ProductReleaseIssuerArtifact>(
    args.release.payload.issuer_ref,
  );
  if (
    issuer.artifact_type !== 'product_release_issuer' ||
    issuer.payload.purpose !== PRODUCT_RELEASE_ISSUER_PURPOSE ||
    issuer.payload.key_id !== args.verification.keyId
  )
    throw new Error('REJECT_PRODUCT_RELEASE_ISSUER_TRUST');
  const attestation = args.release.attestation;
  if (
    !attestation ||
    attestation.signer !== issuer.payload.key_id ||
    attestation.subjectDigest !== productReleaseSubjectDigest(args.release) ||
    attestation.predicateType !== predicateType(args.release) ||
    JSON.stringify(attestation.predicate) !== JSON.stringify(predicate(issuer, args.release))
  )
    throw new Error('REJECT_PRODUCT_RELEASE_ATTESTATION');
  if (!(await verifyArtifactAttestation(attestation, args.verification)))
    throw new Error('REJECT_PRODUCT_RELEASE_SIGNATURE');
}
