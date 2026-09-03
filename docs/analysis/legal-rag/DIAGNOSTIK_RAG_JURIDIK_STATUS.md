# Diagnostik: Juridisk RAG Status & Vad som saknas

**Status:** KRITISKT GAP — Master-arkivet innehåller inte "all juridik"  
**Uppdaterad:** 2026-08-09  
**Genomgång av:** Mimer Bibliotekarie + Odin (Forskning)

---

## Schemaanalys: Vad som är BYGGT men INTE FYLLT

PostgreSQL-schemat HÄR är perfekt för juridisk RAG:

```prisma
model LegalCorpusRecord {
  id: String @id
  recordKey: String @unique        // "foundation:sfs-1998-808"
  canonicalKey: String             // "sfs:1998:808"
  sourceFamily: String             // "FOUNDATION", "REGIONAL", "MUNICIPAL"
  title: String
  summary: String?
  authorityName: String?           // "Riksdagen", "Naturvårdsverket"
  legalArea: String?               // "miljö", "vatten", "avfall"
  sourcePath: String               // Path i GEO_Master_Archive/Documents/Sources/
  publishedAt: DateTime?
  searchText: String
  chunks: LegalCorpusChunk[]       // ← Här ska paragraferna ligga
}

model LegalCorpusChunk {
  id: String @id
  recordId: String
  chunkIndex: Int
  chunkText: String @db.Text
  chapter: String?                 // "34" (kap)
  paragraph: String?               // "1" (§)
  section: String?                 // Underavsnitt
  embeddingVector: vector(768)?    // Vertex AI embedding
}
```

**Detta är BYGGT, men status på INNEHÅL?**

---

## Faktisk datainnehål: JBD av `LegalCorpusRecord`

| Status | Källa | Antal | Anmärkning |
|--------|-------|-------|-----------|
| ✅ Seedat | SFS 1998:808 (Miljöbalken) | 1 record | Bara hela boken, inte per paragraf |
| ✅ Seedat | SFS 2013:251 (Miljöprövningsförordningen) | 1 record | " |
| ✅ Seedat | SFS 2020:614 (Avfallsförordningen) | 1 record | " |
| ✅ Seedat | SFS 1998:899 (Miljöfarlig verksamhet) | 1 record | " |
| ✅ Seedat | SFS 2006:412 (Allmänna vattentjänster) | 1 record | " |
| ✅ Seedat | SFS 2010:900 (Plan- och bygglagen) | 1 record | " |
| ❌ Ej seedat | ALLA ÖVRIGA SFS (1000+) | 0 | Helt saknas |
| ❌ Ej seedat | NFS (Naturvårdsverket föreskrifter) | 0 | Helt saknas |
| ❌ Ej seedat | HVMFS (Havs- och vattenmyndigheten) | 0 | Helt saknas |
| ❌ Ej seedat | BFS (Boverket föreskrifter) | 0 | Helt saknas |
| ❌ Ej seedat | Lokala ABVA (290 kommuner) | 0 | Helt saknas |
| ❌ Ej seedat | MMD domar (Mark- och miljödomstolen) | 0 | Helt saknas |
| ❌ Ej seedat | MÖD domar (Mark- och miljööverdomstolen) | 0 | Helt saknas |
| ❌ Ej seedat | Administrativa rättspraxis | 0 | Helt saknas |

**Total utnyttjad RAG-kapacitet:** 6 lagar × 1 record/lag = **6 records** (bör vara 1000+)

---

## PROBLEM 1: Boken är 1 record, inte N paragrafer

`seed-core-legal-sfs.ts` gör detta:

```typescript
const documentText = await fetchText(law.url);  // Hämtar HELA Miljöbalken (308 sidor)
const contentHash = createHash('sha256').update(documentText).digest('hex');

await prisma.legalCorpusRecord.upsert({
  where: { recordKey },
  create: {
    recordKey: "foundation:sfs-1998-808",
    searchText: `${law.title}\n${documentText}`.slice(0, 500_000),
    // ← Hela boken komprimerad till 500 KB text
  }
});
```

**Resultatet:**
- 1 `LegalCorpusRecord` = "Miljöbalken" (hela boken)
- 0 `LegalCorpusChunk` per paragraf
- RAG-sökning kan inte göra: "Vad säger 34 kap 1 § MB om anläggning?" utan att först hittar **hela boken** och sen matchar regex

**Vad borde hända:**

