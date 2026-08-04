import { CanonicalArtifact, ArtifactType, ContentReference } from "@miljobeslut/mps-evolution/src/core/types.js";
import { Permission } from "../types.js";

export interface CapabilityDefinitionArtifact extends CanonicalArtifact {
    artifact_type: "CAPABILITY_DEFINITION";
    capability_key: string;            // semantic only
    capability_version: string;        // semantic only
    input_types: ArtifactType[];
    output_types: ArtifactType[];
    required_permissions: Permission[];
    implementation_ref: ContentReference;
}
