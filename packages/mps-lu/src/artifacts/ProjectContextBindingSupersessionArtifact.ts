import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";

export const PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE = "project_context_binding_supersession" as const;
export const PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION = "PROJECT_CONTEXT_BINDING_SUPERSESSION_V1" as const;

export interface ProjectContextBindingSupersessionArtifact extends ArtifactContract {
  readonly artifact_type: typeof PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE;
  readonly payload: {
    readonly contract_version: typeof PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION;
    readonly project_id: string;
    readonly superseded_binding_ref: ArtifactReference;
    readonly successor_binding_ref: ArtifactReference;
    readonly reason_code: string;
    readonly issuer_ref: ArtifactReference;
    readonly issuer_key_id: string;
    readonly issued_at: string;
  };
  readonly attestation?: ArtifactAttestation;
}

function ref(value: ArtifactReference, field: string): ArtifactReference {
  if (!value?.artifact_id?.trim() || !value.artifact_type?.trim()) throw new Error(`REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION: ${field} is required`);
  return { artifact_id: value.artifact_id.trim(), artifact_type: value.artifact_type.trim() };
}
function required(value: string, field: string): string {
  if (!value?.trim()) throw new Error(`REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION: ${field} is required`);
  return value.trim();
}

function identity(payload: Omit<ProjectContextBindingSupersessionArtifact["payload"], "issued_at">) {
  const superseded_binding_ref = ref(payload.superseded_binding_ref, "superseded_binding_ref");
  const successor_binding_ref = ref(payload.successor_binding_ref, "successor_binding_ref");
  if (superseded_binding_ref.artifact_id === successor_binding_ref.artifact_id && superseded_binding_ref.artifact_type === successor_binding_ref.artifact_type) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION: successor must differ from predecessor");
  }
  return { contract_version: PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION, project_id: required(payload.project_id, "project_id"), superseded_binding_ref, successor_binding_ref, reason_code: required(payload.reason_code, "reason_code"), issuer_ref: ref(payload.issuer_ref, "issuer_ref"), issuer_key_id: required(payload.issuer_key_id, "issuer_key_id") };
}

export function createProjectContextBindingSupersessionArtifact(input: ProjectContextBindingSupersessionArtifact["payload"]): ProjectContextBindingSupersessionArtifact {
  const payload = { ...identity(input), issued_at: required(input.issued_at, "issued_at") };
  const id = sha256ContentHash({ canonicalizer_id: "rfc8785-sha256-v1", artifact_type: PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE, payload: identity(payload) });
  const artifact: Omit<ProjectContextBindingSupersessionArtifact, "content_hash"> = { artifact_id: `project-context-binding-supersession-${id.value.slice(0, 24)}`, artifact_type: PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE, references: [payload.superseded_binding_ref, payload.successor_binding_ref, payload.issuer_ref], payload };
  return { ...artifact, content_hash: sha256ContentHash({ artifact_type: artifact.artifact_type, artifact_id: artifact.artifact_id, references: artifact.references, payload: artifact.payload }) };
}

export function validateProjectContextBindingSupersessionArtifact(artifact: ProjectContextBindingSupersessionArtifact): ProjectContextBindingSupersessionArtifact {
  if (!artifact || artifact.artifact_type !== PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION: artifact_type");
  const rebuilt = createProjectContextBindingSupersessionArtifact(artifact.payload);
  if (artifact.artifact_id !== rebuilt.artifact_id || artifact.content_hash?.value !== rebuilt.content_hash.value || artifact.content_hash?.algorithm !== rebuilt.content_hash.algorithm) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION: canonical identity or content hash");
  if (JSON.stringify(artifact.references) !== JSON.stringify(rebuilt.references)) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION: references do not match payload");
  }
  return artifact;
}

/**
 * ARTIFACT-OPERATIONAL-TEMPORAL-ENVELOPE-V1 (H2/H12). Same fix as ProjectContextBindingArtifact
 * V2: `issued_at` -- "when the implementation happened to sign this" -- is operational
 * provenance, not semantic content, and is removed entirely from the stored payload rather than
 * merely excluded from the hash. This is deliberately NOT the same field as a future
 * `effective_from` ("the relation is semantically effective from this point") -- that would be
 * genuine semantic content belonging in the canonical body, but it does not exist yet and this
 * change does not invent it; conflating the two was explicitly the owner's objection to the
 * naive "just exclude from hash" fix. V1 (above) is completely unchanged; V2 is purely additive.
 */
