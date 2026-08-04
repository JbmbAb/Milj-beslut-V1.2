import { ApplicationExecutionValidator } from "./ApplicationExecutionValidator.js";
import { ApplicationExecutionArtifact } from "../artifacts/ApplicationExecutionArtifact.js";
import { ApplicationGovernanceBoundaryViolationError } from "../errors/ApplicationErrors.js";

export class DefaultApplicationExecutionValidator implements ApplicationExecutionValidator {
  validate(artifact: ApplicationExecutionArtifact): void {
    if (artifact.artifact_type.startsWith("GOVERNANCE_")) {
      throw new ApplicationGovernanceBoundaryViolationError(
        "APPLICATION_GOVERNANCE_BOUNDARY_VIOLATION: Application execution cannot create governance artifacts."
      );
    }
  }
}
