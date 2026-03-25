# Google AI Studio — Prompt-bibliotek

> Öppna [aistudio.google.com](https://aistudio.google.com), ladda in kontextfilerna från
> `ai_studio_context_manifest.md` och klistra in en prompt nedan.

---

## 📋 Hur du använder den här filen

1. Öppna Google AI Studio
2. Välj rätt modell och ladda in kontextfilerna (se `ai_studio_context_manifest.md`)
3. Klistra in systeminstruction + prompt
4. Iterera och förfina svaret
5. Kopiera förbättrad systeminstruction tillbaka till aktuell servicefil
6. Skicka ändringen till Copilot agent för TS/lint-check + test

---

## Uppgift 1: Förfina kravanalysprompt (suggestRequirementsFromGemini)

### Kontextfiler att ladda in
- `types.ts`
- `server/schemas/mvpSchemas.ts`
- `server/services/mvpAiGatewayService.ts`

### Systeminstruction
```
Du är en expert på svensk miljölagstiftning — miljöbalken (MB), plan- och bygglagen (PBL),
artskyddsförordningen, förordningen om miljökonsekvensbeskrivningar m.fl.
Analysera projektbeskrivningar och identifiera konkreta lagkrav som projektet måste uppfylla.
Svara alltid med giltig JSON. Använd svenska lagcitat med paragraf och kapitel.
Koordinatsystem: SWEREF99 TM (EPSG:3006). Kommuner i Sverige.
```

### Prompt
```
Analysera följande projektbeskrivning och returnera en JSON-lista med tillämpliga krav.

Projektbeskrivning:
"""
Schaktning och bortforsling av 15 000 ton förorenade massor från industritomt
i Göteborg, koordinat N6400000 E320000 (SWEREF99 TM).
Massorna ska mellanlastas på godkänd deponi i Västra Götaland.
"""

Returnera JSON enligt detta schema:
{
  "requirements": [
    {
      "rule": "Kortfattad beskrivning av kravet",
      "law": "Lagrum (t.ex. MB 9 kap. 6 §)",
      "citation": "Exakt lagtext eller vägledande citat"
    }
  ]
}

Inkludera minst: anmälnings-/tillståndsplikt, transportdokumentation (TSFS),
artskyddsprövning, EWC-kod för förorenade massor.
```

---

## Uppgift 2: Förbättra Executive Summary-prompten

### Kontextfiler att ladda in
- `types.ts`
- `server/services/execSummaryQueueService.ts`

### Prompt
```
Nedan är en Executive Summary-prompt som används i en svensk miljötillståndsapp.
Förbättra den så att svaret blir mer strukturerat och inkluderar:

1. En riskbedömning (LÅG / MEDEL / HÖG) baserat på projekttyp
2. En lista med de tre viktigaste åtgärderna att prioritera
3. En rekommendation om tillståndsansökan krävs eller räcker med anmälan

Nuvarande prompt:
"""
[klistra in nuvarande prompt från execSummaryQueueService.ts]
"""

Returnera förbättrad prompt som plain text, klar att klistra in i koden.
```

---

## Uppgift 3: Analysera en miljödom (PDF-upload)

### Kontextfiler att ladda in
- `types.ts`
- `server/services/documentGenerator.ts`
- *(Ladda upp PDF-domen direkt i AI Studio)*

### Systeminstruction
```
Du är ett juridiskt analysverktyg specialiserat på svenska miljödomar.
Extrahera strukturerad information och identifiera tillståndsvillkor.
Svara på svenska. Använd exakta sidnummer och villkorsnummer från domen.
```

### Prompt
```
Analysera den uppladdade miljödomen och extrahera:

1. Tillståndsinnehavare (namn, org.nr)
2. Beviljad verksamhet (kortfattat)
3. Tillståndsgräns (mängd, enhet, tidsgräns)
4. Villkorslista (numrerade villkor med sammanfattning)
5. Prövningstillstånd krävs? (ja/nej)
6. Domstol och målnummer

Returnera som JSON:
{
  "permit_holder": "...",
  "activity": "...",
  "capacity_limit": "...",
  "conditions": [{"number": 1, "summary": "..."}],
  "appeal_permission_required": true,
  "court": "...",
  "case_number": "..."
}
```

---

## Uppgift 4: Validera och förbättra RAG-svar

### Kontextfiler att ladda in
- `types.ts`
- `server/services/ragSearchService.ts`

### Prompt
```
Nedan är ett RAG-svar (Retrieval-Augmented Generation) från Miljöbeslut-systemet.
Granska svaret och identifiera:

1. Faktafel eller felaktiga lagcitat
2. Svar som behöver mer precision
3. Saknade relevanta rättsliga överväganden

RAG-svar att granska:
"""
[klistra in svar att granska]
"""

Returnera:
{
  "issues": ["issue1", "issue2"],
  "missing_considerations": ["..."],
  "corrected_citations": [{"original": "...", "corrected": "..."}],
  "quality_score": 0.0
}
```

---

## Uppgift 5: Generera testdata med svenska tecken

### Prompt (ingen kontextfil behövs)
```
Generera 5 realistiska svenska fastigheter med:
- Fastighetsbeteckning (t.ex. "Göteborg Lundby 5:12")
- Koordinat i SWEREF99 TM (N: 6300000–6700000, E: 250000–900000)
- Kommunnamn med korrekt stavning (å/ä/ö)
- EWC-kod för schaktmassor (17 05 03* eller 17 05 04)

Returnera som JSON-array.
```
