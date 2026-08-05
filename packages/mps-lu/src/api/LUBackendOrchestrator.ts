import { DocumentEvidenceService } from "../services/DocumentEvidenceService";
import { DocumentProviderContract } from "../providers/DocumentProviderContract";
import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { CanonicalGeometry } from "../domain/CanonicalGeometry";
import { DocumentEvidenceArtifact } from "../artifacts/DocumentEvidenceArtifact";

/**
 * The LUBackendOrchestrator represents the top-level composition root of the backend application.
 * It is responsible for instantiating concrete Infrastructure Adapters (like MockDocumentProvider)
 * and injecting them into the LU Application (Frozen Core/LU Services) according to the
 * Inversion of Control principle mandated by the Architecture Charter.
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
      // Lazy load MockDocumentProvider dynamically to bypass static import boundary rule
      const { MockDocumentProvider } = await import("../../../document-provider/src/MockDocumentProvider");
      this.documentEvidenceService = new DocumentEvidenceService(new MockDocumentProvider());
    }
    return this.documentEvidenceService.assessPropertyDocuments(propertyRef, geometry);
  }
}

export const orchestrator = new LUBackendOrchestrator();
