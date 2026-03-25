# Google AI Studio — Context Manifest

> Vilka filer du ska ladda upp i Google AI Studio ([aistudio.google.com](https://aistudio.google.com)) beroende på uppgift.
> Ladda alltid in filer i angiven ordning — AI Studio läser dem uppifrån och ned.

---

## Användningsområden

| Uppgift | Bäst lämpad för AI Studio |
|---|---|
| Finjustera system-promptar för Gemini-tjänster | ✅ Ja — interaktivt promptlab |
| Testa RAG-svar med verkliga dokument | ✅ Ja — stöder PDF-upload direkt |
| Prototypa strukturerade JSON-svar | ✅ Ja — `application/json`-läge |
| Analysera krav och lagtexter | ✅ Ja — lång kontextfönster (1M tokens) |
| Testa embeddings | ✅ Ja — `gemini-embedding-001` tillgänglig |
| Generera UI-komponenter | ⚠️ Hellre Figma Make / Stitch |
| Lokal databas-integrering | ❌ Nej — använd VS Code |

---

## Session 1: Prompt-tuning för kravanalysen (mvpAiGatewayService)

Ladda in dessa filer i ordning:

1. `types.ts`
2. `constants.ts`
3. `server/schemas/mvpSchemas.ts`
4. `server/services/mvpAiGatewayService.ts`

**Modell att välja**: `gemini-2.5-pro`  
**Temperature**: `0.1`  
**Response MIME**: `application/json`

**Systeminstruction** (klistra in i "System instructions"):

```
Du är en expert på svensk miljölagstiftning och miljöbalken (MB).
Du analyserar projektbeskrivningar och identifierar tillämpliga lagkrav.
Svara alltid med giltig JSON enligt angivet schema.
Använd svenska lagcitat och paragrafnummer.
Koordinatsystem: SWEREF99 TM (EPSG:3006).
```

---

## Session 2: Prompt-tuning för RAG-sökning (ragSearchService)

Ladda in dessa filer i ordning:

1. `types.ts`
2. `server/services/ragSearchService.ts`
3. `server/services/searchService.ts` (rad 1–100)

**Modell att välja**: `gemini-2.0-flash`  
**Temperature**: `0.2`

---

## Session 3: Dokumentanalys och kravextraktion

Ladda in dessa filer + ett PDF-dokument (t.ex. en miljödom):

1. `types.ts`
2. `server/services/documentGenerator.ts`
3. `server/repositories/requirementRepository.ts`
4. *(Valfritt: ladda in en PDF-miljödom direkt i AI Studio)*

**Modell att välja**: `gemini-2.5-pro`  
**Kontextfönster**: upp till 1 000 000 tokens → kan analysera hela domar

---

## Session 4: Finjustera Executive Summary-prompten

Ladda in dessa filer i ordning:

1. `types.ts`
2. `server/services/execSummaryQueueService.ts`

**Modell att välja**: `gemini-2.0-flash`  
**Temperature**: `0.3`

---

## Session 5: Testa embedding-pipeline

Ladda in:

1. `server/services/searchService.ts` (rad 580–650, `embedText`-funktionen)

**Modell att välja**: `text-embedding-004` eller `gemini-embedding-001`  
**Dimension**: `768`

---

## Exportera förbättrad prompt tillbaka till kodebasen

1. Testa och validera prompten i AI Studio
2. Kopiera den slutgiltiga `systemInstruction`-texten
3. Öppna rätt servicefil i VS Code eller skicka till Copilot agent
4. Ersätt systemprompten i den aktuella servicen
5. Kör `npm run test:unit` för att verifiera att inga typer bröts

---

## Säkerhet

- Ladda **aldrig** upp `.env`, `prisma/schema.prisma` med lösenord, eller PFX-certifikat till AI Studio.
- Ladda inte upp riktiga personuppgifter (GDPR) — använd anonymiserade testexempel.
- AI Studio-sessioner är inte kopplade till produktionsdatabasen.
