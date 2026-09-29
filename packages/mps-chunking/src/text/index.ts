export {
  chunkSwedishLaw,
  chunkSwedishLawV24,
  hasGenuineChapterMarkerV24,
  chunkCourtDecision,
  chunkStandard,
  type PreparedLegalChunk,
} from './LegalChunker.js';

export {
  detectSections,
  generateEvidenceChunks,
  determineRelations,
  type ExtractedChunk,
} from './EvidenceChunker.js';

export {
  routeToCorrectChunker,
  chunkTextStructure,
  type TextChunkKind,
  type TextChunkRecord,
  type TextChunkResult,
} from './TextStructureChunker.js';

export { splitWithBoundary, MAX_CHUNK_CHARS, OVERLAP_CHARS, MIN_CHUNK_CHARS } from './splitWithBoundary.js';
export { sanitizeForChunking, repairMojibake } from './sanitize.js';

export {
  A_STRUCTURE_ANNOTATION_VERSION,
  A_STRUCTURE_MARKER_VERSION,
  annotateAuthorityChunks,
  type AuthorityChunk,
  type AStructureRole,
  type AStructureSpanAnnotation,
  type AStructureAnnotatedChunk,
} from './APlusStructureAnnotator.js';
