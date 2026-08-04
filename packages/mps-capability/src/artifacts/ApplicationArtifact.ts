import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";
import { CanonicalMetadata } from "../types.js";

export interface ApplicationArtifact extends CanonicalArtifact {
    artifact_type: "APPLICATION_ARTIFACT";
    application_family: "REPORT" | "ANALYSIS" | "SCENARIO" | "EXPORT";
    produced_by_execution: ContentReference;     // WorkflowExecutionArtifact
    source_refs: ContentReference[];
    application_metadata?: CanonicalMetadata;
}
