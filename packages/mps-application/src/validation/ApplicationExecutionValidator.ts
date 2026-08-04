import { ApplicationExecutionArtifact } from "../artifacts/ApplicationExecutionArtifact.js";

export interface ApplicationExecutionValidator {
  validate(artifact: ApplicationExecutionArtifact): void;
}
