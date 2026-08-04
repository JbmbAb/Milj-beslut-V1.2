import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";

export interface CanonicalImplementationArtifact extends CanonicalArtifact {
    artifact_type: "CANONICAL_IMPLEMENTATION";
    runtime_hash: string;       // The hash of the executing code
    entrypoint: string;         // The function/binary entrypoint
    environment_constraints: string[];
}
