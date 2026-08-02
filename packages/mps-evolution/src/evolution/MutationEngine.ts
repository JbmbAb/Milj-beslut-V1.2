import { EvolutionCandidateArtifact } from "./EvolutionCandidateArtifact.js";
import { ContentReference } from "../core/types.js";

export interface MutationContext {
    random_seed?: string;
    actor: ContentReference;
}

export interface MutationEngine {
    mutate(
        source: EvolutionCandidateArtifact,
        context: MutationContext
    ): Promise<EvolutionCandidateArtifact>;
}
