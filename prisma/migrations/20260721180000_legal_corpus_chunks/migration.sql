-- Legal corpus chunks for RAG V2.2 (semanticChunker)
CREATE EXTENSION IF NOT EXISTS vector;

DROP TABLE IF EXISTS public.legal_corpus_chunks CASCADE;

CREATE TABLE public.legal_corpus_chunks (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES public.legal_corpus_records(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  chunk_version TEXT NOT NULL DEFAULT 'v2.2',
  document_type TEXT NOT NULL DEFAULT 'other',
  law_name TEXT,
  chapter TEXT,
  paragraph TEXT,
  section TEXT,
  embedding_vector vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT legal_corpus_chunks_record_chunk_idx UNIQUE (record_id, chunk_index, chunk_version)
);

CREATE INDEX idx_legal_chunks_record_id
  ON public.legal_corpus_chunks (record_id);

CREATE INDEX idx_legal_chunks_chapter_paragraph
  ON public.legal_corpus_chunks (chapter, paragraph)
  WHERE chapter IS NOT NULL AND paragraph IS NOT NULL;

CREATE INDEX idx_legal_chunks_version
  ON public.legal_corpus_chunks (chunk_version);

-- HNSW requires typed vector dimensions; create only when column is vector(N)
CREATE INDEX idx_legal_chunks_embedding_hnsw
  ON public.legal_corpus_chunks
  USING hnsw (embedding_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding_vector IS NOT NULL;
