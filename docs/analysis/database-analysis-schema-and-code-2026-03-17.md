# Grundlig Databasanalys: Schema + Kod, Appdata + Pipelines

Datum: 2026-03-17

## Sammanfattning

Den här analysen bygger enbart på statiska källor i repot. Ingen live-databas har lästs, eftersom `DATABASE_URL` inte är satt i den aktuella miljön.

Analysen bekräftar att den nuvarande appdatabasen består av:

- 28 Prisma-modeller i [prisma/schema.prisma](../../prisma/schema.prisma)
- 6 Prisma-migrationer i [prisma/migrations](../../prisma/migrations)
- tre huvudsakliga adminytor för datainsikt i [server/repositories/adminReportRepository.ts](../../server/repositories/adminReportRepository.ts)
- publika svarstyper i [types.ts](../../types.ts)

Det viktigaste resultatet är att databasen som system är betydligt större än vad adminytorna visar. De nuvarande `/api/admin/db-*`-ytorna täcker främst dokument, krav och delar av e-postpipen, men lämnar stora delar av säkerhet, sökindex, metadata-review, knowledge graph och flera relationsrisker osynliga.

De högst prioriterade riskerna är:

1. schemadrift och parallella sanningar mellan Prisma, rå SQL och tjänstelager
2. referensintegritetsluckor där flera viktiga länkar bara lagras som strängar
3. känslig datalagring och export av text, filvägar och identitetsdata
4. blind spots i adminanalysen som gör att viktiga tabeller kan vara trasiga utan att synas
5. dubbla kravpipelines utan tydlig reconciliation-modell

## Metod och verifiering

Källor som analyserats:

- [prisma/schema.prisma](../../prisma/schema.prisma)
- [server/repositories/adminReportRepository.ts](../../server/repositories/adminReportRepository.ts)
- [types.ts](../../types.ts)
- samtliga 6 filer i [prisma/migrations](../../prisma/migrations)
- drift- och stödkod i `server/db`, `server/security`, `server/services`, `server/compliance`

Verifieringar som körts lokalt:

- modellinventering med `rg` mot Prisma-schemat
- migrationsinventering via mappinnehåll
- riktade admintester:
  `npx vitest run --config vitest.config.ts --project unit tests/unit/dbAnalysis.test.ts tests/unit/dbContents.test.ts tests/unit/dbStats.test.ts --coverage.enabled false`
  Resultat: 22 tester passerade
- generell typecheck:
  `npm run typecheck`
  Resultat: failar i flera filer, främst route/service-typning. Det är inte ett databasinnehållsbevis, men visar att repoets totala typstatus inte är grön

Viktig begränsning:

- `adminReportRepository.ts` använder `const db = prisma as any`, vilket döljer Prisma-drift i compile-time. Det betyder att vissa queryfel inte fångas av TypeScript.

## Modellinventering per delsystem

### 1. Auth, organisation och projekt

Modeller:

- `User`
- `TokenRevocation`
- `RateLimitEntry`
- `Organisation`
- `Project`
- `ProjectPlanState`
- `ProjectMember`
- `PropertyAccessLog`
- `AuditTrail`

Bedömning:

- Detta är kärnan för identitet, åtkomst, revisionsspår och livscykelhantering.
- `Project` bär även compliance-/riskfält och retentiondatum, vilket gör tabellen central för både affärsflöde och GDPR-logik.

### 2. Dokument och sökindex

Modeller:

- `DocumentRecord`
- `DocumentContent`
- `DocumentChunk`
- `SearchJob`
- `SearchQueryLog`

Bedömning:

- `DocumentRecord` är navet i hela modellen.
- `DocumentContent` lagrar både krypterad payload och plaintext `searchText`.
- `DocumentChunk` lagrar semantiska textsegment och embeddings i JSON.
- Sökmodellen stöder både köade jobb och queryloggning.

### 3. Structured requirements