```typescript
// Parse structure: Chapter → Section → Paragraph
const chapters = parseChaptersFromText(documentText);  // 48 kapitel
const totalParagraphs = chapters.flatMap(ch => ch.paragraphs).length;  // ~400 paragrafer

// Create 400 LegalCorpusChunk records (NOT 1 LegalCorpusRecord)
for (const chapter of chapters) {
  for (const para of chapter.paragraphs) {
    await prisma.legalCorpusChunk.create({
      recordId: sfsRecord.id,
      chunkIndex: para.id,
      chunkText: para.full_text,
      chapter: chapter.number.toString(),
      paragraph: para.number.toString(),
      section: para.section || null,
      embeddingVector: await embeddings.embed(para.full_text),  // Vertex AI
    });
  }
}
```

**Resultat:** 1 `LegalCorpusRecord` + 400 `LegalCorpusChunk` (atomär juridik)

---

## PROBLEM 2: Bara 6 SFS, ingen harvesting av övriga

**Status i arkivet vs RAG:**

```bash
H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Documents\Sources\
├── Riksdagen\SFS\
│   ├── 1998-808\         ✅ Miljöbalken (seedat)
│   ├── 2013-251\         ✅ Miljöprövningsförordningen (seedat)
│   ├── 2020-614\         ✅ Avfallsförordningen (seedat)
│   ├── 1998-899\         ✅ Miljöfarlig verksamhet (seedat)
│   ├── 2006-412\         ✅ Allmänna vattentjänster (seedat)
│   ├── 2010-900\         ✅ Plan- och bygglagen (seedat)
│   ├── 1998-816\         ❌ Vattenlagen (ej seedat)
│   ├── 2007-845\         ❌ Artskyddsförordningen (ej seedat)
│   └── ... (50+ fler)    ❌ Ej seedade
│
├── Naturvardsverket\NFS\
│   ├── 2006-7\           ❌ Föreskrifter mark- och vattenförorening (ARKIV finns, ej seedat)
│   ├── 2019-14\          ❌ Ny version av NFS 2006-7 (ARKIV finns, ej seedat)
│   └── ... (20+ fler)    ❌ Arkiv finns, ej seedat
│
├── Havs_Och_Vattenmyndigheten\HVMFS\
│   ├── 2016-17\          ❌ Föreskrifter avloppsreningavlopp (ARKIV finns, ej seedat)
│   └── ... (15+ fler)    ❌ Arkiv finns, ej seedat
│
├── Boverket\BFS\
│   ├── BBR\              ❌ Boverkets byggregler (ARKIV finns, ej seedat)
│   └── ... (10+ fler)    ❌ Arkiv finns, ej seedat
│
├── Kommuner_Dalarna\
│   ├── ABVA_Mora\        ❌ (ARKIV finns, ej seedat)
│   ├── ABVA_Falun\       ❌ (ARKIV finns, ej seedat)
│   └── ... (290 kommuner) ❌ Arkiv finns, ej seedat
│
└── Domstolsverket\
    ├── Miljodomstolar\   ❌ Mark- och miljödomstolen domar (INGEN ARKIV)
    └── Overdomstolar/    ❌ Mark- och miljööverdomstolen domar (INGEN ARKIV)
```

**Konklusion:** 
- **Arkivet har**: Källfiler för ~70% av juridiken (när ABVA räknas)
- **RAG har**: 0% av arkivfilen = 6 SFS + ingenting

---

## PROBLEM 3: Ej seedat = inte lättåtkomligt för RAG

**Flowet är bruten:**

```text
Arkivfil finns
H:\...Riksdagen\SFS\1998-816\raw\vattenlagen.txt

    ↓ (INTE KOPPLAT)
    
LegalCorpusRecord (skulle kunna peka här)
    ❌ sourcePath: null
    ❌ recordKey: null (ej seedat)
    
    ↓ (INGEN PIPELINE)
    
LegalCorpusChunk (skulle kunna länka här)
    ❌ 0 chunks
```

**Resultatet:** Arkivet är en gravar — data är där, men RAG vet inte om det.

---

## PROBLEM 4: Inget update-flöde (Seed ≠ Recovery)

`seed-core-legal-sfs.ts` kör via:

```bash
npm run seed:legal  # Körs manuellt 1 gång
```

**Vad som INTE händer:**
- Riksdagen uppdaterar en SFS → RAG uppdateras ALDRIG
- En paragraf ändras i 34 kap MB → Chunk är fortfarande gammal
- Ny ABVA från kommunen → RAG märker det ALDRIG
- Ny MMD-dom från mark- och miljödomstolen → Ingenting händer

