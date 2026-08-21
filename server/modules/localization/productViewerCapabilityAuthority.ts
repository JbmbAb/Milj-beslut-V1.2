import {
  createArtifactAttestation,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  VIEWER_CAPABILITY_ISSUER_ARTIFACT_TYPE,
  VIEWER_CAPABILITY_ISSUER_PURPOSE,
  VIEWER_CAPABILITY_ISSUER_ALLOWED_ARTIFACT_TYPE,
  PRESENT_PERSISTED_CANONICAL_LU_RESULTS,
  type ProductViewerCapabilityArtifact,
  type ViewerCapabilityIssuerArtifact,
} from "@miljobeslut/mps-lu";

const ISSUER_PREDICATE_TYPE = "viewer-capability-issuer-authority-v1" as const;
const CAPABILITY_PREDICATE_TYPE = "viewer-capability-authority-v1" as const;

function issuerContentPayload(issuer: Omit<ViewerCapabilityIssuerArtifact, "attestation">): object {
  return { artifact_type: issuer.artifact_type, artifact_id: issuer.artifact_id, references: issuer.references, payload: issuer.payload };
}

function capabilityPredicate(issuer: ViewerCapabilityIssuerArtifact, capability: ProductViewerCapabilityArtifact) {
  return {
    action: "ISSUE_VIEWER_CAPABILITY",
    issuer_purpose: VIEWER_CAPABILITY_ISSUER_PURPOSE,
    project_id: capability.payload.subject_project_id,
    release_hash: capability.payload.product_release_hash,
    scope: capability.payload.permitted_presentation_capability,
  };
}

/**
 * Self-attestation over a `ViewerCapabilityIssuerArtifact`: proves possession of the issuer
 * private key at minting time. This is NOT the root of trust by itself -- the runtime verifier
 * additionally requires the issuer's `issuer_key_id` to match its own env-configured trusted
 * key_id (see `verifyViewerCapabilityIssuerArtifact`). Possessing a private key that can sign an
 * issuer declaration does not, on its own, make the runtime trust it.
 */
