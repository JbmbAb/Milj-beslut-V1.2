import { DocumentProviderContract } from "../providers/DocumentProviderContract";
import { DocumentEvidenceArtifact } from "../artifacts/DocumentEvidenceArtifact";
import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { CanonicalGeometry } from "../domain/CanonicalGeometry";

export class DocumentEvidenceService {
  constructor(private readonly provider: DocumentProviderContract) {}

  /**
   * Orchestrates fetching documents and packaging them as canonical artifacts.
   */
  public async assessPropertyDocuments(
    propertyRef: ArtifactReference,
    geometry: CanonicalGeometry
  ): Promise<DocumentEvidenceArtifact[]> {
    const rawDocuments = await this.provider.fetchDocumentsForGeometry(geometry);

    return rawDocuments.map((doc, index) => {
      return {
        artifact_id: `doc_ev_${index}_${Math.random().toString(36).substring(2, 11)}`,
        artifact_type: "DOCUMENT_EVIDENCE",
        payload: {
          property_ref: propertyRef,
          document_ref: {
            // F4B-0A: RelevantDocumentMetadata is a closed descriptive contract and carries no
            // document_id. A provider-supplied identity belongs in document_ref, not metadata.
            artifact_id: `mock-doc-hash-${index}`,
            artifact_type: "EXTERNAL_DOCUMENT"
          },
          // P3-LU-DOCUMENT-CLASSIFICATION-01C — the provider now returns a descriptor, and a
          // descriptor is NOT a RelevantDocument. Assigning it here would have re-created the
          // bypass one layer up: observation carrying its own interpretation. The document class
          // is decided later, by the classification authority, over this evidence.
          source_metadata: {
            provider: this.provider.getProviderName(),
            retrieved_at: new Date().toISOString(),
            document_title: doc.title,
            /** OBSERVED SOURCE VALUE. NON-AUTHORITATIVE — never a document class. */
            source_classification_label: doc.source_classification_label
          }
        },
        content_hash: { algorithm: "sha256", value: "uncalculated" },
        references: [propertyRef]
      } as DocumentEvidenceArtifact;
    });
  }
}