Modeller:

- `RequirementCase`
- `RequirementRecord`
- `RequirementCitation`

Bedömning:

- Detta är den strukturerade tillstånds-/kravpipen.
- Relationen `DocumentRecord -> RequirementCase -> RequirementRecord -> RequirementCitation` är tydlig och starkt indexerad.

### 4. Outlook-ingestion och extraherade krav

Modeller:

- `EmailMessage`
- `OutlookAttachment`
- `AttachmentOccurrence`
- `PipelineRun`
- `ExtractedRequirement`

Bedömning:

- Detta är en separat ingest- och extraktionskedja vid sidan av structured requirements.
- Den använder egna identitetsstrategier, egna statusfält och egna kvalitetsfält.

### 5. Knowledge graph

Modeller:

- `KnowledgeNode`
- `KnowledgeEdge`

Bedömning:

- Prisma-schemat modellerar en graf i `knowledge_nodes` och `knowledge_edges`.
- Den faktiska tjänstekoden använder dock andra tabellnamn, se risksektionen.

### 6. Metadata review

Modeller:

- `DocumentMetadataEvidence`
- `MetadataReviewQueue`

Bedömning:

- Detta är ett viktigt människa-i-loopen-spår för låg confidence och oeniga metadata.
- De här tabellerna är operativt viktiga, men är nästan osynliga i dagens adminanalys.

### 7. Case staging och anteckningar

Modeller:

- `CaseCandidate`
- `CaseNote`

Bedömning:

- `CaseCandidate` är staging för materialisering av ärenden.
- `CaseNote` ersätter tidigare in-memory-noteringar men saknar stark relation i schemat.

## Primära dataflöden

### Flöde A: Projekt- och dokumentdriven kärnmodell

Primär linje:

`Organisation -> Project -> DocumentRecord -> RequirementCase -> RequirementRecord -> RequirementCitation`

Funktion:

- organisationen äger projekt
- projektet äger dokument
- ett dokument kan materialiseras till ett kravärende
- ett ärende får kravrader
- kravrader kan få evidens/citeringar

Sekundära stödflöden från samma kärna:

- `Project -> ProjectPlanState`
- `Project/User -> ProjectMember`
- `User/Project -> PropertyAccessLog`
- `User/Project -> SearchQueryLog`
- `DocumentRecord -> DocumentContent -> DocumentChunk`
- `DocumentRecord -> DocumentMetadataEvidence`
- `DocumentRecord -> MetadataReviewQueue`

### Flöde B: Outlook-ingestion och extraherade krav

Primär linje:

`EmailMessage -> OutlookAttachment -> ExtractedRequirement`

Kompletterande relationer:

- `EmailMessage -> AttachmentOccurrence`
- `PipelineRun` loggar ingestkörningar
- `OutlookAttachment.documentId` försöker länka tillbaka till appdokument, men utan formell relation

Bedömning:

- Flödet är idempotent på meddelande- och hash-nivå.
- Det producerar kravdata parallellt med structured requirements, men utan tydlig samordning mellan de två sanningarna.

## Migrationshistorik och förändringstakt

### 20260301_init

Innehåll:

- basmodeller för auth, organisation, projekt, dokument och sök

Slutsats:

- första generationens kärnmodell
- `DocumentRecord` startade enklare, med `municipality` i stället för senare normaliseringsfält

### 20260302_requirements_model

Innehåll:

- `RequirementCase`
- `RequirementRecord`
- `RequirementCitation`
- första verifieringsmodell med `RequirementVerificationStatus`

Slutsats:

- structured requirements lades till som ett tydligt andra steg
- modellen var först mer verifieringsorienterad än dagens schema

### 20260314005842_sync_schema_and_fix_drift

Innehåll:

