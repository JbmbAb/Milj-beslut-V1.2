import { ApplicationArtifact } from "./ApplicationArtifact.js";

export interface ScenarioArtifact extends ApplicationArtifact {
    application_family: "SCENARIO";
}
