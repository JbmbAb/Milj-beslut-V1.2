import { ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";
import { ApplicationArtifact } from "../artifacts/ApplicationArtifact.js";
import { CanonicalMetadata } from "../types.js";

export interface ApplicationEngine {
    generateApplicationState(
        execution_ref: ContentReference, 
        family: "REPORT" | "ANALYSIS" | "SCENARIO" | "EXPORT",
        metadata?: CanonicalMetadata
    ): Promise<ApplicationArtifact>;
}
