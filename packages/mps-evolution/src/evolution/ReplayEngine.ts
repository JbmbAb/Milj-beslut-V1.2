import { ArtifactRepository } from "../artifact/CasArtifactRepository.js";
import { EvolutionCandidateArtifact } from "./EvolutionCandidateArtifact.js";
import { ContentReference } from "../core/types.js";
import { MutationEngine } from "./MutationEngine.js";

export class ReplayEngine {
    constructor(
        private repository: ArtifactRepository,
        private engine: MutationEngine
    ) {}

    async run(candidateRef: ContentReference): Promise<EvolutionCandidateArtifact> {
        // Replay must load the exact candidate from the artifact repository.
        const candidate = await this.repository.get<EvolutionCandidateArtifact>(candidateRef);
        
        // Replay SHALL NEVER call `engine.mutate()`.
        // The candidate already exists and is immutable.
        
        return candidate;
    }
}
