# ADR-006: Kontrollerad migrering från `server/services` mot `src/` och `server/modules`

**Datum:** 2026-06-10
**Status:** Accepterad

## Kontext

Plattformen har flera samexisterande backend-arkitekturer: ett äldre, monolitiskt `server/services`-lager, en pågående modulär migration i `server/modules/*`, och en ny, renare målarkitektur i `src/`. Detta har lett till otydlighet och teknisk skuld. Analysdokumentet `platform-total-analysis-2026-04-02.md` identifierar detta som ett strukturellt problem.

## Beslut

1.  **Stopp för ny domänlogik i `server/services`:** All ny, bred affärslogik ska implementeras enligt målarkitekturen i `src/` eller som en del av en pågående domänmigrering i `server/modules/*`. Katalogen `server/services` betraktas som teknisk skuld och ska inte växa.

2.  **`server/modules` är en accepterad övergångszon:** För befintliga domäner som ännu inte är redo för en full `src/`-migrering är `server/modules/<domain>` den föredragna platsen för att samla och strukturera om kod från `server/services`.

3.  **`server/routes` ska vara tunna adaptrar:** Ruttfiler ska primärt hantera HTTP-specifika uppgifter (request/response, auth, felhantering) och delegera affärslogiken till applikationstjänster i `src/application` eller `server/modules`.

4.  **Användning av Strangler Fig-mönstret:** Vi kommer att stegvis "strypa" det gamla `server/services`-lagret genom att ersätta dess funktionalitet, del för del, med nya implementationer. Det gamla lagret agerar som en proxy eller adapter under övergången.

5.  **CI-spärr med baslinje:** En CI-kontroll (`scripts/ci/assert-legacy-layer-growth.ts`) införs. Den förhindrar att _nya_ filer läggs till i `server/services` och `server/routes` genom att jämföra mot en incheckad baslinje.

## Konsekvenser

### Positiva

- Skapar en tydlig och enhetlig arkitektur för all framtida utveckling.
- Erkänner och strukturerar den pågående modulära migreringen.
- Minskar den kognitiva belastningen för utvecklare.
- Förbättrar testbarhet och underhållbarhet.
- Tvingar fram en uppstädning av teknisk skuld på ett kontrollerat sätt.

### Negativa

- Kräver disciplin för att inte ta genvägar och fortsätta bygga i det gamla `server/services`-lagret.
- Kräver en medveten ansträngning att inte ta genvägar och fortsätta bygga i det gamla lagret.

Detta beslut är avgörande för plattformens långsiktiga hälsa och skalbarhet, och balanserar behovet av en ren arkitektur med den pragmatiska verkligheten i en stor kodbas under utveckling.
