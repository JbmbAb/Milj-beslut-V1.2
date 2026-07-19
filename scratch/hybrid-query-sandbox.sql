-- =============================================================================
-- hybrid-query-sandbox.sql
--
-- Bibliotek av hybrid SQL-frågor för miljöbeslut.se
-- Kombinerar: pgvector (semantik), PostgreSQL (matematik) och PostGIS (geografi)
--
-- Krav: pg_vector-extension måste vara aktiverat.
--       Kör "CREATE EXTENSION IF NOT EXISTS vector;" om det saknas.
--
-- Tabeller:
--   "DocumentRecord"       - Dokumentmetadata (kommun, ärendertyp, diarienr)
--   "DocumentChunk"        - Textsegment + pgvector-embeddings (embeddingJson)
--   krav_parametrar        - Extraherade gränsvärden med operator och enhet
--   extracted_requirements - Krav-text med kategori och juridisk referens
--   "Project"              - Projekt/ärenden som dokument är kopplade till
-- =============================================================================


-- =============================================================================
-- SEKTION 1: RENA SQL-MATEMATISKA FILTER (OFFLINE, INGEN VEKTOR BEHÖVS)
-- Dessa frågor kör 100% lokalt utan API-anrop.
-- =============================================================================

-- 1A. Visa alla PFAS-4-krav som är strängare än 0.2 µg/l
--     Exempelfall: "Vilka kommuner har satt hårdare PFAS-4 krav än Naturvårdsverkets riktvärde?"
SELECT
    kp.id,
    kp.gransvarde,
    kp."comparison_operator" AS operator,
    kp.enhet,
    kp."original_value"       AS original_text,
    kp."source_text"          AS exact_sentence,
    kp.confidence,
    kp."model_version",
    kp."processed_at",
    d.municipality,
    d."municipalityNormalized" AS municipality_normalized,
    d."decisionType",
    d."entryId"               AS case_number,
    d."receivedTime"          AS document_date,
    chunk."chunkIndex",
    chunk."chunkText"         AS chunk_preview
FROM krav_parametrar kp
JOIN "DocumentChunk" chunk ON chunk.id = kp."chunk_id"
JOIN "DocumentRecord" d    ON d.id = chunk."documentId"
WHERE
    kp."parameter_typ" = 'PFAS_4'
    AND kp.enhet = 'UG_L'
    AND kp."comparison_operator" IN ('LTE', 'LT')  -- "≤" eller "<"
    AND kp.gransvarde <= 0.2
ORDER BY kp.gransvarde ASC, d."receivedTime" DESC;


-- 1B. Kombinerat filter: Hitta beslut med PFAS-4 ≤ 0.1 µg/l OCH bly ≤ 50 mg/kg TS
--     Exempelfall: "Vilka ärenden har stränga krav på BÅDA PFAS och bly?"
SELECT DISTINCT
    d.id            AS document_id,
    d.municipality,
    d."entryId"     AS case_number,
    d."decisionType",
    d."receivedTime",
    pfas.gransvarde AS pfas4_limit,
    bly.gransvarde  AS bly_limit
FROM "DocumentRecord" d
JOIN "DocumentChunk" chunk  ON chunk."documentId" = d.id
JOIN krav_parametrar pfas   ON pfas."chunk_id" = chunk.id
    AND pfas."parameter_typ" = 'PFAS_4'
    AND pfas.enhet = 'UG_L'
    AND pfas.gransvarde <= 0.1
    AND pfas."comparison_operator" IN ('LTE', 'LT')
JOIN krav_parametrar bly    ON bly."chunk_id" = chunk.id
    AND bly."parameter_typ" = 'BLY'
    AND bly.enhet = 'MG_KG_TS'
    AND bly.gransvarde <= 50.0
    AND bly."comparison_operator" IN ('LTE', 'LT')
ORDER BY d."receivedTime" DESC;


-- 1C. Visa volymbegränsningar för schaktmassor > 5000 ton
--     Exempelfall: "Hitta alla tillstånd för storskalig schakthantering"
SELECT
    kp.gransvarde   AS max_volym_ton,
    kp."original_value",
    kp."source_text",
    d.municipality,
    d."entryId"     AS case_number,
    d."decisionType",
    d."activityCode",
    d."receivedTime"
FROM krav_parametrar kp
JOIN "DocumentChunk" chunk ON chunk.id = kp."chunk_id"
JOIN "DocumentRecord" d    ON d.id = chunk."documentId"
WHERE
    kp."parameter_typ" = 'VOLYM_SCHAKT'
    AND kp.enhet = 'TON'
    AND kp.gransvarde > 5000
ORDER BY kp.gransvarde DESC;


