export type { SourceArtifact, SourceArtifactRef } from "./types/SourceArtifact.js";

export type {
  ExtractionMethod,
  ExtractionCompleteness,
  ExtractionStatus,
  ExtractorKind,
  ExtractorRef,
  ExtractionStep,
  ExtractionProvenance,
} from "./types/ExtractionProvenance.js";

export {
  methodToExtractorKind,
  toExtractionStatus,
} from "./types/ExtractionProvenance.js";

export {
  TEXT_PROJECTION_CONTRACT,
  TEXT_PROJECTION_VERSION,
  type TextProjection,
  type ContentHash,
} from "./types/TextProjection.js";

export {
  buildExtractionProvenance,
  DEFAULT_MIN_CHARS_THRESHOLD,
  type BuildTextProjectionInput,
} from "./extraction/buildTextProjection.js";

export { TextProjectionBuilder } from "./builder/TextProjectionBuilder.js";
/** @deprecated Prefer TextProjectionBuilder.build */
export { buildTextProjection } from "./extraction/buildTextProjection.js";

export {
  resolveChunkContract,
  type ChunkContractResolution,
} from "./classification/ChunkContractResolver.js";

export type {
  ExtractionResult,
  TextExtractorPort,
  OcrPort,
} from "./extraction/ExtractionPorts.js";

export {
  classifyDocument,
  DOCUMENT_CLASSIFIER_VERSION,
  type DocumentClass,
  type DocumentClassification,
  type ClassificationHints,
} from "./classification/DocumentClassifier.js";

export {
  TextIngestionPipeline,
  type TextIngestionDeps,
  type TextIngestionInput,
  type TextIngestionResult,
} from "./pipeline/TextIngestionPipeline.js";

export { sha256Utf8Text } from "./core/hashText.js";