- största förändringen i hela historiken
- metadata-normalisering på `DocumentRecord`
- confidence- och source-fält
- review status
- project scoring-fält
- `caseReviewStatus`
- `requirementHash`
- Outlook-ingestiontabeller
- extracted requirements
- knowledge tables
- metadata evidence/review queue
- case staging
- enumutökningar
- borttagning av `verificationStatus` från `RequirementRecord` och `RequirementCitation`

Slutsats:

- detta är tydligt en "andra generationens" schema-sync
- migrationsnamnet visar explicit att drift redan hade uppstått
- den här migreringen är den tydligaste indikatorn på hög förändringstakt och teknisk skuld runt datamodellen

### 20260315_add_case_notes_and_attachment_fields

Innehåll:

- `case_notes`
- `attachments.extracted_text`
- `attachments.parse_failure_reason`

Slutsats:

- operativa behov flyttades från minne till databas
- Outlook-attachment-livscykeln fördjupades

### 20260315_add_rate_limit_table

Innehåll:

- DB-backed rate limiting

Slutsats:

- säkerhets- och driftlager flyttades in i databasen

### 20260315_add_token_revocation

Innehåll:

- refresh token revocation store

Slutsats:

- säkerhetsmodellen blev databeroende även för auth

## Täckning i nuvarande adminytor

### `/api/admin/db-stats`

Täcker direkt:

- `DocumentRecord`
- `RequirementRecord`
- `ExtractedRequirement`
- kommunaggregering via `RequirementCase`

Ger:

- totaldokument
- krav totalt från två pipelines
- tröskelvalidering
- kommunvis dokument/krav

Täcker inte:

- `User`
- `Organisation`
- `Project`
- `ProjectPlanState`
- `ProjectMember`
- `PropertyAccessLog`
- `AuditTrail`
- `DocumentContent`
- `DocumentChunk`
- `SearchJob`
- `SearchQueryLog`
- `RequirementCitation`
- `EmailMessage`
- `OutlookAttachment`
- `AttachmentOccurrence`
- `PipelineRun`
- `KnowledgeNode`
- `KnowledgeEdge`
- `DocumentMetadataEvidence`
- `MetadataReviewQueue`
- `CaseCandidate`
- `CaseNote`

### `/api/admin/db-analysis`

Täcker direkt:

- `RequirementRecord`
- `RequirementCitation`
- `DocumentRecord`
- `RequirementCase`
- `ExtractedRequirement`

Ger:

- kategorier
- coding confidence
- level/status
- dokumentstatus
- legal status
- municipality confidence buckets
- citations coverage
- coverage ratio documents vs requirements
- kommun-gap mellan dokument och krav

Täcker inte:

- alla auth/säkerhetstabeller
- `ProjectPlanState`
- `PropertyAccessLog`
- `AuditTrail`
- `DocumentContent`
- `DocumentChunk`
- `SearchJob`
- `SearchQueryLog`
- `EmailMessage`
- `OutlookAttachment`
- `AttachmentOccurrence`
- `PipelineRun`
- `KnowledgeNode`
- `KnowledgeEdge`
- `DocumentMetadataEvidence`
- `MetadataReviewQueue`
- `CaseCandidate`
- `CaseNote`

### `/api/admin/db-contents`

Täcker direkt:

- `Organisation`
- `Project`
- `DocumentRecord`
- `RequirementCase`
- `RequirementRecord`
- `ExtractedRequirement`
- `EmailMessage`
- `PipelineRun`

Täcker inte:

- `User`
- `TokenRevocation`
- `RateLimitEntry`
- `ProjectPlanState`
- `ProjectMember`
- `PropertyAccessLog`
- `AuditTrail`
- `DocumentContent`
- `DocumentChunk`
- `SearchJob`
- `SearchQueryLog`
- `RequirementCitation`
- `OutlookAttachment`
- `AttachmentOccurrence`
- `KnowledgeNode`
- `KnowledgeEdge`
- `DocumentMetadataEvidence`
- `MetadataReviewQueue`
- `CaseCandidate`
- `CaseNote`

