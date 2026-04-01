# Ombyggnadsstrategi: Bygga Nytt, Bygga Rätt

**Datum:** 2026-04-01
**Version:** 1.0
**Status:** Strategidokument för ombyggnad av Miljöbeslut.se

---

## Sammanfattning

Detta dokument beskriver hur plattformen kan byggas om på ett kontrollerat sätt med maximal återanvändning av det som är bra i dagens lösning, men utan att dra med historisk komplexitet, examensspår eller teknisk skuld in i nästa generation.

Målet är inte en total omskrivning utan styrning mot en ny, ren produktkärna med tydliga kontrakt, juridisk hållbarhet och låg risk vid migrering.

---

## 1. Rekommendation i korthet

Rekommendationen är att bygga en ny produktkärna och migrera in fungerande delar stegvis.

### Det som ska återanvändas:

- Domänmodeller och begrepp
- Regelmotorer som är begripliga och verifierbara
- Repository- och service-mönster som är tydliga
- API-kontrakt som redan fungerar i praktiken
- Tester som beskriver verkligt önskat beteende
- Dokumentation om process, juridik, integrationer och affärslogik

### Det som inte ska flyttas över okritiskt:

- Historiska specialfall
- Examensspecifika artefakter
- Temporära integrationer och backupflöden
- UI-texter, testförväntningar och struktur som vuxit fram av tillfälligheter
- Moduler som saknar tydligt ägarskap eller kontrakt

### Strategin är alltså:

1. Bygg nytt
2. Kopiera det bra som mall
3. Migrera funktion för funktion
4. Lämna gammal kod orörd tills ersättning finns

---

## 2. Hur komplex är processen?

Komplexiteten är medelhög till hög, men fullt genomförbar om den delas upp korrekt.

### Tre realistiska nivåer:

**Nivå A - Ren MVP-kärna:**
- Auth, projekt, dokument, kravmotor, audit, grundläggande integrationer
- Detta är en medelhög process
- **Tidsestimering:** 6-8 veckor

**Nivå B - Produktionsbar plattform:**
- MVP-kärna plus GIS, masslogistik, scoring, schedulerjobb, export och driftstöd
- Detta är hög komplexitet men hanterbart med tydlig fasindelning
- **Tidsestimering:** 12-16 veckor

**Nivå C - Total full omskrivning av allt samtidigt:**
- Detta är onödigt riskabelt och bör undvikas
- **Rekommendation:** GÖR INTE

### Min bedömning:
**Nivå B är rätt målbild, men den måste genomföras via Nivå A först.**

---

## 3. Vad den nya plattformen ska bestå av

Den nya lösningen bör ha sex tydliga lager.

### 3.1 Domänkärna

Detta är hjärtat i systemet och ska vara oberoende av UI, databas och externa API:er.

#### Kärnobjekt:

```typescript
// domain/models/
- Project
- Organization
- User
- PermitCase
- Requirement
- RequirementSource
- Document
- AuditEvent
- StorageArea
- MassFlow
- ComplianceAssessment
- IntegrationStatus
```

#### Regler:

- All affärslogik skrivs mot dessa modeller
- Inga UI-beroenden i domänkärnan
- Inga direkta fetch-anrop i domänkärnan
- Alla viktiga tillstånd ska kunna serialiseras och loggas

### 3.2 Applikationstjänster

Detta lagret koordinerar use cases.

#### Exempel:

```typescript
// application/use-cases/
- CreateProject
- ImportDocument
- AnalyzeRequirements
- GenerateComplianceAssessment
- RegisterStorageArea
- CalculateMassFlow
- SubmitPermitToAuthority
- GenerateReport
```

#### Regler:

- Exakt ett ansvar per use case
- Input och output styrs av schemas (Zod)
- Human-in-the-loop markeras explicit i varje arbetsflöde

### 3.3 Adapterlager

Alla beroenden mot omvärlden ska bo här.

#### Exempel:

```typescript
// infrastructure/adapters/
- PrismaRepositories
- OutlookGraphAdapter
- LantmaterietAdapter
- SguAdapter
- SluArtdatabankenAdapter
- SmhiWeatherAdapter
- NaturvardsverketAdapter
- TransportProviderAdapter
- BankIdAdapter
- DocxPdfExportAdapter
```

