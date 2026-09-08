/**
 * KNOWLEDGE-K2.2: LEGAL-CHUNK-ADMISSION-V1 moved, unchanged, into `@miljobeslut/mps-knowledge-corpus`
 * — the one package that legitimately depends on BOTH `mps-chunking` and `mps-legal-corpus`, which is
 * exactly the adapter role this module had here. This file is a re-export so every existing caller
 * (the 8 `scripts/db/legal-corpus-*.ts` scripts and the unit test) keeps working with zero behavior
 * change; no second implementation exists.
 */
export {
  admitChunks,
  admitCourtChunks,
  admitEvidenceChunks,
  admitLawChunks,
  admitLawChunksV24,
  admitStandardChunks,
  type AdmissionDocumentStatus,
  type ChunkAdmissionResult,
  type RejectedFragment,
} from '@miljobeslut/mps-knowledge-corpus';
