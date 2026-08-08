import {
  chunkTextStructure,
  type TextChunkResult,
} from "@miljobeslut/mps-chunking";
import type { SourceArtifact } from "../types/SourceArtifact.js";
import type { ExtractionStep } from "../types/ExtractionProvenance.js";
import type { TextProjection } from "../types/TextProjection.js";
import { DEFAULT_MIN_CHARS_THRESHOLD } from "../extraction/buildTextProjection.js";
import { TextProjectionBuilder } from "../builder/TextProjectionBuilder.js";
import type { OcrPort, TextExtractorPort } from "../extraction/ExtractionPorts.js";
import {
  classifyDocument,
  type ClassificationHints,
  type DocumentClassification,
} from "../classification/DocumentClassifier.js";
import { resolveChunkContract } from "../classification/ChunkContractResolver.js";

export interface TextIngestionDeps {
  readonly extractor?: TextExtractorPort;
  readonly ocr?: OcrPort;
  readonly min_chars_threshold?: number;
  /** When true, run OCR if primary extraction is below threshold. */
  readonly enable_ocr_fallback?: boolean;
}

export interface TextIngestionInput {
  readonly source: SourceArtifact;
  /** Original bytes — required when extractor/OCR ports are used. */
  readonly bytes?: Uint8Array;
  /**
   * Pre-extracted text (tests / trusted upstream).
   * Recorded as method=preextracted unless steps are supplied.
   */
  readonly preextracted_text?: string;
  readonly preextracted_version?: string;
  readonly steps?: readonly ExtractionStep[];
}

export interface TextIngestionResult {
  readonly projection: TextProjection;
  readonly classification: DocumentClassification;
  readonly chunks?: TextChunkResult;
}

/**
 * TEXT-L1 pipeline:
 * SourceArtifact → (extract → optional OCR) → TextProjection → classify → optional chunk.
 *
 * Does not mutate SourceArtifact. Does not embed. Does not write CAS.
 * Chunking is delegated to mps-chunking with text only.
 */
export class TextIngestionPipeline {
  constructor(private readonly deps: TextIngestionDeps = {}) {}

  async ingest(
    input: TextIngestionInput,
    opts: { readonly chunk?: boolean } = {},
  ): Promise<TextIngestionResult> {
    const minChars =
      this.deps.min_chars_threshold ?? DEFAULT_MIN_CHARS_THRESHOLD;
    const steps: ExtractionStep[] = input.steps ? [...input.steps] : [];

    let text = input.preextracted_text;

    if (text !== undefined && steps.length === 0) {
      steps.push({
        method: "preextracted",
        version: input.preextracted_version ?? "caller",
        char_count: text.length,
        succeeded: true,
      });
    }

    if (text === undefined) {
      if (!this.deps.extractor) {
        throw new Error(
          "REJECT_TEXT_INGESTION: bytes extraction requires TextExtractorPort or preextracted_text",
        );
      }
      if (!input.bytes) {
        throw new Error("REJECT_TEXT_INGESTION: bytes required for extraction");
      }
      const extracted = await this.deps.extractor.extract(
        input.source,
        input.bytes,
      );
      steps.push({
        method: extracted.method,
        version: extracted.version,
        char_count: extracted.text.length,
        succeeded: extracted.succeeded,
        ...(extracted.notes ? { notes: extracted.notes } : {}),
      });
      text = extracted.text;
    }

    const enableOcr = this.deps.enable_ocr_fallback !== false;
    if (
      enableOcr &&
      this.deps.ocr &&
      input.bytes &&
      text.length < minChars
    ) {
      const ocrResult = await this.deps.ocr.ocr(input.source, input.bytes);
      steps.push({
        method: ocrResult.method,
        version: ocrResult.version,
        char_count: ocrResult.text.length,
        succeeded: ocrResult.succeeded,
        ...(ocrResult.notes ? { notes: ocrResult.notes } : {}),
      });
      if (ocrResult.succeeded && ocrResult.text.length > 0) {
        if (text.length > 0 && !ocrResult.text.includes(text)) {
          text = `${text}\n${ocrResult.text}`;
        } else {
          text = ocrResult.text;
        }
      }
    }

    const projection = TextProjectionBuilder.build({
      source: input.source,
      text: text ?? "",
      steps,
      min_chars_threshold: minChars,
    });

    const hints: ClassificationHints = {
      ...(input.source.evidence_doc_type
        ? { evidence_doc_type: input.source.evidence_doc_type }
        : {}),
      doc_name: input.source.doc_name,
      ...(input.source.source_system
        ? { source_system: input.source.source_system }
        : {}),
    };

    const classification = classifyDocument(projection, hints);
    const chunkContract = resolveChunkContract(classification);

    if (!opts.chunk) {
      return { projection, classification };
    }

    // Chunker sees text + resolved contract only — not extractor/OCR internals
    const chunks = chunkTextStructure({
      text: projection.text,
      docName: hints.doc_name ?? projection.doc_name,
      sourceSystem: hints.source_system ?? projection.source_system,
      source_artifact_ref: projection.source_artifact_ref,
      kind: chunkContract.chunk_kind,
      ...(chunkContract.evidence_doc_type
        ? { evidenceDocType: chunkContract.evidence_doc_type }
        : {}),
    });

    return { projection, classification, chunks };
  }
}