Viktigt:

- `db-contents` ger alltså inte "vad som finns i DB" i bred mening
- det är ett nyckelurval av tabeller, inte en hel databasöversikt

### `/api/admin/database-dump`

Ingår inte i de tre primära ytorna men är viktig för riskbilden.

Täcker:

- `Organisation`
- `User`
- `Project`
- `ProjectMember`
- `PropertyAccessLog`
- `AuditTrail`
- `ProjectPlanState`
- `DocumentRecord`
- `DocumentContent`
- `DocumentChunk`
- `SearchJob`
- `SearchQueryLog`

Täcker inte:

- structured requirements
- Outlook-ingestion
- metadata review
- knowledge graph
- case staging
- case notes

Särskild risk:

- `includeSearchText=true` och `includeChunkText=true` är default
- det innebär att plaintext `searchText` och `chunkText` exporteras om admin kallar endpointen utan att stänga av dem

## Blinda fläckar

### 1. Säkerhet och sessionsdata syns nästan inte

Tabeller:

- `TokenRevocation`
- `RateLimitEntry`

Konsekvens:

- adminytorna kan se gröna ut trots att auth-säkerhet eller rate limiting beter sig fel

### 2. Search storage syns inte i db-stats/db-analysis/db-contents

Tabeller:

- `DocumentContent`
- `DocumentChunk`
- `SearchJob`
- `SearchQueryLog`

Konsekvens:

- appen kan sakna embeddings, chunkar eller ha fastnade jobb utan att den huvudsakliga adminanalysen visar det

### 3. Metadata-review-pipen är nästan helt osynlig

Tabeller:

- `DocumentMetadataEvidence`
- `MetadataReviewQueue`

Konsekvens:

- låg confidence, konfliktlägen och mänskliga granskningsköer går att missa operativt

### 4. Knowledge graph är en blind fläck

Tabeller:

- `KnowledgeNode`
- `KnowledgeEdge`
- samt råtabellerna `graph_nodes` och `graph_edges`

Konsekvens:

- två olika grafvärldar kan samexistera utan att någon adminyta berättar vilken som faktiskt används

### 5. Staging och anteckningar syns inte

Tabeller:

- `CaseCandidate`
- `CaseNote`

Konsekvens:

- pipelineproblem mellan dokument och materialiserade ärenden kan döljas

## Prioriterad risklista

### P1. Parallella sanningar och schemadrift

Fakta:

- [server/services/knowledgeGraphService.ts](../../server/services/knowledgeGraphService.ts) skapar och använder `graph_nodes` och `graph_edges`
- Prisma-schemat mappar i stället `KnowledgeNode` och `KnowledgeEdge` till `knowledge_nodes` och `knowledge_edges`
- [server/database/migrations.ts](../../server/database/migrations.ts) innehåller ytterligare rå bootstrap-DDL för `TokenRevocation`, `RateLimitEntry` och `PropertyAccessAudit` som inte matchar Prisma-modellerna
- `20260314005842_sync_schema_and_fix_drift` visar att drift redan behövt repareras

Konsekvens:

- samma domän kan ha flera tabelluppsättningar och flera definitionskällor
- drift kan uppstå igen utan att Prisma ens märker det

### P1. Referensintegritetsluckor

Fakta:

- `RequirementCase.organisationId` är ett fristående fält utan relation till `Organisation`
- `OutlookAttachment.documentId` är ett fristående fält utan relation till `DocumentRecord`
- `ExtractedRequirement.knowledgeNodeId` är ett fristående fält utan relation till vare sig `KnowledgeNode` eller `graph_nodes`
- `EmailMessage.runId` har ingen relation till `PipelineRun`
- `CaseNote.caseId` saknar relation/FK

Konsekvens:

- orphanade rader kan uppstå och överleva länge
- join-logik tvingas ut i applikationskod i stället för att skyddas av databasen

