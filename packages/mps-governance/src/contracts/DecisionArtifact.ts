import { GovernanceArtifact } from "./GovernanceArtifact.js";
import { DecisionProvenance } from "./DecisionProvenance.js";

export interface DecisionArtifact extends GovernanceArtifact {
  readonly artifact_type: "GOVERNANCE_DECISION_ARTIFACT";

  readonly provenance: DecisionProvenance;
}
