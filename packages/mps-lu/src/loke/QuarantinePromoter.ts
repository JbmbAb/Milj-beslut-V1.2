import { ArtifactRepositoryPort, sha256ContentHash } from "../../../mps-runtime/src/kernel/ExecutionKernel";
import { DocumentEvidenceArtifact } from "../artifacts/DocumentEvidenceArtifact";
import { QuarantineStorage } from "./LokeIngestor";

export class QuarantinePromoter {
  constructor(
    private readonly quarantine: QuarantineStorage,
    private readonly cas: ArtifactRepositoryPort
  ) {}

  async promote(
    rawArtifactId: string, 
    propertyRefId: string, 
    documentRefId: string,
    documentType: string
  ): Promise<DocumentEvidenceArtifact> {
    const raw = await this.quarantine.get(rawArtifactId);
    if (!raw) {
      throw new Error(`Quarantine item not found: ${rawArtifactId}`);
    }

    // Verify integrity of the raw artifact before promoting
    const expectedHash = sha256ContentHash(raw.payload);
    if (expectedHash.value !== raw.content_hash.value) {
      throw new Error("Quarantine integrity violation: hash mismatch");
    }

    // Create the Document Evidence Artifact for CAS
    const payload = {
      property_ref: { artifact_id: propertyRefId, artifact_type: "PROPERTY" as const },
      document_ref: { artifact_id: documentRefId, artifact_type: "DOCUMENT" as const },
      relevant_document: {
        id: documentRefId,
        type: documentType,
        source_url: raw.payload.original_path,
        text_content: Buffer.from(raw.payload.content_bytes_base64, "base64").toString("utf8"), // Or extracting text using a tool
      },
      source_metadata: {
        provider: raw.payload.authority,
        retrieved_at: raw.payload.observed_at,
      },
      raw_source_ref: {
        artifact_id: raw.artifact_id,
        artifact_type: raw.artifact_type,
      }
    };

    const evidenceArtifact: DocumentEvidenceArtifact = {
      artifact_id: `doc_ev_${documentRefId}`,
      artifact_type: "DOCUMENT_EVIDENCE",
      content_hash: sha256ContentHash(payload),
      payload,
    };

    // Promote to CAS!
    await this.cas.put({
      artifact_id: evidenceArtifact.artifact_id,
      content_hash: evidenceArtifact.content_hash,
      body: evidenceArtifact,
    });

    return evidenceArtifact;
  }
}