#### Regler:

- Inga adapters får innehålla central affärslogik
- Varje adapter ska kunna ersättas eller mockas
- Fallback-lagen ska vara tydliga och observerbara

### 3.4 API-lager

Detta är det enda lagret som webklient eller externa klienter ska prata med.

#### Krav:

```typescript
// api/
- Versionshanterade endpoints (/v1/, /v2/)
- Zod eller motsvarande kontraktsvalidering
- Enhetliga felobjekt
- Tydlig auth- och behörighetsmodell
```

### 3.5 Frontend

Frontend ska byggas som en klient till den nya applikationskärnan, inte som platsen där affärslogiken bor.

#### Krav:

```typescript
// client/features/
- Tunna vykomponenter
- Datahämtning via definierade API-hooks eller klienter
- Minimal dold lokal logik
- Features grupperade per domän, inte per slumpmässig skärm
```

### 3.6 Plattform och observability

Detta lagret ska ge driftbarhet.

#### Krav:

```typescript
// platform/
- Health endpoints
- Scheduler-status
- Audit trail
- Felspårning
- Integrationsstatus
- Backup- och retentionregler
```

---

## 4. Vad som ska återanvändas som mall

### 4.1 Återanvänds i princip

✅ **Bra typer och kontrakt**
- Exempel: `Project`, `PermitCase`, `Requirement` från types.ts
- Åtgärd: Extrahera till domain/types/

✅ **Repository-interface där ansvar är tydligt**
- Exempel: userRepository, projectAccessRepository, tokenRepository
- Åtgärd: Migrera direkt till infrastructure/repositories/

✅ **Services där logiken är ren och avgränsad**
- Exempel: auditLogService, gdprComplianceService, auditSanitization
- Åtgärd: Migrera direkt till application/services/

✅ **Auditspår och loggmönster**
- Exempel: AuditEvent-modell, audit-logging i alla kritiska operationer
- Åtgärd: Flytta till domain/audit/

✅ **Exportflöden som faktiskt motsvarar affärsbehov**
- Exempel: DOCX-generering för C-anmälningar
- Åtgärd: Extrahera till infrastructure/export/

✅ **Testfall som verifierar riktig verksamhetslogik**
- Exempel: Compliance-tester, requirement-extraction-tester
- Åtgärd: Migrera till nya test-suiten

### 4.2 Återanvänds efter omskrivning

🔄 **Integrationsmoduler**
- Exempel: Lantmäteriet, SGU, SMHI
- Problem: Adapter + domänlogik blandat
- Åtgärd: Dela upp i adapter (infrastructure/) + domänlogik (domain/)

🔄 **Gemini- eller AI-relaterade flöden**
- Exempel: geminiService.ts (root + server)
- Problem: API-anrop + prompts + RAG + affärslogik blandat
- Åtgärd:
  - infrastructure/adapters/gemini/
  - domain/prompts/
  - application/ai-services/

🔄 **Schedulerlösningar**
- Exempel: auditVerificationScheduler
- Problem: Blandad ansvarsstruktur
- Åtgärd: Dela i orchestration (application/) + execution (infrastructure/)

🔄 **Scoring- och compliancekod**
- Exempel: complianceRuleEngine (2 versioner!), predictiveScoringService
- Problem: Duplicerad kod, otydlig separation
- Åtgärd: Konsolidera till domain/compliance/

🔄 **Masslogistikmoduler**
- Exempel: gpsTrackingService, marketIntelService
- Problem: Backend finns, inget UI, oklart om produktion
- Åtgärd: Beslut krävs - integrera eller arkivera

🔄 **GIS-analysflöden**
- Exempel: sguService, sguRiskService, gisRiskService
- Problem: Flera överlappande tjänster
- Åtgärd: Konsolidera till:
  - infrastructure/adapters/gis/
  - domain/geo-analysis/

### 4.3 Ska inte följa med som aktiv produktkod

❌ **Examens- och presentationsspår**
- Exempel: `/examensrepo/` (hela katalogen)
- Åtgärd: Behåll som separat repo, ta bort från huvudrepo

