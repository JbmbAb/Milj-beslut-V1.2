import { ArtifactId } from "./ArtifactId";
import { ArtifactType } from "./ArtifactType";
import { ContentHash } from "./ContentHash";
import { ArtifactReference } from "./ArtifactReference";

/**
 * Pure representation boundary.
 *
 * ArtifactContract SHALL NOT:
 * - create identities
 * - calculate hashes
 * - perform canonicalization
 * - expose canonical bytes
 * - perform validation
 * - perform governance decisions
 */
export interface ArtifactContract {
  readonly artifact_id: ArtifactId;
  readonly artifact_type: ArtifactType;
  readonly content_hash: ContentHash;
  readonly references: readonly ArtifactReference[];
}
