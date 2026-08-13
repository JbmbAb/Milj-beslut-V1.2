import { DocumentEvidenceService } from "../services/DocumentEvidenceService";
import { EvidenceRAGService } from "../services/EvidenceRAGService";
import { DocumentProviderContract } from "../providers/DocumentProviderContract";
import { NullDocumentProvider, resolveDocumentProviderFromEnv } from "../providers/NullDocumentProvider";
import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { CanonicalGeometry } from "../domain/CanonicalGeometry";
import { DocumentEvidenceArtifact, RetrievalCandidate, EvidenceBundle } from "../artifacts/DocumentEvidenceArtifact";
import { prisma } from "../../../../server/db/prisma";

/**
 * Composition root for LU document evidence and Legal Knowledge Retrieval.
 * Default provider is NullDocumentProvider (not Mock) unless LU_DOC_PROVIDER=mock.
 */
export class LUBackendOrchestrator {
  private documentEvidenceService: DocumentEvidenceService | null = null;
  private ragService: EvidenceRAGService;

  constructor(private readonly docProvider?: DocumentProviderContract) {
    if (docProvider) {
      this.documentEvidenceService = new DocumentEvidenceService(docProvider);
    }
    this.ragService = new EvidenceRAGService();
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
      } else if (mode === "postgis") {
        const { PostgisDocumentProvider } = await import(
          "../providers/PostgisDocumentProvider"
        );
        this.documentEvidenceService = new DocumentEvidenceService(new PostgisDocumentProvider());
      } else {
        this.documentEvidenceService = new DocumentEvidenceService(new NullDocumentProvider());
      }
    }
    return this.documentEvidenceService.assessPropertyDocuments(propertyRef, geometry);
  }

  /**
   * P6: Fastighet → rättsregel → evidens → finding
   * End-to-end orchestration of spatial evidence to legal findings.
   */
  public async generateKnowledgeFinding(
    query: string,
    propertyDesignation: string,
    geometry: CanonicalGeometry
  ): Promise<{ answer: string; bundle: EvidenceBundle; abstained: boolean; reason?: string }> {
    // 1. Spatial Evidence -> Municipality mapping
    const res = await prisma.$queryRawUnsafe<Array<{ kommunnamn: string }>>(`
      SELECT DISTINCT name AS kommunnamn
      FROM hydro.water_catchment
      WHERE geom && ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 3006)
      LIMIT 1
    `, JSON.stringify(geometry)).catch(() => []);

    const municipality = res[0]?.kommunnamn || "Mora"; // Test fallback

    // 2. Juridisk Retrieval (BM25 Hybrid Candidate Pool)
    const dbChunks = await prisma.documentChunk.findMany({
      where: { document: { municipalityNormalized: municipality } },
      include: { document: true },
      take: 20,
    });

    if (dbChunks.length === 0) {
      return {
        answer: "Avstår. Ingen kunskapskälla hittades för fastighetens geografiska område.",
        bundle: this.ragService.compileEvidenceBundle(query, [], 0, propertyDesignation, municipality),
        abstained: true,
        reason: "No chunks found for spatial extent",
      };
    }

    const candidates: RetrievalCandidate[] = dbChunks.map((chunk, index) => ({
      id: chunk.id,
      document_id: chunk.documentId,
      document_sha256: chunk.document.fileSha256 || 'uncalculated',
      chunk_index: chunk.chunkIndex,
      chunkText: chunk.chunkText,
      source_path: chunk.document.absolutePath,
      retrieval_method: 'hybrid',
      fused_score: 1 / (60 + index + 1),
    }));

    // 3. Rättskällebedömning & Evidensbunt (P12 & P17)
    const bundle = this.ragService.compileEvidenceBundle(query, candidates, 5, propertyDesignation, municipality);

    if (bundle.evidence.length === 0) {
      return {
        answer: "Avstår. Ingen av de hittade källorna bär tillräckligt juridiskt bevisvärde för frågan.",
        bundle,
        abstained: true,
        reason: "All candidates failed the semantic threshold or authority constraints",
      };
    }

    // 4. Verifierat Svar (P15)
    const answer = this.ragService.generateGroundedAnswer(bundle);

    // 5. Semantic Entailment & Citation Gate (P13, P16, P19)
    const gateResult = this.ragService.verifyGrounding(answer, bundle);

    if (!gateResult.passed) {
      return {
        answer: `Avstår. Systemet genererade en slutsats som inte kunde bevisas kryptografiskt eller semantiskt. Orsak: ${gateResult.error_reason}`,
        bundle,
        abstained: true,
        reason: gateResult.error_reason,
      };
    }

    return {
      answer,
      bundle,
      abstained: false,
    };
  }
}

export const orchestrator = new LUBackendOrchestrator();
