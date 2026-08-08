import type { TextProjection } from "../types/TextProjection.js";
import type { TextChunkKind } from "@miljobeslut/mps-chunking";

export const DOCUMENT_CLASSIFIER_VERSION = "v1.0" as const;

export type DocumentClass =
  | "law"
  | "court"
  | "evidence_decision"
  | "evidence_mkb"
  | "evidence_technical"
  | "evidence_control"
  | "standard"
  | "unknown";

/**
 * Hints supplied *after* TextProjection (or alongside), never as document_class on the projection.
 */
export interface ClassificationHints {
  readonly evidence_doc_type?: string;
  readonly doc_name?: string;
  readonly source_system?: string;
}

export interface DocumentClassification {
  readonly classifier_version: typeof DOCUMENT_CLASSIFIER_VERSION;
  readonly document_class: DocumentClass;
  /** Handoff into mps-chunking text contract. */
  readonly chunk_kind: TextChunkKind;
  readonly evidence_doc_type?: string;
  readonly confidence: "high" | "medium" | "low";
  readonly reasons: readonly string[];
}

/**
 * Deterministic document classification AFTER TextProjection.
 * Does not embed or call LLMs. Does not mutate the projection.
 */
export function classifyDocument(
  projection: TextProjection,
  hints: ClassificationHints = {},
): DocumentClassification {
  const src = String(
    hints.source_system ?? projection.source_system ?? "",
  ).toLowerCase();
  const name = String(hints.doc_name ?? projection.doc_name).toLowerCase();
  const evidenceHint = String(hints.evidence_doc_type || "").toLowerCase();
  const textHead = projection.text.slice(0, 2000).toLowerCase();
  const reasons: string[] = [];

  if (
    evidenceHint === "decision" ||
    evidenceHint === "mkb" ||
    evidenceHint === "technical_description" ||
    evidenceHint === "control_program"
  ) {
    const map: Record<string, DocumentClass> = {
      decision: "evidence_decision",
      mkb: "evidence_mkb",
      technical_description: "evidence_technical",
      control_program: "evidence_control",
    };
    const document_class = map[evidenceHint]!;
    reasons.push(`evidence_doc_type=${evidenceHint}`);
    return freezeClass({
      document_class,
      chunk_kind: "evidence",
      evidence_doc_type: evidenceHint,
      confidence: "high",
      reasons,
    });
  }

  if (
    src.includes("sfs") ||
    src.includes("riksdagen") ||
    src.includes("lagrummet") ||
    name.includes("miljöbalken") ||
    name.includes("plan- och bygglagen") ||
    name.includes("pbl ")
  ) {
    reasons.push("source/name matches law");
    return freezeClass({
      document_class: "law",
      chunk_kind: "law",
      confidence: "high",
      reasons,
    });
  }

  if (
    src.includes("domstol") ||
    src.includes("möd") ||
    src.includes("mmd") ||
    src.includes("mark- och miljö") ||
    name.includes(" dom ") ||
    name.startsWith("m ") ||
    /\bdomsk[äa]l\b/.test(textHead) ||
    /\bdomslut\b/.test(textHead)
  ) {
    reasons.push("source/name/text matches court");
    return freezeClass({
      document_class: "court",
      chunk_kind: "court",
      confidence:
        src.includes("domstol") || src.includes("möd") ? "high" : "medium",
      reasons,
    });
  }

  if (
    /villkor\s+och\s+f[öo]rsiktighetsm[åa]tt/i.test(projection.text) ||
    /beslutets\s+inneb[öo]rd/i.test(projection.text)
  ) {
    reasons.push("text markers suggest permit decision");
    return freezeClass({
      document_class: "evidence_decision",
      chunk_kind: "evidence",
      evidence_doc_type: "decision",
      confidence: "medium",
      reasons,
    });
  }

  reasons.push("fallback standard");
  return freezeClass({
    document_class: projection.char_count === 0 ? "unknown" : "standard",
    chunk_kind: "standard",
    confidence: "low",
    reasons,
  });
}

function freezeClass(
  partial: Omit<DocumentClassification, "classifier_version">,
): DocumentClassification {
  return Object.freeze({
    classifier_version: DOCUMENT_CLASSIFIER_VERSION,
    ...partial,
    reasons: Object.freeze([...partial.reasons]),
  });
}
