import {
  createArtifactAttestation,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";
import {
  PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_ALLOWED_ARTIFACT_TYPE,
  PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_ARTIFACT_TYPE,
  PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PURPOSE,
  validateProjectContextBindingSupersessionAnyVersion,
  type ProjectContextBindingSupersessionArtifact,
  type ProjectContextBindingSupersessionArtifactV2,
  type ProjectContextBindingSupersessionIssuerArtifact,
} from "@miljobeslut/mps-lu";

/**
 * PROJECT-CONTEXT-BINDING-SUPERSESSION-ISSUER-V1 Phase B.
 *
 * The dedicated, least-privilege authority module for `project_context_binding_supersession`
 * artifacts -- deliberately separate from projectContextBindingAuthority.ts's
 * attest/verifyProjectContextBindingArtifactAuthority, which is scoped to the ordinary
 * PROJECT_CONTEXT_BINDING_ISSUER (project_property_binding + project_context_binding only).
 * Mirrors server/modules/localization/localizationGeometrySupersessionAuthority.ts exactly.
 */

type AnySupersession = ProjectContextBindingSupersessionArtifact | ProjectContextBindingSupersessionArtifactV2;

const ISSUER_PREDICATE_TYPE = "project-context-binding-supersession-issuer-authority-v1" as const;
const SUPERSESSION_PREDICATE_TYPE = "project-context-binding-supersession-authority-v1" as const;

function issuerPredicate(issuer: Omit<ProjectContextBindingSupersessionIssuerArtifact, "attestation">) {
  return {
    issuer_purpose: issuer.payload.purpose,
    allowed_artifact_type: issuer.payload.allowed_artifact_type,
    owner_authority_ref: issuer.payload.owner_authority_ref,
  };
}

function supersessionPredicate(issuer: ProjectContextBindingSupersessionIssuerArtifact, artifact: AnySupersession) {
  return {
    action: "ISSUE_PROJECT_CONTEXT_BINDING_SUPERSESSION",
    issuer_purpose: issuer.payload.purpose,
    project_id: artifact.payload.project_id,
    reason_code: artifact.payload.reason_code,
  };
}

/** Self-attestation over a `ProjectContextBindingSupersessionIssuerArtifact`: proves possession of
 *  the issuer private key at minting time -- not the root of trust by itself (see
 *  verifyProjectContextBindingSupersessionIssuerArtifact). */
export async function attestProjectContextBindingSupersessionIssuerArtifact(args: {
  readonly issuer: Omit<ProjectContextBindingSupersessionIssuerArtifact, "attestation">;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  if (args.signing.keyId !== args.issuer.payload.issuer_key_id) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY");
  }
  return createArtifactAttestation({
    subjectDigest: args.issuer.content_hash.value,
    predicateType: ISSUER_PREDICATE_TYPE,
    predicate: issuerPredicate(args.issuer),
    signing: args.signing,
  });
}

/** Verifies a `ProjectContextBindingSupersessionIssuerArtifact` against the runtime's trusted
 *  public key -- the trusted key_id IS the actual root of trust. This is the structural reason the
 *  ordinary ProjectContextBinding issuer can never authorize a supersession: its key_id will never
 *  match this verifier's configured key_id. */
export async function verifyProjectContextBindingSupersessionIssuerArtifact(args: {
  readonly issuer: ProjectContextBindingSupersessionIssuerArtifact;
  readonly verification: VerificationKeyProvider;
}): Promise<void> {
  const { issuer, verification } = args;
  if (issuer.artifact_type !== PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_ARTIFACT_TYPE) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_TYPE");
  }
  if (issuer.payload.purpose !== PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PURPOSE) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PURPOSE");
  }
  if (issuer.payload.allowed_artifact_type !== PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_ALLOWED_ARTIFACT_TYPE) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_SCOPE");
  }
  if (!issuer.payload.owner_authority_ref?.artifact_id || !issuer.payload.owner_authority_ref?.artifact_type) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_OWNER_AUTHORITY_MISSING");
  }
  if (issuer.payload.issuer_key_id !== verification.keyId) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_TRUST_ROOT");
  }
  const attestation = issuer.attestation;
  if (!attestation || attestation.signer !== issuer.payload.issuer_key_id) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_UNSIGNED");
  }
  if (attestation.subjectDigest !== issuer.content_hash.value || attestation.predicateType !== ISSUER_PREDICATE_TYPE) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_TAMPERED");
  }
  if (!(await verifyArtifactAttestation(attestation, verification))) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_SIGNATURE");
  }
}

export async function attestProjectContextBindingSupersessionArtifact(args: {
  readonly artifact: Omit<AnySupersession, "attestation">;
  readonly issuer: ProjectContextBindingSupersessionIssuerArtifact;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  if (args.signing.keyId !== args.issuer.payload.issuer_key_id) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY");
  }
  return createArtifactAttestation({
    subjectDigest: args.artifact.content_hash.value,
    predicateType: SUPERSESSION_PREDICATE_TYPE,
    predicate: supersessionPredicate(args.issuer, args.artifact as AnySupersession),
    signing: args.signing,
  });
}

/** Full verification of one supersession artifact (V1 or V2): structural self-consistency, issuer
 *  trust chain, predicate/subject binding, and signature. Caller supplies the already-resolved
 *  issuer. */
export async function verifyProjectContextBindingSupersessionArtifact(args: {
  readonly artifact: unknown;
  readonly issuer: ProjectContextBindingSupersessionIssuerArtifact;
  readonly verification: VerificationKeyProvider;
}): Promise<AnySupersession> {
  const verified = validateProjectContextBindingSupersessionAnyVersion(args.artifact);
  await verifyProjectContextBindingSupersessionIssuerArtifact({ issuer: args.issuer, verification: args.verification });
  if (verified.payload.issuer_key_id !== args.issuer.payload.issuer_key_id) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_TRUST");
  }
  const attestation = verified.attestation;
  if (!attestation || attestation.signer !== args.issuer.payload.issuer_key_id) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_UNSIGNED");
  }
  if (
    attestation.subjectDigest !== verified.content_hash.value ||
    attestation.predicateType !== SUPERSESSION_PREDICATE_TYPE ||
    JSON.stringify(attestation.predicate) !== JSON.stringify(supersessionPredicate(args.issuer, verified))
  ) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_TAMPERED");
  }
  if (!(await verifyArtifactAttestation(attestation, args.verification))) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_SIGNATURE");
  }
  return verified;
}

/**
 * Resolves the supersession's own `issuer_ref` from CAS as a
 * `ProjectContextBindingSupersessionIssuerArtifact` (never as the ordinary
 * ProjectContextBindingIssuerArtifact type) and verifies against the dedicated,
 * env-configured supersession verifier. This is the negative-proof boundary: an artifact whose
 * `issuer_ref` resolves to the ordinary binding issuer fails here with
 * REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_TYPE (wrong artifact_type entirely, not
 * merely a scope mismatch) before any signature is even checked.
 */
export async function resolveAndVerifyProjectContextBindingSupersessionArtifact(args: {
  readonly artifact: unknown;
  readonly artifactRepository: { resolve<T>(ref: { artifact_id: string; artifact_type: string }): Promise<T> };
  readonly verification: VerificationKeyProvider;
}): Promise<AnySupersession> {
  const preliminary = validateProjectContextBindingSupersessionAnyVersion(args.artifact);
  const issuer = await args.artifactRepository.resolve<ProjectContextBindingSupersessionIssuerArtifact>(
    preliminary.payload.issuer_ref,
  );
  return verifyProjectContextBindingSupersessionArtifact({ artifact: preliminary, issuer, verification: args.verification });
}
