import { ContentReference, ArtifactType } from "@miljobeslut/mps-evolution/src/core/types.js";
import { ActorReference, ActorRole } from "@miljobeslut/mps-evolution/src/core/ActorReference.js";

// Export re-used types for convenience
export type { ActorReference, ActorRole, ContentReference, ArtifactType };

export type GovernanceDecision = 
    | "APPROVE"
    | "REJECT"
    | "REQUEST_CHANGES";

export interface GovernanceRule {
    artifact_type: ArtifactType;
    requires_review: boolean;
    minimum_role: ActorRole;
    conditions: RuleCondition[];
}

export interface RuleCondition {
    field: string;
    operator: "EQUALS" | "NOT_EQUALS" | "CONTAINS" | "GREATER_THAN" | "LESS_THAN";
    value: string | number | boolean;
}

export interface SimulationAssumption {
    parameter: string;
    value: string | number | boolean;
}

export interface SimulationResult {
    metric: string;
    outcome: string | number;
}
