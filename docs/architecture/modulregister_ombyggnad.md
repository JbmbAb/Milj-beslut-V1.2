# Modulregister for ombyggnad

Detta dokument ar ett beslutsregister for vilka moduler i plattformen som ska:

- `BEHALLAS`
- `BYGGAS OM`
- `ARKIVERAS`
- `KASSERAS`

Registret ar framtaget for att stodja strategin i `docs/architecture/ombyggnadsstrategi_bygga_nytt_bygga_ratt.md`.

Malet ar att skilja mellan:

- faktisk produktkarna
- vardefull logik som ska ateranvandas som mall
- legacy, experiment och presentationer
- tekniskt brus som inte ska med in i nasta generation

---

## 1. Beslutsprinciper

### `BEHALLAS`

Anvands for moduler som redan motsvarar verkligt produktbehov och som kan leva vidare med begransad omstrukturering.

### `BYGGS OM`

Anvands for moduler som har hogt affarsvarde men dar ansvar, kontrakt eller implementation ar for otydliga for att flyttas over rakt av.

### `ARKIVERAS`

Anvands for moduler eller material som fortfarande har referensvarde men som inte ska fortsatta vara aktiv produktyta.

### `KASSERAS`

Anvands for moduler, filer eller monster som inte tillfor tillrackligt affarsvarde for att motivera migrering eller underhall.

---

## 2. Sammanfattad rekommendation

Huvudlinjen ar:

- Bevara audit, projekt, krav, dokument, access och centrala integrationskontrakt.
- Bygg om AI, compliance, GIS, logistik, scoring och myndighetsinlamning runt en ny domanmodell.
- Arkivera Core-demo, utvecklingsspår, presentationsmaterial och experimentytor.
- Kassera rena artefakter, duplicerade frontendramverk och moduler utan tydligt produktagarskap.

---

## 3. Backend: domankritiska moduler

| Modulgrupp                      | Primara sokvagar                                                                                                                                                                               | Status     | Motiv                                                                                               | Rekommenderad atgard                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Audit och spårbarhet            | `server/repositories/auditRepository.ts`, `services/auditLogService.ts`, `server/services/gdprComplianceService.ts`                                                                            | `BEHALLAS` | Hoger juridiskt varde an de flesta andra moduler. Tydligt behov for revision, GDPR och beslutsspar. | Behall som karndoman, flytta till ny `domain/audit` och `application/audit`. |
| Projektplan och projektstruktur | `server/services/projectPlanService.ts`, `server/repositories/projectPlanRepository.ts`, `services/projectStructure.ts`, `components/ProjectStructureContext.tsx`                              | `BEHALLAS` | Detta ar en faktisk produktkarna med tydligt verksamhetsvarde.                                      | Behall begreppen, dela upp i domanmodell, use cases och UI-adapter.          |
| Behörighet och projektatkomst   | `server/repositories/projectAccessRepository.ts`, `server/repositories/userRepository.ts`, `server/services/projectMemberService.ts`, `server/services/orgInvitationService.ts`                | `BEHALLAS` | Kritisk for multi-tenant och GovTech-liknande drift.                                                | Behall, men samla i ny accessmodul med tydliga roller och policies.          |
| Dokument- och kravunderlag      | `server/services/documentUploadService.ts`, `server/services/requirementExtractionService.ts`, `server/repositories/requirementsRepository.ts`, `server/services/requirementsReportService.ts` | `BEHALLAS` | En av plattformens starkaste verkliga tillgangar.                                                   | Behall processerna, men bygg nya kontrakt och renare dokumentpipeline.       |
| Admin- och rapportrepository    | `server/repositories/adminReportRepository.ts`, `server/services/pdfReportService.ts`, `server/services/documentGenerator.ts`, `server/services/permitDocxExportService.ts`                    | `BYGGS OM` | Vardefulla exportbehov finns, men implementationerna bor renodlas.                                  | Behall affarsbehov, bygg om runt gemensam exporttjanst.                      |
| Storage area och massfloden     | `server/repositories/storageAreaRepository.ts`, `server/repositories/massFlowService.ts`, `server/repositories/transportRepository.ts`                                                         | `BYGGS OM` | Stark domanpotential men otydlig stabilitet, typer och datamodell.                                  | Gora till egen doman: `StorageArea`, `MassFlow`, `TransportBooking`.         |
| Legal source och judgment-lager | `server/repositories/legalSourceRepository.ts`, `server/repositories/judgmentRepository.ts`, `server/services/legalSourceIngestService.ts`, `server/services/domstolRssService.ts`             | `BYGGS OM` | Hoger strategiskt varde, men bor separeras tydligare mellan ingest, index och analys.               | Bygg ny legal intelligence-modul med scheduler som adapter.                  |

