import { ApplicationArtifact } from "../artifacts/ApplicationArtifact.js";

export interface ProvenanceValidator {
    validateProvenance(artifact: ApplicationArtifact): void;
}
