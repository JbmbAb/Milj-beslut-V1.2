import { CanonicalArtifact, ContentReference } from "../core/types.js";

export interface EvolutionCandidateArtifact extends CanonicalArtifact {
    artifact_type: "EVOLUTION_CANDIDATE";
    parent_ref: ContentReference;
    mutation_operator: string;
    mutation_parameters: Record<string, unknown>;
    created_by: ContentReference;
}
