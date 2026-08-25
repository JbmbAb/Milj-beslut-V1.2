import {
  createArtifactAttestation,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";
import {
  LOCALIZATION_GEOMETRY_SUPERSESSION_ARTIFACT_TYPE,
  LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_ARTIFACT_TYPE,
  LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_ALLOWED_ARTIFACT_TYPE,
  LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PURPOSE,
  createLocalizationGeometrySupersessionIssuerArtifact,
  validateLocalizationGeometrySupersessionArtifact,
  type LocalizationGeometrySupersessionArtifact,
  type LocalizationGeometrySupersessionIssuerArtifact,
} from "@miljobeslut/mps-lu";

const ISSUER_PREDICATE_TYPE = "localization-geometry-supersession-issuer-authority-v1" as const;
const SUPERSESSION_PREDICATE_TYPE = "localization-geometry-supersession-authority-v1" as const;

function issuerPredicate(issuer: Omit<LocalizationGeometrySupersessionIssuerArtifact, "attestation">) {
  return {
    issuer_purpose: issuer.payload.purpose,
    allowed_artifact_type: issuer.payload.allowed_artifact_type,
    owner_authority_ref: issuer.payload.owner_authority_ref,
  };
}

function supersessionPredicate(issuer: LocalizationGeometrySupersessionIssuerArtifact, artifact: LocalizationGeometrySupersessionArtifact) {
  return {
    action: "ISSUE_LOCALIZATION_GEOMETRY_SUPERSESSION",
    issuer_purpose: issuer.payload.purpose,
    project_id: artifact.payload.project_id,
    reason_code: artifact.payload.reason_code,
  };
}

/** Self-attestation over a `LocalizationGeometrySupersessionIssuerArtifact`: proves possession of
 *  the issuer private key at minting time -- not the root of trust by itself (see
 *  verifyLocalizationGeometrySupersessionIssuerArtifact). */
export async function attestLocalizationGeometrySupersessionIssuerArtifact(args: {
  readonly issuer: Omit<LocalizationGeometrySupersessionIssuerArtifact, "attestation">;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  if (args.signing.keyId !== args.issuer.payload.issuer_key_id) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY");
  }
  return createArtifactAttestation({
    subjectDigest: args.issuer.content_hash.value,
    predicateType: ISSUER_PREDICATE_TYPE,
    predicate: issuerPredicate(args.issuer),
    signing: args.signing,
  });
}

/** Verifies a `LocalizationGeometrySupersessionIssuerArtifact` against the runtime's trusted
 *  public key -- the trusted key_id IS the actual root of trust. */
export async function verifyLocalizationGeometrySupersessionIssuerArtifact(args: {
  readonly issuer: LocalizationGeometrySupersessionIssuerArtifact;
  readonly verification: VerificationKeyProvider;
}): Promise<void> {
  const { issuer, verification } = args;
  if (issuer.artifact_type !== LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_ARTIFACT_TYPE) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_TYPE");
  }
  const rebuilt = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: issuer.payload.issuer_key_id,
    owner_authority_ref: issuer.payload.owner_authority_ref,
  });
  if (
    issuer.artifact_id !== rebuilt.artifact_id ||
    issuer.content_hash?.algorithm !== rebuilt.content_hash.algorithm ||
    issuer.content_hash?.value !== rebuilt.content_hash.value ||
    JSON.stringify(issuer.references) !== JSON.stringify(rebuilt.references)
  ) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CANONICAL_INTEGRITY");
  }
  if (issuer.payload.purpose !== LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PURPOSE) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PURPOSE");
  }
  if (issuer.payload.allowed_artifact_type !== LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_ALLOWED_ARTIFACT_TYPE) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_SCOPE");
  }
  if (!issuer.payload.owner_authority_ref?.artifact_id || !issuer.payload.owner_authority_ref?.artifact_type) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_OWNER_AUTHORITY_MISSING");
  }
  if (issuer.payload.issuer_key_id !== verification.keyId) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_TRUST_ROOT");
  }
  const attestation = issuer.attestation;
  if (!attestation || attestation.signer !== issuer.payload.issuer_key_id) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_UNSIGNED");
  }
  if (attestation.subjectDigest !== issuer.content_hash.value || attestation.predicateType !== ISSUER_PREDICATE_TYPE) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_TAMPERED");
  }
  if (!(await verifyArtifactAttestation(attestation, verification))) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_SIGNATURE");
  }
}

export async function attestLocalizationGeometrySupersessionArtifact(args: {
  readonly artifact: Omit<LocalizationGeometrySupersessionArtifact, "attestation">;
  readonly issuer: LocalizationGeometrySupersessionIssuerArtifact;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  if (args.signing.keyId !== args.issuer.payload.issuer_key_id) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY");
  }
  return createArtifactAttestation({
    subjectDigest: args.artifact.content_hash.value,
    predicateType: SUPERSESSION_PREDICATE_TYPE,
    predicate: supersessionPredicate(args.issuer, args.artifact as LocalizationGeometrySupersessionArtifact),
    signing: args.signing,
  });
}

/** Full verification of one supersession artifact: structural self-consistency, issuer trust
 *  chain, predicate/subject binding, and signature. Resolves nothing itself -- caller supplies
 *  the already-resolved issuer (see LocalizationGeometryCurrentProvider, which resolves+verifies
 *  every issuer_ref it encounters before calling this). */
export async function verifyLocalizationGeometrySupersessionArtifact(args: {
  readonly artifact: LocalizationGeometrySupersessionArtifact;
  readonly issuer: LocalizationGeometrySupersessionIssuerArtifact;
  readonly verification: VerificationKeyProvider;
}): Promise<LocalizationGeometrySupersessionArtifact> {
  if (args.artifact.artifact_type !== LOCALIZATION_GEOMETRY_SUPERSESSION_ARTIFACT_TYPE) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ARTIFACT_TYPE");
  }
  const verified = validateLocalizationGeometrySupersessionArtifact(args.artifact);
  await verifyLocalizationGeometrySupersessionIssuerArtifact({ issuer: args.issuer, verification: args.verification });
  if (verified.payload.issuer_key_id !== args.issuer.payload.issuer_key_id) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_TRUST");
  }
  const attestation = verified.attestation;
  if (!attestation || attestation.signer !== args.issuer.payload.issuer_key_id) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_UNSIGNED");
  }
  if (
    attestation.subjectDigest !== verified.content_hash.value ||
    attestation.predicateType !== SUPERSESSION_PREDICATE_TYPE ||
    JSON.stringify(attestation.predicate) !== JSON.stringify(supersessionPredicate(args.issuer, verified))
  ) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_TAMPERED");
  }
  if (!(await verifyArtifactAttestation(attestation, args.verification))) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_SIGNATURE");
  }
  return verified;
}
