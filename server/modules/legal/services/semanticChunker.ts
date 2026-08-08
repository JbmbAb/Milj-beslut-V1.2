/**
 * Compatibility re-export — implementation lives in @miljobeslut/mps-chunking (text/v2.3).
 *
 * Juridisk textchunker för RAG-pipeline.
 * - Lagar: §-baserad; Domar: sektionsbaserad; Standard: styckebaserad
 * - v2.3: boundary-aware overlap (paragraph / sentence / whitespace)
 */

export {
  chunkSwedishLaw,
  chunkCourtDecision,
  chunkStandard,
  routeToCorrectChunker,
  type PreparedLegalChunk,
} from '@miljobeslut/mps-chunking';
