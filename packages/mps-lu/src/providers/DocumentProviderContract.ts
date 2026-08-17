import { DocumentDescriptor } from "../domain/DocumentDescriptor";
import { CanonicalGeometry } from "../domain/CanonicalGeometry";

/**
 * Interface that Infrastructure Adapters (like document-provider) must implement.
 * This ensures that the LU Application remains decoupled from specific document sources.
 *
 * P3-LU-DOCUMENT-CLASSIFICATION-01C — this returned `RelevantDocument[]` until the authority
 * model was corrected. That obliged every conforming provider to decide what each document IS,
 * which is how an ungoverned classifier ended up running in production. Providers observe;
 * classification is a separate governed step.
 *
 * @see ../domain/DocumentDescriptor.ts
 */
export interface DocumentProviderContract {
  /**
   * Fetches documents associated with a specific geometry (e.g. a property boundary), as
   * OBSERVATIONS. The returned descriptors carry no document class.
   */
  fetchDocumentsForGeometry(geometry: CanonicalGeometry): Promise<DocumentDescriptor[]>;

  /**
   * Identifies the provider (e.g. "VISS", "Lantmateriet", "MockProvider")
   */
  getProviderName(): string;
}
