-- ============================================================
-- Migration: GIN-index + betingad trigger för legal_corpus_records
-- RAG V2.2 — Fas 1
-- ============================================================

-- 1. Betingad trigger: beräkna search_vector ENDAST när search_text
--    eller title faktiskt ändras. Förhindrar onödig tsvector-beräkning
--    vid t.ex. uppdatering av timestamps.
CREATE OR REPLACE FUNCTION update_legal_corpus_search_vector()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.search_text IS DISTINCT FROM OLD.search_text
     OR NEW.title IS DISTINCT FROM OLD.title
  THEN
    NEW.search_vector := to_tsvector(
      'swedish',
      coalesce(NEW.search_text, '') || ' ' || coalesce(NEW.title, '')
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Idempotent: ta bort om den redan finns
DROP TRIGGER IF EXISTS trg_update_legal_search_vector ON public.legal_corpus_records;

CREATE TRIGGER trg_update_legal_search_vector
BEFORE INSERT OR UPDATE ON public.legal_corpus_records
FOR EACH ROW EXECUTE FUNCTION update_legal_corpus_search_vector();

-- 2. Backfill befintliga rader (engångskörning, idempotent)
UPDATE public.legal_corpus_records
SET search_vector = to_tsvector(
  'swedish',
  coalesce(search_text, '') || ' ' || coalesce(title, '')
)
WHERE search_vector IS NULL
  AND search_text IS NOT NULL;

-- 3. Partiellt GIN-index (exkluderar rader utan sökbar text,
--    reducerar indexstorlek och byggtid)
CREATE INDEX IF NOT EXISTS idx_legal_corpus_search_vector_gin
ON public.legal_corpus_records
USING gin(search_vector)
WHERE search_text IS NOT NULL;
