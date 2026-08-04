import { ContentReference, CanonicalArtifact } from "./types.js";

export function assertContentReferenceMatches(
    reference: ContentReference,
    artifact: CanonicalArtifact
) {
    if (reference.hash !== artifact.content_hash) {
        throw new Error("CONTENT_REFERENCE_MISMATCH");
    }

    if (reference.artifact_type !== artifact.artifact_type) {
        throw new Error("ARTIFACT_TYPE_MISMATCH");
    }

    // Protect against asymmetric schema_ref
    if (reference.schema_ref !== undefined && reference.schema_ref !== artifact.schema_version) {
        throw new Error("SCHEMA_REFERENCE_MISMATCH");
    }
}
