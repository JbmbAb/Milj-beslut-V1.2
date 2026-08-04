import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";

export interface CapabilityRegistryArtifact extends CanonicalArtifact {
    artifact_type: "CAPABILITY_REGISTRY_ENTRY";
    capability_ref: ContentReference;
    implementation_ref: ContentReference;
    availability: "AVAILABLE" | "DEPRECATED";
    compatibility: string[];
    registry_schema_version: string;
    registered_at_policy_ref?: ContentReference;
}
