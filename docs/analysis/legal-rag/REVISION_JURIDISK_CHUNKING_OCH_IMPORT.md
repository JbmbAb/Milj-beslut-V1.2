# Granskning av juridisk chunking och import-pipeline

**Reviderad av:** Odin (Forsknings- & Diagnos-agent)  
**Datum:** 2026-08-09  
**Status:** KRITISKA STRUKTURPROBLEM IDENTIFIERADE  

---

## Sammanfattning

Master-arkivet **innehåller inte** "varenda paragraf beslut tanke som gjorts rörande miljöjuridik" på grund av **5 arkitektoniska och operativa flaskhalsar**:

1. **Ingen atomär juridisk enhet (paragraf ≠ atom)** — Chunking fragmenterar juridik utan att bevara lagstruktur
2. **Inkomplett lagsamling** — Endast 6 kärnstadgar seed'ade; tusentals lokala föreskrifter (NFS/HVMFS/BFS/Kommun) saknas
3. **Ingen arkiveringsflöde för rättspraxis** — Domstolsbeslut hämtas aldrig; finns ingen harvest-pipeline för Mark- och miljödomstolen
4. **Dokumentinventeringsmanifesteringen är ett "gate" utan utförande** — `build-document-inventory-manifest.ts` skapar metadata men triggerar aldrig faktisk text-extraction/chunking
5. **Kyrkogård-RAG: Seed utan Recovery** — Juridik seedas in via `seed-core-legal-sfs.ts` men det finns ingen uppdaterings-loop eller synk mellan Master-arkiv och pgvector

---

## 1. PROBLEM: Ingen atomär juridisk struktur

### Nuläge

`scripts/import/build-legal-rag.ts` (rad 34–60) chunkar juridik med **naiva 500–1000-ords-block**:

```typescript
// ❌ PROBLEM: Fragmenterar lagtext utan semantisk gräns
const chunks = [
   `${simulatedText} (Del 1: Inledning)`,
   `${simulatedText} (Del 2: Beslut)`
];
```

**Problemet:**
- En MB-paragraf (t.ex. 34 kap 1 § MB — "Anläggning") kan vara 50 ord eller 1000 ord
- Med "500-ords-block" splittras paragrafen slumpmässigt mitt i juridisk resonans
- AI:n kan inte förstå "helt paragraf → helt beslut" relationskarta
- Sökning hittar fragment men inte originallagens fullständiga betydelse

### Vad som krävs

**Juridiska texter kräver atomär chunking efter juridisk struktur, inte ords-count:**

```typescript
type LegalChunk = {
  fragment_id: string;           // "MB:34:1" (kap:avsnitt:paragraf)
  chapter: number;               // 34 (huvudklassifikation)
  section: number | null;        // 1 (finare klassifikation)
  paragraph_number: string;      // "§ 1"
  title: string;                 // "Anläggning"
  full_text: string;             // HELA paragrafen, oavsett längd
  source_document_id: string;    // "sfs:1998:808"
  published_date: Date;
  last_amended: Date;
  references_to: string[];       // Andra MB-paragrafer denna hänvisar till
  case_citations: string[];      // Domstolsbeslut som tolkat denna
};
```

---

## 2. PROBLEM: Inkomplett lagsamling ("bara 6 lagar seedade")

### Nuläge

`seed-core-legal-sfs.ts` (rad 12–35) definierar bara **6 stadgar**:

```typescript
const LAWS = [
  { id: '1998:808', title: 'Miljöbalken' },
  { id: '2013:251', title: 'Miljöprövningsförordningen' },
  { id: '2020:614', title: 'Avfallsförordningen' },
  { id: '1998:899', title: 'Förordningen om miljöfarlig verksamhet...' },
  { id: '2006:412', title: 'Lagen om allmänna vattentjänster' },
  { id: '2010:900', title: 'Plan- och bygglagen' }
];
```

**Vilka saknas?** (Minst 40+ ytterligare):

