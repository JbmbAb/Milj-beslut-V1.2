import { ApplicationArtifact } from "../artifacts/ApplicationArtifact.js";

export interface ApplicationValidator {
    validate(artifact: ApplicationArtifact): void;
}