❌ **Tillfälliga tmp-filer och backupskript**
- Exempel: Gamla migreringsskript, one-off data-fixes
- Åtgärd: Arkivera i legacy/one-off-scripts/

❌ **Gammal testkod som bara jagar UI-text**
- Exempel: Tester som matchar "nasta" istället för att testa funktionalitet
- Åtgärd: Skriv om testfall till behaviour-driven

❌ **Features som saknar tydligt affärscase**
- Exempel: bankComplianceProfileService (ingen integration), gpsTracking (inget UI)
- Åtgärd: Flytta till legacy/experimental/

❌ **Mode-switches som inte längre har aktiv användning**
- Exempel: MvpDemoInterface, gamla feature-flags
- Åtgärd: Ta bort helt eller flytta till legacy/demos/

---

## 5. Vad som ska byggas först

Byggordningen är viktigare än val av ramverk.

### Fas 0: Beslutsfrysning (Vecka 0)

**Syfte:**
- Definiera vad som faktiskt är produkt
- Skilja produkt, experiment, arkiv och examensmaterial
- Fastställa juridiska och operativa minimikrav

**Leverabler:**
- ✅ Produktkarta
- ✅ Modulregister (detta dokument + modulregister_ombyggnad.md)
- ☐ Dataklassificering (GDPR-kritisk data identifierad)
- ☐ Lista över human-in-the-loop-beslut

### Fas 1: Ny domänmodell (Vecka 1-2)

**Syfte:**
- Bygga ren modell för kärndatan

**Leverabler:**
```typescript
// domain/models/
- project.model.ts
- permit-case.model.ts
- requirement.model.ts
- document.model.ts
- audit-event.model.ts
- compliance-assessment.model.ts

// domain/value-objects/
- organization-id.vo.ts
- permit-status.vo.ts
- risk-level.vo.ts
```

**Test-coverage mål:** 100% av domänmodeller

### Fas 2: Ny API-kontraktmodell (Vecka 2-3)

**Syfte:**
- Stoppa kontraktsdrift mellan klient, service och databas

**Leverabler:**
```typescript
// api/schemas/
- project.schemas.ts (Zod)
- permit.schemas.ts
- requirement.schemas.ts

// api/contracts/
- request-formats.ts
- response-formats.ts
- error-formats.ts

// api/versioning/
- v1/
- v2/ (future)
```

### Fas 3: Ny datakärna (Vecka 3-4)

**Syfte:**
- Bygga datalagret runt domänmodellen, inte tvärtom

**Leverabler:**
```typescript
// infrastructure/database/
- schema.prisma (NY modell)
- migrations/

// infrastructure/repositories/
- project.repository.ts
- permit-case.repository.ts
- requirement.repository.ts
- audit.repository.ts
```

**Migreringsstrategi:**
- Parallell databas under utveckling
- Adapter för att läsa från gammal schema
- Batch-migrering av verifierad data

### Fas 4: Use cases (Vecka 5-8)

Bygg de viktigaste flödena först:

**Sprint 1 (Vecka 5):**
1. Autentisering och organisation
2. Projekt CRUD

**Sprint 2 (Vecka 6):**
3. Dokumentimport
4. Grundläggande audit

**Sprint 3 (Vecka 7):**
5. Kravextraktion (RAG + LLM)
6. Lagring av beslut och krav

**Sprint 4 (Vecka 8):**
7. Rapportering
8. Export (DOCX/PDF)

### Fas 5: Risk- och integrationsmoduler (Vecka 9-12)

När kärnan är stabil:

**Sprint 5 (Vecka 9):**
- GIS-adapters (Lantmäteriet, SGU)
- Geo-analys domänlogik

**Sprint 6 (Vecka 10):**
- Masslogistik (om produktionsbeslut tas)
- Transport-integration

**Sprint 7 (Vecka 11):**
- Scoring och compliance
- Prediktiv analys

**Sprint 8 (Vecka 12):**
- Schedulerjobb
- Myndighetsinlämning
- Bank- och complianceflöden (om produktionsbeslut tas)

### Fas 6: Ny frontend ovanpå ny API-yta (Vecka 13-16)

