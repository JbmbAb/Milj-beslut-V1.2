import type { ArtifactContract } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";

export const PROJECT_CONTEXT_BINDING_ISSUER_ARTIFACT_TYPE = "project_context_binding_issuer" as const;
export const PROJECT_CONTEXT_BINDING_ISSUER_VERSION = "project-context-binding-issuer-v1" as const;
export const PROJECT_CONTEXT_BINDING_ISSUER_PURPOSE = "PROJECT_CONTEXT_BINDING_ISSUER_V1" as const;

export interface ProjectContextBindingIssuerArtifact extends ArtifactContract {
  readonly artifact_type: typeof PROJECT_CONTEXT_BINDING_ISSUER_ARTIFACT_TYPE;
  readonly payload: {
    readonly issuer_key_id: string;
    readonly issuer_purpose: typeof PROJECT_CONTEXT_BINDING_ISSUER_PURPOSE;
    readonly allowed_artifact_types: readonly ["project_property_binding", "project_context_binding"];
    readonly issuer_version: typeof PROJECT_CONTEXT_BINDING_ISSUER_VERSION;
  };
}

export function createProjectContextBindingIssuerArtifact(input: {
  readonly issuer_key_id: string;
}): ProjectContextBindingIssuerArtifact {
  const issuerKeyId = input.issuer_key_id.trim();
  if (!issuerKeyId) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_ISSUER: issuer_key_id is required");
  const payload: ProjectContextBindingIssuerArtifact["payload"] = {
    issuer_key_id: issuerKeyId,
    issuer_purpose: PROJECT_CONTEXT_BINDING_ISSUER_PURPOSE,
    allowed_artifact_types: ["project_property_binding", "project_context_binding"],
    issuer_version: PROJECT_CONTEXT_BINDING_ISSUER_VERSION,
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