### P1. Typosäkerhet kring DB-queries är urholkad

Fakta:

- `adminReportRepository.ts` använder `const db = prisma as any`
- `getDbContents()` läser `PipelineRun` som om modellen hade fälten `id`, `messagesIngested` och `requirementsExtracted`
- nuvarande Prisma-schema definierar i stället `runId`, `processedCount` och `errorCount`

Konsekvens:

- felaktiga queryfält kan nå produktion utan compile-time-stopp
- endpointen kan vara kontraktsmässigt stabil i test men ändå semantiskt ur takt med den faktiska databasen

### P1. Känslig data lagras och exporteras i klartext eller nästan klartext

Fakta:

- `DocumentRecord.absolutePath`, `EmailMessage.rawEmlPath` och `OutlookAttachment.storedPath` lagras i DB
- `DocumentContent` lagrar krypterad text men även plaintext `searchText`
- `DocumentChunk` lagrar plaintext `chunkText`
- `DocumentMetadataEvidence.llmResponse` kan innehålla rå modellutdata
- `backupService.ts` exporterar användare inklusive `bankidId`
- `database-dump` kan exportera `searchText` och `chunkText` som default

Konsekvens:

- backup/export/adminfunktioner blir högriskytor för PII och dokumentinnehåll
- incidentimpact blir större än nödvändigt

### P2. Dubbla kravpipelines utan reconciliation

Fakta:

- structured requirements använder `RequirementRecord`
- Outlook-ingestion använder `ExtractedRequirement`
- `db-stats` summerar båda som om de vore ett gemensamt mått
- ingen tydlig modell för deduplicering, materialisering eller canonical source framgår av adminanalysen

Konsekvens:

- totalsiffror kan vara missvisande
- täckning kan se bättre ut än den operativt är

### P2. Performance- och skalrisk i analysfrågor

Fakta:

- `getDbAnalysis()` hämtar fulla mängder confidence- och kommunrader till minnet
- `getDbStats()` bygger per-kommun-kartor i applikationskod
- `checkRateLimit()` kör `cleanupExpiredRateLimits()` vid varje kontroll
- sökstacken har fallback till JSON-baserad embeddingjämförelse om `pgvector` eller vector-kolumn saknas

Konsekvens:

- adminanalys och säkerhetslogik kan bli dyra på större datamängder
- sökprestanda kan falla hårt om vector-spåret inte är aktiverat

### P2. Retention och GDPR är bara delvis genomförd

Fakta:

- retentionlogik finns i [server/compliance/retention.ts](../../server/compliance/retention.ts) och [server/services/gdprComplianceService.ts](../../server/services/gdprComplianceService.ts)
- projekt arkiveras när retention passerat
- permanent borttagning fokuserar på användarrelaterade tabeller, inte hela dokument-/attachment-/backupkedjan
- `projectsDeleted` i `permanentlyDeleteUserData()` är egentligen antal medlemskap, inte faktiskt raderade projekt

Konsekvens:

- retention- och deletionseffekter är ofullständiga och delvis missvisande

### P3. Testerna verifierar kontrakt men inte verklig datamodell

Fakta:

- `dbStats`, `dbAnalysis` och `dbContents` testas via route-nivå med mockade repositorysvar
- de verifierar auth och response shape, men inte verkliga Prisma-querys

Konsekvens:

- en route kan vara "grön" i test trots att den är ur synk med databasen

## Viktiga observationspunkter per tabellgrupp

### DocumentRecord

Styrkor:

- bra indexering kring projekt, status och metadata-review
- tydlig roll som nav

Risker:

- många nullable metadatafält
- både legacy- och normaliserade kommunfält finns kvar samtidigt
- filväg i DB innebär deployment- och sekretesskoppling till filsystemet

### DocumentContent och DocumentChunk

Styrkor:

- krypterad kärntext finns
- chunking och embeddings möjliggör hybrid search

Risker:

- plaintext `searchText` och `chunkText` underminerar den rena nyttan av krypteringen
- admin dump och backupflöden ökar exponeringen

### RequirementCase / RequirementRecord / RequirementCitation

Styrkor:

- bra relationsstruktur
- bra indexering
- citations gör evidensspår möjligt

Risker:

- verifieringsmodellen har förändrats över tid och delvis avvecklats i schema
- `organisationId` på `RequirementCase` är inte relationssäkrad

### Outlook-ingestion

Styrkor:

- idempotens via `messageId` och `attachmentHash`
- tydliga statusfält och pipeline runs

Risker:

- flera länkar saknar FK
- attachments har både filsystemsberoende och DB-koppling
- `PipelineRun` används inkonsekvent mellan schema och adminrapportering

### Metadata review

Styrkor:

- tydlig human-in-the-loop-modell

Risker:

- operativt viktig men nästan osynlig i adminöversikter
- `llmResponse` kan bli stor och känslig

## Fas 2: Read-only query pack för live-DB

När `DATABASE_URL` finns tillgänglig bör nästa steg vara en strikt read-only revision. Följande frågor är färdiga att köras.

### 1. Basinventering

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;
```

```sql
SELECT extname, extversion
FROM pg_extension
ORDER BY extname;
```

### 2. Radantal per kärntabell

```sql
SELECT 'Organisation' AS table_name, COUNT(*) AS row_count FROM "Organisation"
UNION ALL SELECT 'Project', COUNT(*) FROM "Project"
UNION ALL SELECT 'DocumentRecord', COUNT(*) FROM "DocumentRecord"
UNION ALL SELECT 'DocumentContent', COUNT(*) FROM "DocumentContent"
UNION ALL SELECT 'DocumentChunk', COUNT(*) FROM "DocumentChunk"
UNION ALL SELECT 'RequirementCase', COUNT(*) FROM "RequirementCase"
UNION ALL SELECT 'RequirementRecord', COUNT(*) FROM "RequirementRecord"
UNION ALL SELECT 'RequirementCitation', COUNT(*) FROM "RequirementCitation"
UNION ALL SELECT 'email_messages', COUNT(*) FROM email_messages
UNION ALL SELECT 'attachments', COUNT(*) FROM attachments
UNION ALL SELECT 'extracted_requirements', COUNT(*) FROM extracted_requirements
UNION ALL SELECT 'DocumentMetadataEvidence', COUNT(*) FROM "DocumentMetadataEvidence"
UNION ALL SELECT 'MetadataReviewQueue', COUNT(*) FROM "MetadataReviewQueue"
UNION ALL SELECT 'CaseCandidate', COUNT(*) FROM "CaseCandidate"
UNION ALL SELECT 'case_notes', COUNT(*) FROM case_notes
ORDER BY table_name;
```

### 3. Orphan-kontroller

```sql
SELECT COUNT(*) AS missing_org_links
FROM "RequirementCase" rc
LEFT JOIN "Organisation" o ON o.id = rc."organisationId"
WHERE rc."organisationId" IS NOT NULL
  AND o.id IS NULL;
```

```sql
SELECT COUNT(*) AS missing_document_links
FROM attachments a
LEFT JOIN "DocumentRecord" d ON d.id = a.document_id
WHERE a.document_id IS NOT NULL
  AND d.id IS NULL;
```

```sql
SELECT COUNT(*) AS missing_run_links
FROM email_messages e
LEFT JOIN ingest_runs r ON r.run_id = e.run_id
WHERE e.run_id IS NOT NULL
  AND r.run_id IS NULL;