Frontend migreras sist eller parallellt i små delar, aldrig som stor omkoppling på en gång.

**Sprint 9-10 (Vecka 13-14):**
- Kärn-komponenter (35 st från modulregistret)
- Feature-baserad struktur

**Sprint 11-12 (Vecka 15-16):**
- Ombyggnad av stora komponenter (ProjectWorkspace, ExecutiveSummary, GisRiskModule)
- Integration med ny API

---

## 6. Migreringsstrategi med låg risk

Den nya plattformen bör byggas parallellt med den gamla.

### 6.1 Ingen big-bang

Vi ska inte försöka "fixa allt i befintlig kod" och vi ska inte heller stänga av gammal produkt innan ny motsvarighet finns.

### 6.2 Strangler-pattern

Den gamla lösningen fortsätter leva medan ny funktion tar över stegvis.

**Exempel:**

```typescript
// OLD: /api/projects (gamla implementationen)
// NEW: /api/v2/projects (nya implementationen)

// client/api-client.ts
const useProjects = () => {
  const newApiEnabled = featureFlags.newProjectApi;
  return newApiEnabled
    ? fetchFromV2('/api/v2/projects')
    : fetchFromV1('/api/projects');
};
```

**Flöde:**
1. Gammal endpoint finns kvar
2. Ny endpoint byggs bredvid
3. Trafik flyttas modulvis (feature flag)
4. Gamla implementationen pensioneras efter verifiering

### 6.3 Adapter för gammal data

Gammal data ska inte migreras blint.

**Istället:**

```typescript
// infrastructure/adapters/legacy-data.adapter.ts
export class LegacyDataAdapter {
  async readOldProject(id: string): Promise<Project> {
    const oldData = await oldDb.project.findUnique({ where: { id }});
    return this.normalizeToNewModel(oldData);
  }

  private normalizeToNewModel(old: OldProject): Project {
    // Transformera från gammalt till nytt schema
  }
}
```

- Bygg en läsadapter mot gammalt schema
- Normalisera till ny domänmodell
- Migrera verifierad data i batcher

### 6.4 Verifiering per steg

Varje migrerad modul måste verifieras med:

**Kontraktstest:**
```typescript
describe('Project API Contract', () => {
  it('should match v2 schema', () => {
    const response = await api.get('/api/v2/projects/123');
    expect(response).toMatchSchema(ProjectResponseSchema);
  });
});
```

**Domäntest:**
```typescript
describe('Project Domain Logic', () => {
  it('should enforce compliance rules', () => {
    const project = new Project({...});
    expect(project.canSubmitPermit()).toBe(true);
  });
});
```

**Integrationsprov:**
```typescript
describe('End-to-End Project Flow', () => {
  it('should create project through full stack', async () => {
    // Test från API → Application → Domain → Repository
  });
});
```

**Manuell verksamhetsgranskning:**
- Product owner verifierar use case
- Juridisk expert verifierar compliance-logik
- Slutanvändare testar UI-flöde

---

## 7. Juridisk och operativ designprincip

Ombyggnaden måste designas för juridisk hållbarhet, inte läggas på i slutet.

### Det betyder:

✅ **AI får assistera men inte ensam besluta i juridiska slutsatser**
```typescript
// RÄTT:
const aiSuggestion = await gemini.analyzeRequirement(doc);
const humanDecision = await reviewQueue.submit(aiSuggestion);

// FEL:
const decision = await gemini.analyzeRequirement(doc);
await db.requirement.create({ data: decision }); // Ingen human review!
```

✅ **Källor och underlag måste vara spårbara**
```typescript
interface Requirement {
  text: string;
  sources: RequirementSource[];
  confidence: number;
  reviewStatus: 'AUTO' | 'NEEDS_REVIEW' | 'VERIFIED' | 'LOCKED';
}
```

✅ **Alla automatiska bedömningar ska kunna granskas i efterhand**
```typescript
interface AuditEvent {
  timestamp: Date;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes: Record<string, any>;
  aiModelVersion?: string;
  confidence?: number;
}
```

✅ **Status, risk och rekommendation ska vara förklarbara**
```typescript
interface RiskAssessment {
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: RiskFactor[];
  explanation: string;
  mitigations: Mitigation[];
}
```

