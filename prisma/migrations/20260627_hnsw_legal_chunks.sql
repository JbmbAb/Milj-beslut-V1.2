-- ============================================================
-- Migration: HNSW-index för LegalCorpusChunk embedding_vector
-- RAG V2.2 — Fas 2
--
-- Parametrar:
--   m = 16               Standard grannar per lager (balans precision/minne)
--   ef_construction = 64 Sökbredd vid indexering
--                        Högre = bättre recall vid build, långsammare build
--
-- ef_search sätts per session beroende på önskad balans:
--   SET LOCAL hnsw.ef_search = 40;   -- snabb (~2ms),  recall ~85%
--   SET LOCAL hnsw.ef_search = 100;  -- balanserad,    recall ~95% ← REKOMMENDERAT för RAG
--   SET LOCAL hnsw.ef_search = 200;  -- hög recall,    vid batch-analys
-- ============================================================

-- Partiellt HNSW-index: exkluderar rader utan embedding.
-- Minskar indexstorlek och build-tid när många chunks saknar embedding (t.ex. nyingestade).
CREATE INDEX IF NOT EXISTS idx_legal_chunks_embedding_hnsw
ON public.legal_corpus_chunks
USING hnsw (embedding_vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE embedding_vector IS NOT NULL;