---

## 4. Backend: regler, AI och beslutstjanster

| Modulgrupp                    | Primara sokvagar                                                                                                                                                                            | Status     | Motiv                                                                                             | Rekommenderad atgard                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Compliance- och regelmotor    | `server/services/complianceRuleEngine.ts`, `services/complianceRulesEngine.ts`, `server/services/mpfThresholdService.ts`, `server/services/bankComplianceProfileService.ts`                 | `BYGGS OM` | Mycket hogt affarsvarde, men splittrat pa flera lager och delvis dubblerat.                       | Konsolidera till en symbolisk regelmotor i ny domankarna.                           |
| AI-analys och orkestrering    | `services/geminiService.ts`, `services/orchestrationService.ts`, `server/services/checkListRagService.ts`, `server/services/ragSearchService.ts`, `server/services/coreAiGatewayService.ts` | `BYGGS OM` | Viktigt men riskfyllt. AI-floden maste bli forklarbara, kontraktsstyrda och juridiskt avgransade. | Flytta AI till adapterlager och behall bara verifierbar beslutslogik i domanen.     |
| Predictive scoring            | `services/predictiveScoringService.ts`, `server/services/marketIntelService.ts`                                                                                                             | `BYGGS OM` | Intressant kommersiellt, men bor inte vara en central del innan karndatan ar ren.                 | Behall modellerna som hypoteser, bygg om senare som separat scoringmodul.           |
| Myndighetsinlamning           | `server/services/permitAuthorityService.ts`, `server/services/permitAuthorityAdapter.ts`                                                                                                    | `BYGGS OM` | Hogt produktvarde, men juridisk risk och integrationsrisk kraver tydligare ansvar.                | Behall use case, bygg ny adapterbaserad submit-kedja med fallback och manuell gate. |
| BankID och e-signering        | `server/services/bankIdService.ts`, `server/services/eidasSignatureService.ts`                                                                                                              | `BEHALLAS` | Tydlig produktnytta och viktig human-in-the-loop-mekanism.                                        | Behall som karntjanster, bygg tydliga kontrakt och separat signerflode.             |
| Full status och driftoversikt | `server/services/fullStatusService.ts`, `server/services/externalHealthService.ts`, `server/services/metricsService.ts`, `server/services/errorTrackingService.ts`                          | `BYGGS OM` | Bra driftbehov, men nuvarande form ser ut att samla for mycket blandad logik.                     | Bryt ut till observabilitymoduler per ansvar.                                       |

---

## 5. Backend: geodata, myndighetsdata och externa integrationer

