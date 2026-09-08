/**
 * LEGAL-RETRIEVAL-IDENTITY-CONTRACT-01.
 *
 * A minimal, storage-agnostic port over the real LegalCorpusMaterializedChunk table (see
 * prisma/schema.prisma). This package never depends on Prisma directly -- a real adapter binds
 * this port to the database in the bounded pilot unit; here it exists so `buildRetrievalResult`
 * can enforce "a retrieval result must always resolve back to the exact governed chunk" as an
 * executable check against a real (or realistically faked, in tests) source of truth, not a
 * naming convention nobody verifies.
 */
export interface GovernedChunkRef {
  readonly fragment_id: string;
  readonly materialization_id: string;
  readonly content_hash: string;
  /** KNOWLEDGE-K2.2: `evidence` added additively — the persisted `structure_kind` column already
   *  carries it for decision/MKB/technical/control-program chunks (ChunkIdentity v2); the result
   *  contract's identity semantics are unchanged. */
  readonly structure_kind: 'law' | 'court' | 'evidence' | 'standard';
}

export interface GovernedChunkLookupPort {
  findByFragmentId(fragment_id: string): GovernedChunkRef | null;
}

/** In-memory implementation for tests and for callers who already hold a resolved chunk set --
 *  never used as a substitute for the real DB-backed adapter in production. */
export function createInMemoryGovernedChunkLookup(
  chunks: readonly GovernedChunkRef[],
): GovernedChunkLookupPort {
  const byFragmentId = new Map(chunks.map((c) => [c.fragment_id, c]));
  return {
    findByFragmentId(fragment_id: string): GovernedChunkRef | null {
      return byFragmentId.get(fragment_id) ?? null;
    },
  };
}
