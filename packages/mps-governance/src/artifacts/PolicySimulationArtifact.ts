import { CanonicalArtifact } from "@miljobeslut/mps-evolution/src/core/types.js";
import { ContentReference, SimulationAssumption, SimulationResult } from "../types.js";

export interface PolicySimulationArtifact extends CanonicalArtifact {
    artifact_type: "POLICY_SIMULATION";
    policy_ref: ContentReference;
    baseline_ref: ContentReference;
    assumptions: SimulationAssumption[];
    results: SimulationResult[];
}
