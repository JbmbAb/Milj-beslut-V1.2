export type ArtifactType =
    | "PLAN"
    | "EVOLUTION_CANDIDATE"
    | "SHADOW_EVALUATION"
    | "PROMOTION_DECISION";

export interface ContentReference {
    hash: string;
    artifact_type: ArtifactType;
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