-- 1D. Statistik: Histogram över PFAS-4 gränsvärden per kommun
--     Exempelfall: "Visa kommunal spridning och strikthetsranking för PFAS-4 krav"
SELECT
    d."municipalityNormalized"    AS kommun,
    COUNT(DISTINCT d.id)          AS antal_dokument,
    MIN(kp.gransvarde)            AS strängaste_gräns,
    MAX(kp.gransvarde)            AS lättaste_gräns,
    ROUND(AVG(kp.gransvarde)::numeric, 4) AS medel_gräns,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY kp.gransvarde)::numeric, 4) AS median_gräns
FROM krav_parametrar kp
JOIN "DocumentChunk" chunk ON chunk.id = kp."chunk_id"
JOIN "DocumentRecord" d    ON d.id = chunk."documentId"
WHERE
    kp."parameter_typ" = 'PFAS_4'
    AND kp.enhet = 'UG_L'
    AND d."municipalityNormalized" IS NOT NULL
GROUP BY d."municipalityNormalized"
HAVING COUNT(*) > 0
ORDER BY MIN(kp.gransvarde) ASC;


-- =============================================================================
-- SEKTION 2: FULL-TEXT SPÅRBARHET (HUMAN-IN-THE-LOOP GRANSKNING)
-- Tillåter en handläggare att verifiera varje extraherat värde mot källtexten.
-- =============================================================================

-- 2A. Spårbarhet: Visa exakt varifrån ett gränsvärde kommer
--     Ger: originaldokument, exact mening, sida, extraherat av vilken modell
SELECT
    kp.id                           AS krav_id,
    kp."parameter_typ",
    kp."comparison_operator"        AS operator,
    kp.gransvarde,
    kp.enhet,
    kp."original_value"             AS llm_raw_string,
    kp."source_text"                AS exact_source_sentence,
    kp."page_number"                AS pdf_page,
    kp.confidence                   AS extraction_confidence,
    kp."model_version"              AS llm_model,
    kp."prompt_version"             AS prompt_used,
    kp."processed_at",
    chunk."chunkIndex",
    chunk."chunkText"               AS full_chunk,
    d."absolutePath"                AS pdf_source_path,
    d."entryId"                     AS case_number,
    d.municipality,
    d."receivedTime"
FROM krav_parametrar kp
JOIN "DocumentChunk" chunk ON chunk.id = kp."chunk_id"
JOIN "DocumentRecord" d    ON d.id = chunk."documentId"
WHERE kp.id = :krav_id  -- Ersätt :krav_id med faktiskt ID vid körning
;


-- 2B. Visa alla lågkonfidens-extraktioner som behöver manuell granskning
--     (confidence < 0.7 = bör verifieras av handläggare)
SELECT
    kp.id,
    kp."parameter_typ",
    kp.gransvarde,
    kp.enhet,
    kp."original_value",
    kp."source_text",
    kp.confidence,
    kp."model_version",
    d.municipality,
    d."entryId" AS case_number
FROM krav_parametrar kp
JOIN "DocumentChunk" chunk ON chunk.id = kp."chunk_id"
JOIN "DocumentRecord" d    ON d.id = chunk."documentId"
WHERE kp.confidence < 0.70
ORDER BY kp.confidence ASC
LIMIT 50;


-- =============================================================================
-- SEKTION 3: HYBRID SÖKNING (pgvector + SQL MATEMATIK)
-- OBS: Kräver att embeddingJson-kolumnen är konverterad till vector-typ.
-- Se SEKTION 5 för hur du aktiverar detta.
-- =============================================================================

-- 3A. Hybrid Sökning: Semantisk likhet + exakt PFAS-filter
--     Simulerar en användarsökning: "Miljöbeslut med PFAS-krav i Haninge"
--     Steg 1: Semantisk sökning hittar relevanta chunks
--     Steg 2: SQL-filtret säkerställer matematisk korrekthet
--
-- OBS: :query_embedding ersätts i appkoden med en pgvector-vektor genererad
--      av en embedding-modell (t.ex. text-embedding-004 eller nomic-embed-text).
SELECT
    d.id            AS document_id,
    d.municipality,
    d."entryId"     AS case_number,
    d."decisionType",
    d."receivedTime",
    chunk."chunkText"   AS relevant_passage,
    chunk."chunkIndex",
    kp."parameter_typ",
    kp.gransvarde,
    kp.enhet,
    kp."original_value",
    kp."source_text",
    -- Semantisk distans (lägre = mer relevant, 0 = identisk)
    (chunk."embeddingJson"::vector <=> :query_embedding::vector) AS semantic_distance
