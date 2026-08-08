# RAG V2.2 — Hybrid Retrieval Pipeline

## Retrievalkedjan (komplett)

```
Inkommande sökfråga (query)
         │
         ▼
┌─────────────────────────────┐
│    LegalReferenceParser     │  Extraherar: lawName, chapter, paragraph,
│  (legalReferenceParser.ts)  │  subsection (första→"1"), item (tredje punkten→"3")
└─────────┬───────────────────┘
          │ ref (null om ingen hänvisning)
          │
          ├────────────────────────────────────────┐
          │ ref?.chapter + ref?.paragraph           │ ref?.lawName
          ▼                                         ▼
   ① Exact SQL                              ① Exact SQL (title ILIKE)
   (legal_corpus_chunks)                    (legal_corpus_records)
   B-tree: chapter + paragraph              LIMIT 20, k=30 (precision boost)
   LIMIT 20, k=30 (precision boost)
          │
          │ (parallellt med ① om ref saknas/alltid)
          │
          ├─────────────────────────────────────────────────────────┐
          │                                                          │
          ▼                                                          ▼
   ② FTS (GIN-index)                                       ③ Vector (HNSW)
   search_vector @@                                         embedding_vector <=>
   websearch_to_tsquery('swedish', query)                   query_embedding
   ts_rank_cd(search_vector, tsq)                           vector_cosine_ops
   LIMIT 30, k=60                                           LIMIT 30, k=60
          │                                                          │
          └──────────────────────┬──────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  Reciprocal Rank Fusion │
                    │  RRF(d) = Σ 1/(k+rank) │
                    │  k=30 för ① (2× boost) │
                    │  k=60 för ② och ③      │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  Deduplicera + top-5   │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  (Framtida) Cross-     │
                    │  encoder reranker      │
                    │  bi-encoder för top-N  │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   Gemini (generation)  │
                    │   Får top-5 som kontext│
                    └────────────────────────┘

Fallback om alla tre armar är tomma: LIKE-sök på title + case_number
```

## Retrievalarmarna

| Arm | Typ | Index | k (RRF) | Styrka | Svaghet |
|-----|-----|-------|---------|--------|---------|
| ① Exact SQL | Strukturerad | B-tree | 30 (2× boost) | Precision för kända lagrum | Kräver parser-match |
| ② FTS | Lexikal | GIN | 60 | Naturliga söktermer | Synonymer, stavning |
| ③ Vector | Semantisk | HNSW | 60 | Semantisk likhet | Hallucination-risk |

## HNSW-parametrar

```sql
-- Production-index (legal_corpus_chunks, partiellt):
CREATE INDEX idx_legal_chunks_embedding_hnsw
ON public.legal_corpus_chunks
USING hnsw (embedding_vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE embedding_vector IS NOT NULL;

-- ef_search per session (välj per användningsfall):
SET LOCAL hnsw.ef_search = 40;   -- snabb  (~2ms),  recall ~85%
SET LOCAL hnsw.ef_search = 100;  -- balans (~5ms),  recall ~95%  ← REKOMMENDERAT för RAG
SET LOCAL hnsw.ef_search = 200;  -- recall (~12ms), batchanalys
```

## GIN FTS-index

```sql
-- Partiellt GIN (exkluderar rader utan sökbar text):
CREATE INDEX idx_legal_corpus_search_vector_gin
ON public.legal_corpus_records
USING gin(search_vector)
WHERE search_text IS NOT NULL;

-- Trigger: beräknar search_vector ENDAST vid faktisk ändring av text/titel:
IF TG_OP = 'INSERT'
   OR NEW.search_text IS DISTINCT FROM OLD.search_text
   OR NEW.title      IS DISTINCT FROM OLD.title
THEN
  NEW.search_vector := to_tsvector('swedish', ...);
END IF;
```

## LegalReference-modellen (parsad ur query)

```typescript
interface LegalReference {
  lawName?:    string;  // "Miljöbalken"      (ur SFS-nr eller förkortning)
  chapter?:    string;  // "2"                ("2 kap.")
  paragraph?:  string;  // "6a"               ("6 a §", normaliserat)
  subsection?: string;  // "första"           ("första stycket")
  item?:       string;  // "3"                ("tredje punkten" → "3")
}
```

## Chunk-versionering

| Version | Chunkningslogik | Aktiv |
|---------|----------------|-------|
| v1 | Enkel styckeindelning (legacy) | Nej |
| v2.0 | Paragraf-aware för lagtext | Nej |
| v2.1 | Domstols-sektioner (DOMSKÄL/DOMSLUT) | Nej |
| v2.2 | Structure-aware + överlapp | Nej |
| **v2.3** | Boundary-aware overlap (`@miljobeslut/mps-chunking` text contract) | **Ja** |

Backfill-skriptet (`scripts/db/rechunk-legal-corpus.ts`) är idempotent:
hoppar automatiskt poster med aktuell `chunk_version`, DELETE+INSERT
i en transaktion för att undvika dubbletter.

## Backfill-flöde (idempotent)

```
Hämta records WHERE NOT EXISTS chunk WITH chunk_version = CURRENT_VERSION
         │
         ▼
routeToCorrectChunker(text, title, sourceSystem)
         │
         ├── sfs/riksdagen → chunkSwedishLaw()    (§-baserad)
         ├── domstol/möd  → chunkCourtDecision()  (sektionsbaserad)
         └── övrigt       → chunkStandard()       (styckebaserad)
         │
         ▼
$transaction([
  deleteMany({ recordId }),   ← radera ALLA gamla chunks
  ...createMany(newChunks)    ← skapa nya med CURRENT_VERSION
])
         │
         ▼
embedText(chunkText) per chunk → UPDATE embedding_vector
```
