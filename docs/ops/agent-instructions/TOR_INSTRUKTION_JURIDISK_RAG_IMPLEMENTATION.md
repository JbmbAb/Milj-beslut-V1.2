# Tor: Instruktion för Juridisk RAG Chunking & Indexering

**AUTHORITY STATUS (2026-08-30, DOCUMENTATION_FINAL_NORMALIZATION):** `TASK_SCOPED` /
non-normative. The "SCHEMA-CONVERGENCE-SPEC 2026-08-11" section of this document was being cited
as `ADR:` by five production files despite this being a task-scoped agent instruction, not
architecture authority. That invariant is now formally extracted and superseded by
[ADR-LEGAL-CORPUS-IMPORT-GATE.md](../../architecture/ADR-LEGAL-CORPUS-IMPORT-GATE.md); production
code now references that ADR instead. This document is preserved as historical/operational record
of the implementation work (including a self-caught spec deviation, see "IMPLEMENTATION
2026-08-11" below) — it no longer functions as architecture authority for any code.

**Adressat:** Tor (Kodimplementör / Copilot Agent)  
**Projekt:** Juridisk RAG — Master Recovery  
**Timeline:** 3 veckor (efter Loke's harvest)  
**Scope:** Chunking, embedding, import EFTER att alla juridiska filer är arkiverade

---

## OVERVIEW: Din mission

Du skall bygga en **produktion-klar juridisk RAG-pipeline** för transformation:

1. ✅ Läsa juridiska arkivfiler (från Loke's harvest)
2. ✅ Parse juridisk struktur (kap→§→paragraf)  
3. ✅ Chunka atomärt (1 paragraf = 1 chunk, ALDRIG splittat på ords-count)
4. ✅ Embedda med Vertex AI (768-dim vectors)  
5. ✅ Importera till PostgreSQL/pgvector
6. ✅ Veckovis verifiering av completeness

---

## STATUS: VÄNTA PÅ LOKE

**Loke startar parallell harvest av ALL juridik DAY 1:**
- WORKER 1: SFS (~1000 filer)
- WORKER 2: Regulatory (~45 filer)
- WORKER 3: Municipal ABVA (~290 filer)
- WORKER 4: Court Decisions (~5000 filer)

**Du startar när Loke är färdig (~2 veckor).** Då är arkivet fyllt med raw juridiska dokument.

---

## PHASE 1: FÖRBEREDELSE — Vänta på Loke

Medan Loke harvester kan du förberedela:

1. ✅ Installera dependencies för chunking (`mps-chunking` package)
2. ✅ Testa Vertex AI embedding-service (`server/services/vertexEmbeddingService.ts`)
3. ✅ Skapa unit tests för LegalTextChunkingStrategy
4. ✅ Validera PostgreSQL schema (`legal_corpus_chunks` ready)

---

## PHASE 2: JURIDISK CHUNKING (Vecka 1 efter Loke)

### 3.1 — Implementera LegalTextChunkingStrategy

**File:** `packages/mps-chunking/src/strategies/LegalTextChunkingStrategy.ts`

```typescript
/**
 * Atomär juridisk chunking: Kap → Avsnitt → Paragraf
 * 
 * Input: Rawtext från en SFS (t.ex. Miljöbalken 1998:808)
 * 
 * Output: LegalChunk[] där varje chunk är en KOMPLETT paragraf
 * (aldrig splittad på ords-count)
 * 
 * Structure som parsas:
 * - 1 kap 1 § → Chapter 1, Paragraph 1
 * - Kap 34 Anläggning → Chapter 34, multiple paragraphs
 * - Underavsnitt (e.g., "Anläggningar för vattenöverföring") → Section
 */

export interface LegalChunk {
  fragment_id: string;              // "MB:34:1" eller "SFS-1998-808:34:1"
  source_record_id: string;         // Länk till LegalCorpusRecord.id
  chapter: number;
  section?: string;                 // Underavsnitt
  paragraph: string;                // "1", "2a", "3", etc
  title?: string;                   // "Anläggning", "Verksamhet"
  full_text: string;                // HELA paragrafen, ej splittat
  
  // Metadata för juridisk tolkning
  published_date: Date;
  last_amended?: Date;
  references_to: string[];          // Andra paragrafer denna hänvisar till (t.ex. ["34:2", "35:1"])
  case_citations: string[];         // MMD-domar som tolkat denna
  
  // Chunking metadata
  chunk_version: string;            // "v1.0" för reproduserbarhet
  content_hash: string;             // SHA256 för integrity check
  embedding_status: "PENDING" | "EMBEDDED" | "FAILED";
}

export class LegalTextChunkingStrategy implements ChunkingStrategy {
  async chunk(text: string, sourceId: string): Promise<LegalChunk[]> {
    // 1. Parse juridisk struktur
    const chapters = this.parseChapters(text);
    
    // 2. Extract paragrafer som atomär enhet
    const chunks: LegalChunk[] = [];
    for (const chapter of chapters) {
      for (const para of chapter.paragraphs) {
        chunks.push({
          fragment_id: `${sourceId}:${chapter.number}:${para.number}`,
          full_text: para.full_text,
          // ... rest
        });
      }
    }
    
    return chunks;
  }
  
  private parseChapters(text: string): Chapter[] {
    // Implementation: Regex/Parser för att identifiera:
    // - "1 kap" eller "Kap 1" → Chapter marker
    // - "1 §" eller "§ 1" → Paragraph marker
    // - Text mellan markers → Paragraph content
  }
}
```

**Checklist:**
- [ ] Parse svenska juridiska markörer (kap, §, etc)
- [ ] Handle edge cases (undantag, bilagor, övergångsregler)
- [ ] Extract internal references (§ 2, 34 kap 1 §)
- [ ] Unit tests med verklig Miljöbalken
- [ ] Validate chunk_version consistency

---

### 3.2 — Implementera CourtDecisionChunkingStrategy

**File:** `packages/mps-chunking/src/strategies/CourtDecisionChunkingStrategy.ts`

Liknande som LegalTextChunkingStrategy men för domstolsbeslut:

```typescript
export interface PrecedentChunk {
  fragment_id: string;              // "MMD-2024-123:1"
  case_id: string;                  // "T 2024:123"
  court: string;                    // "Mark- och miljödomstolen"
  judgement_date: Date;
  legal_issue: string;              // "Klassificering av PFAS"
  relevant_laws: string[];          // Vilka paragrafer som tolkats
  reasoning: string;                // Domstolens motivering
  precedent_impact: string;         // "Ändrar tolkningen av MB 10 kap 1 §"
  // ... rest
}
```

---

## PHASE 4: MANIFEST-DRIVEN PIPELINE (Vecka 3–4)

### 4.1 — Implementera DocumentIngestionEngine

**File:** `scripts/import/run-document-ingestion-engine.ts`

```typescript
/**
 * Huvudorkestrering för juridisk RAG:
 * 
 * DocumentInventoryManifest
 *   ↓
 * FOR EACH document IN manifest WHERE status = 'PENDING':
 *   ├─ TextExtractionWorker
 *   │   └─ Output: rawText, extractionStats
 *   │
 *   ├─ ChunkingEngine (välj strategy baserat på document_type)
 *   │   ├─ IF 'legal_statute' → LegalTextChunkingStrategy
 *   │   ├─ IF 'court_decision' → CourtDecisionChunkingStrategy
 *   │   └─ IF 'municipal_rule' → LegalTextChunkingStrategy
 *   │
 *   ├─ VectorEmbeddingWorker (Vertex AI)
 *   │   └─ Output: chunks[], each with embedding_vector
 *   │
 *   └─ PostgreSQL Import
 *       ├─ INSERT INTO legal_corpus_chunks
 *       └─ UPDATE manifest: status = 'INDEXED'
 */

class DocumentIngestionEngine {
  async process(manifestPath: string): Promise<void> {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    
    for (const doc of manifest.documents) {
      if (doc.status !== 'PENDING') continue;
      
      try {
        // 1. Extract
        const rawText = await this.extractText(doc);
        
        // 2. Chunk
        const strategy = this.selectStrategy(doc.document_type);
        const chunks = await strategy.chunk(rawText, doc.document_id);
        
        // 3. Embed
        const embeddings = await this.embedChunks(chunks);
        
        // 4. Import
        await this.importToPostgres(embeddings, doc.source_archive_path);
        
        // 5. Mark done
        doc.status = 'INDEXED';
        doc.indexed_at = new Date();
      } catch (err) {
        doc.status = 'FAILED';
        doc.error = err.message;
      }
    }
    
    // Update manifest
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
}

await new DocumentIngestionEngine().process(
  'storage/manifests/document-inventory-manifest.json'
);
```

**Checklist:**
- [ ] TextExtractionWorker (PDF → text, handles OCR)
- [ ] ChunkingEngine (router för rätt strategy)
- [ ] VectorEmbeddingWorker (calls vertexEmbeddingService.ts)
- [ ] PostgreSQL import (INSERT + indexing)
- [ ] Error handling + resume capability
- [ ] Progress logging

---

### 4.2 — Integrera Vertex AI embedding

**File:** `server/services/vertexEmbeddingService.ts` (redan finns, bara integrera)

```typescript
import { vertexAI } from './vertexAiService';

export async function embedLegalChunks(chunks: LegalChunk[]): Promise<LegalChunk[]> {
  for (const chunk of chunks) {
    try {
      const embedding = await vertexAI.predict({
        instances: [{ content: chunk.full_text }],
        parameters: { dimension: 768 },
      });
      
      chunk.embedding_vector = embedding.predictions[0].embeddings[0].values;
      chunk.embedding_status = 'EMBEDDED';
    } catch (err) {
      chunk.embedding_status = 'FAILED';
    }
  }
  return chunks;
}
```

**Checklist:**
- [ ] Batch embedding (efficient API usage)
- [ ] Error handling (timeout, quota)
- [ ] Retry logic
- [ ] Cost tracking (logging)

---

## PHASE 5: CONTINUOUS SYNC (Vecka 3, + veckovis verifiering)

### 5.1 — Implementera Weekly Verification Loop

**File:** `scripts/import/verify-juridisk-completeness.ts`

```typescript
/**
 * Veckovis verifiering av juridisk RAG-completeness.
 * 
 * Körs varje tisdag 09:00 (via cron eller manual trigger).
 * 
 * Rapporterar:
 * 1. Total chunks indexed
 * 2. Total embeddings created
 * 3. Coverage per domain (FOUNDATION, REGULATORY, MUNICIPAL, PRECEDENT)
 * 4. Missing sources (scannar arkiv vs RAG)
 * 5. Failed imports (errors to retry)
 */

interface CompletenessReport {
  report_date: Date;
  total_chunks: number;
  total_embeddings: number;
  coverage_percent: number;
  domain_breakdown: {
    FOUNDATION: { chunks: number; coverage: number };
    REGULATORY: { chunks: number; coverage: number };
    MUNICIPAL: { chunks: number; coverage: number };
    PRECEDENT: { chunks: number; coverage: number };
  };
  missing_sources: string[];        // Filer i arkiv som INTE är indexerade
  failed_imports: string[];         // Chunks som failed embedding
  status: "COMPLETE" | "IN_PROGRESS" | "BLOCKED";
  next_actions: string[];
}

async function verifyCompleteness(): Promise<CompletenessReport> {
  // 1. Count chunks & embeddings from PostgreSQL
  const totalChunks = await db.query('SELECT COUNT(*) FROM legal_corpus_chunks');
  const totalEmbeddings = await db.query(
    'SELECT COUNT(*) FROM legal_corpus_chunks WHERE embedding_vector IS NOT NULL'
  );
  
  // 2. Scan arkiv för alla juridiska filer
  const archivedFiles = await scanArchive('GEO_Master_Archive/Documents/Sources/');
  
  // 3. Find delta: arkiverade filer som INTE är i RAG
  const missingInRag = findMissing(archivedFiles, totalChunks);
  
  // 4. Find problematic chunks (failed embeddings, etc)
  const failedImports = await db.query(
    'SELECT source_path FROM legal_corpus_chunks WHERE embedding_vector IS NULL'
  );
  
  // 5. Calculate coverage percent
  const coveragePercent = (totalEmbeddings / archivedFiles.length) * 100;
  
  return {
    report_date: new Date(),
    total_chunks: totalChunks,
    total_embeddings: totalEmbeddings,
    coverage_percent: coveragePercent,
    // ... rest
    status: coveragePercent === 100 ? "COMPLETE" : "IN_PROGRESS",
  };
}

// Run weekly & log results
const report = await verifyCompleteness();
console.log(`📊 Juridisk RAG Completeness: ${report.coverage_percent.toFixed(1)}%`);

if (report.status === "COMPLETE") {
  console.log('✅ 100% JURIDISK TÄCKNING UPPNÅDD!');
} else if (report.missing_sources.length > 0) {
  console.log(`⚠️ ${report.missing_sources.length} sources kvar att indexera`);
  console.log('Next week actions:', report.next_actions);
}

// Save report to archive
fs.writeFileSync(
  `storage/reports/juridisk-completeness-${new Date().toISOString().split('T')[0]}.json`,
  JSON.stringify(report, null, 2)
);
```

**Checklist:**
- [ ] PostgreSQL queries för stats
- [ ] Arkiv-scanning (efficiently)
- [ ] Delta detection (missing sources)
- [ ] Weekly cron trigger
- [ ] Report generation & archival
- [ ] Slack/email notification på status

---

## PHASE 6: TESTING & VALIDATION (Kontinuerligt)

### 6.1 — Unit tests för chunking

**File:** `tests/unit/LegalTextChunkingStrategy.test.ts`

```typescript
describe('LegalTextChunkingStrategy', () => {
  it('parses Miljöbalken kap:§ structure correctly', () => {
    const text = `
      34 kap
      Anläggning
      
      1 § Denna kapitel gäller för anläggningar...
      
      2 § Kommun skall...
    `;
    
    const chunks = strategy.chunk(text, 'sfs:1998:808');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].chapter).toBe(34);
    expect(chunks[0].paragraph).toBe('1');
    expect(chunks[1].paragraph).toBe('2');
  });
  
  it('preserves full paragraph text without word-count splitting', () => {
    // Verify chunk.full_text is complete, not truncated
  });
  
  it('handles edge cases: undantag, övergångsregler', () => {
    // Test complex legal structures
  });
});
```

### 6.2 — Integration tests

Test the full pipeline:
- Harvest → Chunk → Embed → Import → Query

### 6.3 — Validation queries (PostgreSQL)

```sql
-- Verify all chunks imported
SELECT COUNT(*) as total_chunks FROM legal_corpus_chunks;

-- Verify embeddings present
SELECT COUNT(*) as embedded_chunks FROM legal_corpus_chunks 
WHERE embedding_vector IS NOT NULL;

-- Sample search test
SELECT * FROM legal_corpus_chunks 
WHERE to_tsvector('swedish', chunk_text) @@ plainto_tsquery('swedish', 'anläggning')
LIMIT 5;
```

---

## DELIVERABLES & MILESTONES

| Vecka | Milestone | Deliverable |
|-------|-----------|-------------|
| 0 (Parallell) | Loke harvester | `storage/manifests/harvest-summary-*.json` + ~6350 arkivfiler |
| 1 | Juridisk chunking | LegalTextChunkingStrategy implementerad + testad |
| 2 | Manifest-driven ETL | DocumentIngestionEngine + 50k chunks indexed |
| 3 | Embedding + Import | 100% chunks embeddat + pgvector indexed |
| 4+ | Weekly verification | Coverage 100% + veckovis uppdateringar

---

## SUCCESS CRITERIA

✅ **Genomfört när:**

1. `SELECT COUNT(*) FROM legal_corpus_chunks;` → **> 50,000 chunks** ✅
2. `SELECT COUNT(*) FROM legal_corpus_chunks WHERE embedding_vector IS NOT NULL;` → **> 50,000** ✅
3. **Coverage 100%:** Alla arkiverade juridiska filer är indexerade + embeddat
4. Veckovis verifiering visar 0 missing sources
5. RAG-sökningar returnerar relevanta juridiska fragment (manuell test)
6. Zero "enskilda avlopp"-innehål i indexed chunks
7. **Juridisk RAG är LOCKED** (uppdateringar bara veckovis efter detta)

---

## Tor: Nästa steg?

**Vänta på Mimer Bibliotekarie's arkiv-sanering** (running now, ~15 min).

**Sedan startar du PHASE 2** med harvesting-pipelinen.

Du får instruktioner närhelst du är redo.

---

## ÅTAGANDE-UPPDATERING 2026-08-11 — utökat, kontraktsstyrt scope (ersätter/utökar ovanstående)

**Status:** Charterrevision, inte en ny implementation. Skriven efter governance-granskningen
av harvest/promotion-kedjan (se `docs/architecture/GAP-REPORT-harvest-governance-2026-08-10.md`)
— den granskningen visade upprepade gånger att governance-liknande mekanismer (hash, signatur,
"godkännande") existerat i kod utan att faktiskt vara bindande eller verifierade. Denna
uppdatering gör explicit att samma disciplin gäller för Sonnet/Tors hela pipeline-åtagande, inte
bara promotion-vägen.

**Rollfördelning:** Jimmy äger kontroll, revision och arkitekturlåsning. Sonnet/Tor äger
implementering av datapipeline och bevisbara moduler — men äger också provenance, tester,
manifest, approval gates och failure handling. Det räcker inte att bygga pipelinen; den måste
kunna bevisas.

Scope utökas från "nedladdningspipeline, chunkning, arkivering, sortering" till:

**1. Ingestion** — nedladdning, retry/idempotens, manifest per källa, checksum före och efter
lagring, inga tysta bortfall (ett fel som sväljs utan att synas i manifestet räknas som brutet
kontrakt).

**2. Chunkning** — deterministisk chunkning, stabil chunk-id (samma indata ska alltid ge samma
id, inte bara samma innehåll), källcitat och sid-/positionreferens per chunk, versionerad
chunk-policy (ändrad policy ska vara spårbar, inte tyst appliceras retroaktivt på gamla
chunkar).

**3. Arkivering** — raw archive först, WORM/CAS efter verifiering (aldrig direkt till CAS, se
redan etablerat mönster i `packages/mimers-brunn-core`), quarantine vid osäkerhet, ingen
radering av källa utan explicit policy.

**4. Sortering och klassificering** — källa, rättsområde, dokumenttyp, kommun, datum, myndighet.
Klassificering får INTE filtrera bort källor som "irrelevanta" utan manifest-spår — en
bortsorterad post ska synas i manifestet med skäl, inte bara försvinna.

**5. Provenance** — varje artefakt ska ha ursprung, hämtningstid, källa, hash, pipeline-version.
Alla transformationer ska vara reproducerbara (samma indata + samma pipeline-version ⇒ samma
utdata, deterministiskt).

**6. Approval gate** — import till canonical corpus kräver godkännande. Godkännandet ska vara
signerat/bundet, inte bara ett fält i JSON — samma disciplin som redan bevisad i
`QuarantinePromoter.promote()`s 7-stegs bindningskontroll (Level 2, PROVEN 2026-08-11): en
sträng som påstår "vem godkände" räknas inte som bevis. Human-in-the-loop ska vara explicit,
inte implicit i att ett skript kördes.

**7. Test och bevis** — unit-test för parser/chunker, integrationstest för pipeline, negativa
tester (trasig hash, saknad källa, ändrad fil, duplicate, fel schema), Windows-verifiering
innan något får kallas PROVEN. Samma status-disciplin som redan etablerad i denna session:
IMPLEMENTERAD ≠ PROVEN förrän en faktisk körning på Windows bekräftat grönt, med testräkningen
verifierad mot antalet skrivna `it()`-block — inte bara "exit code 0".

**8. Arkitekturdisciplin** — ingen ny kod i monolit; nya moduler under `packages`, `services`
eller en tydlig modulstruktur. Inga nya parallella authority-modeller — governance-granskningen
hittade redan minst fyra oberoende "vem godkände detta"-mekanismer i repot
(`mps-data-governance`, `mimers-brunn-core`, `mps-lu`, den hårdkodade `SOURCE_REGISTRY`); en
femte får inte tillkomma för RAG-pipelinen. Återanvänd Mimers Brunn-signing/attestation
(`createArtifactAttestation`/`verifyArtifactAttestation`/`LocalPemSigningKeyProvider`) där
authority faktiskt behövs, istället för att uppfinna en ny mekanism per modul.

**Vad detta ändrar konkret jämfört med PHASE 1–6 ovan:** de tidigare skisserna
(`DocumentIngestionEngine`, `LegalTextChunkingStrategy` m.fl.) är fortfarande rimliga som
teknisk utgångspunkt, men saknar genomgående: signerade approval-artefakter (skissen har bara
`doc.status = 'INDEXED'`, ett fritt strängfält utan bindning), manifest-spår för bortsorterat
material, och explicita negativa tester. Innan implementation av nästa fas påbörjas ska ett
kort kontrakt/schema skrivas för minst approval-gate och provenance-fälten (samma
"spec-innan-kod"-disciplin som redan använts för Level 2 och registry-convergence), inte
implementeras direkt mot den äldre skissen.

**Denna spec ges nedan.** Den ersätter styrande, där de krockar, delar av PHASE 1–6 ovan (i
synnerhet 4.1 `DocumentIngestionEngine`s `doc.status = 'INDEXED'`-mönster). Den historiska
skissen raderas inte — den är kvar som teknisk utgångspunkt för extraktion/embedding-delarna,
som inte är auktoritetsbärande och inte berörs av denna spec.

---

## SCHEMA-CONVERGENCE-SPEC 2026-08-11 — Juridisk ingestion: approval & provenance

**Status: IMPLEMENTERAD 2026-08-11, väntar på Windows-bevis.** Kod skriven exakt mot denna
spec, negativa tester först — se "IMPLEMENTATION 2026-08-11" längst ned i detta avsnitt för
var koden ligger och vad som återstår innan PROVEN. Styr
implementationen av corpus-import-steget i `DocumentIngestionEngine`/
`LegalTextChunkingStrategy`. Återanvänder exakt samma mekanism som redan PROVEN i
promotion-spåret (`QuarantinePromoter.promote()`, Level 2) och specad i
registry-convergence-spåret (`SourceRegistryArtifactV2`) — ingen ny auktoritetsmodell för
juridisk RAG, per Arkitekturdisciplin-punkten ovan.

**Två steg, en gräns:** råmaterialet är redan governat via Loke/karantän-spåret (rör inte
det här). Det denna spec gäller är gränsen mellan bearbetning (extraktion, chunkning,
embedding — inte auktoritativt, kan göras om) och den kanoniska corpusen
(`legal_corpus_chunks`/pgvector — auktoritativ, sökbar, det LU:s RAG faktiskt svarar utifrån).
**Approval-gaten sitter vid den gränsen, inte tidigare.**

### 1. Vilket artifact godkänner ingestion/chunking

`LegalCorpusImportAttestationPredicate` — signerad predikat i en `ArtifactAttestation`
(`createArtifactAttestation`/`verifyArtifactAttestation`, samma som redan används):

```
{
  action: "legal.corpus.import"        // domänseparerar från promotion-/source-approval-attestationer
  document_id: string                  // stabilt id, binder till RawSourceArtifact
  source_content_hash: string          // hash av den råtext chunkningen utgick från
  chunk_set_content_hash: string       // hash av HELA den deterministiska, kanoniserade
                                        // chunk-arrayen (fragment_id + full_text + strukturfält
                                        // — INTE embedding_vector, som är en separat, ombäraknelig
                                        // projektion, se "Vad detta INTE täcker" nedan)
  pipeline_version: string             // kod-/pipelineversion (extraktion + chunkning)
  chunk_policy_version: string         // policyversion, separat från pipeline_version — kan
                                        // ändras utan kodändring (charter-punkt 2)
  approver_actor_id: string
  approver_role: "GOVERNANCE_REVIEWER"
  attestation_schema_version: number
  signer_key_id: string
}
```

`subjectDigest = sha256:<chunk_set_content_hash>`. Egen `key_id`/signeringsnyckel, separat
blast radius från promotion- och harvest-plan-nycklarna (samma princip som redan etablerad).

Detta skärper den äldre `LegalChunk`-skissen (PHASE 2 ovan) snarare än att motsäga den:
skissens per-chunk `content_hash`/`chunk_version` blir byggstenar i `chunk_set_content_hash`
(hash över den kanoniserade arrayen av alla chunkar för ett dokument), och `chunk_version`
delas upp i `pipeline_version` + `chunk_policy_version` eftersom de kan ändras oberoende av
varandra.

**Precisering (låst 2026-08-11): `chunk_set_content_hash`s ordning och exakthet.**
Samma chunkmängd i annan array-ordning FÅR INTE ge samma identitet av en slump, men den
ordning som används måste vara deterministisk och återskapbar — inte "vilken ordning
databasen råkar returnera raderna i". Konkret:

1. Chunkarna sorteras med en explicit, deterministisk komparator INNAN serialisering:
   `(chapter, paragraph)` där `paragraph` jämförs numeriskt-medvetet (inte naiv
   strängsortering — "34:10" ska inte hamna före "34:2"), med `fragment_id` som sista,
   entydiga tiebreak. Denna sorteringsfunktion är själv en del av `pipeline_version`s
   kontrakt: om sorteringslogiken ändras räknas det som en pipeline-ändring.
2. `canonicalizeStrict` (RFC 8785) kanoniserar objektnycklars ordning inom varje chunk, men
   **kanoniserar inte array-elementens ordning** — array-ordningen måste alltså vara korrekt
   redan innan `canonicalizeStrict` anropas; den är inte ett skyddsnät för detta.
3. Endast identitetsbärande fält ingår i det som hashas per chunk: `fragment_id`,
   `chapter`, `section`, `paragraph`, `title`, `full_text`, `references_to`,
   `case_citations`, `chunk_policy_version`. **`embedding_status`/`embedding_vector` och alla
   tidsstämplar (t.ex. `processed_at`) exkluderas uttryckligen** — samma regel som redan
   gäller i `mps-core/src/types.ts`: *"Timestamps SHALL NOT participate in canonical
   identity, hashing, signing, or replay equality."* Återanvänd regeln, uppfinn den inte på
   nytt för denna domän.
4. `chunk_set_content_hash = sha256(canonicalizeStrict(orderedChunkArray))` — och
   verifieringen (steg "verify all bindings" i sekvensen nedan) MÅSTE återskapa exakt samma
   bytes genom att köra samma sorteringsfunktion + samma fältutdrag + samma
   `canonicalizeStrict`-anrop, inte en löst "motsvarande" jämförelse. Om verifieringskoden
   och skapandekoden divergerar (t.ex. olika sorteringsimplementationer på två ställen)
   är hela bindningen värdelös trots att båda "ser rätt ut" var för sig.

### 2. Provenance som krävs även för bortfiltrerat material

`IngestionManifestEntry` — **en post krävs för varje råtdokument pipelinen någonsin
tittar på, oavsett utfall:**

```
{
  document_id: string
  source_manifest_ref: ContentReference          // → RawSourceArtifact (Loke/karantän)
  status: "PENDING" | "INGESTED" | "FILTERED_OUT" | "FAILED"
  classification: { legal_area?, document_type?, municipality?, date?, authority? }
  content_hash: string                            // hash av extraherad råtext — finns även vid FILTERED_OUT
  pipeline_version: string
  processed_at: string                            // ISO 8601
  filtered_reason?: string                        // KRÄVS om status === FILTERED_OUT, annars förbjudet
  corpus_import_attestation_ref?: ContentReference // KRÄVS om status === INGESTED, annars förbjudet
}
```

**Fristående kontraktsbrott**, oberoende av vilken skrivväg som anropades: (a) ett
råtdokument utan någon manifest-post alls, (b) `FILTERED_OUT` utan `filtered_reason`, (c)
`INGESTED` utan `corpus_import_attestation_ref`. Detta är en fullständighets-invariant som
kontrolleras genom skanning av manifestet, inte bara genom skrivvägens egen logik — en tyst
bortsorterad källa ska vara upptäckbar utan att behöva lita på att skrivkoden gjorde rätt.

**Precisering (låst 2026-08-11): manifest completeness är en PRE-WRITE-grind, inte en
efterhandsaudit.** Fullständighetsskanningen i negativt test #6 nedan är inte bara ett
kontinuerligt/schemalagt revisionsverktyg — den är en obligatorisk del av själva
skrivsekvensen för en ingestion-körning (batch), och måste passera i sin helhet för HELA
körningens manifest innan den första raden skrivs till `legal_corpus_chunks` för NÅGOT
dokument i den körningen. Se den reviderade operativa sekvensen nedan — annars kan ett
partiellt auktoritativt corpus uppstå om skrivning hinner ske för dokument 1–N innan ett
fullständighetsproblem för dokument N+1 upptäcks.

### 3. Negativa tester som krävs

Samma disciplin som Level 2, anpassad till denna domän:

1. Direktanrop till corpus-import-funktionen utan/med ogiltig attestation → avvisas, noll
   rader skrivna till `legal_corpus_chunks`.
2. Giltigt signerad attestation för dokument A:s chunk-set återanvänd för att importera
   dokument B:s chunkar → avvisas (`document_id`/`chunk_set_content_hash`-bindning).
3. Attestation skapad för en annan `action` återanvänd som `legal.corpus.import` → avvisas.
4. Chunk-set omkört med en ANNAN `pipeline_version`/`chunk_policy_version` än den
   attestationen signerades mot → avvisas (den domänspecifika risken här: policy-drift eller
   icke-determinism i chunkningen, inte bara innehållsmanipulation).
5. `chunk_set_content_hash` i attestationen matchar inte en färsk hash av det som faktiskt
   ska skrivas → avvisas före första DB-skrivning.
6. Manifest-fullständighetsskanning: ett råtdokument i arkivet/karantänen utan
   manifest-post, eller en `FILTERED_OUT`-post utan `filtered_reason`, eller en
   `INGESTED`-post utan `corpus_import_attestation_ref` → flaggas som kontraktsbrott. Detta
   är en batch-nivå-kontroll, körd som del av det enda grindbeslutet före körningens första
   corpus-skrivning (se operativ sekvens nedan) — inte en löst kopplad, schemalagd
   efterhandsaudit, och inte bara en per-dokuments/per-anrops-grind.

### Den explicita invarianten — operativ sekvens (låst 2026-08-11)

En ingestion-körning behandlas som en batch med ETT gemensamt grindbeslut, inte som N
oberoende dokument som var för sig springer förbi grinden mot corpusen:

```
raw docs (redan governat — Loke/karantän-spåret, rörs inte här)
        │
        ▼
deterministic processing  (extraktion + chunkning, pipeline_version + chunk_policy_version
        │                  bundna, ordnad chunk-array per §1-preciseringen ovan)
        ▼
complete manifest  (EN manifest-post per dokument i körningen, oavsett utfall — hela
        │           batchens manifest färdigskrivet innan nästa steg)
        ▼
chunk-set canonicalization/hash  (chunk_set_content_hash per dokument, exakt de bytes
        │                         som senare återskapas vid verifiering)
        ▼
signed import attestation  (per dokument som ska in i corpusen — FILTERED_OUT-dokument
        │                    får ingen, och behöver ingen)
        ▼
verify ALL bindings + manifest completeness  — EN grind, körd EN gång för hela batchen:
        │    • varje attestation: signatur + document_id + chunk_set_content_hash +
        │      pipeline_version + chunk_policy_version + approver-fält
        │    • hela batchens manifest: fullständighetsskanning (negativt test #6) —
        │      körs HÄR, före första skrivning, inte som schemalagd efterhandsaudit
        ▼
        [ single gate — allt ovan måste passera i sin helhet ]
        ▼
corpus write  (legal_corpus_chunks — först nu, för samtliga godkända dokument i batchen)
```

**Uttryckligen förbjudet:** `process → skriv några chunkar → upptäck manifest-/
attestationsproblem`. Om verifieringen av dokument N+1 misslyckas efter att dokument 1–N
redan skrivits till corpusen har grinden redan brutits, oavsett om enskilda attestationer
för 1–N var giltiga. Skrivningen till `legal_corpus_chunks` för en batch sker antingen i sin
helhet efter en passerad batch-grind, eller inte alls för den körningen.

**Formell invariant:** Ingen pipeline-output når ett auktoritativt/sökbart lager (kanonisk
corpus) om inte dess approval- och provenance-kedja verifierar fullständigt — signatur
giltig, varje bindningsfält kontrollerat, manifestets fullständighet bekräftad för hela
batchen — och detta sker **före**, inte efter, den första skrivningen. Samma princip som
redan bevisad i `QuarantinePromoter.promote()` (Level 2, PROVEN) och specad för
`SourceRegistryArtifactV2`/`HarvestPlan` (registry-convergence) — återanvänd här, inte
återuppfunnen.

### Vad detta INTE täcker (explicit, per samma scope-disciplin)

`embedding_vector` är inte del av chunk-identiteten/hashen — embeddings är en separat,
omberäkningsbar projektion; en ny embedding-modellversion kräver inte nytt godkännande av
det underliggande chunk-innehållet (men bör bumpa ett eget `embedding_version`-fält, utanför
scope här). Individuella per-reviewer-nycklar, nyckelrotation, UI, chunking-kvalitetsoptimering
och fler käll-adaptrar — allt uttryckligen efter att denna grind är fryst, inte innan.

### IMPLEMENTATION 2026-08-11 — CorpusImportGate, väntar på Windows-bevis

Ny, fristående paket `packages/mps-legal-corpus` (`ChunkIdentity.ts`,
`CorpusImportAttestation.ts`, `IngestionManifest.ts`, `CorpusImportGate.ts`, `index.ts`) plus
`server/security/legalCorpusSigningKey.ts` (egen nyckel/env-block, separat blast radius från
governance-/harvest-plan-nycklarna). Storage-agnostisk — `ManifestStore`/`CorpusWriter`
injiceras, ingen Postgres-kod skriven än (medvetet: pipelinen/embeddings rörs inte förrän
denna grind är PROVEN). Wired in i `vitest.config.ts` (alias + compliance-projektets
test-include) och `tsconfig.json` (paths) — annars hade paketets tester aldrig upptäckts.

**En korrigering upptäckt och fixad under implementationen, värd att notera:** mitt eget
utkast till preciseringen "samma chunks i annan ordning får inte ge samma identitet"
implementerades först FEL — en tyst intern omsortering innan hashning hade gjort precis det
motsatta av vad som krävdes (två olika array-ordningar av samma chunkar hade fått samma hash).
Korrigerat: `computeChunkSetContentHash` sorterar inte längre internt — den KRÄVER att
indata redan är i kanonisk ordning och kastar `ChunkOrderError` annars.
`orderChunksDeterministically` finns kvar som en explicit funktion för producenter (pipeline,
tester) att anropa själva innan hashning. Detta är en självupptäckt och självrättad avvikelse
från specen, inte en avvikelse som lämnats kvar.

**Testtäckning** (`packages/mps-legal-corpus/tests/CorpusImportGate.test.ts`, negativa tester
skrivna först): alla 6 begärda negativa fall (bypass/ogiltig attestation, artefaktsubstitution,
action-substitution, pipeline/policy-drift, content-hash-tamper, manifest-completeness),
båda låsta preciseringarna som egna testgrupper (order-sensitivitet — inklusive ett explicit
bevis på att omsortering till kanonisk ordning reproducerar EXAKT samma hash, samt
numerisk-medveten paragrafsortering "34:10" efter "34:2" — samt pre-write-batch-gaten, bevisad
med två separata scenarier: en manifest-inkomplett batch och en binding-ogiltig batch, båda
med noll skrivningar även för det annars giltiga dokumentet i samma batch), en bonus-nyckeltest
(fel signeringsnyckel), och en lycklig väg (två dokument, plus ett FILTERED_OUT-dokument med
korrekt `filtered_reason` som inte blockerar resten av batchen).

**Verifiering i denna sandbox:** `vitest` kan inte köras här (samma
`@rollup/rollup-linux-x64-gnu`-native-binary-begränsning som tidigare, opåverkad av denna
kod). En ad hoc `tsc --noEmit` mot samtliga nya/ändrade filer gav noll typfel efter en fixad
regression (`readonly string[].sort()` i ett testfall, bytt mot `[...array].sort()`).

**Väntar på:** faktisk `vitest run packages/mps-legal-corpus/tests/CorpusImportGate.test.ts`
på Windows för PROVEN-status — samma disciplin som redan krävts för PR 1/2/containment/Level 2.

### VERIFIERINGSPASS 2026-08-11 — fyra kontrollpunkter före Windows-körning

Utfört på begäran innan Windows-körning, ingen ny funktionalitet tillagd:

1. **Testupptäckt.** Exakt antal `it()`-block i filen räknat direkt: **18** (inte 15 — tidigare
   löpande uppskattning var fel, detta är den siffra som ska stämmas av mot Windows-rapporten).
   10 `describe`-block. Filen matchar globmönstret
   `packages/mps-legal-corpus/**/*.test.ts` som redan låg i `vitest.config.ts`s
   `compliance`-projekts `test.include` (rad 237) — bekräftat genom läsning, inte antagande.
2. **Alias-upplösning i `compliance`-projektet.** `compliance`-projektet hade sedan tidigare
   sina EGNA `resolve.alias`-overrides för `spatial-provider-postgis`/`mps-lu`/`mps-runtime`
   trots att dessa redan fanns på rot-nivå — ett faktiskt observerat tecken på att rot-nivåns
   `resolve.alias` inte pålitligt når in i vitest `projects`-poster i den här uppsättningen.
   Åtgärdat defensivt: lade till `@miljobeslut/mimers-brunn-core`, `@miljobeslut/mps-core` och
   `@miljobeslut/mps-legal-corpus` explicit i `compliance`-projektets egen `resolve.alias`,
   med kommentar om varför. Inläst igen efter ändring för att bekräfta att den landade
   syntaktiskt korrekt.
3. **Zero-write-mätning.** Grep bekräftar 11 separata anrop av
   `expect(writer.writes).toHaveLength(0)` direkt mot `RecordingCorpusWriter`-mocken i varje
   negativt testfall — inte enbart slutsats dragen från returvärde eller kastat fel.
4. **Äkta separat signeringsnyckel.** Testet "rejects an attestation validly signed by a
   non-governance key" genererar ett verkligt, oberoende Ed25519-nyckelpar via
   `LocalPemSigningKeyProvider.generate('ed25519:not-the-legal-corpus-key')` och signerar
   attestationen med den nyckelns faktiska privata nyckel — inte bara ett manipulerat
   `key_id`-strängvärde signerat med rätt nyckel.

Alla fyra punkter adresserade. Ingen ytterligare implementation gjord. Väntar nu på Windows:
`vitest run packages/mps-legal-corpus/tests/CorpusImportGate.test.ts` (isolerat, jämför mot
18), därefter full svit (eftersom `vitest.config.ts` ändrats och kan påverka andra projekt).

### 🔒 PROVEN v1 — MPS Legal Corpus Import Gate (2026-08-11)

Windows-bevis mottaget i två steg:

1. `vitest run packages/mps-legal-corpus/tests/CorpusImportGate.test.ts` — 1 filed passed,
   **18/18** tester, exit 0. Matchar exakt den oberoende `it()`-räkningen i
   VERIFIERINGSPASSET ovan.
2. `vitest run packages/mps-legal-corpus` (paket-scopat) — samma, **18/18**, exit 0.
3. Kollateral-kontroll: `vitest run --config vitest.config.ts --project compliance` gav
   152 filer passed / 16 failed, 567/17/5 (pass/fail/skip). Stash-test genomfört
   (`vitest.config.ts` + `tsconfig.json` tillfälligt återställda till HEAD): **exakt samma**
   16 filer / 17 tester föll även utan denna sessions ändringar. Enda skillnaden var
   filantalet (167/571 utan `mps-legal-corpus`-inclusen mot 168/589 med) — förväntat, inte
   en avvikelse. Slutsats: de 16/17 felen är pre-existing (legacy LU/CAS-boundary/
   artifact-store/event-compliance-kontrakt) plus miljöbunden DB-auth (`riskguard`), inte
   orsakade av denna ändring. Bekräftat både genom diff-analys (rent additiv ändring, inga
   befintliga rader rörda; inget i repot importerar `mps-legal-corpus`; `tsconfig.json` är
   kausalt overksamt för Vitest utan `vite-tsconfig-paths`) och empiriskt (stash-testet).

**Fyra bevis, namngivna enligt instruktion:**

- **Canonical chunk identity** — `computeChunkSetContentHash` är deterministisk och
  ordningskänslig; bevisad med explicit omsorterings-reproduktionstest och numerisk-medveten
  paragrafsortering.
- **Cryptographically bound import authority** — attestation verifieras mot en riktig,
  oberoende signerad Ed25519-nyckel (`ArtifactAttestation`/`verifyArtifactAttestation`), med
  bindning till action, document_id, chunk-hash, pipeline/policy-version och
  approver-identitet; ett äkta separat-nyckel-test bevisar avvisning.
- **Manifest completeness before first write** — helbatch-kontroll i `importBatch()` steg 1,
  innan några per-dokument-checks eller writes sker.
- **Batch fail-closed / zero partial corpus writes** — bevisat med två scenarier
  (manifest-inkomplett och binding-ogiltig) där noll writes sker, inklusive för det annars
  giltiga dokumentet i samma batch.

**Explicit kvarstående begränsning:** normal full CI-svit är fortsatt BLOCKED av 16/17
pre-existing legacy-/miljöfel — inte av detta paket. `mps-legal-corpus` är PROVEN för egen
funktion och för kollateral-risk mot `compliance`-konfigen; det är inte samma sak som att hela
repots testsvit är grön.

**Nästa steg (inte påbörjat):** Tor/Sonnet kan börja koppla `DocumentIngestionEngine` mot
denna grind. Fortsatt: inga embeddings, ingen kvalitetstuning, inga fler adapters innan
ingestion-wiringen i sig är PROVEN.