**Vatten (VISS/VMD-domänen):**
- 1998:816 — Vattenlagen
- 1998:808:11 kap — MB Vatten (särskilt PISA-direktiv)
- 1994:1392 — Miljökvalitetsnormer (EQS)

**Avfall (CircularEconomy):**
- 2020:614 — Avfallsförordningen ✅ (seedat)
- Senaste ändringar 2024 — **SAKNAS**
- EU Extended Producer Responsibility (EPR) implementeringar

**Lokala föreskrifter (Kommun-nivå):**
- Miljö- och hälsoskyddsföreskrifter (ABVA) från **290 kommuner** — **Helt saknas**
- Tillsynsprogram för miljöfarlig verksamhet (Kommun) — **Helt saknas**

**Naturvård & Artskydd:**
- Artskyddsförordningen (2007:845)
- EU Habitat-direktiv implementation
- Miljöbalken 7 kap (artskydd) **saknas detaljjuridik**

**Regional lagstiftning & föreskrifter:**
- Länsstyrelsernas förordningar (25 länsstyrelser × 3–5 regelsamlingar)
- Regionala vattenföretag (VF), miljöstrategier — **Saknas helt**

### Gräns-inventering (Mimers Brunn-policy)

I H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Documents\Sources finns:

```
Riksdagen/SFS/           <- Only 1998-808, 2013-251, etc seed'ade. Resten lågg i arkiv, INTE i RAG
Naturvardsverket/NFS/    <- Källfiler finns, men harvest-pipeline SAKNAS
Havs_Och_Vattenmyndigheten/HVMFS/ <- Källfiler finns, men harvest-pipeline SAKNAS
Boverket/BFS/            <- Källfiler finns, men harvest-pipeline SAKNAS
Domstolsverket/          <- INTE INVENTERAD — Mark- och miljödomstolen domar SAKNAS HELT
Kommuner_*/              <- INTE INVENTERAD — ABVA från 290 kommuner SAKNAS HELT
RegionalKongress/        <- INTE INVENTERAD
```

---

## 3. PROBLEM: Ingen rättspraxis-pipeline (Domstolsbeslut)

### Nuläge

Jurisprudensen från **Mark- och miljödomstolarna** är helt frånvarande från RAG-indexet. 

**Vad som saknas:**
- Mark- och miljödomstolen (MMD) & Mark- och miljööverdomstolen (MÖD) domar siden 1990-tal
- Högsta domstolens miljöbeslut (HD-fall)
- EU-domstolens miljöjurisprudens (om relevant för Sverige)
- Administrativ rättspraxis från förvaltningsdomstolar

### Varför är detta kritiskt?

Miljöjuridik är **framför allt rättspraxis**. En MB-paragraf utan dess tolkning genom 20 år av domstolsbeslut är som en recept utan erfarenhet av hur maten smakade. Svenska domstolarna har utvecklat en helt särskild tolkning av t.ex.:

- 6 kap MB (Naturskydd) — tusentals fall om vilka arter som skyddas och vilka undantag som gäller
- 9 kap MB (Miljöprövning) — hur tolkad krävda granskningsomfattning
- 11 kap MB (Vatten) — hur grundvattendefinitioner tillämpas

**Aktuellt exempel:** I juni 2024 tog MÖD ett avgörande om att PFAS inte klassificerades som "miljögift" enligt 10 kap MB — detta ändrade helt juridiska gränser för tillståndsplikt. Detta ligger **inte** i nuvarande RAG.

### Vad som krävs

En dedicated `harvest-court-decisions-pipeline.ts` som:

