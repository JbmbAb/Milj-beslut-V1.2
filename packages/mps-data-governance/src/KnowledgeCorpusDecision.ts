import type { CanonicalArtifact, ContentReference, ActorReference, Timestamp } from "../../mps-core/src/types";
import type { InventoryClassification } from "./InventoryArtifact";

/**
 * 🜃 KnowledgeCorpusDecisionArtifact (Tier 4)
 * 
 * Ett reproducerbart, versionshanterat urval från Inventory, skapat genom explicit policy.
 * Alla exkluderingar ska vara spårbara och återförbara till Raw Archive.
 * Garanterar Invariant: "Ingen källa får permanent förloras på grund av en agents relevansbedömning."
 */
export interface KnowledgeCorpusDecisionArtifact extends CanonicalArtifact {
  readonly artifact_type: "KNOWLEDGE_CORPUS_DECISION";
  readonly source_id: string; // T.ex. myndighets-id, eller specifik käll-id
  readonly inventory_id: ContentReference; // Refers to the InventoryArtifact
  readonly policy_version: string;
  readonly classification: InventoryClassification;
  readonly decision: "INCLUDE" | "EXCLUDE";
  readonly reason_code: string;
  readonly decided_at: Timestamp;
  readonly decided_by: ActorReference;
  readonly raw_reference: ContentReference; // Refers directly back to the RawSourceArtifact
}
