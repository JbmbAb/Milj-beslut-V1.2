import {
  createArtifactAttestation,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  PROJECT_CONTEXT_BINDING_ISSUER_ARTIFACT_TYPE,
  PROJECT_CONTEXT_BINDING_ISSUER_PURPOSE,
  type ProjectContextBindingArtifact,
  type ProjectContextBindingIssuerArtifact,
  type ProjectPropertyBindingArtifact,
  projectContextBindingSubjectDigest,
} from "@miljobeslut/mps-lu";
import type { ProjectContextBindingIndex } from "../../repositories/projectContextBindingRepository";

const PREDICATE_TYPE = "project-context-binding-authority-v1" as const;
const ACTION = "ISSUE_PROJECT_CONTEXT_BINDING" as const;

type AttestableArtifact = ProjectPropertyBindingArtifact | ProjectContextBindingArtifact;

function subjectDigest(artifact: AttestableArtifact): string {
  return artifact.artifact_type === "project_context_binding"
    ? projectContextBindingSubjectDigest(artifact)
    : artifact.content_hash.value;
}

function predicate(issuer: ProjectContextBindingIssuerArtifact, artifact: AttestableArtifact): Record<string, unknown> {
  return {
    action: ACTION,
    issuer_purpose: PROJECT_CONTEXT_BINDING_ISSUER_PURPOSE,
    issuer_version: issuer.payload.issuer_version,
    artifact_type: artifact.artifact_type,
    project_id: artifact.payload.project_id,
    allowed_artifact_types: issuer.payload.allowed_artifact_types,
  };
}

export async function attestProjectContextBindingArtifact(args: {
  readonly artifact: AttestableArtifact;
  readonly issuer: ProjectContextBindingIssuerArtifact;
  readonly signing: SigningKeyProvider;
}): Promise<ArtifactAttestation> {
  if (!args.issuer.payload.allowed_artifact_types.includes(args.artifact.artifact_type)) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER_SCOPE");
  }
  if (args.signing.keyId !== args.issuer.payload.issuer_key_id) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER_KEY");
  }
  return createArtifactAttestation({
    subjectDigest: subjectDigest(args.artifact),
    predicateType: PREDICATE_TYPE,
    predicate: predicate(args.issuer, args.artifact),
    signing: args.signing,
  });
}

export async function verifyProjectContextBindingArtifactAuthority(args: {
  readonly artifact: AttestableArtifact;
  readonly issuerRef: { readonly artifact_id: string; readonly artifact_type: string };
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly verification: VerificationKeyProvider;
}): Promise<void> {
  const issuer = await args.artifactRepository.resolve<ProjectContextBindingIssuerArtifact>(args.issuerRef);
  if (issuer.artifact_type !== PROJECT_CONTEXT_BINDING_ISSUER_ARTIFACT_TYPE) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER_TYPE");
  }
  if (issuer.payload.issuer_purpose !== PROJECT_CONTEXT_BINDING_ISSUER_PURPOSE) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER_PURPOSE");
  }
  if (issuer.payload.issuer_key_id !== args.verification.keyId) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER_TRUST");
  }
  if (!issuer.payload.allowed_artifact_types.includes(args.artifact.artifact_type)) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER_SCOPE");
  }
  const attestation = args.artifact.attestation;
  if (!attestation || attestation.signer !== issuer.payload.issuer_key_id) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ATTESTATION_MISSING");
  }
  if (attestation.subjectDigest !== subjectDigest(args.artifact) || attestation.predicateType !== PREDICATE_TYPE) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ATTESTATION_SUBJECT");
  }
  const expected = predicate(issuer, args.artifact);
  if (JSON.stringify(attestation.predicate) !== JSON.stringify(expected)) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ATTESTATION_SCOPE");
  }
  if (!(await verifyArtifactAttestation(attestation, args.verification))) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ATTESTATION_SIGNATURE");
  }
}

/**
 * Owner-side product bootstrap write boundary. All signatures and subject bindings are checked
 * before any product-context artifact enters CAS or its lookup projection.
 */
