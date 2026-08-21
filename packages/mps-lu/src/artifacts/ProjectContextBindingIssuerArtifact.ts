import type { ArtifactContract } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";

export const PROJECT_CONTEXT_BINDING_ISSUER_ARTIFACT_TYPE = "project_context_binding_issuer" as const;
export const PROJECT_CONTEXT_BINDING_ISSUER_VERSION_V1 = "project-context-binding-issuer-v1" as const;
export const PROJECT_CONTEXT_BINDING_ISSUER_VERSION_V2 = "project-context-binding-issuer-v2" as const;
export const PROJECT_CONTEXT_BINDING_ISSUER_VERSION = PROJECT_CONTEXT_BINDING_ISSUER_VERSION_V1;
export const PROJECT_CONTEXT_BINDING_ISSUER_PURPOSE = "PROJECT_CONTEXT_BINDING_ISSUER_V1" as const;

export interface ProjectContextBindingIssuerArtifact extends ArtifactContract {
  readonly artifact_type: typeof PROJECT_CONTEXT_BINDING_ISSUER_ARTIFACT_TYPE;
  readonly payload: {
    readonly issuer_key_id: string;
    readonly issuer_purpose: typeof PROJECT_CONTEXT_BINDING_ISSUER_PURPOSE;
    readonly allowed_artifact_types:
      | readonly ["project_property_binding", "project_context_binding"]
      | readonly ["project_property_binding", "project_context_binding", "project_context_binding_supersession"];
    readonly issuer_version:
      | typeof PROJECT_CONTEXT_BINDING_ISSUER_VERSION_V1
      | typeof PROJECT_CONTEXT_BINDING_ISSUER_VERSION_V2;
  };
}

export function createProjectContextBindingIssuerArtifact(input: {
  readonly issuer_key_id: string;
  /** V1 remains the default so historical issuer identities remain reproducible. */
  readonly issuer_version?: ProjectContextBindingIssuerArtifact["payload"]["issuer_version"];
}): ProjectContextBindingIssuerArtifact {
  const issuerKeyId = input.issuer_key_id.trim();
  if (!issuerKeyId) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER: issuer_key_id is required");
  const issuerVersion = input.issuer_version ?? PROJECT_CONTEXT_BINDING_ISSUER_VERSION_V1;
  const allowedArtifactTypes = issuerVersion === PROJECT_CONTEXT_BINDING_ISSUER_VERSION_V2
    ? ["project_property_binding", "project_context_binding", "project_context_binding_supersession"] as const
    : ["project_property_binding", "project_context_binding"] as const;
  const payload: ProjectContextBindingIssuerArtifact["payload"] = {
    issuer_key_id: issuerKeyId,
    issuer_purpose: PROJECT_CONTEXT_BINDING_ISSUER_PURPOSE,
    allowed_artifact_types: allowedArtifactTypes,
    issuer_version: issuerVersion,
  };
  const identity = sha256ContentHash({
    canonicalizer_id: "rfc8785-sha256-v1",
    artifact_type: PROJECT_CONTEXT_BINDING_ISSUER_ARTIFACT_TYPE,
    payload,
  });
  const artifact: Omit<ProjectContextBindingIssuerArtifact, "content_hash"> = {
    artifact_id: `project-context-binding-issuer-${identity.value.slice(0, 24)}`,
    artifact_type: PROJECT_CONTEXT_BINDING_ISSUER_ARTIFACT_TYPE,
    references: [],
    payload,
  };
  return {
    ...artifact,
    content_hash: sha256ContentHash(artifact),
  };
}

/** Verifies the complete issuer artifact before it is used as a runtime trust anchor. */
export function validateProjectContextBindingIssuerArtifact(
  artifact: ProjectContextBindingIssuerArtifact,
): ProjectContextBindingIssuerArtifact {
  if (!artifact || artifact.artifact_type !== PROJECT_CONTEXT_BINDING_ISSUER_ARTIFACT_TYPE) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER_TYPE");
  }
  const payload = artifact.payload;
  if (
    !payload ||
    payload.issuer_purpose !== PROJECT_CONTEXT_BINDING_ISSUER_PURPOSE ||
    !payload.issuer_key_id?.trim() ||
    !Array.isArray(payload.allowed_artifact_types) ||
    payload.allowed_artifact_types[0] !== "project_property_binding" ||
    payload.allowed_artifact_types[1] !== "project_context_binding" ||
    !(
      (payload.issuer_version === PROJECT_CONTEXT_BINDING_ISSUER_VERSION_V1 && payload.allowed_artifact_types.length === 2) ||
      (payload.issuer_version === PROJECT_CONTEXT_BINDING_ISSUER_VERSION_V2 &&
        payload.allowed_artifact_types.length === 3 &&
        payload.allowed_artifact_types[2] === "project_context_binding_supersession")
    )
  ) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER_PAYLOAD");
  }
  const expected = createProjectContextBindingIssuerArtifact({
    issuer_key_id: payload.issuer_key_id,
    issuer_version: payload.issuer_version,
  });
  if (artifact.artifact_id !== expected.artifact_id) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER_IDENTITY");
  }
  if (
    artifact.content_hash?.algorithm !== expected.content_hash.algorithm ||
    artifact.content_hash?.value !== expected.content_hash.value
  ) {
    throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER_CONTENT_HASH");
  }
  return artifact;
}