export async function attestViewerCapabilityIssuerArtifact(args: {
  readonly issuer: Omit<ViewerCapabilityIssuerArtifact, "attestation">;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  if (args.signing.keyId !== args.issuer.payload.issuer_key_id) {
    throw new Error("REJECT_VIEWER_CAPABILITY_ISSUER_KEY");
  }
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

/**
 * Verifies a `ViewerCapabilityIssuerArtifact` against the runtime's trusted public key. The
 * trusted key_id (`verification.keyId`, env-configured) IS the actual root of trust: an issuer
 * artifact self-signed by any other key is rejected here regardless of internal consistency.
 * `owner_authority_ref` is checked for structural presence as an audit trail of who authorized
 * installing this key -- it is not itself resolved as a second signature layer.
 */
export async function verifyViewerCapabilityIssuerArtifact(args: {
  readonly issuer: ViewerCapabilityIssuerArtifact;
  readonly verification: VerificationKeyProvider;
}): Promise<void> {
  const { issuer, verification } = args;
  if (issuer.artifact_type !== VIEWER_CAPABILITY_ISSUER_ARTIFACT_TYPE) {
    throw new Error("REJECT_VIEWER_CAPABILITY_ISSUER_TYPE");
  }
  if (issuer.payload.purpose !== VIEWER_CAPABILITY_ISSUER_PURPOSE) {
    throw new Error("REJECT_VIEWER_CAPABILITY_ISSUER_PURPOSE");
  }
  if (issuer.payload.allowed_artifact_type !== VIEWER_CAPABILITY_ISSUER_ALLOWED_ARTIFACT_TYPE) {
    throw new Error("REJECT_VIEWER_CAPABILITY_ISSUER_SCOPE");
  }
  if (!issuer.payload.owner_authority_ref?.artifact_id || !issuer.payload.owner_authority_ref?.artifact_type) {
    throw new Error("REJECT_VIEWER_CAPABILITY_ISSUER_OWNER_AUTHORITY_MISSING");
  }
  if (issuer.payload.issuer_key_id !== verification.keyId) {
    throw new Error("REJECT_VIEWER_CAPABILITY_ISSUER_TRUST_ROOT");
  }
  const attestation = issuer.attestation;
  if (!attestation || attestation.signer !== issuer.payload.issuer_key_id) {
    throw new Error("REJECT_VIEWER_CAPABILITY_ISSUER_UNSIGNED");
  }
  if (attestation.subjectDigest !== issuer.content_hash.value || attestation.predicateType !== ISSUER_PREDICATE_TYPE) {
    throw new Error("REJECT_VIEWER_CAPABILITY_ISSUER_TAMPERED");
  }
  if (!(await verifyArtifactAttestation(attestation, verification))) {
    throw new Error("REJECT_VIEWER_CAPABILITY_ISSUER_SIGNATURE");
  }
}

export async function attestProductViewerCapability(args: {
  readonly capability: Omit<ProductViewerCapabilityArtifact, "attestation">;
  readonly issuer: ViewerCapabilityIssuerArtifact;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  if (args.signing.keyId !== args.issuer.payload.issuer_key_id) {
    throw new Error("REJECT_VIEWER_CAPABILITY_ISSUER_KEY");
  }
  return createArtifactAttestation({
    subjectDigest: args.capability.content_hash.value,
    predicateType: CAPABILITY_PREDICATE_TYPE,
    predicate: capabilityPredicate(args.issuer, args.capability as ProductViewerCapabilityArtifact),
    signing: args.signing,
  });
}

/**
 * The full runtime issuer-trust-chain + capability verification. Resolves the issuer from the
 * artifact repository (real CAS, not a caller-supplied object), verifies it against the trusted
 * public key, then verifies the capability's own attestation and every subject/scope/temporal
 * binding. Uses only a `VerificationKeyProvider` -- structurally cannot mint what it verifies.
 */
export async function verifyProductViewerCapability(args: {
  readonly capability: ProductViewerCapabilityArtifact;
  readonly repository: ArtifactRepositoryPort;
  readonly verification: VerificationKeyProvider;
  readonly projectId: string;
  readonly bindingId: string;
  readonly viewerIdentityId: string;
  readonly releaseId: string;
  readonly releaseHash: string;
  readonly now: Date;
}): Promise<void> {
  const issuer = await args.repository.resolve<ViewerCapabilityIssuerArtifact>(args.capability.payload.issuer_ref);
  await verifyViewerCapabilityIssuerArtifact({ issuer, verification: args.verification });

  if (args.capability.payload.issuer_key_id !== issuer.payload.issuer_key_id) {
    throw new Error("REJECT_VIEWER_CAPABILITY_ISSUER_TRUST");
  }

  const c = args.capability;
  if (c.payload.subject_project_id !== args.projectId) throw new Error("REJECT_VIEWER_CAPABILITY_PROJECT");
  if (c.payload.project_context_binding_ref.artifact_id !== args.bindingId) throw new Error("REJECT_VIEWER_CAPABILITY_CONTEXT_BINDING");
  if (c.payload.viewer_identity_ref.artifact_id !== args.viewerIdentityId) throw new Error("REJECT_VIEWER_CAPABILITY_VIEWER_IDENTITY");
  if (c.payload.product_release_ref.artifact_id !== args.releaseId) throw new Error("REJECT_VIEWER_CAPABILITY_RELEASE_REF");
  if (c.payload.permitted_presentation_capability !== PRESENT_PERSISTED_CANONICAL_LU_RESULTS) {
    throw new Error("REJECT_VIEWER_CAPABILITY_SCOPE");
  }

  // Canonical release resolution: never trust a caller-supplied hash on its own. Resolve the
  // release manifest for real from the repository and require its own domain `release_hash`
  // (product-release-v1 contract; distinct from the manifest's own CAS content_hash) to match
  // both what the capability declares AND the caller's expectation.
  const release = await args.repository.resolve<{ release_hash?: { value: string } }>(c.payload.product_release_ref);
  const resolvedReleaseHash = release.release_hash?.value;
  if (!resolvedReleaseHash || resolvedReleaseHash !== c.payload.product_release_hash || resolvedReleaseHash !== args.releaseHash) {
    throw new Error("REJECT_VIEWER_CAPABILITY_RELEASE_HASH");
  }

  const now = args.now.getTime();
  const from = Date.parse(c.payload.valid_from);
  const until = Date.parse(c.payload.valid_until);
  if (Number.isNaN(from) || Number.isNaN(until) || until <= from) {
    throw new Error("REJECT_VIEWER_CAPABILITY_VALIDITY_WINDOW");
  }
  if (now < from) throw new Error("REJECT_VIEWER_CAPABILITY_NOT_YET_VALID");
  if (now > until) throw new Error("REJECT_VIEWER_CAPABILITY_EXPIRED");

  const t = c.attestation;
  if (
    !t ||
    t.signer !== issuer.payload.issuer_key_id ||
    t.subjectDigest !== c.content_hash.value ||
    t.predicateType !== CAPABILITY_PREDICATE_TYPE ||
    JSON.stringify(t.predicate) !== JSON.stringify(capabilityPredicate(issuer, c))
  ) {
    throw new Error("REJECT_VIEWER_CAPABILITY_TAMPERED");
  }
  if (!(await verifyArtifactAttestation(t, args.verification))) {
    throw new Error("REJECT_VIEWER_CAPABILITY_SIGNATURE");
  }
}