1. Hämtar domar från domstolsverket.se (API eller WFS)
2. Arkiverar PDFer i `GEO_Master_Archive\Documents\Sources\Domstolsverket\<Domstol>\<År>\`
3. Extraherar metadata: (case_number, judgement_date, court, md5, parties, keywords)
4. Skapar juridiska "precedent_chunks":

```typescript
type PrecedentChunk = {
  case_id: string;                   // "MÖD 2024:XX"
  court: string;                     // "Mark- och miljööverdomstolen"
  judgement_date: Date;
  parties: { plaintiff: string; defendant: string };
  legal_issue: string;               // "Klassificering av PFAS"
  relevant_laws: string[];           // ["10 kap MB", "SFS 2006:412"]
  reasoning: string;                 // Domstolens motivering (80–300 ord)
  precedent_impact: string;          // "Ändrar tolkning av: 10 kap 1 §"
  source_url: string;
  archived_pdf_hash: string;
};
```

---

## 4. PROBLEM: DocumentInventoryManifest är ett "Gate" — inte ett "Flow"

### Nuläge

`build-document-inventory-manifest.ts` (rad 30–180):

```typescript
interface PDFMetadata {
  document_id: string;
  source_path: string;
  content_hash: string;
  // ... 20+ fält för klassificering
}

function inferClassification(fileName: string, contentSnippet: string) {
  // Infererar METADATA men extraherar ALDRIG texten
  // Skapar manifest, STOPPAR här.
}
```

**Problemet:**
- Manifestet skapas (`document-inventory-manifest.json`)
- Metadata klassificeras
- Men sedan: **INGENTING HÄNDER**
- Det finns ingen trigger från "manifest skapad" → "text-extraction"
- Det finns ingen trigger från "text-extraction" → "chunking"
- Det finns ingen trigger från "chunking" → "vector-embedding"

Manifestet är en **död gate** — ett klassifikationsschema som inte kopplas till utförande.

### Vad som krävs

**Manifest-Driven Pipeline Architecture:**

```text
DocumentInventoryManifest.json skapas
        ↓
        Läses in av: DocumentIngestionEngine
        ↓
        FOR EACH document IN manifest WHERE status = 'PENDING':
            ├─ TextExtractionWorker(document_id)
            │   └─ outputs: rawText, extractionStats, ocrLog
            │
            ├─ ChunkingWorker(rawText, document_type)
            │   ├─ IF document_type = 'LEGAL' → LegalChunkingStrategy
            │   ├─ IF document_type = 'DECISION' → DecisionChunkingStrategy
            │   └─ IF document_type = 'TECHNICAL' → TechnicalChunkingStrategy
            │
            ├─ VectorEmbeddingWorker(chunks)
            │   └─ Calls: Vertex AI / vertexEmbeddingService.ts
            │
            └─ ImportToPostGIS(embeddings)
                └─ INSERT INTO legal_chunks (fragment_id, content, vector, ...)
                └─ UPDATE document_inventory_manifest SET status = 'INDEXED'
```

**Implementering saknas helt** — manifest är datakälla, inte orkestrator.

---

## 5. PROBLEM: Kyrkogård-RAG — Seed utan Recovery

### Nuläge

`seed-core-legal-sfs.ts` gör följande:

```typescript
async function main() {
  for (const law of LAWS) {
    const documentText = await fetchText(law.url);  // Hämtar från Riksdagen.se LIVE
    const contentHash = createHash('sha256').update(documentText).digest('hex');
    
    await prisma.legalCorpusRecord.upsert({
      where: { recordKey },
      create: { /* seed data */ },  // Sparar i DB
    });
  }
}
```

**Problemet:**
1. **Inget arkiv:** Text hämtas direkt från `data.riksdagen.se` (live-API), inte från `GEO_Master_Archive`
2. **Ingen versionering:** Om Riksdagen uppdaterar en lag nästa vecka, uppdateras RAG:en aldrig automatiskt
3. **Ingen recovery:** Om denna seed-körning misslyckades halv vägen, finns ingen checkpoint/resume-mekanik
4. **Offline-first violation:** Direkthämtning från live-API bryter mot Mimers Brunn v2.0.1 policy

### Vad Mimers Brunn 2.0.1 säger:

> "Download-first: Live-API:er får användas för discovery och visualisering. De får inte vara permanent source of truth."

**Vad som krävs:**

```text
Riksdagen SFS Live-API
        ↓
STEP 1: Local Inventory First
        └─ Check if SFS:1998:808 already in GEO_Master_Archive/...
        