export async function installVerifiedProductLuContext(args: {
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly index: ProjectContextBindingIndex;
  readonly issuer: ProjectContextBindingIssuerArtifact;
  readonly verification: VerificationKeyProvider;
  readonly geometryArtifact: { readonly artifact_id: string; readonly artifact_type: string; readonly content_hash: { readonly algorithm: "sha256"; readonly value: string }; readonly references: readonly unknown[]; readonly payload: unknown };
  readonly propertyObservation: { readonly artifact_id: string; readonly artifact_type: string; readonly content_hash: { readonly algorithm: "sha256"; readonly value: string }; readonly references: readonly unknown[]; readonly payload: { readonly geometry_ref: { readonly artifact_id: string; readonly artifact_type: string } } };
  readonly propertyBinding: ProjectPropertyBindingArtifact;
  readonly propertyContext: { readonly artifact_id: string; readonly artifact_type: string; readonly content_hash: { readonly algorithm: "sha256"; readonly value: string }; readonly references: readonly unknown[]; readonly payload: { readonly project_property_binding_ref?: { readonly artifact_id: string; readonly artifact_type: string } } };
  readonly projectContext: { readonly artifact_id: string; readonly artifact_type: string; readonly content_hash: { readonly algorithm: "sha256"; readonly value: string }; readonly references: readonly unknown[]; readonly payload: { readonly project_id?: string; readonly project_property_binding_ref?: { readonly artifact_id: string; readonly artifact_type: string } } };
  readonly contextBinding: ProjectContextBindingArtifact;
}): Promise<void> {
  const issuerRef = { artifact_id: args.issuer.artifact_id, artifact_type: args.issuer.artifact_type };
  const propertyBindingRef = {
    artifact_id: args.propertyBinding.artifact_id,
    artifact_type: args.propertyBinding.artifact_type,
  };
  const geometryRef = {
    artifact_id: args.geometryArtifact.artifact_id,
    artifact_type: args.geometryArtifact.artifact_type,
  };
  const observationRef = {
    artifact_id: args.propertyObservation.artifact_id,
    artifact_type: args.propertyObservation.artifact_type,
  };
  if (
    args.contextBinding.payload.authority_ref.artifact_id !== issuerRef.artifact_id ||
    args.contextBinding.payload.authority_ref.artifact_type !== issuerRef.artifact_type ||
    args.contextBinding.payload.project_property_binding_ref?.artifact_id !== propertyBindingRef.artifact_id ||
    args.propertyContext.payload.project_property_binding_ref?.artifact_id !== propertyBindingRef.artifact_id ||
    args.projectContext.payload.project_property_binding_ref?.artifact_id !== propertyBindingRef.artifact_id ||
    args.projectContext.payload.project_id !== args.contextBinding.payload.project_id ||
    args.propertyBinding.payload.geometry_ref.artifact_id !== geometryRef.artifact_id ||
    !args.propertyBinding.payload.source_refs.some((reference) => reference.artifact_id === observationRef.artifact_id && reference.artifact_type === observationRef.artifact_type) ||
    args.propertyObservation.payload.geometry_ref.artifact_id !== geometryRef.artifact_id ||
    !args.propertyContext.references.some((reference) => reference.artifact_id === geometryRef.artifact_id && reference.artifact_type === geometryRef.artifact_type)
  ) {
    throw new Error("REJECT_PRODUCT_LU_CONTEXT_SUBJECT_BINDING");
  }
  await args.artifactRepository.put({
    artifact_id: args.issuer.artifact_id,
    content_hash: args.issuer.content_hash,
    body: args.issuer,
  });
  await args.artifactRepository.put({
    artifact_id: args.geometryArtifact.artifact_id,
    content_hash: args.geometryArtifact.content_hash,
    body: args.geometryArtifact,
  });
  await args.artifactRepository.put({
    artifact_id: args.propertyObservation.artifact_id,
    content_hash: args.propertyObservation.content_hash,
    body: args.propertyObservation,
  });
  await verifyProjectContextBindingArtifactAuthority({
    artifact: args.propertyBinding,
    issuerRef,
    artifactRepository: args.artifactRepository,
    verification: args.verification,
  });
  await verifyProjectContextBindingArtifactAuthority({
    artifact: args.contextBinding,
    issuerRef,
    artifactRepository: args.artifactRepository,
    verification: args.verification,
  });

  await args.artifactRepository.put({
    artifact_id: args.propertyBinding.artifact_id,
    content_hash: args.propertyBinding.content_hash,
    body: args.propertyBinding,
  });
  await args.artifactRepository.put({
    artifact_id: args.propertyContext.artifact_id,
    content_hash: args.propertyContext.content_hash,
    body: args.propertyContext,
  });
  await args.artifactRepository.put({
    artifact_id: args.projectContext.artifact_id,
    content_hash: args.projectContext.content_hash,
    body: args.projectContext,
  });
  await args.artifactRepository.put({
    artifact_id: args.contextBinding.artifact_id,
    content_hash: args.contextBinding.content_hash,
    body: args.contextBinding,
  });
  await args.index.register(args.contextBinding);
}
