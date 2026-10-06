// NON-EXECUTABLE PROPOSAL. Do not paste into prisma/schema.prisma until owner approval and model selection.
// Proposed relation addition inside LegalCorpusMaterializedChunk:
localEmbeddings LegalCorpusChunkEmbeddingLocalV1[]

/// W-NO-GOOGLE-02A -- PROPOSAL, NOT APPLIED (needs the Prisma-migration Dev-Gov unit and Jimmy's approval).
/// The explicit 3072 -> 1024 boundary. Local embeddings (the two frozen A7 candidates, both 1024
/// dimensions) live here, in a versioned table of their own; LegalCorpusChunkEmbedding (vector 3072)
/// is historical input only and is neither altered, read as local, nor converted. The database pins
/// the dimension (CHECK 1024) and the only two admitted (model, revision, pipeline) triples; see the
/// migration and packages/mps-embedding-identity LocalEmbeddingPipelines.ts. embeddingVector is
/// Unsupported by the Prisma client -- written and read through raw SQL only.
model LegalCorpusChunkEmbeddingLocalV1 {
  id String @id @default(cuid())

  fragmentId        String @map("fragment_id")
  materializationId String @map("materialization_id")
  chunkContentHash  String @map("chunk_content_hash")

  embeddingModelId         String @map("embedding_model_id")
  embeddingModelVersion    String @map("embedding_model_version")
  embeddingPipelineVersion String @map("embedding_pipeline_version")
  embeddingIdentityHash    String @unique(map: "lcel_v1_identity_hash_key") @map("embedding_identity_hash")

  embeddingDimension Int                         @map("embedding_dimension") @db.SmallInt
  embeddingVector    Unsupported("vector(1024)") @map("embedding_vector")

  createdAt DateTime @default(now()) @map("created_at")

  chunk LegalCorpusMaterializedChunk @relation(fields: [materializationId, fragmentId], references: [materializationId, fragmentId], onDelete: Cascade, map: "lcel_v1_chunk_fkey")

  @@index([fragmentId])
  @@index([materializationId])
  @@map("legal_corpus_chunk_embeddings_local_v1")
}