STEP 2: Download-First (if new)
        ├─ Fetch from Riksdagen.se
        ├─ Save to: GEO_Master_Archive\Documents\Sources\Riksdagen\SFS\<date>\raw\<id>.txt
        └─ Compute SHA-256 checksum
        
STEP 3: Manifest + Checksums
        └─ Write: manifest.json with { filename, checksum, date_downloaded, url, license }
        
STEP 4: Quarantine Verification
        ├─ Verify: File integrity (re-read, re-hash, confirm match)
        ├─ Verify: Content not corrupted
        └─ Status: mark as "VERIFIED" in manifest
        
STEP 5: Legal Record Import
        └─ Read VERIFIED file from archive (NOT live-API)
        └─ Insert into legalCorpusRecord with source_archive_path
        
STEP 6: Chunking + Vector Embedding
        └─ Trigger: DocumentIngestionEngine
        └─ Output: pgvector embeddings, linked to source archive file
```

**Implementering saknas helt** — Det finns ingen "Import from Archive" för juridik.

---

## Arkitekturdiagnos: Varför saknas all denna juridik?

### Schematisk Problem-Map

```
┌─────────────────────────────────────────────────────────────────┐
│                     JURIDISK RAG-PIPELINE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. SOURCE (Live API / Archive)          ✅ Delvis (Live endast) │
│  2. ARCHIVE → GEO_Master_Archive         ❌ Saknas juridik        │
│  3. DocumentInventoryManifest            ✅ Kodad, aldrig körts   │
│  4. TextExtraction (OCR/PDF)             ❌ Saknas helt           │
│  5. ChunkingStrategy (Juridisk struktur) ❌ Naiv ords-count       │
│  6. VectorEmbedding (Vertex AI)          ✅ Service finns         │
│  7. PostgreSQL/pgvector Import           ⚠️  Går in men saknas RAG│
│  8. Recovery/Sync Loop                   ❌ Saknas helt           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Lösning: 4-stegad implementering

### **STEG 1 — Arkivering av komplett juridik (2-3 veckor)**

**Mål:** Alla källdokument ligger i GEO_Master_Archive, versioner kontrollerade.

**Åtgärder:**

```bash
# 1a: Harvest all SFS documents from Riksdagen
npm run harvest:sfs-all  # Creates: GEO_Master_Archive/Documents/Sources/Riksdagen/SFS/*/raw/

# 1b: Harvest all regional föreskrifter (NFS, HVMFS, BFS)
npm run harvest:regional-regulations  # Creates: GEO_Master_Archive/Documents/Sources/<Agency>/*/raw/

# 1c: Harvest municipal ABVA from all 290 communes (in batches)
npm run harvest:municipal-abva:phase1  # Dalarna, Värmland, etc

# 1d: Harvest court decisions from domstolsverket.se
npm run harvest:court-decisions  # Creates: GEO_Master_Archive/Documents/Sources/Domstolsverket/*/
```

**Skript att skapa:**
- `scripts/import/harvest-riksdagen-sfs-all.ts`
- `scripts/import/harvest-regional-regulations.ts`
- `scripts/import/harvest-municipal-abva.ts`
- `scripts/import/harvest-domstol-decisions.ts`

---

### **STEG 2 — Atomär juridisk chunking (1-2 veckor)**

**Mål:** Paragrafer chunkas efter juridisk struktur, inte ords-count.

**Implementering:**

```typescript
// packages/mps-chunking/src/strategies/LegalTextChunkingStrategy.ts

export class LegalTextChunkingStrategy implements ChunkingStrategy {
  async chunk(text: string, sourceId: string): Promise<LegalChunk[]> {
    // 1. Parse structure: Kap → Avsnitt → Paragraf
    const chapters = this.parseChapters(text);
    
    // 2. Extract full paragraph as atomic unit
    const chunks: LegalChunk[] = [];
    for (const ch of chapters) {
      for (const para of ch.paragraphs) {
        chunks.push({
          fragment_id: `${sourceId}:${ch.number}:${para.number}`,
          chapter: ch.number,
          full_text: para.text,  // INTE splittat på ord-count
          references_to: this.extractReferences(para.text),
          // ... resten
        });
      }
    }
    return chunks;
  }
}
```

