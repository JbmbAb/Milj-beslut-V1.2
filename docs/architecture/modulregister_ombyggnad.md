# Modulregister: Inventering för Ombyggnad

**Datum:** 2026-04-01
**Syfte:** Kartlägga alla moduler i kodbasen och besluta om deras framtid vid ombyggnad
**Status:** Living document

---

## Sammanfattning

Detta dokument klassificerar varje modul i kodbasen enligt fyra kategorier:
- ✅ **BEHÅLL** - Ren kod, tydligt ansvar, redo att migrera
- 🔄 **BYGG OM** - Bra koncept, dålig implementation, behöver omskrivas
- 📦 **ARKIVERA** - Experiment/POC, inte produktionskod
- ❌ **KASSERA** - Duplicerad, oanvänd, eller föråldrad

---

## 1. Backend Services (server/services/)

### 1.1 BEHÅLL (Produktionskvalitet)

| Service | Rader | Status | Kommentar |
|---------|-------|--------|-----------|
| **auditLogService.ts** | ~400 | ✅ BEHÅLL | Ren audit-logik, 14 tester, tydligt ansvar |
| **userRepository.ts** | ~300 | ✅ BEHÅLL | Standardiserat repository-mönster |
| **projectAccessRepository.ts** | ~250 | ✅ BEHÅLL | Tydlig behörighetskontroll |
| **tokenRepository.ts** | ~200 | ✅ BEHÅLL | DB-backed token revocation |
| **rateLimitDb.ts** | ~150 | ✅ BEHÅLL | Distribuerad rate limiting |
| **gdprComplianceService.ts** | ~350 | ✅ BEHÅLL | Juridiskt kritisk, vältestad |
| **auditSanitization.ts** | ~200 | ✅ BEHÅLL | PII-maskning, säkerhetskritisk |
| **projectPlanRepository.ts** | ~280 | ✅ BEHÅLL | Kärn-repository |
| **requirementsRepository.ts** | ~320 | ✅ BEHÅLL | Kärn-repository |

**Total: 9 services som kan migreras direkt**

### 1.2 BYGG OM (Bra koncept, behöver rensning)

| Service | Rader | Problem | Ombyggnadsstrategi |
|---------|-------|---------|-------------------|
| **complianceRuleEngine.ts** | 221 | ✅ **KONSOLIDERAD 2026-04-02** - Lade till waste-specific types från services/complianceRulesEngine.ts | Klar - innehåller nu både geo + waste compliance |
| **smhiWeatherService.ts** | 246 | ✅ **BEHÅLLS** - services/weatherService.ts är frontend client, INTE duplicerad | Ingen åtgärd - korrekt separation frontend/backend |
| **sguService.ts** | ~500 | Två SGU-services (även sguRiskService) | Dela upp: adapter + domain logic |
| **sguRiskService.ts** | ~400 | Otydlig separation från sguService | Flytta risk-logik till domain/ |
| **geminiService.ts** (server) | ~600 | AI-integration + prompt + RAG blandat | Dela: prompts/, adapters/, domain/ |
| **searchService.ts** | 1018 | Monolitisk: search + embedding + RAG | Dela i: SearchAdapter, EmbeddingService, RAGEngine |
| **mvpContractService.ts** | ~550 | MVP-specific, hardkodade värden | Extrahera kontrakt, rensa MVP-kopplingar |
| **documentGenerator.ts** | ~650 | DOCX/PDF-export + affärslogik | Dela: export-adapter + template-logic |
| **notificationService.ts** | ~400 | Email + SMS + push blandat | Dela per kanal, gör adapters |

**Total: 9 services som behöver omstrukturering**

### 1.3 ARKIVERA (Experiment/POC)

