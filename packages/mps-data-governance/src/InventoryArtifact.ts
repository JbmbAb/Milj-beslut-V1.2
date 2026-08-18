import type { CanonicalArtifact, ContentReference, Timestamp } from "../../mps-core/src/types";

export type InventoryClassification = "UNKNOWN" | "POSSIBLE" | "RELEVANT" | "IRRELEVANT";

export interface InventoryMetadata {
  readonly title?: string;
  readonly description?: string;
  readonly temporal_coverage_start?: string;
  readonly temporal_coverage_end?: string;
  readonly language?: string;
}

/**
 * 🜃 InventoryArtifact (Tier 3)
 * 
 * Ett klassificerat men ännu inte befordrat dokument.
 * Bygger på RawSourceArtifact, men lägger till systemets initiala bedömning.
 */
export interface InventoryArtifact extends CanonicalArtifact {
  readonly artifact_type: "INVENTORY_ARTIFACT";
  readonly raw_source_ref: ContentReference;
  readonly classification: InventoryClassification;
  readonly metadata: InventoryMetadata;
  readonly inventoried_at: Timestamp;
}
