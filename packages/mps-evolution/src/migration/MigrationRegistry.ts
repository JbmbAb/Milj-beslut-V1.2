import { CanonicalArtifact } from "../core/types.js";

export class MigrationRegistry {
    migrate<T extends CanonicalArtifact>(artifact: T, targetVersion: string): T {
        // Create a new object to avoid mutating the original
        const migrated = { ...artifact };
        
        migrated.schema_version = targetVersion;
        
        // Invalidate old signature because the schema version (and potentially content) changed
        migrated.signature = {
            algorithm: "SHA256",
            value: "" // Requires re-signing
        };

        // Invalidate the content hash as well, since schema_version is part of the canonical envelope
        migrated.content_hash = ""; // Requires re-hashing

        return migrated;
    }
}
