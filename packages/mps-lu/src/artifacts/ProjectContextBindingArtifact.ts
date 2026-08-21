import type { ArtifactContract } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { ContentHash } from "@miljobeslut/mps-compliance/src/artifacts/ContentHash";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";

export const PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE = "project_context_binding" as const;

export interface ProjectContextBindingPayload {
  readonly project_id: string;
  readonly project_context_ref: ArtifactReference;
  readonly project_property_binding_ref: ArtifactReference;
  readonly binding_version: string;
  /** Owner/project-authority artifact that authorized this immutable association. */
  readonly authority_ref: ArtifactReference;
  readonly created_at: string;
}

/**
 * An immutable, owner-issued association between an access-controlled Project and a LU context.
 * It is deliberately separate from the frozen LU project-context and assessment artifacts.
 */
export interface ProjectContextBindingArtifact extends ArtifactContract {
  readonly artifact_type: typeof PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE;
  readonly payload: ProjectContextBindingPayload;
  /** Attestation is over content_hash and is deliberately excluded from identity. */
  readonly attestation?: ArtifactAttestation;
}

type BindingIdentityPayload = Omit<ProjectContextBindingPayload, "created_at"> & {
  readonly artifact_type: typeof PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE;
};

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_PROJECT_CONTEXT_BINDING: ${field} is required`);
  return normalized;
}

function validateReference(reference: ArtifactReference, field: string): ArtifactReference {
  if (!reference || typeof reference !== "object") {
    throw new Error(`REJECT_PROJECT_CONTEXT_BINDING: ${field} is required`);
  }
  return {
    artifact_id: requireNonEmpty(String(reference.artifact_id ?? ""), `${field}.artifact_id`),
    artifact_type: requireNonEmpty(String(reference.artifact_type ?? ""), `${field}.artifact_type`),
  };
}

export function projectContextBindingIdentityPayload(
  payload: Omit<ProjectContextBindingPayload, "created_at">,
): BindingIdentityPayload {
  return {
    artifact_type: PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE,
    project_id: requireNonEmpty(payload.project_id, "project_id"),
    project_context_ref: validateReference(payload.project_context_ref, "project_context_ref"),
    project_property_binding_ref: validateReference(payload.project_property_binding_ref, "project_property_binding_ref"),
    binding_version: requireNonEmpty(payload.binding_version, "binding_version"),
    authority_ref: validateReference(payload.authority_ref, "authority_ref"),
  };
}

export function projectContextBindingArtifactId(
  payload: Omit<ProjectContextBindingPayload, "created_at">,
): string {
  const identityHash = sha256ContentHash(projectContextBindingIdentityPayload(payload));
  return `project-context-binding-${identityHash.value.slice(0, 24)}`;
}

function bindingContentPayload(artifact: ProjectContextBindingArtifact): object {
  return {
    artifact_type: artifact.artifact_type,
    artifact_id: artifact.artifact_id,
    references: artifact.references,
    payload: artifact.payload,
  };
}

export function projectContextBindingSubjectDigest(artifact: ProjectContextBindingArtifact): string {
  return sha256ContentHash(bindingContentPayload(artifact)).value;
}

/** Owner-side construction helper. Runtime routes only validate and resolve this artifact. */
export function createProjectContextBindingArtifact(args: {
  readonly project_id: string;
  readonly project_context_ref: ArtifactReference;
  readonly project_property_binding_ref: ArtifactReference;
  readonly binding_version: string;
  readonly authority_ref: ArtifactReference;
  readonly created_at: string;
}): ProjectContextBindingArtifact {
  const identity = projectContextBindingIdentityPayload(args);
  const createdAt = requireNonEmpty(args.created_at, "created_at");
  const artifact: Omit<ProjectContextBindingArtifact, "content_hash"> = {
    artifact_id: projectContextBindingArtifactId(args),
    artifact_type: PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE,
    references: [
      identity.project_context_ref,
      identity.project_property_binding_ref,
      identity.authority_ref,
    ],
    payload: {
      project_id: identity.project_id,
      project_context_ref: identity.project_context_ref,
      project_property_binding_ref: identity.project_property_binding_ref,
      binding_version: identity.binding_version,
      authority_ref: identity.authority_ref,
      created_at: createdAt,
    },
  };
  return { ...artifact, content_hash: sha256ContentHash(bindingContentPayload(artifact as ProjectContextBindingArtifact)) };
}

/** Validates structure, canonical identity and body hash before a binding can enter runtime. */
export function validateProjectContextBindingArtifact(
  artifact: ProjectContextBindingArtifact,
): ProjectContextBindingArtifact {
  if (!artifact || typeof artifact !== "object" || artifact.artifact_type !== PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING: artifact_type must be project_context_binding");
  }
  if (!artifact.payload || typeof artifact.payload !== "object") {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING: payload is required");
  }
  const identity = projectContextBindingIdentityPayload(artifact.payload);
  const expectedId = projectContextBindingArtifactId(identity);
  if (artifact.artifact_id !== expectedId) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING: artifact_id does not match canonical identity");
  }
  const expectedHash: ContentHash = sha256ContentHash(bindingContentPayload(artifact));
  if (artifact.content_hash?.algorithm !== expectedHash.algorithm || artifact.content_hash?.value !== expectedHash.value) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING: content_hash does not match canonical body");
  }
  const references = artifact.references;
  if (!Array.isArray(references)) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING: references are required");
  }
  const hasContext = references.some((reference) =>
    reference.artifact_id === identity.project_context_ref.artifact_id &&
    reference.artifact_type === identity.project_context_ref.artifact_type,
  );
  const hasAuthority = references.some((reference) =>
    reference.artifact_id === identity.authority_ref.artifact_id &&
    reference.artifact_type === identity.authority_ref.artifact_type,
  );
  const hasPropertyBinding = references.some((reference) =>
    reference.artifact_id === identity.project_property_binding_ref.artifact_id &&
    reference.artifact_type === identity.project_property_binding_ref.artifact_type,
  );
  if (!hasContext || !hasAuthority || !hasPropertyBinding) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING: references must bind context and authority");
  }
  return artifact;
}
