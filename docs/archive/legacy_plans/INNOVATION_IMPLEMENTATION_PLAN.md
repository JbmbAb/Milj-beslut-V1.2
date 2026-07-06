# Innovation Clarification and Implementation Plan

Detta dokument oversatter kravbilden till konkret teknik i plattformen.

## 1. Karninnovationer

### 1.1 RAG med strikt evidens (noll-hallucination malbild)

- Status nu:
  - Semantisk sokning kor mot intern dokumentindex (chunks + embeddings i databas).
  - `strictEvidence` ar inford i sok-API.
  - Resultat utan kallcitat kan filtreras bort innan svar returneras.
- Implementerat i kod:
  - `POST /api/search/query` accepterar `strictEvidence`.
  - Svar innehaller `guardrails` + `citations` per resultat.

### 1.2 Aktiv kallhanvisning

- Status nu:
  - Varje sokresultat kan leverera kallcitat med confidence och citationId.
  - Admin-vyn visar kallcitat direkt och hover visar exakt citat.
- Implementerat i kod:
  - `searchData.results[].citations[]` i API-svar.
  - UI-stod i `AdminSearchConsole`.

### 1.3 Human-in-the-loop och ansvars-sparrar

- Status nu:
  - Dokumentflode ar utkastdrivet.
  - Stage gate `DOCUMENT_CONTROL` kraver nu:
    - verifierade dokument
    - minst en signaturhandelse (`signatureId`) i audit trail.
- Implementerat i kod:
  - hardare gate-logik i `services/projectStructure.ts`.

### 1.4 Smart kodvaljare + geofencing

- Status nu:
  - Grundlaggande permit/gate-ramverk finns.
  - Geodatafloden finns i integrationslager (Lantmateriet/SGU med flera), men automatisk MPF-triggring pa EWC/SNI ar inte fullt inford an.
- Nasta steg:
  - lagg till regelmotor-tabell for MPF-trosklar per kod.
  - bind kodval till gate-utvardering + ganttjustering.

### 1.5 Compliance Index for banker

- Status nu:
  - Audit export och kedjekontroll finns.
  - Compliance-score finns i produktens vyer.
- Nasta steg:
  - taxonomi-mappning per indikator
  - bankerelaterad scoreprofil i separat API.

## 2. Strategiska integrationer

### 2.1 Fraktbors/transportflottor

- Foreslagen implementation:
  - nytt adapterlager: `transportDispatchService`
  - webhook/API-utskick nar permit- och riskgates ar passerade.

### 2.2 Dynamisk domstolspraxis (MMD/MOD)

- Foreslagen implementation:
  - daglig ingest-pipeline till separat praxis-index.
  - RAG-ranking med viktad kombination: lagtext + myndighetsstod + praxis.

### 2.3 ERP/ekonomisynk

- Foreslagen implementation:
  - trigger vid gate-pass -> eventbus -> Fortnox/Visma-adapter.
  - grans for vilka kostnadsposter som frislapps.

### 2.4 LIMS-integration (ALS/Eurofins)

- Foreslagen implementation:
  - import av signerade analysrapporter via API/SFTP.
  - automatisk validering mot riktvarden och gate-regler.

## 3. Prioriteringsordning (rekommenderad)

1. Strikt evidens + kallhanvisning (klar, nu i drift).
2. Signaturstyrd gate-policy (klar i logik, behov av fler signatur-events i data).
3. MPF-kodmotor + geofencing automation.
4. Transportdispatch och ERP-trigger.
5. Praxis- och LIMS-ingest.
