import { DocumentEvidenceService } from "../services/DocumentEvidenceService";
import { DocumentProviderContract } from "../providers/DocumentProviderContract";
import { NullDocumentProvider, resolveDocumentProviderFromEnv } from "../providers/NullDocumentProvider";
import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { CanonicalGeometry } from "../domain/CanonicalGeometry";
import { DocumentEvidenceArtifact } from "../artifacts/DocumentEvidenceArtifact";

/**
 * Composition root for LU document evidence.
 * Default provider is NullDocumentProvider (not Mock) unless LU_DOC_PROVIDER=mock.
 */
export class LUBackendOrchestrator {
  private documentEvidenceService: DocumentEvidenceService | null = null;

  constructor(private readonly docProvider?: DocumentProviderContract) {
    if (docProvider) {
      this.documentEvidenceService = new DocumentEvidenceService(docProvider);
    }
  }

  public async generateDocumentEvidence(
    propertyRef: ArtifactReference,
    geometry: CanonicalGeometry
  ): Promise<DocumentEvidenceArtifact[]> {
    if (!this.documentEvidenceService) {
      const mode = resolveDocumentProviderFromEnv();
      if (mode === "mock") {
        const { MockDocumentProvider } = await import(
          "../../../document-provider/src/MockDocumentProvider"
        );
        this.documentEvidenceService = new DocumentEvidenceService(new MockDocumentProvider());
      } else {
        this.documentEvidenceService = new DocumentEvidenceService(new NullDocumentProvider());
      }
    }
    return this.documentEvidenceService.assessPropertyDocuments(propertyRef, geometry);
  }
}

export const orchestrator = new LUBackendOrchestrator();