| Modulgrupp                      | Primara sokvagar                                                                                                                                                                           | Status     | Motiv                                                                       | Rekommenderad atgard                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Lantmateriet och fastighetsdata | `server/services/lantmaterietService.ts`, `server/services/propertyUnitService.ts`, `components/PropertyRegisterExtract.tsx`                                                               | `BEHALLAS` | Stark och tydlig domankoppling till produkten.                              | Behall som strategisk integrationsmodul, bygg tydlig property-adapter.                   |
| GIS och spatial audit           | `server/services/geoService.ts`, `server/services/spatialAuditService.ts`, `server/services/terrainService.ts`, `server/services/markCoverService.ts`, `server/services/sguRiskService.ts` | `BYGGS OM` | Hogt varde, men GIS-logiken bor skiljas fran UI och API-specifika detaljer. | Skapa ny `GeoAssessment`-modul med adapter per datakalla.                                |
| Natur- och artdata              | `server/services/sluService.ts`, `server/services/nvrService.ts`, `server/services/raaService.ts`, `server/services/sguService.ts`, `server/services/smhiWeatherService.ts`                | `BEHALLAS` | Relevanta externa datakallor och tydligt domanvarde.                        | Behall integrationskontrakten, bygg om implementationerna runt standardiserade adapters. |
| Outlook och notifering          | `server/services/outlookIngestionService.ts`, `server/services/outlookSchedulerService.ts`, `server/services/notificationService.ts`                                                       | `BYGGS OM` | Viktigt for driftsattning och dokumentinflode, men maste isoleras battre.   | Behall use case, flytta till integrationslager med tydlig schedulergrans.                |
| LIMS och provdata               | `server/services/limsService.ts`, `server/services/limsAutoFetchService.ts`, `server/repositories/limsRepository.ts`                                                                       | `BEHALLAS` | Har tydligt affarsvarde och passar val i ny produktkarna.                   | Behall som egen domanmodul for provdata och gransvarden.                                 |
| Open datasource-katalog         | `server/services/openDataSourceService.ts`, `server/datasources/catalog.ts`                                                                                                                | `BEHALLAS` | Bra gemensam katalog for externa kallsystem.                                | Behall och gora till canonical source registry.                                          |

---

## 6. API-lager och serverplattform

| Modulgrupp                 | Primara sokvagar                                                                                       | Status     | Motiv                                                                            | Rekommenderad atgard                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Secure API och appskapande | `server/createApp.ts`, `server/index.ts`, `server/secureApi.express.ts`, `server/geminiApi.express.ts` | `BYGGS OM` | Funktionellt nodnav, men sannolikt for tungt och blandat som central entrypoint. | Bygg ny API-yta med versionerade routes och delad kontraktsvalidering. |
| Routes och schemas         | `server/routes`, `server/schemas`, `app/routes/api*`                                                   | `BYGGS OM` | Har varde men verkar splittras mellan Remix- och Express-spår.                   | Standardisera ett API-lager och skilj UI-routes fran doman-API.        |
| Säkerhetslager             | `server/security/*`, `server/compliance/*`                                                             | `BEHALLAS` | Detta ar grund for juridisk och operativ hallbarhet.                             | Behall principerna, renodla gränssnitt och policies.                   |
| Databas- och Prisma-lager  | `server/db`, `server/database`, `prisma`                                                               | `BEHALLAS` | Tekniskt fundament som maste leva vidare.                                        | Behall, men bygg ny schemaevolution runt malarkitekturen.              |

---

## 7. Frontend: karna och arbetsyta

| Modulgrupp                    | Primara sokvagar                                                                                                                                                                          | Status     | Motiv                                                                                 | Rekommenderad atgard                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| App shell och workspace       | `components/App.tsx`, `components/WorkspaceApp.tsx`, `components/WorkspaceScaffold.tsx`, `components/workspaceModes.ts`, `components/ProjectWorkspace.tsx`                                | `BYGGS OM` | Har verkligt produktvarde men verkar samla for manga koncept i samma yta.             | Bygg nytt shell ovanpa ny API-yta och featurestruktur.                  |
| Projektledning och planvy     | `components/ProjectManagerView.tsx`, `components/ProjectPlanStructurePanel.tsx`, `components/GanttChart.tsx`, `components/ProjectOrgChart.tsx`                                            | `BEHALLAS` | Stark koppling till verklig verksamhet och planfloden.                                | Behall som funktionell referens, migrera stegvis till ny UI-struktur.   |
| Permit portal (legacy)      | `components/PermitPortalView.tsx`, `components/PermitTable.tsx`, `components/DetailModal.tsx`                                                                                               | `ARKIVERAS` | Ursprunglig monolitisk C-anmälan; canonical modul är C-anmälan schaktmassor.          | Behåll kart-/riskvy med deprecation; ny funktionalitet → `CNotificationMassUI`. Se `PERMIT_PORTAL_LEGACY.md`. |
| Marknad och logistik          | `components/MarketIntelView.tsx`, `components/MarketingHub.tsx`, `components/projectTransportComplianceFlow.ts`                                                                           | `BYGGS OM` | Har potential men blandar marknad, logistik och compliance pa ett tungt satt.         | Splitta till separata features: `MarketIntel`, `Transport`, `MassFlow`. |
| GIS och kartgranssnitt        | `components/MapView.tsx`, `components/GisRiskModule.tsx`, `components/WeatherRisk.tsx`                                                                                                    | `BEHALLAS` | Tydligt produktvarde.                                                                 | Behall UX-koncepten men koppla om mot ny geo-API.                       |
| Adminverktyg                  | `components/AdminRequirementsStudio.tsx`, `components/AdminSearchConsole.tsx`, `components/AdminDbStatusPanel.tsx`, `components/AdminGdprPanel.tsx`, `components/AdminMetadataReview.tsx` | `BYGGS OM` | Vardefulla interna verktyg, men bor delas upp tydligare mellan drift, krav och admin. | Bygg om till ren adminyta med separata featurepaket.                    |
| Dokument- och uploadyta       | `components/UploadModal.tsx`, `components/FieldAssistant.tsx`, `components/FormManager.tsx`, `components/RequirementChecklist.tsx`                                                        | `BYGGS OM` | Viktiga floden, men UX och domanlogik verkar delvis blandade.                         | Migrera till nya dokument- och fallfloden.                              |
| Legal support och beslutsstod | `components/LegalSupportCenter.tsx`, `components/SluExpert.tsx`, `components/TechnicalSluExpert.tsx`, `components/ChatBot.tsx`                                                            | `BYGGS OM` | Delvis produktrelevant men har experimentinslag och AI-risk.                          | Behall som koncept, bygg om runt tydligare use cases.                   |

