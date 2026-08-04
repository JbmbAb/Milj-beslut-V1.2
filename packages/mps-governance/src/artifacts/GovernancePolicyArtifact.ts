import { CanonicalArtifact } from "@miljobeslut/mps-evolution/src/core/types.js";
import { GovernanceRule } from "../types.js";

export interface GovernancePolicyArtifact extends CanonicalArtifact {
    artifact_type: "GOVERNANCE_POLICY";
    policy_name: string;
    policy_version: string;
    rules: GovernanceRule[];
}
