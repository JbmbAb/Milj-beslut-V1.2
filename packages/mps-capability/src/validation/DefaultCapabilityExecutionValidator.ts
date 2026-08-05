import { CapabilityExecutionArtifact } from "../artifacts/CapabilityExecutionArtifact.js";

export class DefaultCapabilityExecutionValidator {
  validateExecutionArtifact(artifact: CapabilityExecutionArtifact): void {
    if (artifact.artifact_type === "GOVERNANCE_APPROVAL_ARTIFACT" as any) {
      throw new Error("GOVERNANCE_BOUNDARY_VIOLATION");
    }
  }
}
