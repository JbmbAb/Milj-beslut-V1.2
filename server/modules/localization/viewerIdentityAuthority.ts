import {
  createArtifactAttestation,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  VIEWER_IDENTITY_ISSUER_ARTIFACT_TYPE,
  VIEWER_IDENTITY_ISSUER_PURPOSE,
  VIEWER_IDENTITY_ISSUER_ALLOWED_ARTIFACT_TYPE,
  VIEWER_IDENTITY_CONTRACT_VERSION,
  LU_CANONICAL_PRESENTATION_VIEWER,
  validateViewerIdentityArtifact,
  type ViewerIdentityArtifact,
  type ViewerIdentityIssuerArtifact,
} from "@miljobeslut/mps-lu";

const ISSUER_PREDICATE_TYPE = "viewer-identity-issuer-authority-v1" as const;
const IDENTITY_PREDICATE_TYPE = "viewer-identity-authority-v1" as const;

function identityPredicate(issuer: ViewerIdentityIssuerArtifact, identity: ViewerIdentityArtifact) {
  return {
    action: "ISSUE_VIEWER_IDENTITY",
    issuer_purpose: VIEWER_IDENTITY_ISSUER_PURPOSE,
    viewer_kind: identity.payload.viewer_kind,
    release_hash: identity.payload.product_release_hash,
  };
}

export async function attestViewerIdentityIssuerArtifact(args: {
  readonly issuer: Omit<ViewerIdentityIssuerArtifact, "attestation">;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  if (args.signing.keyId !== args.issuer.payload.issuer_key_id) throw new Error("REJECT_VIEWER_IDENTITY_ISSUER_KEY");
  return createArtifactAttestation({
    subjectDigest: args.issuer.content_hash.value,
    predicateType: ISSUER_PREDICATE_TYPE,
    predicate: {
      issuer_purpose: args.issuer.payload.purpose,
      allowed_artifact_type: args.issuer.payload.allowed_artifact_type,
      owner_authority_ref: args.issuer.payload.owner_authority_ref,
    },
    signing: args.signing,
  });
}

export async function verifyViewerIdentityIssuerArtifact(args: {
  readonly issuer: ViewerIdentityIssuerArtifact;
  readonly verification: VerificationKeyProvider;
}): Promise<void> {
  const { issuer, verification } = args;
  if (issuer.artifact_type !== VIEWER_IDENTITY_ISSUER_ARTIFACT_TYPE) throw new Error("REJECT_VIEWER_IDENTITY_ISSUER_TYPE");
  if (issuer.payload.purpose !== VIEWER_IDENTITY_ISSUER_PURPOSE) throw new Error("REJECT_VIEWER_IDENTITY_ISSUER_PURPOSE");
  if (issuer.payload.allowed_artifact_type !== VIEWER_IDENTITY_ISSUER_ALLOWED_ARTIFACT_TYPE) throw new Error("REJECT_VIEWER_IDENTITY_ISSUER_SCOPE");
  if (!issuer.payload.owner_authority_ref?.artifact_id || !issuer.payload.owner_authority_ref?.artifact_type) {
    throw new Error("REJECT_VIEWER_IDENTITY_ISSUER_OWNER_AUTHORITY_MISSING");
  }
  if (issuer.payload.issuer_key_id !== verification.keyId) throw new Error("REJECT_VIEWER_IDENTITY_ISSUER_TRUST_ROOT");
  const attestation = issuer.attestation;
  if (!attestation || attestation.signer !== issuer.payload.issuer_key_id) throw new Error("REJECT_VIEWER_IDENTITY_ISSUER_UNSIGNED");
  if (attestation.subjectDigest !== issuer.content_hash.value || attestation.predicateType !== ISSUER_PREDICATE_TYPE) {
    throw new Error("REJECT_VIEWER_IDENTITY_ISSUER_TAMPERED");
  }
  if (!(await verifyArtifactAttestation(attestation, verification))) throw new Error("REJECT_VIEWER_IDENTITY_ISSUER_SIGNATURE");
}

export async function attestViewerIdentityArtifact(args: {
  readonly identity: Omit<ViewerIdentityArtifact, "attestation">;
  readonly issuer: ViewerIdentityIssuerArtifact;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  if (args.signing.keyId !== args.issuer.payload.issuer_key_id) throw new Error("REJECT_VIEWER_IDENTITY_ISSUER_KEY");
  return createArtifactAttestation({
    subjectDigest: args.identity.content_hash.value,
    predicateType: IDENTITY_PREDICATE_TYPE,
    predicate: identityPredicate(args.issuer, args.identity as ViewerIdentityArtifact),
    signing: args.signing,
  });
}

/**
 * Full runtime issuer-trust-chain + identity verification. Resolves the issuer AND the identity
 * from the real artifact repository (never a caller-supplied object), verifies canonical release
 * binding against the real release manifest, and never accepts a fixture/caller-selected value.
 */
export async function verifyViewerIdentityArtifact(args: {
  readonly identityRef: { readonly artifact_id: string; readonly artifact_type: string };
  readonly repository: ArtifactRepositoryPort;
  readonly verification: VerificationKeyProvider;
  readonly releaseId: string;
  readonly releaseHash: string;
}): Promise<ViewerIdentityArtifact> {
  const resolved = await args.repository.resolve<ViewerIdentityArtifact>(args.identityRef);
  const identity = validateViewerIdentityArtifact(resolved);
  if (identity.payload.contract_version !== VIEWER_IDENTITY_CONTRACT_VERSION) throw new Error("REJECT_VIEWER_IDENTITY_CONTRACT_VERSION");
  if (identity.payload.viewer_kind !== LU_CANONICAL_PRESENTATION_VIEWER) throw new Error("REJECT_VIEWER_IDENTITY_KIND");

  const issuer = await args.repository.resolve<ViewerIdentityIssuerArtifact>(identity.payload.issuer_ref);
  await verifyViewerIdentityIssuerArtifact({ issuer, verification: args.verification });
  if (identity.payload.issuer_key_id !== issuer.payload.issuer_key_id) throw new Error("REJECT_VIEWER_IDENTITY_ISSUER_TRUST");

  if (identity.payload.product_release_ref.artifact_id !== args.releaseId) throw new Error("REJECT_VIEWER_IDENTITY_RELEASE_REF");

  const release = await args.repository.resolve<{ release_hash?: { value: string } }>(identity.payload.product_release_ref);
  const resolvedReleaseHash = release.release_hash?.value;
  if (!resolvedReleaseHash || resolvedReleaseHash !== identity.payload.product_release_hash || resolvedReleaseHash !== args.releaseHash) {
    throw new Error("REJECT_VIEWER_IDENTITY_RELEASE_HASH");
  }

  const attestation = identity.attestation;
  if (
    !attestation ||
    attestation.signer !== issuer.payload.issuer_key_id ||
    attestation.subjectDigest !== identity.content_hash.value ||
    attestation.predicateType !== IDENTITY_PREDICATE_TYPE ||
    JSON.stringify(attestation.predicate) !== JSON.stringify(identityPredicate(issuer, identity))
  ) {
    throw new Error("REJECT_VIEWER_IDENTITY_TAMPERED");
  }
  if (!(await verifyArtifactAttestation(attestation, args.verification))) throw new Error("REJECT_VIEWER_IDENTITY_SIGNATURE");

  return identity;
}
