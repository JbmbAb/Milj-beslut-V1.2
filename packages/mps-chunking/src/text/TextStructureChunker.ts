import type { ChunkBase, SourceArtifactRef } from "../core/ChunkTypes.js";
import { sha256Utf8Text } from "../core/ChunkHasher.js";
import { buildChunkManifest, type ChunkManifest } from "../core/ChunkManifest.js";
import { TEXT_CHUNK_VERSION } from "../core/ChunkVersion.js";
import {
  chunkCourtDecision,
  chunkStandard,
  chunkSwedishLaw,
  type PreparedLegalChunk,
} from "./LegalChunker.js";
import {
  generateEvidenceChunks,
  type ExtractedChunk,
} from "./EvidenceChunker.js";

export type TextChunkKind = "law" | "court" | "evidence" | "standard";

export interface TextChunkRecord extends ChunkBase {
  readonly contract_id: "text";
  readonly chunk_version: typeof TEXT_CHUNK_VERSION;
  readonly chunkText: string;
  readonly chapter?: string;
  readonly paragraph?: string;
  readonly section?: string;
  readonly relations?: ReadonlyArray<{ type: string; target: string }>;
}

export interface TextChunkResult {
  readonly chunks: readonly TextChunkRecord[];
  readonly manifest: ChunkManifest;
}

function toRecords(
  prepared: PreparedLegalChunk[],
  source: SourceArtifactRef,
): TextChunkRecord[] {
  return prepared.map((p, i) => ({
    source_artifact_ref: source,
    chunk_index: i,
    content_hash: sha256Utf8Text(p.chunkText),
    contract_id: "text" as const,
    chunk_version: TEXT_CHUNK_VERSION,
    chunkText: p.chunkText,
    ...(p.chapter !== undefined ? { chapter: p.chapter } : {}),
    ...(p.paragraph !== undefined ? { paragraph: p.paragraph } : {}),
    ...(p.section !== undefined ? { section: p.section } : {}),
  }));
}

function evidenceToRecords(
  extracted: ExtractedChunk[],
  source: SourceArtifactRef,
): TextChunkRecord[] {
  return extracted.map((e, i) => ({
    source_artifact_ref: source,
    chunk_index: i,
    content_hash: sha256Utf8Text(e.content),
    contract_id: "text" as const,
    chunk_version: TEXT_CHUNK_VERSION,
    chunkText: e.content,
    section: e.section,
    relations: e.relations,
  }));
}

/**
 * Route to the correct text structure chunker (RAG Text Chunking v2.3).
 * Text-only API — never accepts raw bytes / Buffer.
 */
export function routeToCorrectChunker(
  rawText: string,
  docName: string,
  sourceSystem?: string,
): PreparedLegalChunk[] {
  const src = String(sourceSystem || "").toLowerCase();
  const name = docName.toLowerCase();

  if (
    src.includes("sfs") ||
    src.includes("riksdagen") ||
    src.includes("lagrummet") ||
    name.includes("miljöbalken") ||
    name.includes("plan- och bygglagen") ||
    name.includes("pbl ")
  ) {
    return chunkSwedishLaw(rawText);
  }

  if (
    src.includes("domstol") ||
    src.includes("möd") ||
    src.includes("mmd") ||
    src.includes("mark- och miljö") ||
    name.includes(" dom ") ||
    name.includes("mö") ||
    name.startsWith("m ")
  ) {
    return chunkCourtDecision(rawText);
  }

  return chunkStandard(rawText);
}

export function chunkTextStructure(input: {
  readonly text: string;
  readonly docName: string;
  readonly sourceSystem?: string;
  readonly source_artifact_ref: SourceArtifactRef;
  readonly kind?: TextChunkKind;
  readonly evidenceDocType?: string;
}): TextChunkResult {
  if (typeof input.text !== "string") {
    throw new Error("REJECT_TEXT_CONTRACT: text chunker requires string input");
  }

  let records: TextChunkRecord[];

  if (input.kind === "evidence" || input.evidenceDocType) {
    const docType = input.evidenceDocType ?? "decision";
    records = evidenceToRecords(
      generateEvidenceChunks(input.text, docType),
      input.source_artifact_ref,
    );
  } else if (input.kind === "law") {
    records = toRecords(chunkSwedishLaw(input.text), input.source_artifact_ref);
  } else if (input.kind === "court") {
    records = toRecords(
      chunkCourtDecision(input.text),
      input.source_artifact_ref,
    );
  } else if (input.kind === "standard") {
    records = toRecords(chunkStandard(input.text), input.source_artifact_ref);
  } else {
    records = toRecords(
      routeToCorrectChunker(input.text, input.docName, input.sourceSystem),
      input.source_artifact_ref,
    );
  }

  const manifest = buildChunkManifest(
    "text",
    TEXT_CHUNK_VERSION,
    input.source_artifact_ref,
    records,
  );

  return { chunks: Object.freeze(records), manifest };
}
