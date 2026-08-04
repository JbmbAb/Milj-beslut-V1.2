import { ApplicationArtifact } from "./ApplicationArtifact.js";

export interface AnalysisArtifact extends ApplicationArtifact {
    application_family: "ANALYSIS";
}