| Service | Rader | Skäl | Destination | Status |
|---------|-------|------|-------------|--------|
| **gpsTrackingService.ts** | 300 | Ingen UI-integration, används bara i routes | legacy/experimental/ | ✅ **ARKIVERAD 2026-04-02** |
| **marketIntelService.ts** | 350 | Experiment, inget UI, låg användning | legacy/experimental/ | ✅ **ARKIVERAD 2026-04-02** |
| **bankComplianceProfileService.ts** | 400 | Förberedd men aldrig integrerad | legacy/experimental/ | ✅ **ARKIVERAD 2026-04-02** |

**Total: 3 services arkiverade till `legacy/experimental/`**

**Beslut 2026-04-02:**
- Skapade `legacy/README.md` med beslutsrationale
- Uppdaterade alla imports i routes, tester och services
- Kvalitetsgrindar: TS 0, ESLint 0, 119 testfiler (1031 tester) passing

### 1.4 KASSERA (Duplicerad/Oanvänd)

*Inga services identifierade för total kassering - även oanvända moduler har konceptvärde*

---

## 2. Root Services (services/)

### 2.1 BEHÅLL (Efter omstrukturering)

| Service | Rader | Status | Åtgärd |
|---------|-------|--------|--------|
| **projectStructure.ts** | 1265 | 🔄 BYGG OM | Dela i: domain/models/, application/workflows/, config/ |
| **geminiService.ts** | 901 | 🔄 BYGG OM | Dela i: adapters/gemini/, prompts/, domain/ |
| **complianceRulesEngine.ts** | 0 | ✅ **ARKIVERAD 2026-04-02** | → legacy/experimental/complianceRulesEngine_old.ts |
| **weatherService.ts** | 27 | ✅ **BEHÅLLS** | Frontend API client - INTE duplicerad mot server/services/smhiWeatherService.ts |
| **documentRequirements.ts** | ~400 | ✅ BEHÅLL | Ren domänlogik, flytta till domain/ |
| **stageGates.ts** | ~350 | ✅ BEHÅLL | Workflow-logik, flytta till domain/ |
| **gisRiskService.ts** | ~450 | 🔄 BYGG OM | Dela: GIS-adapter + risk-domain |
| **ontology.ts** | ~300 | ✅ BEHÅLL | Domänmodeller, flytta till domain/ |
| **projectAccess.ts** | ~250 | ✅ BEHÅLL | Behörighetslogik, flytta till domain/ |

**Total: 9 services (3 behåll, 6 bygg om)**

### 2.2 ARKIVERA

| Service | Skäl | Destination |
|---------|------|-------------|
| **mvpApiClient.ts** | DEMO_TOKEN hårdkodad, MVP-specific | legacy/mvp-demo/ |
| **publicUiService.ts** | 1159 rader monolitisk UI-logik | legacy/public-ui/ |

**Total: 2 services att arkivera**

---

## 3. Frontend Components (components/)

### 3.1 BEHÅLL (Produktionskvalitet)

| Komponent | Tester | Status | Kommentar |
|-----------|--------|--------|-----------|
| **AdminRequirementsStudio.tsx** | 15 | ✅ BEHÅLL | Kärn-feature, vältestad |
| **ApplicationWizard.tsx** | 12 | ✅ BEHÅLL | Onboarding-flow |
| **MapView.tsx** | 18 | ✅ BEHÅLL | GIS-integration |
| **DetailModal.tsx** | 11 | ✅ BEHÅLL | Återanvändbar |
| **PermitTable.tsx** | 8 | ✅ BEHÅLL | Kärn-UI |
| **FormManager.tsx** | 6 | ✅ BEHÅLL | Form-handling |
| **SystemStatus.tsx** | 8 | ✅ BEHÅLL | Observability |
| **BtfaNoteWidget.tsx** | 7 | ✅ BEHÅLL | Kärn-feature |
| **RequirementChecklist.tsx** | 10 | ✅ BEHÅLL | Kärn-feature |

**Total: ~35 komponenter produktionsklara**

### 3.2 BYGG OM

