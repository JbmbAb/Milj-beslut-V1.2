export type ArtifactType =
    | "PLAN"
    | "EVOLUTION_CANDIDATE"
    | "SHADOW_EVALUATION"
    | "PROMOTION_DECISION"
    | "GOVERNANCE_REVIEW"
    | "GOVERNANCE_APPROVAL"
    | "GOVERNANCE_POLICY"
    | "POLICY_SIMULATION"
    | "CAPABILITY_DEFINITION"
    | "CAPABILITY_EXECUTION"
    | "WORKFLOW_DEFINITION"
    | "WORKFLOW_EXECUTION"
    | "APPLICATION_ARTIFACT"
    | "CAPABILITY_REGISTRY_ENTRY";

export interface ContentReference {
    hash: string;
    artifact_type: ArtifactType;
    schema_ref?: string;
}

export interface CanonicalArtifact {
    artifact_type: ArtifactType;
    content_hash: string;
    schema_version: string;
    signature: ArtifactSignature;
}

export interface ArtifactSignature {
    algorithm: "SHA256";
    value: string;
}
