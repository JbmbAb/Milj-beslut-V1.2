import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";

export interface CapabilityExecutionArtifact extends CanonicalArtifact {
    artifact_type: "CAPABILITY_EXECUTION";
    capability_ref: ContentReference;
    input_refs: ContentReference[];
    output_refs: ContentReference[];
    runtime_result_ref?: ContentReference;
}
