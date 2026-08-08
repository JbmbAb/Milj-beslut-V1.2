import type { SourceArtifact } from "../types/SourceArtifact.js";
import type {
  ExtractionCompleteness,
  ExtractionMethod,
  ExtractionProvenance,
  ExtractionStep,
} from "../types/ExtractionProvenance.js";
import {
  methodToExtractorKind,
  toExtractionStatus,
} from "../types/ExtractionProvenance.js";
import {
  TEXT_PROJECTION_CONTRACT,
  TEXT_PROJECTION_VERSION,
  type TextProjection,
} from "../types/TextProjection.js";
import { sha256Utf8Text } from "../core/hashText.js";

export const DEFAULT_MIN_CHARS_THRESHOLD = 120;

export interface BuildTextProjectionInput {
  readonly source: SourceArtifact;
  readonly text: string;
  readonly steps: readonly ExtractionStep[];
  readonly min_chars_threshold?: number;
  /** Stable id; if omitted derived from source + text hash. */
  readonly projection_id?: string;
  readonly completeness_override?: ExtractionCompleteness;
}

function deriveCompleteness(
  text: string,
  steps: readonly ExtractionStep[],
  minChars: number,
): ExtractionCompleteness {
  const anySuccess = steps.some((s) => s.succeeded && s.char_count > 0);
  const anyAttempt = steps.some((s) => s.method !== "none");
  if (anyAttempt && !anySuccess && text.length === 0) return "failed";
  if (text.length === 0) return "empty";
  if (text.length < minChars) return "partial";
  return "full";
}

function pickPrimary(steps: readonly ExtractionStep[]): {
  method: ExtractionMethod;
  version: string;
} {
  const nonOcr = steps.find(
    (s) =>
      s.succeeded &&
      s.char_count > 0 &&
      s.method !== "ocr_gemini" &&
      s.method !== "ocr_external",
  );
  if (nonOcr) return { method: nonOcr.method, version: nonOcr.version };

  const anySuccess = steps.find((s) => s.succeeded && s.char_count > 0);
  if (anySuccess) return { method: anySuccess.method, version: anySuccess.version };

  const last = steps[steps.length - 1];
  return {
    method: last?.method ?? "none",
    version: last?.version ?? "none",
  };
}

export function buildExtractionProvenance(
  text: string,
  steps: readonly ExtractionStep[],
  minChars: number = DEFAULT_MIN_CHARS_THRESHOLD,
  completenessOverride?: ExtractionCompleteness,
): ExtractionProvenance {
  const frozenSteps = Object.freeze([...steps].map((s) => Object.freeze({ ...s })));
  const primary = pickPrimary(frozenSteps);
  const ocrStep = frozenSteps.find(
    (s) =>
      (s.method === "ocr_gemini" || s.method === "ocr_external") &&
      s.succeeded &&
      s.char_count > 0,
  );

  const completeness =
    completenessOverride ?? deriveCompleteness(text, frozenSteps, minChars);

  return Object.freeze({
    steps: frozenSteps,
    extractor: Object.freeze({
      kind: methodToExtractorKind(primary.method),
      version: primary.version,
    }),
    ocr_used: Boolean(ocrStep),
    ...(ocrStep
      ? {
          ocr: Object.freeze({
            kind: "ocr" as const,
            version: ocrStep.version,
          }),
        }
      : {}),
    extraction_status: toExtractionStatus(completeness),
    min_chars_threshold: minChars,
  });
}

/**
 * Internal projection construction. TEXT-L2 consumers MUST use
 * `TextProjectionBuilder.build` — do not call this from server adapters.
 */
export function buildTextProjection(input: BuildTextProjectionInput): TextProjection {
  const text = String(input.text ?? "");
  const minChars = input.min_chars_threshold ?? DEFAULT_MIN_CHARS_THRESHOLD;
  const contentHash = sha256Utf8Text(text);
  const projectionId =
    input.projection_id ??
    `tp:${input.source.ref.artifact_id}:${contentHash.value.slice(0, 16)}`;

  const extraction = buildExtractionProvenance(
    text,
    input.steps,
    minChars,
    input.completeness_override,
  );

  // Copy ref — never mutate caller's SourceArtifact
  const sourceRef = Object.freeze({
    artifact_id: input.source.ref.artifact_id,
    ...(input.source.ref.artifact_type
      ? { artifact_type: input.source.ref.artifact_type }
      : {}),
  });

  return Object.freeze({
    contract_id: TEXT_PROJECTION_CONTRACT,
    projection_version: TEXT_PROJECTION_VERSION,
    projection_id: projectionId,
    source_artifact_ref: sourceRef,
    text,
    content_hash: contentHash,
    char_count: text.length,
    extractor: extraction.extractor,
    extraction_status: extraction.extraction_status,
    ocr_used: extraction.ocr_used,
    ...(extraction.ocr ? { ocr: extraction.ocr } : {}),
    extraction,
    doc_name: input.source.doc_name,
    ...(input.source.source_system
      ? { source_system: input.source.source_system }
      : {}),
    ...(input.source.mime_type ? { mime_type: input.source.mime_type } : {}),
  });
}
