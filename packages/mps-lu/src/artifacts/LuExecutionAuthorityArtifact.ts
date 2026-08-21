import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";

export const LU_EXECUTION_AUTHORITY_ROOT_TYPE = "lu_execution_authority_root" as const;
export const LU_EXECUTION_AUTHORITY_ISSUER_TYPE = "lu_execution_authority_issuer" as const;
export const LU_EXECUTION_AUTHORITY_SCOPE = "LU_EXECUTION_AUTHORITY_V1" as const;
export const LU_EXECUTION_AUTHORITY_CONTRACT_VERSION = "lu-execution-authority-v1" as const;

export interface LuExecutionAuthorityRootArtifact extends ArtifactContract {
  readonly artifact_type: typeof LU_EXECUTION_AUTHORITY_ROOT_TYPE;
  readonly payload: {
    readonly contract_version: typeof LU_EXECUTION_AUTHORITY_CONTRACT_VERSION;
    readonly root_key_id: string;
    readonly public_key_fingerprint: string;
    readonly delegated_scope: typeof LU_EXECUTION_AUTHORITY_SCOPE;
    readonly allowed_artifact_type: "execution_identity";
    readonly owner_provisioning: "OWNER_PROVISIONED";
  };
  readonly attestation?: ArtifactAttestation;
}

export interface LuExecutionAuthorityIssuerArtifact extends ArtifactContract {
  readonly artifact_type: typeof LU_EXECUTION_AUTHORITY_ISSUER_TYPE;
  readonly payload: {
    readonly contract_version: typeof LU_EXECUTION_AUTHORITY_CONTRACT_VERSION;
    readonly issuer_key_id: string;
    readonly public_key_fingerprint: string;
    readonly root_ref: ArtifactReference;
    readonly delegated_scope: typeof LU_EXECUTION_AUTHORITY_SCOPE;
    readonly allowed_artifact_type: "execution_identity";
  };
  readonly attestation?: ArtifactAttestation;
}

function required(value: string, field: string): string {
  const result = value.trim();
  if (!result) throw new Error(`REJECT_LU_EXECUTION_AUTHORITY: ${field} is required`);
  return result;
}

function reference(value: ArtifactReference): ArtifactReference {
  return { artifact_id: required(value.artifact_id, "root_ref.artifact_id"), artifact_type: required(value.artifact_type, "root_ref.artifact_type") };
}

export function createLuExecutionAuthorityRootArtifact(input: { readonly root_key_id: string; readonly public_key_fingerprint: string }): Omit<LuExecutionAuthorityRootArtifact, "attestation"> {
  const payload = { contract_version: LU_EXECUTION_AUTHORITY_CONTRACT_VERSION, root_key_id: required(input.root_key_id, "root_key_id"), public_key_fingerprint: required(input.public_key_fingerprint, "public_key_fingerprint"), delegated_scope: LU_EXECUTION_AUTHORITY_SCOPE, allowed_artifact_type: "execution_identity", owner_provisioning: "OWNER_PROVISIONED" } as const;
  const identity = sha256ContentHash({ artifact_type: LU_EXECUTION_AUTHORITY_ROOT_TYPE, payload });
  const artifact = { artifact_id: `lu-execution-authority-root-${identity.value.slice(0, 24)}`, artifact_type: LU_EXECUTION_AUTHORITY_ROOT_TYPE, references: [], payload } as const;
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function createLuExecutionAuthorityIssuerArtifact(input: { readonly issuer_key_id: string; readonly public_key_fingerprint: string; readonly root_ref: ArtifactReference }): Omit<LuExecutionAuthorityIssuerArtifact, "attestation"> {
  const payload = { contract_version: LU_EXECUTION_AUTHORITY_CONTRACT_VERSION, issuer_key_id: required(input.issuer_key_id, "issuer_key_id"), public_key_fingerprint: required(input.public_key_fingerprint, "public_key_fingerprint"), root_ref: reference(input.root_ref), delegated_scope: LU_EXECUTION_AUTHORITY_SCOPE, allowed_artifact_type: "execution_identity" } as const;
  const identity = sha256ContentHash({ artifact_type: LU_EXECUTION_AUTHORITY_ISSUER_TYPE, payload });
  const artifact = { artifact_id: `lu-execution-authority-issuer-${identity.value.slice(0, 24)}`, artifact_type: LU_EXECUTION_AUTHORITY_ISSUER_TYPE, references: [payload.root_ref], payload } as const;
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function validateLuExecutionAuthorityRootArtifact(artifact: LuExecutionAuthorityRootArtifact): LuExecutionAuthorityRootArtifact {
  const rebuilt = createLuExecutionAuthorityRootArtifact(artifact.payload);
  if (artifact.artifact_type !== rebuilt.artifact_type || artifact.artifact_id !== rebuilt.artifact_id || artifact.content_hash?.value !== rebuilt.content_hash.value) throw new Error("REJECT_LU_EXECUTION_AUTHORITY_ROOT_CANONICAL");
  return artifact;
}

export function validateLuExecutionAuthorityIssuerArtifact(artifact: LuExecutionAuthorityIssuerArtifact): LuExecutionAuthorityIssuerArtifact {
  const rebuilt = createLuExecutionAuthorityIssuerArtifact(artifact.payload);
  if (artifact.artifact_type !== rebuilt.artifact_type || artifact.artifact_id !== rebuilt.artifact_id || artifact.content_hash?.value !== rebuilt.content_hash.value) throw new Error("REJECT_LU_EXECUTION_AUTHORITY_ISSUER_CANONICAL");
  return artifact;
}