**Varför?** Det finns ingen:
1. **Watch-loop** som survejar arkivet för nya filer
2. **Delta-importer** som uppdaterar bara ändrade filer
3. **Version-tracking** av juridik

---

## PROBLEM 5: Chunking är simulerad, inte verklig

`build-legal-rag.ts` (rad 40–60):

```typescript
// ❌ SIMULERAD TEST-DATA
const simulatedText = `Detta är den utvunna texten för paragraf 1 i ${file}...`;

// ❌ NAIV CHUNKING
const chunks = [
   `${simulatedText} (Del 1: Inledning)`,
   `${simulatedText} (Del 2: Beslut)`
];

// ❌ SIMULERAD INMATNING
totalChunks++;  // Räknar bara, inserterar aldrig till DB
```

**Vad som saknas:**
- Faktisk PDF-extraction från arkivfiler
- Faktisk juridisk struktur-parsing
- Faktisk Vertex AI embedding
- Faktisk INSERT till pgvector

---

## PROBLEM 6: Inga Embedding-vektorer seedade

```sql
SELECT COUNT(*) FROM legal_corpus_chunks WHERE embedding_vector IS NOT NULL;
-- Result: 0
```

Varje chunk borde ha:
1. `embeddingVector: vector(768)` (från Vertex AI)
2. Lagrat som pgvector för HNSW-sök

**Status:** 0 embeddings skapade.

---

## ROOT CAUSE: Design vs Implementation Gap

| Nivå | Status | Förklaring |
|------|--------|-----------|
| **Arkitektur** | ✅ GJORD | Schema är perfekt (LegalCorpusRecord + LegalCorpusChunk) |
| **Dokumentation** | ✅ GJORD | ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT.md definierar flödet |
| **Manifest** | ⚠️ HALVGJORD | `build-document-inventory-manifest.ts` skapar metadata men triggar aldrig action |
| **Harvesting** | ❌ INGA | Ingen pipeline hämtar från Riksdagen/NVM/kommun efter första seed |
| **Extraction** | ⚠️ SIMULERAD | `build-legal-rag.ts` är hardkodad test, inte verklig |
| **Chunking** | ❌ FEJKAD | Ingen faktisk juridisk struktur-parsing |
| **Embedding** | ❌ SAKNAS | Ingen Vertex AI-anrop för vektorer |
| **Import** | ❌ SAKNAS | `insert into legal_corpus_chunks` aldrig körts |
| **Recovery** | ❌ SAKNAS | Ingen loop för uppdateringar |

---

## Vad behöver JbmbAb göra NU?

**Prioritet 1 (Denna vecka):**
1. Bestäm: **Vilka juridiska källa är kritiska FÖRST?**
   - A) Bara Miljöbalken (MB) + Miljöprövningsförordningen?
   - B) MB + Vatten + Avfall (Tier-1)?
   - C) ALLT (MB + lokalt + domar) från dag 1?

2. Uppdatering från Odin (Forskning-agent) behövs för:
   - Vilka 10 kärnstadgar är viktigast för miljöbeslut?
   - Vilka domstolsbeslut från MMD är "landmark cases"?
   - Vilka kommuner/ABVA är viktigast (prioriter Dalarna)?

**Prioritet 2 (Nästa vecka):**
3. Starta Tor (Kodimplementör) på:
   - Skapa `harvest-complete-sfs-manifest.ts` (från Riksdagen)
   - Implementera `LegalTextChunkingStrategy` (paragraf-atomär)
   - Connecta `DocumentInventoryManifest` → ChunkingEngine (triggered)

**Prioritet 3 (2–3 veckor):**
4. Implementera kontinuerlig sync:
   - `watch-legal-archive.ts` (kontinuerlig uppdateringsmönitor)
   - `update-legal-embeddings.ts` (incremental re-embed vid ändringar)

---

## Nästa steg: Frågor för JbmbAb

1. **Juridisk prioritet:** Vilket domän är viktigast (MB, Vatten, Avfall, Lokalt)?
2. **Scope:** Alla 290 kommuners ABVA från start, eller bara Dalarna?
3. **Rättspraxis:** Hur många år av MMD-domar ska arkiveras? (Alla sedan 1990? Bara senaste 10 år?)
4. **Uppdaterings-cadence:** Månatlig, veckovis eller real-time?
5. **Human review:** Ska juridiska chunks granskas av jurist före RAG-indexering?

**Svar på dessa → Tor kan starta implementering.**

