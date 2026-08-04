import { ApplicationArtifact } from "@miljobeslut/mps-application/src/artifacts/ApplicationArtifact.js";
import { ApplicationViewModel } from "../viewmodels/ApplicationViewModel.js";

export interface ArtifactPresentationAdapter {
    adapt(artifact: ApplicationArtifact): Promise<ApplicationViewModel>;
}
