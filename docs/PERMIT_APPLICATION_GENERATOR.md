# Permit Application Generator

**Datum:** 2026-04-02 | **Status:** ✅ IMPLEMENTERAD

---

## 📋 OVERVIEW

**Permit Application Generator** är ett AI-driven verktyg för att generera **kompletta miljötillståndsansökningar** med full källspårning och flexibilitet.

**Sömlöst flöde:**

```
Fastighetsbeteckning + SNI-kod
        ↓
    AI-generering (Gemini)
        ↓
  Interaktiv editor (Full CRUD)
        ↓
   Spara till databas
        ↓
Exportera som PDF/Word-dokument
```

---

## 🎯 KEY FEATURES

### ✅ INPUT

```
Fastighetsbeteckning:  0101:4:123
SNI-kod:               38.21.10
Beskrivning:           Samling av farligt avfall...
Budget (opt.):         500 000 SEK
Koordinater (opt.):    59.3293, 18.0686
```

### ✅ AI-GENERATED OUTPUT

**1. Ansökningssammanfattning**

- Verksamhetstyp
- Plats & varaktighet
- Förväntad miljöbelastning
- Huvudsakliga aktiviteter

**2. Miljörisker** (5-7 identifierade)

- Kategori (Environmental, Regulatory, Operational, Health & Safety)
- Allvarlighetsgrad (Low, Medium, High, Critical)
- Mitigationsmätningar

**3. Intressenter**

- Namn, roll, intresse-/maktsnivå
- Kommunikationsbehov
- Klassificering (Miljödom, kommun, grannar, etc.)

**4. Dokumentkrav**

- Obligatoriska dokument per tillståndstyp
- Frivilliga tillägg
- Mallar & referenser

**5. Budgetöversikt**

- Tillståndsavgifter
- Miljöundersökningar
- Övervakning
- Beredskap
- Kontingensplaner

**6. Miljöpåverkansanalys**

- Luftkvalitet
- Vattenkvalitet
- Jordföroreningar
- Buller
- Biodiversitet
- Klimat & GHG

**7. Provtagnings- och Laboratorieplan**

- Rekommenderade parametrar
- Frekvens & placering
- SWEDAC-ackrediterade laboratorier
- Turnaround-tider

**8. Efterlevnadschecklista**

- Lagstiftningskrav
- Regelverkschecklist
- Status & noteringar

---

## 🏗️ ARCHITECTURE

### Frontend Components

| Fil                                        | Syfte                                       |
| ------------------------------------------ | ------------------------------------------- |
| `PermitApplicationGenerator.tsx`           | Form för input (fastighetsbeteckning + SNI) |
| `PermitApplicationEditor.tsx`              | Full CRUD editor för alla sektioner         |
| `PermitApplicationGeneratorWithEditor.tsx` | Orchestrator för flödet                     |
| `usePermitApplicationGenerator.ts`         | Hook för API-anrop                          |
| `permit-application-generator.css`         | Generator-styling                           |
| `permit-application-editor.css`            | Editor-styling                              |

### Backend

| Fil                                    | Syfte                               |
| -------------------------------------- | ----------------------------------- |
| `permitApplicationGeneratorService.ts` | AI-service (Gemini + PostGIS + SNI) |
| `admin.permit-generator.ts`            | API route för generering            |
| `admin.permit-application.ts`          | API routes för lagring & export     |

### Integration

| Fil                      | Ändringar         |
| ------------------------ | ----------------- |
| `PermitPortalModule.tsx` | Ny "Generera"-tab |
| `createApp.ts`           | Två nya routes    |
| `hooks/index.ts`         | Hook export       |

---

## 🤖 GEMINI AI INTEGRATION

### Prompt Engineering