✅ **Personuppgifter, myndighetsdata och exportflöden måste ha tydliga ansvarspunkter**
```typescript
// domain/compliance/gdpr.rules.ts
export const gdprRules = {
  requiresConsent: ['email', 'phone', 'address'],
  requiresMasking: ['personnummer', 'bankId'],
  retentionPeriod: { audit: 7_YEARS, documents: 10_YEARS }
};
```

### Human-in-the-loop ska vara explicit i:

1. **Dokumentpublicering**
```typescript
// application/use-cases/publish-document.use-case.ts
export class PublishDocumentUseCase {
  async execute(docId: string, userId: string) {
    // Kräver manuell godkännande
    await this.reviewQueue.requireApproval({
      type: 'DOCUMENT_PUBLISH',
      docId,
      userId
    });
  }
}
```

2. **Myndighetsinlämning**
```typescript
// MÅSTE ha human-godkännande innan submission
await submitToAuthority.requireHumanApproval();
```

3. **Regulatorisk slutsats**
```typescript
// AI får föreslå, människa beslutar
const suggestion = await ai.suggestCompliance(project);
const decision = await human.decide(suggestion);
```

4. **Riskklassning med affärs- eller juridisk konsekvens**
```typescript
if (risk.level === 'HIGH' || risk.hasLegalImpact) {
  await reviewQueue.escalate(risk);
}
```

---

## 8. Om jag skulle bygga om det

Jag skulle inte börja i UI:t.

### Jag skulle göra så här:

1. **Kartlägga faktisk produktkärna och kasta brus**
   - ✅ Gjort via modulregister_ombyggnad.md
   - Identifierat: 87 moduler att behålla, 18 att bygga om, 14 att arkivera, 11 att kassera

2. **Bygga ny domänmodell och nya API-kontrakt**
   ```
   src/
     domain/
       models/
       value-objects/
       rules/
     api/
       schemas/
       contracts/
   ```

3. **Skapa nytt datalager med ren repositorystruktur**
   ```
   infrastructure/
     database/
       schema.prisma
     repositories/
       project.repository.ts
       permit.repository.ts
   ```

4. **Flytta över ett use case i taget**
   - Börja med: CreateProject
   - Sedan: ImportDocument
   - Sedan: AnalyzeRequirements
   - etc.

5. **Sätta upp audit, schedulerstatus och integrationsstatus tidigt**
   ```
   platform/
     health/
     audit/
     scheduler-status/
     integration-monitor/
   ```

6. **Låta ny frontend tala bara med ny API-yta**
   ```
   client/
     api/
       v2-client.ts (endast prata med /api/v2/*)
   ```

7. **Flytta gammal kod till arkiv eller adapter när ersättning finns**
   ```
   legacy/
     old-services/
     archived-components/
   ```

### Jag skulle också medvetet undvika:

❌ Att flytta över all testkod rakt av
❌ Att återanvända UI-struktur bara för att den redan finns
❌ Att blanda produktkod med researchmaterial
❌ Att laga vidare på varje gammal modul innan målarkitekturen är bestämd

---

## 9. Praktisk målbild för detta repo

En realistisk målbild är att införa en ny struktur bredvid dagens kod.

### Alternativ A: Monorepo med tydlig separation

```
src/
  domain/
    models/
    value-objects/
    rules/
    audit/
    compliance/

  application/
    use-cases/
    services/
    workflows/

  infrastructure/
    database/
    repositories/
    adapters/
      gemini/
      lantmateriet/
      sgu/
      smhi/

  api/
    v1/
    v2/
    schemas/
    middleware/

  ui/
    features/
    shared/
    components/

  platform/
    health/
    monitoring/
    scheduler/

legacy/
  old-services/
  old-tests/
  archived-adapters/
  mvp-demo/
  remix-poc/
```

### Alternativ B: Uppdelad mellan klient och server

```
server/
  domain/
  application/
  infrastructure/
  api/
  platform/

client/
  features/
    projects/
    permits/
    documents/
    compliance/
  shared/
    components/
    hooks/
    api-client/
  app/

legacy/
archive/
```

### Det viktiga är inte exakt mappnamn utan att:

