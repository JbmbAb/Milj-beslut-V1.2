import { GovernanceArtifact } from "./GovernanceArtifact.js";
import { ApprovalProvenance } from "./ApprovalProvenance.js";

export interface ApprovalArtifact extends GovernanceArtifact {
  readonly artifact_type: "GOVERNANCE_APPROVAL_ARTIFACT";

  readonly provenance: ApprovalProvenance;
}
