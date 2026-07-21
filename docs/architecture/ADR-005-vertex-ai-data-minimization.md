# ADR-005: Vertex AI — dataminimering och förbud mot identifierare i prompt

**Status:** Antagen  
**Datum:** 2026-04-26  
**Beslutsfattare:** Produkt + plattform (formell signatur enligt er interna rutin)

## Kontext

Vertex AI (och liknande LLM-gränssnitt) används för analys, sammanfattning och framtida verktygsorkestrering. Miljö- och myndighetsdomänen innehåller **personuppgifter**, **kundsekretess** och data som kan **återidentifiera** fysiska personer eller avslöja känsliga ärenden om de skickas ofiltrerat i prompt.

## Beslut

1. **Förbjudet innehåll i LLM-prompt (Vertex)** utan föregående dokumenterad undantagsprocess:
   - **Riktiga svenska fastighetsbeteckningar** (fullständiga, som de förekommer i handlingar och register).
   - **Personnamn** och **kontaktuppgifter** (e-post, telefon, personnummer, BankID-relaterade identifierare i klartext).
   - **Diarienummer / ärendenummer** som i praktiken pekar ut ett unikt myndighetsärende i kombination med kommun eller tidsstämpel, om det inte uttryckligen bedömts som ofarligt och minimerat.

2. **Tillåtet** efter minimering och behovsprovning:
   - **Aggregerade eller pseudonymiserade** platshänvisningar (t.ex. kommun + grov zon, eller internt `projectId` utan mänsklig läsbar beteckning i prompt).
   - **Citat från juridiska källor** som redan är offentliga, under strikt evidensläge (RAG) och utan onödiga personuppgifter i samma sträng.

3. **Verktygsspår:** När beslut ska förklaras ska **siffror och risknivåer** i första hand komma från **deterministiska verktyg** (regelmotor, PostGIS-frågor med minimerad retur), inte från fri modelltext — se även ADR för verifierat verktygsspår.

4. **Undantag:** Endast efter skriftlig riskbedömning (t.ex. DPIA-tillägg), begränsad pilot, loggning och gallring enligt register över behandlingar.

## Konsekvenser

- Nya features som bygger `prompt = ...` måste genomgå **checklista**: *Vilka fält? Vilken klass enligt `governance/data_matrix.md`?*
- Tekniska hjälpfunktioner (maskning, intern ID-only) bör centraliseras så samma regel gäller alla anrop till Vertex.
- Kunddemo kan kräva **syntetiska** exempel i stället för produktionsbeteckningar.

## Alternativ som avvisats

- **“Skicka hela dossieren till modellen”** — avvisat som standard på grund av PII- och sekretessrisk.
- **Endast muntlig policy** — avvisat; ADR + matris ska vara spårbara vid revision.

## Relaterade dokument

- [Dataklassning & modulägarskap](governance/data_matrix.md)
- [Plan: CI-importgränser (ESLint)](governance/ci-import-boundaries-plan.md)