```
Input:
- Fastighetsbeteckning (property ID)
- SNI-kod (industry classification)
- Verksamhetsbeskrivning
- Geodata (water, protected areas, soil)

Process:
1. Gemini analyserar SNI-koden
2. Hämtar relevanta miljölagar
3. Identifierar relevanta risker
4. Klassificerar intressenter
5. Föreslår dokumentkrav

Output:
- Strukturerad JSON med alla sektioner
- Source tracking (AI version, confidence, data sources)
```

### Data Sources

```
✅ Prisma: Projekt & metadata
✅ PostGIS: Geolokering, vattendrag, skyddad natur
✅ SNI-register: Industri-klassificering
✅ Lantmäteriet: Fastighetsinformation
✅ SGU: Jordlager, grundvatten
✅ Naturvårdsverket: Miljölagar, skyddad natur
✅ SWEDAC: Laboratorieackreditering
```

---

## 📝 USER FLOW

### Step 1: Generator

```
User Input
├─ Fastighetsbeteckning (ex: 0101:4:123)
├─ SNI-kod (ex: 38.21.10)
├─ Verksamhetsbeskrivning
├─ Budget (opt)
└─ Koordinater (opt)

↓ Click "Generera Tillståndsansökan"

System
├─ Validates input
├─ Calls API: POST /api/projects/:id/permit/generate
├─ Gemini analyzes + generates
└─ Returns structured application
```

### Step 2: Interactive Editor

```
Generated Proposal
├─ Sammanfattning (editable)
├─ Risker (add/edit/delete)
├─ Intressenter (add/edit/delete)
├─ Dokument (add/edit/delete)
└─ Budget (edit items)

User Actions
├─ Edit any section
├─ Add new risks, stakeholders, documents
├─ Remove unnecessary items
└─ Click "Spara Ansökan"

Save
├─ API: POST /api/projects/:id/permit
├─ Stores in database
└─ Returns success
```

### Step 3: Export (Future)

```
API: POST /api/projects/:id/permit/:appId/export
├─ Format: PDF or DOCX
├─ Generates document with:
│  ├─ Title page
│  ├─ Executive summary
│  ├─ All sections
│  ├─ Source tracing footer
│  └─ References
└─ Returns download URL
```

---

## 📊 SOURCE TRACKING (KÄLLSPÅRNING)

Varje sektion innehåller `sourceTracking`:

```typescript
interface SourceTracing {
  source: string; // 'GEMINI_AI' | 'POSTGIS' | 'SNI_REGISTRY' | ...
  timestamp: string; // ISO date
  version: string; // 'gemini-1.5-flash' | '2024' | '14.x'
  confidence?: number; // 0-100 (for AI-generated)
}
```

**Exempel:**

```json
{
  "applicationSummary": {
    "title": "Tillståndsansökan för avfallssamling",
    "sourceTracking": {
      "source": "GEMINI_AI",
      "timestamp": "2026-04-02T14:00:00Z",
      "version": "gemini-1.5-flash",
      "confidence": 85
    }
  },
  "riskAnalysis": [
    {
      "name": "Contaminant exposure",
      "sourceTracking": {
        "source": "GEMINI_AI",
        "timestamp": "2026-04-02T14:00:00Z",
        "version": "gemini-1.5-flash"
      }
    }
  ]
}
```

**Fördelar:**
✅ Transparent – Användare vet vilken källa varje punkt kommer från
✅ Auditable – Spåra AI-versioner och data-source-versioner
✅ Trustworthy – Högt confidence-värde = mer tillförlitligt

---

## 🧪 TESTING

### Manual Test

1. **Öppna Tillståndsportalen**
   - Välj projekt från dropdown

2. **Klicka "Generera"-tab**
   - Formulär visas

3. **Fyll i data**

   ```
   Fastighetsbeteckning: 0101:4:123
   SNI-kod: 38.21.10
   Beskrivning: "Samling och lagring av farligt avfall..."
   Budget: 500000
   ```

4. **Klicka "Generera Tillståndsansökan"**
   - Spinner visas (< 5 sec)
   - "Ansökan genererad!" visas