---

## 8. Frontend: Core, demo och experiment

| Modulgrupp                         | Primara sokvagar                                                                                                                                                  | Status      | Motiv                                                                         | Rekommenderad atgard                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Core-demo och showcase             | `components/CoreDemoInterface.tsx`, `components/CoreWorkflowView.tsx`, `components/core/*`, `services/coreApiClient.ts`, `server/services/coreContractService.ts` | `ARKIVERAS` | Har referensvarde, men ska inte styra nasta produktkarna.                     | Arkivera som demo- och salsmaterial, inte aktiv kärnprodukt.     |
| Frontend example och showcasefiler | `components/examples/*`, `FEATURES_SUMMARY.md`, `COMPREHENSIVE_FEATURES.md`, `INTEGRATION_GUIDE.md`                                                               | `ARKIVERAS` | Dokumenterar ett frontendspår men overdriver produktmognad och ar inte karna. | Flytta till `archive/` eller `docs/archive/frontend-showcase`.   |
| Tekniska showcase-komponenter      | `components/GeminiClientExample.tsx`, `components/SystemFunctionalAnalysis.tsx`, `components/SystemStatus.tsx`, `components/AppReadinessPanel.tsx`                | `BYGGS OM`  | Delvis nyttigt som interna dashboards, men inte stabil produkt-UX.            | Bryt upp i intern analysyta eller arkivera om anvandning saknas. |

---

## 9. Gemensamma klientbibliotek och UI-ramverk

| Modulgrupp                   | Primara sokvagar                                                                                               | Status     | Motiv                                       | Rekommenderad atgard                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| UI-komponentbibliotek        | `components/ui/*`, `components/hooks/*`, `components/context/*`, `components/theme/*`, `services/apiClient.ts` | `BEHALLAS` | Bra kandidat som byggklossar i ny frontend. | Behall men rensa bort overambition, dubblering och bristfalliga typer.      |
| Duplikata klientlager        | `services/documentAccessClient.ts`, `services/documentUploadClient.ts`, spretiga API-klienter i `services/*`   | `BYGGS OM` | Flera klientmönster och ansvar blandas.     | Konsolidera till ett tydligt klientlager per feature eller shared API core. |
| Utility- och hjälpfunktioner | `components/utils/*`, `components/workspacePreload.ts`                                                         | `BEHALLAS` | Lågrisk och enkla att återanvända.          | Behall selektivt i ny struktur.                                             |

---

## 10. Data, scripts, docs och ovriga ytor

