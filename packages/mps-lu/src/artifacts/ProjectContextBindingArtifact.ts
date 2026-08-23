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

type AnyBindingLikeArtifact = { readonly artifact_type: string; readonly artifact_id: string; readonly references: unknown; readonly payload: unknown };

function bindingContentPayload(artifact: AnyBindingLikeArtifact): object {
  return {
    artifact_type: artifact.artifact_type,
    artifact_id: artifact.artifact_id,
    references: artifact.references,
    payload: artifact.payload,
  };
}

/** Shape-agnostic by design -- works identically for V1 and V2 (see ...V2 below); it only ever
 *  hashes whatever payload the artifact actually carries. */
export function projectContextBindingSubjectDigest(artifact: AnyBindingLikeArtifact): string {
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

/**
 * ARTIFACT-OPERATIONAL-TEMPORAL-ENVELOPE-V1 (CANONICAL-SEMANTIC-INPUTS-V1 cluster, H2/H12).
 *
 * Owner decision, verbatim: excluding `created_at` from the HASH computation while leaving it
 * present in the stored `payload` is insufficient -- two constructions of the same semantic
 * binding at different wall-clock times would still produce the same `artifact_id` with
 * genuinely different serialized bytes, which `MimersByteStorageBackend.put()` correctly detects
 * and rejects as a WORM violation (crash on a legitimate reconciliation-first retry, not silent
 * corruption -- but still a real reliability defect). The fix is structural: `created_at` is not
 * a field on `ProjectContextBindingPayloadV2` at all. It never enters the object that gets
 * serialized into CAS bytes under this artifact_id.
 *
 * "When this binding was minted" is genuine operational provenance, not semantic content -- it
 * belongs in whatever operational envelope wraps the mint call (a queue request's own durable
 * `createdAt`, a Postgres discovery-projection row's timestamp, an audit log), never inside the
 * immutable canonical body. `createProjectContextBindingArtifactV2` does not even accept a
 * `created_at` parameter -- there is nothing for a caller to (mis)supply.
 *
 * V1 (`ProjectContextBindingArtifact`/`createProjectContextBindingArtifact` above) is completely
 * unchanged and stays the historical rule forever -- every existing binding continues to verify
 * under exactly the rule that minted it. V2 is purely additive: a new, separate type and function
 * pair, not a mutation of V1's shape. Nothing in this codebase is switched to emit V2 by this
 * change alone -- that is a deliberate, separate decision left for the caller/producer to make.
 */
export const PROJECT_CONTEXT_BINDING_CONTRACT_VERSION_V2 = "project-context-binding-body-v2" as const;

export interface ProjectContextBindingPayloadV2 {
  readonly binding_contract_version: typeof PROJECT_CONTEXT_BINDING_CONTRACT_VERSION_V2;
  readonly project_id: string;
  readonly project_context_ref: ArtifactReference;
  readonly project_property_binding_ref: ArtifactReference;
  readonly binding_version: string;
  readonly authority_ref: ArtifactReference;
  // Deliberately no `created_at` or any other wall-clock field -- see file header comment above.
}

export interface ProjectContextBindingArtifactV2 extends ArtifactContract {
  readonly artifact_type: typeof PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE;
  readonly payload: ProjectContextBindingPayloadV2;
  readonly attestation?: ArtifactAttestation;
}

function projectContextBindingV2ContentPayload(artifact: ProjectContextBindingArtifactV2): object {
  return {
    artifact_type: artifact.artifact_type,
    artifact_id: artifact.artifact_id,
    references: artifact.references,
    payload: artifact.payload,
  };
}

/**
 * `artifact_id` and `content_hash` are BOTH computed from this exact same object -- there is only
 * one hash domain for V2 (no separate "identity payload" vs "content payload" split), because
 * with `created_at` removed entirely there is nothing left that could cause them to diverge.
 */
export function createProjectContextBindingArtifactV2(input: {
  readonly project_id: string;
  readonly project_context_ref: ArtifactReference;
  readonly project_property_binding_ref: ArtifactReference;
  readonly binding_version: string;
  readonly authority_ref: ArtifactReference;
}): ProjectContextBindingArtifactV2 {
  const payload: ProjectContextBindingPayloadV2 = {
    binding_contract_version: PROJECT_CONTEXT_BINDING_CONTRACT_VERSION_V2,
    project_id: requireNonEmpty(input.project_id, "project_id"),
    project_context_ref: validateReference(input.project_context_ref, "project_context_ref"),
    project_property_binding_ref: validateReference(input.project_property_binding_ref, "project_property_binding_ref"),
    binding_version: requireNonEmpty(input.binding_version, "binding_version"),
    authority_ref: validateReference(input.authority_ref, "authority_ref"),
  };
  const identityHash = sha256ContentHash(payload);
  const artifact: Omit<ProjectContextBindingArtifactV2, "content_hash"> = {
    artifact_id: `project-context-binding-${identityHash.value.slice(0, 24)}`,
    artifact_type: PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE,
    references: [payload.project_context_ref, payload.project_property_binding_ref, payload.authority_ref],
    payload,
  };
  return { ...artifact, content_hash: sha256ContentHash(projectContextBindingV2ContentPayload(artifact as ProjectContextBindingArtifactV2)) };
}

export function validateProjectContextBindingArtifactV2(
  artifact: ProjectContextBindingArtifactV2,
): ProjectContextBindingArtifactV2 {
  if (!artifact || typeof artifact !== "object" || artifact.artifact_type !== PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_V2: artifact_type must be project_context_binding");
  }
  const p = artifact.payload;
  if (!p || p.binding_contract_version !== PROJECT_CONTEXT_BINDING_CONTRACT_VERSION_V2) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_V2: binding_contract_version mismatch");
  }
  const rebuilt = createProjectContextBindingArtifactV2({
    project_id: p.project_id,
    project_context_ref: p.project_context_ref,
    project_property_binding_ref: p.project_property_binding_ref,
    binding_version: p.binding_version,
    authority_ref: p.authority_ref,
  });
  if (artifact.artifact_id !== rebuilt.artifact_id) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_V2: artifact_id does not match canonical identity");
  }
  if (artifact.content_hash?.algorithm !== rebuilt.content_hash.algorithm || artifact.content_hash?.value !== rebuilt.content_hash.value) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_V2: content_hash does not match canonical body (tampered or malformed)");
  }
  if (JSON.stringify(artifact.references) !== JSON.stringify(rebuilt.references)) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_V2: references do not match payload");
  }
  return artifact;
}

/**
 * Explicit version dispatch, per the frozen owner contract: absence of `binding_contract_version`
 * means legacy V1 shape (validated under the historical rule, unchanged forever); an exact V2
 * match uses the V2 rule; anything else (a garbage/unknown version string) fails closed rather
 * than being silently accepted by either validator.
 */
export function validateProjectContextBindingAnyVersion(
  artifact: unknown,
): ProjectContextBindingArtifact | ProjectContextBindingArtifactV2 {
  const declaredVersion = (artifact as { payload?: { binding_contract_version?: unknown } })?.payload?.binding_contract_version;
  if (declaredVersion === undefined) {
    return validateProjectContextBindingArtifact(artifact as unknown as ProjectContextBindingArtifact);
  }
  if (declaredVersion === PROJECT_CONTEXT_BINDING_CONTRACT_VERSION_V2) {
    return validateProjectContextBindingArtifactV2(artifact as unknown as ProjectContextBindingArtifactV2);
  }
  throw new Error(`REJECT_PROJECT_CONTEXT_BINDING: unknown binding_contract_version '${String(declaredVersion)}'`);
}
