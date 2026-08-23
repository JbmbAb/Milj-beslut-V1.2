import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";

export const PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PURPOSE = "PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_V1" as const;
export const PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_ARTIFACT_TYPE = "project_context_binding_supersession_issuer" as const;
export const PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_VERSION = "project-context-binding-supersession-issuer-v1" as const;
export const PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_ALLOWED_ARTIFACT_TYPE = "project_context_binding_supersession" as const;

function req(v: string, n: string): string {
  const x = (v ?? "").trim();
  if (!x) throw new Error(`REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER: ${n} is required`);
  return x;
}

function reqRef(v: ArtifactReference, n: string): ArtifactReference {
  if (!v || typeof v !== "object") throw new Error(`REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER: ${n} is required`);
  return {
    artifact_id: req(String(v.artifact_id ?? ""), `${n}.artifact_id`),
    artifact_type: req(String(v.artifact_type ?? ""), `${n}.artifact_type`),
  };
}

/**
 * PROJECT-CONTEXT-BINDING-SUPERSESSION-ISSUER-V1 Phase B.
 *
 * A dedicated, self-signed issuing authority for `project_context_binding_supersession` artifacts
 * ONLY -- deliberately separate from PROJECT_CONTEXT_BINDING_ISSUER (whose `allowed_artifact_types`
 * is a closed, structurally-validated 2-tuple/3-tuple union that already grants
 * project_property_binding + project_context_binding authority; widening it to also cover
 * supersession would hand that same issuer authority it does not need, violating least privilege).
 * Same shape as LocalizationGeometrySupersessionIssuerArtifact: possession of the private key
 * alone does not establish authority -- the issuer artifact carries a self-attestation plus an
 * explicit `owner_authority_ref`, and the runtime verifier additionally requires `issuer_key_id`
 * to match its own env-configured trusted key_id (the actual root of trust).
 */
export interface ProjectContextBindingSupersessionIssuerArtifact extends ArtifactContract {
  readonly artifact_type: typeof PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_ARTIFACT_TYPE;
  readonly payload: {
    readonly issuer_key_id: string;
    readonly purpose: typeof PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PURPOSE;
    readonly allowed_artifact_type: typeof PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_ALLOWED_ARTIFACT_TYPE;
    readonly owner_authority_ref: ArtifactReference;
    readonly issuer_version: typeof PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_VERSION;
  };
  readonly attestation?: ArtifactAttestation;
}

export function createProjectContextBindingSupersessionIssuerArtifact(input: {
  readonly issuer_key_id: string;
  readonly owner_authority_ref: ArtifactReference;
}): Omit<ProjectContextBindingSupersessionIssuerArtifact, "attestation"> {
  const payload = {
    issuer_key_id: req(input.issuer_key_id, "issuer_key_id"),
    purpose: PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PURPOSE,
    allowed_artifact_type: PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_ALLOWED_ARTIFACT_TYPE,
    owner_authority_ref: reqRef(input.owner_authority_ref, "owner_authority_ref"),
    issuer_version: PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_VERSION,
  } as const;
  const identity = sha256ContentHash({ artifact_type: PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_ARTIFACT_TYPE, payload });
  const artifact = {
    artifact_id: `project-context-binding-supersession-issuer-${identity.value.slice(0, 24)}`,
    artifact_type: PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_ARTIFACT_TYPE,
    references: [payload.owner_authority_ref],
    payload,
  };
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}