FROM "DocumentRecord" d
JOIN "DocumentChunk" chunk ON chunk."documentId" = d.id
JOIN krav_parametrar kp   ON kp."chunk_id" = chunk.id
WHERE
    -- 1. Kommunfilter (relationellt)
    d."municipalityNormalized" = 'Haninge'
    -- 2. Matematiskt PFAS-filter (exact SQL)
    AND kp."parameter_typ" = 'PFAS_4'
    AND kp.enhet = 'UG_L'
    AND kp.gransvarde <= 0.2
    AND kp."comparison_operator" IN ('LTE', 'LT')
    -- 3. Semantisk tröskel (cutoff för relevans: max 40% av max-distansen)
    AND (chunk."embeddingJson"::vector <=> :query_embedding::vector) < 0.40
ORDER BY semantic_distance ASC
LIMIT 10;


-- 3B. Rent semantisk sökning (utan matematikfilter), sorterat på likhet
--     Användbart för freetext-frågor: "Hur hanteras lakvatten i beslut?"
SELECT
    d.id,
    d.municipality,
    d."entryId" AS case_number,
    d."decisionType",
    d."receivedTime",
    chunk."chunkText",
    (chunk."embeddingJson"::vector <=> :query_embedding::vector) AS distance
FROM "DocumentRecord" d
JOIN "DocumentChunk" chunk ON chunk."documentId" = d.id
WHERE
    chunk."embeddingJson" IS NOT NULL
    AND (chunk."embeddingJson"::vector <=> :query_embedding::vector) < 0.35
ORDER BY distance ASC
LIMIT 10;


-- =============================================================================
-- SEKTION 4: KATEGORISKA AGGREGAT (RAPPORTERING)
-- =============================================================================

-- 4A. Vilka ämnen förekommer mest i gränsvärden?
SELECT
    kp."parameter_typ",
    kp.enhet,
    COUNT(*)                                  AS antal_krav,
    ROUND(AVG(kp.gransvarde)::numeric, 4)     AS medel,
    MIN(kp.gransvarde)                        AS min,
    MAX(kp.gransvarde)                        AS max,
    ROUND(AVG(kp.confidence)::numeric, 2)     AS medel_confidence
FROM krav_parametrar kp
GROUP BY kp."parameter_typ", kp.enhet
ORDER BY antal_krav DESC;


-- 4B. Täckningsgrad: Hur stor andel av chunks har extraherade parametrar?
SELECT
    COUNT(*)                                              AS total_chunks,
    COUNT(CASE WHEN kp.id IS NOT NULL THEN 1 END)         AS chunks_med_parametrar,
    COUNT(CASE WHEN kp.id IS NULL THEN 1 END)             AS chunks_utan_parametrar,
    ROUND(
        100.0 * COUNT(CASE WHEN kp.id IS NOT NULL THEN 1 END) / COUNT(*),
        1
    )                                                     AS pct_med_parametrar,
    SUM(CASE WHEN chunk."parameters_extracted" THEN 1 ELSE 0 END) AS chunks_bearbetade_av_llm
FROM "DocumentChunk" chunk
LEFT JOIN krav_parametrar kp ON kp."chunk_id" = chunk.id;


-- 4C. Exakt antal outestående chunks kvar att bearbeta i backfill-pipeline
SELECT
    COUNT(*) AS chunks_att_bearbeta
FROM "DocumentChunk"
WHERE "parameters_extracted" = false
  AND (
    LOWER("chunkText") LIKE '%pfas%' OR
    LOWER("chunkText") LIKE '%gränsvärde%' OR
    LOWER("chunkText") LIKE '%halt%' OR
    LOWER("chunkText") LIKE '%mg/kg%' OR
    LOWER("chunkText") LIKE '%µg/l%' OR
    LOWER("chunkText") LIKE '%ton%' OR
    LOWER("chunkText") LIKE '%buller%' OR
    LOWER("chunkText") LIKE '%riktvärde%'
  );


-- =============================================================================
-- SEKTION 5: SETUP & AKTIVERING AV VECTOR-EXTENSION
-- Kör en gång för att slå på pgvector och konvertera befintliga embeddings.
-- =============================================================================

-- 5A. Aktivera pgvector-extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 5B. Konvertera embeddingJson till en riktig vector-kolumn (om det behövs)
--     OBS: Kräver att dimensionen (1536) stämmer med din embedding-modell.
--     text-embedding-004 = 768 dim. text-embedding-3-small = 1536 dim.
--     Kontrollera din modell innan du kör!
--
-- ALTER TABLE "DocumentChunk"
--     ADD COLUMN IF NOT EXISTS embedding vector(1536);
--
-- UPDATE "DocumentChunk"
-- SET embedding = (
--     SELECT array_to_string(array_agg(value::text), ',')
--     FROM jsonb_array_elements("embeddingJson") AS v(value)
-- )::vector(1536)
-- WHERE "embeddingJson" IS NOT NULL;
--
-- CREATE INDEX IF NOT EXISTS idx_chunk_embedding_ivfflat
-- ON "DocumentChunk"
-- USING ivfflat (embedding vector_cosine_ops)
-- WITH (lists = 100);
