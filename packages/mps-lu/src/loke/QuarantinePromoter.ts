import { sha256ContentHash } from "../../../mps-runtime/src/kernel/ExecutionKernel";
import { DocumentEvidenceArtifact } from "../artifacts/DocumentEvidenceArtifact";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { QuarantineStorage } from "./LokeIngestor";
import { toRelevantDocumentType } from "../domain/RelevantDocument";

/**
 * LU-local materializer from quarantined raw document bytes to DOCUMENT_EVIDENCE.
 *
 * This is NOT the platform governance promotion authority and holds NO persistence
 * capability. It builds the evidence artifact and returns it; it cannot write anywhere.
 *
 * A1 ENFORCEMENT (2026-08-11) — this class previously took an ArtifactRepositoryPort and
 * called `cas.put(...)` directly, persisting a canonical artifact with no attestation.
 * That was a live authority bypass; see the historical reproduction in
 * `tests/A1AuthorityBypass.red.test.ts` (ESTABLISHED_RED_PROOF) and the repaired-boundary
 * criterion in `tests/A1AuthorityEnforcement.test.ts` (REQUIRED_GREEN_PROOF).
 *
 * Frozen decision (LU-MVP plan §4.1): the staging-CAS reading was explicitly REJECTED —
 * this module must not be legitimized by renaming its write surface. Pre-approval material
 * belongs in non-authoritative quarantine/archive storage. Canonical CAS persistence may
 * occur ONLY through Mimers Brunn's governed promotion path with valid authority and
 * attestation binding. Per ADR-27 (Frozen, binding): "Governance aldrig dupliceras",
 * "LU är en applikation, inte en plattform".
 *
 * Callers that need canonical persistence must route the returned artifact through the
 * governed promotion path. That bridge is a separate, not-yet-built work unit; LU deliberately
 * cannot persist in the meantime rather than persisting unsafely.
 */
export class DocumentEvidenceMaterializer {
  constructor(private readonly quarantine: QuarantineStorage) {}

  /**
   * Builds the DOCUMENT_EVIDENCE artifact from quarantined bytes. Pure: performs no write.
   *
   * Renamed from `promote()` because the method no longer promotes anything — keeping the
   * old name would describe a capability this class must not have.
   */
  async materialize(
    rawArtifactId: string,
    propertyRefId: string,
    documentRefId: string,
    documentType: string
  ): Promise<DocumentEvidenceArtifact> {
    const raw = await this.quarantine.get(rawArtifactId);
    if (!raw) {
      throw new Error(`Quarantine item not found: ${rawArtifactId}`);
    }

    // Fail-closed on an unrecognised document label. Defaulting to "decision" would let a
    // producer's free string become a typed claim about the document.
    const relevantType = toRelevantDocumentType(documentType);
    if (!relevantType) {
      throw new Error(
        `Unknown document type '${documentType}'. RelevantDocument.type is a closed vocabulary ` +
          `(decision | injunction | notification | inspection); it must not be inferred from an ` +
          `unmapped label.`,
      );
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
      // F4B-0A — conforms to the frozen RelevantDocument contract: a structured description of
      // the document, never its text. The raw bytes stay in quarantine; the canonical text
      // belongs to a TextProjection (TEXT-L1), referenced via payload.text_projection_ref once
      // a projection exists. This materializer does not create one.
      relevant_document: {
        title: documentRefId,
        type: relevantType,
        metadata: {
          source_url: raw.payload.original_path,
          authority: raw.payload.authority,
        },
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
      // F4B-0B — `references` is the artifact-level provenance edge set declared REQUIRED by
      // ArtifactContract. It is what makes the evidence graph traversable and replay verifiable;
      // compliance validators read it directly (REPLAY_23_I1/I5, EXE_25_I5/I7, CAP_26_I3/I5).
      //
      // Mandatory by contract, but DERIVED — never a separate input. Every edge is already
      // present in the payload, so taking it as a parameter would allow the declared provenance
      // to disagree with the actual derivation.
      //
      // The three edges are the artifacts this evidence is derived from: the subject property,
      // the subject document, and the Tier 2 raw source it was materialized from. Including
      // raw_source_ref is what keeps the chain back to the preserved original traversable.
      references: [
        payload.property_ref,
        payload.document_ref,
        payload.raw_source_ref,
      ].filter((ref: ArtifactReference | undefined): ref is ArtifactReference => ref !== undefined),
      payload,
    };

    // A1 ENFORCEMENT: no write here, by design. Canonical persistence requires the governed
    // promotion path and a verified ArtifactAttestation. Returning the artifact without
    // persisting is the whole point — LU must not hold this capability.
    return evidenceArtifact;
  }
}

/**
 * @deprecated Use DocumentEvidenceMaterializer for LU-local evidence materialization.
 * Do not use this class name for live governance promotion authority — the canonical
 * QuarantinePromoter lives in `@miljobeslut/mimers-brunn-core` and requires a signed
 * ArtifactAttestation. This name collision is scheduled for removal in FAS 2.2; it is kept
 * here only so this A1 enforcement change stays minimal.
 */
export class QuarantinePromoter extends DocumentEvidenceMaterializer {}
