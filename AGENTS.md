# Arbetssätt – Miljöbeslut V2.0 (Cloud & Vertex Edition)

- Kör aldrig full omindexering utan explicit godkännande.
- Tolka frågor som frågor, inte som körorder.
- Bekräfta innan jobb som kan ta mer än 5 minuter.
- Om något verkar ologiskt: stoppa och fråga.

# Kvalitetskrav

- **Modularitet först:** Ingen ny kod får läggas i "monoliten". Allt ska moduläriseras under `/services`, `/packages` eller `/modules`.
- **Cloud Native:** All infrastruktur ska beskrivas som kod (t.ex. `cloudbuild.yaml`, `Dockerfile.gcp`).
- **Juridisk hållbarhet:** All programmering måste följa svenska regler för miljödata och sekretess.
- **Human in the loop:** Du granskar och godkänner allt innan produktion.

# Arkitekturpolicy: Mimers Brunn (Offline-First)

- **Download-first:** Live-API:er (WMS/WFS/REST) får bara vara tillfälliga visuella hjälpmedel. Varje permanent dataset ska ha en robust harvesting-pipeline som laddar ner rådatan fysiskt.
- **Ny gyllene regel:** Skörda alltid om från källan enligt Mimers Brunn om källan är tillgänglig och nedladdningen är rimligt snabb. Varje ny eller omarbetad källa ska landa i canonical path med manifest v2, `files_detail`, SHA-256 och storlek per fil.
- **Legacy-adoption är undantag:** Adoptera äldre nedladdad data endast om källan har försvunnit, datamängden är extremt tids- eller kostnadskrävande att hämta igen, eller den kräver manuell export/tillståndsprocess. Undantag ska dokumenteras.
- **Definition of Done:** Kärndataset får inte räknas som stängt förrän audit visar 0 % `checksum_missing` och 0 % `legacy_path_mismatch`.
- **Master-arkivet är canonical:** Nya data- och dokumentpipelines får inte skriva till gamla rötter som `D:\GEodata`, `D:\Geo inlärning` eller `C:\GEO PDF`. Nya nedladdningar ska landa under `H:\Delade enheter\Miljöbeslut\GEO_Master_Archive`.
- **Data ska säkras innan import:** Vektordata importeras till PostGIS efter arkivering. Raster registreras via stabila Out-of-DB-länkar från Master-arkivet. Importera inte från `_review` eller temporära mappar.
- **Lokala källhänvisningar:** PDF:er, domar och rapporter ska arkiveras under `GEO_Master_Archive\Documents\Sources\<Provider>\<Dataset>` och serveras från lokal arkivroute. Frontend ska inte bygga beslutskritiska länkar direkt mot original-URL:er.
- **Harvesting-kontrakt:** Nya nedladdningspipelines ska bevara versioner, aldrig skriva över historiska filer, använda polite scraping (rate limiting, retry/backoff, checkpoints) och skriva SHA-256 + storlek i manifest för varje fil.
- **Legacy är undantag, inte norm:** Befintliga äldre scripts med hårdkodade D:/C:/gamla H:-vägar ska betraktas som migrationsskuld. Nya eller refaktorerade `scripts/import/`-moduler ska följa Mimers Brunn.

# 🤖 AI-verktygsdirektiv – V2.0

## Beslut: vilka AI-verktyg som används

| Verktyg                                 | Status                   | Roll                                           | Motivering                                                                            |
| --------------------------------------- | ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Antigravity (Gemini)**                | ✅ BEHÅLLS – ARCHITECT   | Cloud & AI Architect (Vertex AI, GCP, Moduler) | Googles modersmål. Bäst på Vertex AI, GCP-infra och att designa modulära system.      |
| **GitHub Copilot Agent**                | ✅ BEHÅLLS – PRIMARY     | Skriver, testar, commitar all kod              | Ser hela kodbasen, kör TS+ESLint+Vitest före varje commit. Den som "håller i pennan". |
| **Google AI Studio**                    | ✅ BEHÅLLS – PROTOTYPING | Gemini-prompter, datatvätt, snabb analys       | Bäst på Gemini 2.0 Flash-anrop och snabb prototypning – levererar SPECIFIKATION.      |
| **Figma Make**                          | ✅ BEHÅLLS – DESIGN      | UI-spec och layout-beskrivningar               | Levererar visuell specifikation för komponenter.                                      |
| **VS Code / Cursor / Copilot (lokalt)** | ✅ BEHÅLLS – LOKAL UI    | Inline autocomplete, snabba fixar, styling     | Komplement för snabba visuella tweaks i editorn.                                      |

---

## Regler per verktyg

### ✅ Antigravity (ARCHITECT)

- **Huvudansvar:** Vertex AI SDK-integrationer, GCP IAM/Storage/Cloud Run, och den övergripande modulära strukturen.
- **Metodik:** Designar "Blueprints" och infrastruktur-kod. Guidar Copilot Agent i komplexa molnfrågor.

### ✅ GitHub Copilot Agent (IMPLEMENTERER)

- **Enda AI som commitar kod** (för att undvika Git-kaos).
- Kör alltid `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` före commit.
- Ansvarar för: backend, services, tester, CI/CD-pipelines.

### ✅ Google Vertex AI (PROD AI)

- Den primära AI-motorn för applikationen i produktion.
- Alla anrop ska gå via säkrade tjänster i Google Cloud.

---

## Flöde: vem gör vad

```
Du (JbmbAb)
    │
    ├─► Antigravity  ──► Cloud/Vertex Arkitektur + Modulär plan ──┐
    ├─► Figma Make   ──► UI-spec (text)                          ──┤
    │                                                              │
    └─► Copilot Agent ──► Implementering + Tester + Commit ───────┴──► PR ──► Du godkänner
```

**Gyllene regel:** Antigravity designar den molnbaserade framtiden, Copilot Agent bygger den. Endast en AI (Copilot Agent) commitar för att hålla historiken ren.

---

## AI-modellval – Cloud & Vertex

| Uppgift                  | Verktyg                | Modell            | Plattform        |
| ------------------------ | ---------------------- | ----------------- | ---------------- |
| Cloud-arkitektur & GCP   | Antigravity            | Gemini 1.5 Pro    | Google Ecosystem |
| Daglig kodgenerering     | Cursor + Copilot Agent | Claude 3.5 Sonnet | Anthropic/Cursor |
| Analys av enorma dataset | AI Studio / Vertex     | Gemini 1.5 Pro    | Vertex AI (GCP)  |
| Realtids-UI & Styling    | Cursor                 | Claude/Gemini     | Lokal editor     |

---

## Konfliktförebyggande & Säkerhet

1. **GitLens:** Används aktivt för att spåra vem som ändrat vad, speciellt vid refaktorering av gamla moduler.
2. **Vertex AI Secrets:** Inga API-nycklar i koden. Allt via Google Secret Manager.
3. **Branching:** Ny modul = ny branch. Inga commits direkt mot `main`.
4. **CI/CD:** Innan merge till `main` måste Cloud Build-pipelinen passera.
