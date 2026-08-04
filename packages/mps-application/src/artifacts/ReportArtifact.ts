import { ApplicationArtifact } from "./ApplicationArtifact.js";

export interface ReportArtifact extends ApplicationArtifact {
    application_family: "REPORT";
}
