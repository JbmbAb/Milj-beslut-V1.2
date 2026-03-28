# Live Databasrevision: Read-Only Fas 2

Datum: 2026-03-17

## Sammanfattning

Den här revisionen kördes mot den riktiga databasen via repoets `.env`, men enbart med read-only frågor.

Övergripande slutsats:

- databasen är nåbar och innehåller verklig appdata
- dokument- och attachmentnivån är fylld
- krav-, metadata-review- och sökcontentnivån är i praktiken tom
- det finns en tydlig statusdrift i sökdelen: hundratals dokument är markerade som `EMBEDDED` utan att ha någon faktisk `DocumentContent` eller `DocumentChunk`

## Viktigaste fynd

### 1. Databasen är verklig och bredare än appdata

Bekräftat i live-DB:

- 41 användartabeller totalt
- utöver `public` finns även `core`, `env`, `hydro` och `stage`
- PostGIS är installerat

Extensioner:

- `postgis 3.6.1`
- `pg_trgm 1.6`
- `unaccent 1.1`
- `plpgsql 1.0`

### 2. Dokument finns, men sökcontent saknas helt

Radantal:

- `DocumentRecord`: 1884
- `DocumentContent`: 0
- `DocumentChunk`: 0
- `SearchJob`: finns och har historik
- `SearchQueryLog`: 0

Dokumentstatus:

- `METADATA_ONLY`: 1341
- `EMBEDDED`: 543

Verifierad inkonsistens:

- `EMBEDDED` dokument utan `DocumentContent`: 543
- `EMBEDDED` dokument utan `DocumentChunk`: 543

Tolkning:

- sök-/embeddingstatusen i `DocumentRecord.status` går inte att lita på som sann indikator på faktisk indexeringsgrad

### 3. Kravpipelines är i praktiken tomma

Radantal:

- `RequirementCase`: 1
- `RequirementRecord`: 0
- `RequirementCitation`: 0
- `extracted_requirements`: 0

Case-hälsa:

- totalt antal ärenden: 1
- ärenden med kommun: 1
- ärenden utan kravrader: 1

Tolkning:

- den strukturerade kravpipen är inte materiellt befolkad
- Outlook-baserad kravextraktion har ännu inte producerat faktiska kravrader i live-DB

### 4. Outlook-ingestion har metadata men ingen faktisk parsing

Radantal:

- `email_messages`: 1044
- `attachments`: 1341
- `ingest_runs`: finns

Attachment-parsing:

- totala attachments: 1341
- `parsed = true`: 0
- `parsed = false`: 1341
- attachments med `extracted_text`: 0
- attachments med `parse_failure_reason`: 0

Tolkning:

- ingest har kommit långt nog för att skapa e-post/attachments, men textutvinning och kravextraktion har inte körts igenom

### 5. Metadata-review är helt tom

Radantal:

- `DocumentMetadataEvidence`: 0
- `MetadataReviewQueue`: 0
- inga grupperade queue- eller evidence-rader returnerades

Tolkning:

- människa-i-loopen-lagret finns i schema men används inte ännu i live-data

### 6. Knowledge graph finns bara i Prisma-spåret, inte i raw-spåret

Radantal:

- `knowledge_nodes`: 0
- `knowledge_edges`: 0
- `graph_nodes`: tabellen finns inte
- `graph_edges`: tabellen finns inte

Tolkning:

- live-databasen bekräftar driftproblemet från schemaanalysen:
  tjänstekod refererar till `graph_nodes`/`graph_edges`, medan verklig DB just nu bara har Prisma-tabellerna `knowledge_nodes`/`knowledge_edges`

### 7. Orphan-kontrollerna är gröna

Kontrollerade länkar:

- `RequirementCase.organisationId` utan träff i `Organisation`: 0
- `attachments.document_id` utan träff i `DocumentRecord`: 0
- `email_messages.run_id` utan träff i `ingest_runs`: 0
- `case_notes.case_id` utan träff i `RequirementCase`: 0

Tolkning:

- de svaga relationerna är fortfarande riskabla som design, men i nuvarande data såg vi inga orphan-träffar

## Live-DB snapshot

### Kärntabeller

- `Organisation`: 2
- `Project`: 2
- `ProjectPlanState`: 0
- `User`: finns
- `ProjectMember`: finns

### Dokument och sök

- `DocumentRecord`: 1884
- `DocumentContent`: 0
- `DocumentChunk`: 0
- `SearchJob`: historik finns, alla observerade jobbstatusar var `DONE`
- `SearchQueryLog`: 0

### Krav

- `RequirementCase`: 1
- `RequirementRecord`: 0
- `RequirementCitation`: 0
- `extracted_requirements`: 0

### Outlook/ingestion

- `email_messages`: 1044
- `attachments`: 1341
- `attachment_occurrences`: finns
- `ingest_runs`: finns

### Metadata-review och graph

- `DocumentMetadataEvidence`: 0
- `MetadataReviewQueue`: 0
- `knowledge_nodes`: 0
- `knowledge_edges`: 0

## Känslig data footprint

Observerade mängder:

- `DocumentRecord.absolutePath` satta: 1884
- `attachments.stored_path` satta: 1341
- `email_messages.raw_eml_path` satta: 0
- `DocumentContent.searchText`: 0
- `DocumentChunk.chunkText`: 0

Tolkning:

- plaintext söktext är inte aktuell risk i dagens datamängd eftersom contenttabellerna är tomma
- däremot finns omfattande filsystemsreferenser lagrade i databasen

## Slutsats

Live-revisionen bekräftar två saker samtidigt:

1. datalagret används på riktigt för dokument och ingestmetadata
2. flera av de mer avancerade delarna av produktens modell är ännu inte materialiserade i faktisk data

Det mest kritiska driftfyndet är statusdriften mellan `DocumentRecord.status` och verklig indexdata:

- 543 dokument säger `EMBEDDED`
- 0 dokument har faktisk `DocumentContent`
- 0 dokument har faktiska `DocumentChunk`

Det mest kritiska arkitekturfyndet är fortfarande knowledge graph-driften:

- schema/migration har `knowledge_nodes` och `knowledge_edges`
- tjänstekod använder `graph_nodes` och `graph_edges`
- live-DB visar att raw-tabellerna inte ens finns

## Rekommenderade nästa steg

1. Reparera sökstatusmodellen så att `DocumentRecord.status` speglar faktisk content/chunk/embedding-data.
2. Kör eller återskapa text-/chunk-pipelinen för dokument om `EMBEDDED` verkligen ska betyda indexerat.
3. Bestäm en enda canonical knowledge graph-modell och ta bort drift mellan `knowledge_*` och `graph_*`.
4. Utöka adminanalysen så att den visar:
   - content/chunk coverage
   - attachments parsed/unparsed
   - metadata review queue
   - search job backlog vs faktisk indexering
5. Om målet är en verkligt användbar kravdatabas: få igång minst en av kravpipelines till faktisk datamaterialisering.