✅ Domänlogik skiljs från adapters
✅ API skiljs från UI
✅ Legacy skiljs från aktiv produkt
✅ Human-in-the-loop är explicit
✅ Juridisk compliance är inbyggd

---

## 10. Beslutsrekommendation

Den mest rationella vägen är:

1. ✅ Fortsätta drifta nuvarande lösning kortsiktigt
2. ✅ Bygga ny produktkärna parallellt
3. ✅ Återanvända bra kod som mall och kontrakt
4. ✅ Migrera stegvis
5. ✅ Undvika total omskrivning i ett svep

### Det ger bäst kombination av:

- **Teknisk kvalitet:** Ren arkitektur utan historisk skuld
- **Juridisk hållbarhet:** GDPR och compliance inbyggt från start
- **Lägre konfliktkostnad:** Parallell utveckling, ingen big-bang
- **Bättre testbarhet:** Domänlogik isolerad och testbar
- **Mindre beroende av historiska kompromisser:** Frihet att designa rätt

---

## 11. Nästa konkreta steg

Om arbetet ska startas direkt bör nästa leverabler vara:

### 1. Ett modulregister: behåll, bygg om, arkivera, kassera
✅ **KLART:** `docs/architecture/modulregister_ombyggnad.md`

### 2. En ny målarkitektur för server och klient
☐ **TODO:** Skapa `docs/architecture/target-architecture.md`
- Detaljerad mappstruktur
- Dependency-diagram
- Layer boundaries

### 3. Ett minimalt domänschema för kärn-entiteter
☐ **TODO:** Skapa `src/domain/models/`
```typescript
- project.model.ts
- permit-case.model.ts
- requirement.model.ts
- document.model.ts
- audit-event.model.ts
```

### 4. En migreringsordning modul för modul
☐ **TODO:** Skapa `docs/architecture/migration-plan.md`
- Fas-för-fas plan
- Dependency-ordning
- Risk-mitigering per fas

### 5. En teknisk avgränsning för version 1 av nya kärnan
☐ **TODO:** Skapa `docs/architecture/mvp-core-scope.md`
- Vad ingår i kärn-MVP?
- Vad väntar till Fas 2?
- Acceptance criteria per use case

---

## 12. Risk och framgångsfaktorer

### Kritiska framgångsfaktorer:

✅ **Parallell utveckling:** Ingen big-bang, stegvis migration
✅ **Tydliga kontrakt:** API-schema och domänmodeller först
✅ **Juridisk compliance:** GDPR och human-in-the-loop från start
✅ **Testdriven:** Domänlogik 100% testad innan UI
✅ **Produktägare involverad:** Kontinuerlig verifiering av use cases

### Största riskerna:

⚠️ **Scope creep:** Att försöka migrera för mycket samtidigt
- **Mitigation:** Strikt Fas 0-avgränsning, modulregister följs

⚠️ **Data loss:** Att förlora viktig data vid schema-migration
- **Mitigation:** Adapter för gammal data, batch-migration med verifiering

⚠️ **Juridisk regression:** Att tappa GDPR eller audit-compliance
- **Mitigation:** GDPR/audit migreras först (Fas 1)

⚠️ **Beroende-lockup:** Att upptäcka cirkulära beroenden sent
- **Mitigation:** Dependency-analys i Fas 0

---

## 13. Slutsats

Ombyggnaden är genomförbar om den görs systematiskt.

**Nyckelbudskap:**

1. **Bygg nytt, kopiera det bra:** Migrera inte problem
2. **Parallell utveckling:** Ingen big-bang
3. **Domän först, UI sist:** Bygg inifrån och ut
4. **Juridik inbyggd:** Inte påklistrat i slutet
5. **Stegvis verifiering:** Varje fas måste godkännas innan nästa

**Nästa steg:**
- Godkänn denna strategi
- Skapa detaljerad migration-plan
- Starta Fas 0: Beslutsfrysning
- Bygg första domänmodellen

---

**Dokumentägare:** GitHub Copilot Agent
**Senast uppdaterad:** 2026-04-01
**Status:** Godkännande väntar
**Nästa review:** Vid godkännande av ombyggnadsbeslut