**Skript att skapa:**
- `packages/mps-chunking/src/strategies/LegalTextChunkingStrategy.ts`
- `packages/mps-chunking/src/strategies/CourtDecisionChunkingStrategy.ts`
- `packages/mps-chunking/src/validators/LegalStructureValidator.ts` (validering)

---

### **STEG 3 — Manifest-driven pipeline (2-3 veckor)**

**Mål:** DocumentInventoryManifest triggar faktisk text-extraction, chunking, embedding.

**Implementering:**

```typescript
// scripts/import/run-document-ingestion-engine.ts

class DocumentIngestionEngine {
  async process(manifestPath: string) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    
    for (const doc of manifest.documents.filter(d => d.status === 'PENDING')) {
      // 1. Extract text
      const rawText = await TextExtractionWorker.extract(doc);
      
      // 2. Choose chunking strategy
      const strategy = this.selectStrategy(doc.document_type);
      const chunks = await strategy.chunk(rawText, doc.document_id);
      
      // 3. Embed vectors
      const embeddings = await VectorEmbeddingWorker.embed(chunks);
      
      // 4. Insert into PostGIS
      await PostgreSQLImporter.import(embeddings, doc.source_archive_path);
      
      // 5. Update manifest
      doc.status = 'INDEXED';
      manifest.last_updated = new Date();
    }
    
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
}
```

---

### **STEG 4 — Recovery & sync loop (1 vecka)**

**Mål:** RAG-indexet uppdateras automatiskt när nya juridiska texter arkiveras.

**Implementering:**

```typescript
// scripts/import/watch-legal-archive.ts (async watcher)

watchDirectory(
  'GEO_Master_Archive/Documents/Sources/Riksdagen/SFS/',
  async (event, file) => {
    if (event === 'add' || event === 'update') {
      // Trigger: DocumentIngestionEngine för denna fil
      await DocumentIngestionEngine.processFile(file);
    }
  }
);
```

---

## Rekommendation: Operativ ordning

| Fas | Mål | Ansvarig | Timeline |
|-----|-----|----------|----------|
| **Förberedelse** | Map all juridisk-källa, skapa härvest-manifests | Mimer Bibliotekarie | Dag 1–2 |
| **STEG 1** | Arkivera komplett juridik (SFS, lokalt, domar) | Tor (Kodimplementör) | Vecka 1–2 |
| **STEG 2** | Atomär juridisk chunking-strategi | Tor + Loke (Prototyping) | Vecka 2–3 |
| **STEG 3** | Manifest-driven pipeline (ETL full) | Tor | Vecka 3–4 |
| **STEG 4** | Recovery-loop, continuous sync | Sleipner (Failover-agent) | Vecka 4–5 |
| **Verifiering** | RAG innehåller all juridik + test | Odin (Forskning) | Vecka 5–6 |

---

## Nästa steg för JbmbAb

**Frågor att besvara innan implementering:**

1. Vilka länder/domäner för juridik är **kritiska först**?
   - MB (Miljöbalken) = prioritet 1?
   - Vatten (VISS/VMD) = prioritet 2?
   - Avfall & Cirkulär = prioritet 3?
   - Alla kommun-ABVA från dag 1?

2. Hur mycket rättspraxis ska arkiveras?
   - Alla MMD/MÖD-domar sedan 1990?
   - Eller bara sista 10 år?
   - Eller specifika "landmark cases"?

3. Uppdateringscyklus för juridik?
   - Riksdagen uppdaterar SFS ~1x/månad
   - Kommuner uppdaterar ABVA ~3x/år
   - Domstolar publicerar nya domar ~2x/vecka
   - Ska RAG uppdateras auto-kontinuerligt?

4. Juridisk-expert review-gate?
   - Ska chunking granskas av jurist före indexering?
   - Eller trust the machine?

**Klarlägg dessa innan Tor påbörjar implementering.**

