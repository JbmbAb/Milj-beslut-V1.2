import { RelevantDocument } from "../domain/RelevantDocument";
import { CanonicalGeometry } from "../domain/CanonicalGeometry";

/**
 * Interface that Infrastructure Adapters (like document-provider) must implement.
 * This ensures that the LU Application remains decoupled from specific document sources.
 */
export interface DocumentProviderContract {
  /**
   * Fetches relevant documents associated with a specific geometry (e.g. a property boundary).
   */
  fetchDocumentsForGeometry(geometry: CanonicalGeometry): Promise<RelevantDocument[]>;

  /**
   * Identifies the provider (e.g. "VISS", "Lantmateriet", "MockProvider")
   */
  getProviderName(): string;
}