| Modulgrupp                        | Primara sokvagar                                                                        | Status      | Motiv                                                                       | Rekommenderad atgard                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Arkiverat utvecklingsmaterial     | `archive/projekt/*`                                                                     | `ARKIVERAS` | Historik, metodik och referensvarde finns, men ska inte vara aktiv produkt. | Behall arkiverat och exkluderat fran aktiv utveckling.                     |
| QA-, analysis- och legal-underlag | `docs/qa/*`, `docs/analysis/*`                                                          | `BEHALLAS`  | Viktigt for spårbarhet, granskning och juridisk hallbarhet.                 | Behall som revisionsunderlag och beslutsstöd.                              |
| Arkitekturdokument                | `docs/architecture/*`                                                                   | `BEHALLAS`  | Strategiskt viktiga for ombyggnad och extern kommunikation.                 | Behall, uppdatera och standardisera språk/kodning.                         |
| Figma och designstöd              | `figma-plugin/*`, `figma-components/*`                                                  | `ARKIVERAS` | Bra som designstöd men inte del av karndrift.                               | Behall som designverktyg, inte som kärnlogik.                              |
| Deploy, docker och infraunderlag  | `deploy/*`, `docker/*`                                                                  | `BEHALLAS`  | Infrastruktur maste leva vidare i nasta generation.                         | Behall, men uppdatera mot ny målarkitektur.                                |
| Scriptflora                       | `scripts/*`                                                                             | `BYGGS OM`  | Blandning av vardefulla driftjobb och engangsskript.                        | Dela i `scripts/ops`, `scripts/migrate`, `scripts/archive`; kassera skräp. |
| Temp, genererat brus och cache    | `coverage/`, `dist/`, `logs/`, `test-results/`, `storage/tmp`, `components/__pycache__` | `KASSERAS`  | Ingen karnaffarsnytta.                                                      | Hall fortsatt borta fran aktiv produkt och indexering.                     |

---

## 11. Konkreta beslut per produktomrade

### Prioritet 1: bygg vidare pa direkt

- Audit och GDPR
- Projektplan och projektstruktur
- Behorighet och access
- Dokument- och kravunderlag
- C-anmälan schaktmassor (`CNotificationMassUI`, `/api/c-notification/mass/*`)
- Lantmateriet och fastighetsdata
- Basala GIS- och naturdata-integrationer

### Prioritet 2: bygg om efter ny domankarna

- Compliance- och regelmotor
- AI-orkestrering och RAG
- Myndighetsinlamning
- Massfloden, storage areas och transport
- Marknad/intelligence och scoring
- Adminstudio och interna dashboards

### Prioritet 3: flytta ut ur aktiv produkt

- Core/demo-spår
- frontend showcase-dokument
- utvecklings- och presentationsmaterial
- experimentella AI- eller analysvyer utan tydlig produktagare

### Prioritet 4: kasta bort eller isolera permanent

- tmp-, cache- och genererade artefakter
- gammal testkod som bara foljer UI-kosmetik
- duplicerade klientmönster utan tydligt ansvar

---

## 12. Rekommenderad nasta arbetsordning

1. Frys detta modulregister som styrdokument.
2. Skapa ny malstruktur for `domain`, `application`, `infrastructure`, `api`, `ui`.
3. Borja med fem karndomaner:
   - Audit
   - Project
   - Requirement
   - Document
   - PermitCase
4. Flytta sedan in:
   - ProjectPlan
   - Property / GeoAssessment
   - StorageArea / MassFlow
   - AuthoritySubmission
5. Migrera frontend featurevis med `PermitPortal` och `ProjectPlan` forst.

---

## 13. Slutbedomning

Repo:t innehaller flera verkligt starka produktmoduler, men ocksa ett tydligt lager av legacy, demo, utvecklingsmaterial och experiment. Ombyggnaden ska darfor inte behandla hela repo:t som lika viktigt.

Den nya produkten bor bygga vidare pa:

- spårbarhet
- regelmotorik
- projekt- och tillstandsfloden
- dokument- och kravbehandling
- fastighets- och GIS-underlag

Den nya produkten bor inte bygga vidare pa:

- otydliga showcase-spår
- historiska experimentytor
- tillfalliga artefakter
- ostandardiserade integrations- och klientlager

Det ar den uppdelningen som gor ombyggnaden hanterbar.