export const PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION_V2 = "PROJECT_CONTEXT_BINDING_SUPERSESSION_V2" as const;

export interface ProjectContextBindingSupersessionArtifactV2 extends ArtifactContract {
  readonly artifact_type: typeof PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE;
  readonly payload: {
    readonly contract_version: typeof PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION_V2;
    readonly project_id: string;
    readonly superseded_binding_ref: ArtifactReference;
    readonly successor_binding_ref: ArtifactReference;
    readonly reason_code: string;
    readonly issuer_ref: ArtifactReference;
    readonly issuer_key_id: string;
    // Deliberately no `issued_at` -- see comment above.
  };
  readonly attestation?: ArtifactAttestation;
}

function identityV2(payload: Omit<ProjectContextBindingSupersessionArtifactV2["payload"], "contract_version">) {
  const superseded_binding_ref = ref(payload.superseded_binding_ref, "superseded_binding_ref");
  const successor_binding_ref = ref(payload.successor_binding_ref, "successor_binding_ref");
  if (superseded_binding_ref.artifact_id === successor_binding_ref.artifact_id && superseded_binding_ref.artifact_type === successor_binding_ref.artifact_type) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_V2: successor must differ from predecessor");
  }
  return {
    contract_version: PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION_V2,
    project_id: required(payload.project_id, "project_id"),
    superseded_binding_ref,
    successor_binding_ref,
    reason_code: required(payload.reason_code, "reason_code"),
    issuer_ref: ref(payload.issuer_ref, "issuer_ref"),
    issuer_key_id: required(payload.issuer_key_id, "issuer_key_id"),
  };
}

/** `artifact_id` and `content_hash` are both computed from this exact same object -- one hash
 *  domain, no identity/content split, because there is no operational field left to diverge. */
export function createProjectContextBindingSupersessionArtifactV2(
  input: Omit<ProjectContextBindingSupersessionArtifactV2["payload"], "contract_version">,
): ProjectContextBindingSupersessionArtifactV2 {
  const payload = identityV2(input);
  const identityHash = sha256ContentHash(payload);
  const artifact: Omit<ProjectContextBindingSupersessionArtifactV2, "content_hash"> = {
    artifact_id: `project-context-binding-supersession-${identityHash.value.slice(0, 24)}`,
    artifact_type: PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE,
    references: [payload.superseded_binding_ref, payload.successor_binding_ref, payload.issuer_ref],
    payload,
  };
  return {
    ...artifact,
    content_hash: sha256ContentHash({ artifact_type: artifact.artifact_type, artifact_id: artifact.artifact_id, references: artifact.references, payload: artifact.payload }),
  };
}

export function validateProjectContextBindingSupersessionArtifactV2(
  artifact: ProjectContextBindingSupersessionArtifactV2,
): ProjectContextBindingSupersessionArtifactV2 {
  if (!artifact || artifact.artifact_type !== PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_V2: artifact_type");
  }
  if (artifact.payload?.contract_version !== PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION_V2) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_V2: contract_version mismatch");
  }
  const rebuilt = createProjectContextBindingSupersessionArtifactV2(artifact.payload);
  if (artifact.artifact_id !== rebuilt.artifact_id || artifact.content_hash?.value !== rebuilt.content_hash.value || artifact.content_hash?.algorithm !== rebuilt.content_hash.algorithm) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_V2: canonical identity or content hash");
  }
  if (JSON.stringify(artifact.references) !== JSON.stringify(rebuilt.references)) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_V2: references do not match payload");
  }
  return artifact;
}

/** Explicit version dispatch: the existing V1 marker value routes to the historical (unchanged)
 *  validator; the V2 marker routes to the V2 validator; anything else fails closed. */
export function validateProjectContextBindingSupersessionAnyVersion(
  artifact: { readonly payload?: { readonly contract_version?: unknown } } & Record<string, unknown>,
): ProjectContextBindingSupersessionArtifact | ProjectContextBindingSupersessionArtifactV2 {
  const declaredVersion = artifact?.payload?.contract_version;
  if (declaredVersion === PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION) {
    return validateProjectContextBindingSupersessionArtifact(artifact as unknown as ProjectContextBindingSupersessionArtifact);
  }
  if (declaredVersion === PROJECT_CONTEXT_BINDING_SUPERSESSION_VERSION_V2) {
    return validateProjectContextBindingSupersessionArtifactV2(artifact as unknown as ProjectContextBindingSupersessionArtifactV2);
  }
  throw new Error(`REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION: unknown contract_version '${String(declaredVersion)}'`);
}