```

```sql
SELECT COUNT(*) AS missing_case_note_links
FROM case_notes n
LEFT JOIN "RequirementCase" c ON c.id = n.case_id
WHERE c.id IS NULL;
```

### 4. Dubbla grafvärldar

```sql
SELECT
  (SELECT COUNT(*) FROM knowledge_nodes) AS prisma_nodes,
  (SELECT COUNT(*) FROM knowledge_edges) AS prisma_edges,
  (SELECT COUNT(*) FROM graph_nodes) AS raw_nodes,
  (SELECT COUNT(*) FROM graph_edges) AS raw_edges;
```

### 5. Search- och embeddinghälsa

```sql
SELECT
  COUNT(*) AS documents,
  (SELECT COUNT(*) FROM "DocumentContent") AS contents,
  (SELECT COUNT(*) FROM "DocumentChunk") AS chunks,
  (SELECT COUNT(*) FROM "DocumentChunk" WHERE "embeddingJson" IS NOT NULL) AS chunks_with_embeddings;
```

```sql
SELECT EXISTS (
  SELECT 1 FROM pg_type WHERE typname = 'vector'
) AS vector_type_exists;
```

```sql
SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_name = 'DocumentChunk'
    AND column_name = 'embeddingVector'
) AS embedding_vector_column_exists;
```

### 6. Review-queue och confidence

```sql
SELECT "fieldName", "queueType", status, COUNT(*) AS cnt
FROM "MetadataReviewQueue"
GROUP BY "fieldName", "queueType", status
ORDER BY cnt DESC;
```

```sql
SELECT "fieldName", "sourceType", COUNT(*) AS cnt
FROM "DocumentMetadataEvidence"
GROUP BY "fieldName", "sourceType"
ORDER BY cnt DESC;
```

### 7. Pipeline-reconciliation

```sql
SELECT
  COUNT(*) AS structured_requirements
FROM "RequirementRecord";
```

```sql
SELECT
  COUNT(*) AS extracted_requirements
FROM extracted_requirements;
```

```sql
SELECT municipality, COUNT(*) AS cnt
FROM extracted_requirements
WHERE municipality IS NOT NULL
GROUP BY municipality
ORDER BY cnt DESC
LIMIT 25;
```

```sql
SELECT c.municipality, COUNT(*) AS cnt
FROM "RequirementRecord" r
JOIN "RequirementCase" c ON c.id = r."caseId"
WHERE c.municipality IS NOT NULL
GROUP BY c.municipality
ORDER BY cnt DESC
LIMIT 25;
```

### 8. Känslig data-exponering

```sql
SELECT
  COUNT(*) FILTER (WHERE "absolutePath" IS NOT NULL) AS document_paths,
  COUNT(*) FILTER (WHERE "raw_eml_path" IS NOT NULL) AS email_paths,
  COUNT(*) FILTER (WHERE stored_path IS NOT NULL) AS attachment_paths
FROM "DocumentRecord", email_messages, attachments;
```

Observera:

- sista frågan bör vid behov delas upp per tabell i verklig körning för tydligare plan/explain

## Rekommenderad nästa ordning efter fas 2

1. eliminera parallella DDL-källor och bestäm en enda sanning för graf-, token- och rate limit-tabeller
2. lägg till saknade relationer eller dokumenterade orphan-kontroller där FK inte är möjlig
3. gör adminanalysen komplett för metadata-review, search health och knowledge graph
4. minska plaintext-exponering i dump/backup/adminverktyg
5. definiera canonical source mellan `RequirementRecord` och `ExtractedRequirement`

## Slutbedömning

Datamodellen är funktionsrik och relativt mogen, men den är inte enkel. Det här är inte en liten CRUD-databas utan flera delsystem i samma PostgreSQL-instans: auth, dokumentarkiv, sökindex, två kravpipelines, metadata-review och knowledge graph.

Det gör databasen kapabel men också känslig för drift. Just nu är den största tekniska risken inte en enskild tabell, utan att flera delar av modellen har vuxit snabbare än den gemensamma styrningen av schema, admininsyn och typade querygränssnitt.
