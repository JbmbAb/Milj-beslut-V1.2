import { ApplicationArtifact } from "./ApplicationArtifact.js";

export interface ExportArtifact extends ApplicationArtifact {
    application_family: "EXPORT";
}
