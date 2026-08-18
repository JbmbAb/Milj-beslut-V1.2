import type { CanonicalArtifact, ContentReference, Timestamp } from "../../mps-core/src/types";

/**
 * 🜃 RawSourceArtifact (Tier 2)
 * 
 * En oförvanskad, exakt kopia av det som skördades.
 * Fryst Invariant: "Hämta först. Bevara originalet. Radera inte på relevansantaganden."
 * 
 * Dessa skapas av skörderuntimet.
 */
export interface RawSourceArtifact extends CanonicalArtifact {
  readonly artifact_type: "RAW_SOURCE_ARTIFACT";
  readonly source_registry_ref: ContentReference; // Refers to the Tier 1 SourceRegistryArtifact
  readonly original_url: string;
  readonly harvested_at: Timestamp;
  readonly mime_type: string;
  readonly sha256_hash: string;
  readonly byte_size: number;
}
