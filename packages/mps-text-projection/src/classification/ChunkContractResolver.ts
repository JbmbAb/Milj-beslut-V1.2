import { TEXT_CHUNK_VERSION, type TextChunkKind } from "@miljobeslut/mps-chunking";
import type { DocumentClassification } from "./DocumentClassifier.js";

export interface ChunkContractResolution {
  readonly contract_id: "text";
  readonly chunk_version: typeof TEXT_CHUNK_VERSION;
  readonly chunk_kind: TextChunkKind;
  readonly evidence_doc_type?: string;
  /** Stable label e.g. text/law/v2.3 */
  readonly contract_label: string;
}

/**
 * Maps DocumentClassification → mps-chunking text contract.
 * Does not inspect extraction/OCR provenance.
 */
export function resolveChunkContract(
  classification: DocumentClassification,
): ChunkContractResolution {
  const kind = classification.chunk_kind;
  const labelKind =
    kind === "evidence"
      ? `evidence/${classification.evidence_doc_type ?? "generic"}`
      : kind;

  return Object.freeze({
    contract_id: "text" as const,
    chunk_version: TEXT_CHUNK_VERSION,
    chunk_kind: kind,
    ...(classification.evidence_doc_type
      ? { evidence_doc_type: classification.evidence_doc_type }
      : {}),
    contract_label: `text/${labelKind}/${TEXT_CHUNK_VERSION}`,
  });
}