| Komponent | Rader | Problem | Strategi |
|-----------|-------|---------|----------|
| **ProjectWorkspace.tsx** | 709 | För stor, blandade ansvar | Dela i sub-komponenter |
| **ExecutiveSummary.tsx** | ~600 | Monolitisk | Dela i presentational components |
| **GisRiskModule.tsx** | ~550 | GIS + risk + UI blandat | Extrahera GIS-logik |

**Total: 3 komponenter behöver omstrukturering**

### 3.3 ARKIVERA (Demo/POC)

| Komponent | Skäl | Destination |
|-----------|------|-------------|
| **MvpDemoInterface.tsx** | Demo-interface, lazy-loading MVP | legacy/mvp-demo/ |
| **GeminiClientExample.tsx** | Exempel-komponent | legacy/examples/ |
| **components/mvp/** (hela katalogen) | 5 MVP-demo komponenter | legacy/mvp-demo/ |

**Total: 7 komponenter att arkivera**

---

## 4. Arkitektoniska Konflikter

### 4.1 ARKIVERA: Remix Routes (app/routes/)

**Problem:** Parallell arkitektur som aldrig togs i bruk

**Status:** ✅ **ARKIVERADE 2026-04-02** till `legacy/remix-poc/routes/`

**Arkiverade filer:**
```
legacy/remix-poc/routes/api.cases.$caseId.notes.ts
legacy/remix-poc/routes/api.datasources.lantmateriet.ts
legacy/remix-poc/routes/api.layers.sgu.grundlager.ts
legacy/remix-poc/routes/api.layers.sgu.jordskred-raviner.ts
legacy/remix-poc/routes/api.layers.hydro.lakes.ts
legacy/remix-poc/routes/api.layers.hydro.streams.ts
legacy/remix-poc/routes/api.layers.marktacke.query.ts
legacy/remix-poc/routes/api.layers.nvr.ts
legacy/remix-poc/routes/api.spatial-audit.ts
legacy/remix-poc/routes/api.system.postgis.ts
legacy/remix-poc/routes/api/gemini.ts
```

**Genomfört 2026-04-02:**
- Flyttade alla 11 Remix routes till `legacy/remix-poc/routes/`
- Uppdaterade imports för att peka på korrekt placering (../../../../)
- Express routes i `/server/routes/` är den enda produktionsarkitekturen

**Total: 11 filer arkiverade**

---

## 5. Scripts och Verktyg

### 5.1 BEHÅLL: Backfill Pipeline

Alla 24 scripts i `scripts/backfill/` är produktionskritiska:
- ✅ baseline-report.ts
- ✅ build-case-candidates.ts
- ✅ extract-metadata-pass1/2/3-llm.ts
- ✅ materialize-cases.ts
- ✅ coverage-report.ts
- ✅ qa-sample.ts
- ✅ resolve-disagreements.ts
- ✅ etc.

**Total: 24 scripts att behålla**

### 5.2 ARKIVERA: Demo-scripts

| Script | Skäl | Destination |
|--------|------|-------------|
| **scripts/demo-rag-checklist.ts** | Demo av RAG | legacy/demos/ |
| **scripts/test-demo-search.ts** | Söktester | legacy/demos/ |

**Total: 2 scripts att arkivera**

---

## 6. Typer och Kontrakt

### 6.1 BYGG OM: types.ts

**Problem:** Monolitisk fil med 1191 rader

**Strategi:**
```
Dela upp till:
  domain/
    types/
      project.types.ts
      permit.types.ts
      requirement.types.ts
      compliance.types.ts
      geo.types.ts
      audit.types.ts
```

---

## 7. Sammanfattande Statistik

| Kategori | Behåll | Bygg Om | Arkivera | Kassera |
|----------|--------|---------|----------|---------|
| Backend Services | 9 | 9 | 3 | 0 |
| Root Services | 6 | 6 | 2 | 0 |
| Frontend Components | 35 | 3 | 7 | 0 |
| Routes | 13 Express | 0 | 0 | 11 Remix |
| Scripts | 24 backfill | 0 | 2 demo | 0 |
| **TOTALT** | **87** | **18** | **14** | **11** |

---

## 8. Prioriterad Migreringsordning

### Fas 1: Kärn-domän (Vecka 1-2)
1. Migrera rena repositories (9 filer)
2. Migrera audit och GDPR services (3 filer)
3. Skapa ny domain/types/ från types.ts

### Fas 2: Compliance och Regler (Vecka 3-4)
1. Konsolidera compliance engines (2 → 1)
2. Bygg om documentRequirements + stageGates
3. Implementera ny regelmotor-arkitektur

### Fas 3: GIS och Integrationer (Vecka 5-6)
1. Bygg om GIS-services (SGU, SMHI)
2. Skapa adapters för externa API:er
3. Migrera GIS-komponenter

### Fas 4: AI och RAG (Vecka 7-8)
1. Dela upp geminiService (root + server)
2. Extrahera prompts till config
3. Bygg ren RAG-engine

### Fas 5: Frontend (Vecka 9-12)
1. Migrera kärn-komponenter (35 st)
2. Bygg om stora komponenter (3 st)
3. Skapa ny feature-baserad struktur

### Fas 6: Rensning (Vecka 13-14)
1. Flytta arkiverade moduler till legacy/
2. Ta bort Remix routes
3. Rensa demo-kod

---

## 9. Arkivstruktur

Förslag på ny struktur efter ombyggnad:

```
legacy/
  mvp-demo/
    MvpDemoInterface.tsx
    MvpApiClient.ts
    mvp-components/

  logistics/
    gpsTrackingService.ts
    marketIntelService.ts

  bank-scoring/
    bankComplianceProfileService.ts

  remix-poc/
    app/routes/ (hela katalogen)

  demos/
    demo-rag-checklist.ts
    test-demo-search.ts

  examples/
    GeminiClientExample.tsx
```

---

## 10. Risk-bedömning

| Risk | Sannolikhet | Konsekvens | Mitigation |
|------|-------------|------------|------------|
| Förlora funktionalitet vid migration | MEDIUM | HÖG | Parallellkör, kontraktstester |
| Bryta beroenden mellan moduler | HÖG | MEDIUM | Dependency-analys först |
| Juridisk regression | LÅG | KRITISK | GDPR/audit migreras först |
| Dataförlust vid schema-migration | LÅG | KRITISK | Adapter för gammal data |

---

## 11. Beslutspunkter

### Beslut krävs för:

1. **Compliance Engines:** Vilken version behålls? (server/ eller services/)
2. **Weather Services:** Konsolidera eller behåll båda med tydlig separation?
3. **SGU Services:** En eller två? Om två, hur separera ansvar?
4. **Remix Routes:** Total borttagning eller bevaras som referens?
5. **GPS/Market Intel:** Integreras i produkt eller arkiveras permanent?

### Rekommendationer:

1. ✅ **Compliance:** Behåll server-versionen, den är nyare
2. ✅ **Weather:** Konsolidera till EN med adapter-pattern
3. ✅ **SGU:** Behåll båda men döp om: sguAdapter.ts + sguRiskDomain.ts
4. ✅ **Remix:** Total borttagning, ingen produktion-användning
5. ⚠️ **GPS/Market:** Parkera i legacy/, besluta efter MVP-ombyggnad

---

## 12. Nästa Steg

**Omedelbart (Denna vecka):**
1. ✅ Skapa detta modulregister
2. ✅ Skapa ombyggnadsstrategi-dokument
3. ☐ Få godkännande från produktägare
4. ☐ Skapa migration-branch

**Nästa Sprint:**
1. ☐ Implementera ny domain/types/ struktur
2. ☐ Migrera första 3 repositories som proof-of-concept
3. ☐ Sätt upp parallell src/domain/ katalog

---

**Dokumentägare:** GitHub Copilot Agent
**Senast uppdaterad:** 2026-04-01
**Nästa review:** Vid start av ombyggnadsfas
