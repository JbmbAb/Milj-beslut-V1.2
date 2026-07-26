# Helikopterutvärdering: Miljöbeslutsplattformens Arkitektur 2026

Detta dokument utgör en fullständig helikopteranalys och utvärdering av arkitekturkoden i miljöbeslutsplattformen (`miljobeslut-platform-recovery`), med fokus på renodling till en skarp, högpresterande MVP.

---

## 1. Strukturell Arkitekturanalys

Plattformen genomgår en aktiv migration från en Express-monolit (`server/`) till en strikt och juridiskt robust Clean Architecture-struktur i `src/`. Utvärderingen visar att grundbultarna är extremt välkonstruerade:

### 1.1 Domänlager (`src/domain/`)
- **Status:** Mycket stark.
- **Utvärdering:** Innehåller rena TypeScript-kontrakt och entitetsbeskrivningar (t.ex. `permit.ts`, `geo.ts`, `requirement.ts`, `audit.ts`). Lagret har noll externa beroenden till ramverk eller databaser, vilket garanterar att den regulatoriska affärslogiken förblir skyddad och testbar oberoende av infrastrukturbyten.

### 1.2 Applikationslager (`src/application/`)
- **Status:** Hög mognadsgrad.
- **Utvärdering:** Innehåller renodlade användningsfall (Use Cases) som orkestrerar affärslogiken. De tre MVP-kärnflödena är mycket väl implementerade:
  1. `assess-sewage-application.usecase.ts` (Enskilt avlopp)
  2. `evaluate-sewage-regulations.usecase.ts` (Juridiska lagkrav)
  3. `generate-localization-report.usecase.ts` (Lokaliseringsutredning)
  4. `generate-report-pdf.usecase.ts` (PDF-generering)
- **Kommentar:** Separationen av concerns är utmärkt. Det finns dock vissa kvarvarande integrationer mot äldre service-klasser i `server/services/`, vilket hanteras enligt *Strangler Fig*-mönstret.

### 1.3 Infrastrukturlager (`src/infrastructure/`)
- **Status:** Robust och redo för produktion.
- **PostGIS Geodata-adapter (`postgis-geo-adapter.ts`):** Mycket välskriven. Den dämpar prestandaproblem genom automatisk geometriförenkling (`ST_SimplifyPreserveTopology` med tröskelvärden) på tunga spatialskikt, hanterar SQL-injektionsskydd via identifier-quoting och transformerar koordinater sömlöst (från databasens EPSG 3006 / SWEREF99 TM till frontendens EPSG 4326 / WGS84).
- **Vertex AI & RAG (`ai/`):** Innehåller en fullt frikopplad `llm-provider.ts` och `ai-orchestrator.ts`. Stöder mock-anrop i lokala tester samt skarpa Vertex AI-SDK-integrationer (Gemini 2.0/2.5 Flash) via antingen API-nyckel eller Application Default Credentials (ADC) i Google Cloud.

---

## 2. Identifierade arkitektoniska glapp & förvirringskällor

Vid en "helikoptervy" av hela repot blir det uppenbart varför plattformen kan upplevas som överlastad eller oklar:

1. **"Enterprise-fluff" i gränssnittet:**
   - Sidomenyn (`components/AppSidebar.tsx`) och startsidan visar flera avancerade moduler som "Logistik schaktmassor", "Projektplansportfölj" (med Gantt-scheman och organisationskartor), "Egenkontroll" och "Administrator".
   - Dessa är kvarlevor från tidigare visionsfaser eller prototyp-scenarier. De skapar ett enormt visuellt brus och distraherar från den kliniskt rena MVP:n.
2. **Dokumentationsöverflöd:**
   - Det finns dussintals gamla planer, leveransrapporter och tunga administrationsbeskrivningar direkt i rotkatalogen och under `docs/`.
   - Flera av dessa diskuterar ej MVP-relevanta koncept som "Bank-rating AAA till C", "Finansieringsrisker", "CO2-estimat för lastbilsflottor" samt "LIMS lab-integration". Detta gör det svårt för nya utvecklare eller systemet själv att behålla fokus på det som faktiskt räknas: *fungerande kartlager och en prestandasäkrad, utskrivbar PDF*.

---

## 3. Strategiska Rekommendationer

### 🚀 Gränssnittssanering (Fas 1)
- **Åtgärd:** Dölj helt eller arkivera de inaktuella modulerna i sidomenyn och huvudvyn.
- **Konkret genomförande:** Ändra i `components/app/modeCards.ts` och `components/AppSidebar.tsx` så att endast **Huvudmoduler** (Enskilt avlopp, C-anmälan, Lokaliseringsutredning) och eventuellt **Juridiskt Stöd** visas. Detta ger användaren den utlovade kliniskt rena ytan med 100 % fokus på kärnverksamheten.

### 📁 Dokumentationssanering (Fas 1) — ✅ genomförd 2026-07-26
- **Åtgärd:** Tog bort inaktuella leveransplaner (`docs/archive/legacy_plans/`), föråldrade root-guider (`DEPLOYMENT_GUIDE.md`, `RUN_ME.md`, m.fl.) och vilseledande arkitekturbeskrivningar (`docs/ny-plattform-arv.md`).
- **Effekt:** Canonical docs pekar via `docs/archive/README.md`; RAG och nya bidragare riskerar inte att följa utdaterade antaganden.

### 🛡️ Juridisk Hållbarhet & Mimers Brunn (Fas 2)
- **Åtgärd:** Säkerställ att all dokumentation som skördas i Fas 2 lagras fysiskt i Master-arkivet under `GEO_Master_Archive` med manifest v2, SHA-256 och detaljerad filstorlek.
- **Effekt:** Garanterar offline-first funktionalitet och juridiskt bevisbar integritet, helt i linje med Mimers Brunn-policyn.

---

## 4. Slutsats

Plattformen har en mycket vacker och professionell Clean Architecture-kärna i `src/`. Prestandan i PostGIS-adaptern och strukturen för RAG-motorn är på absolut toppnivå. Genom att utföra en omedelbar gränssnitts- och dokumentationssanering (Fas 1) kommer vi att kunna leverera en fokuserad och extremt slagkraftig MVP som sätter geodata och prestanda i första rummet.