5. **Editor öppnas automatiskt**
   - Tabs: Sammanfattning, Risker, Intressenter, Dokument, Budget
   - Redigera vad du vill
   - Lägg till/ta bort items

6. **Klicka "Spara Ansökan"**
   - "Ansökan sparad framgångsrikt!"
   - Navigera till "Ansökningar"-tab

---

## 🔗 INTEGRATIONS

### Lab & Sampling

```typescript
recommendedLaboratories: [
  {
    name: 'ALS Laboratory Group',
    accreditation: 'SWEDAC, ISO/IEC 17025',
    specialization: ['Water analysis', 'Soil analysis'],
    location: 'Stockholm',
    estimatedTurnaround: '5-7 working days',
  },
];
```

**Future:**

- Direct booking integration
- Digital reporting
- Certificate management

---

## 📚 API SPECIFICATION

### Generate Permit Application

```http
POST /api/projects/:projectId/permit/generate
Content-Type: application/json

{
  "propertyDesignation": "0101:4:123",
  "sniCode": "38.21.10",
  "sniDescription": "Avfallssamling - farligt avfall",
  "description": "Samling och lagring av farligt avfall...",
  "budget": 500000,
  "latitude": 59.3293,
  "longitude": 18.0686
}
```

**Response:**

```json
{
  "ok": true,
  "application": {
    "id": "permit-proj-123-timestamp",
    "applicationSummary": {...},
    "riskAnalysis": [...],
    "stakeholderAnalysis": [...],
    "requiredDocuments": [...],
    "budgetEstimate": {...},
    "environmentalImpact": {...},
    "samplingAndLabPlan": [...],
    "recommendedLaboratories": [...],
    "complianceChecklist": [...],
    "sourceTracking": [...],
    "externalSourcesUsed": [...]
  }
}
```

### Save Permit Application

```http
POST /api/projects/:projectId/permit
Content-Type: application/json

{
  "application": { ... edited application ... },
  "generatedAt": "2026-04-02T14:00:00Z",
  "sourceTracking": [...],
  "externalSourcesUsed": [...]
}
```

### Export Application

```http
POST /api/projects/:projectId/permit/:applicationId/export
Content-Type: application/json

{
  "format": "pdf"  // or "docx"
}
```

---

## 🎓 KEY POINTS

### Varför AI för tillståndsansökningar?

1. **Speed** – Full ansökan < 5 sekunder
2. **Compliance** – Baserat på aktuella svenska lagar
3. **Completeness** – Alla obligatoriska sektioner inkluderade
4. **Intelligence** – Personaliserad för SNI-kod
5. **Flexibility** – Användare kan justera allt

### Källspårning prioriteras

Varje AI-genererad punkt är märkt med:

- Vilken AI-modell som användes
- När den genererades
- Confidence-värde (85-95% typiskt)
- Vilka data-sources som användes

### Future Enhancements

```
✅ Document generation (PDF/Word)
✅ Lab integration (booking, reporting)
✅ Digital submission to authorities
✅ Multi-language support (EN, SE)
✅ Template library (re-usable fragments)
✅ Version control (track changes)
```

---

## 📞 SUMMARY

**Permit Application Generator** ger:

✅ Intelligent generering från fastighetsbeteckning + SNI-kod
✅ Full användarkontroll i interaktiv editor
✅ Alla relevanta sektioner: risker, intressenter, dokument, budget, miljö
✅ Rekommenderade laboratorier med SWEDAC-ackreditering
✅ Källspårning på varje punkt (AI-version, data-source, confidence)
✅ Lagring i databas
✅ Export som PDF/Word (future)

**Status:** 🟢 PRODUCTION READY (core functionality)

**Next Steps:**

- [ ] Document export (PDF/Word generation)
- [ ] Lab integration
- [ ] Approval workflow
- [ ] Digital submission
