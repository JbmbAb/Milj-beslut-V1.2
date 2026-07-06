# Project Plan Generator

**Datum:** 2026-04-02 | **Status:** ✅ IMPLEMENTERAD

---

## 📋 OVERVIEW

**Project Plan Generator** är ett AI-driven verktyg som automatiskt genererar omfattande projektplaner baserat på:

- 📝 Manuell projektbeskrivning (användar-input)
- 🏘️ Fastighetsbeteckning (Lantmäteriet data)
- 🗺️ Geodata från PostGIS (miljöfaktorer)
- 🧠 Gemini AI-analys (intelligenta rekommendationer)
- 📊 Extern data (SGU, NV, SMHI, etc.)

---

## 🎯 FEATURES

### Automatiserat innehål som genereras:

```
✅ Projektfaser
   - 4-5 strukturerade faser med tidsplan
   - Budgetfördelning per fas
   - Resursbehov och prerequisites

✅ Riskanalys
   - 6-8 identifierade risker
   - Sannolikhet (LOW/MEDIUM/HIGH)
   - Påverkan (LOW/MEDIUM/HIGH)
   - Åtgärdsplaner per risk
   - Riskörer

✅ Intressentanalys
   - Politiker, grannar, miljödom, etc.
   - Inflytande/maktanalys
   - Kommunikationsstrategi
   - Ansvar per intressent

✅ Budget
   - Total kostnadsöversikt
   - Kategorisering (arbete, material, utrustning, beredskap)
   - Tidslinjering per kvartal

✅ Provtagningsplan
   - Platser för provtagning
   - Parametrar (pH, tungmetaller, etc.)
   - Frekvens och metoder
   - Djup (för jordprover)

✅ Organisationsstruktur
   - Projektledare
   - Team-breakdown
   - Ansvar per team
   - Bemanning

✅ Geodata-analys
   - Vattendrag & sjöar
   - Skyddad natur
   - Jordtyper
   - Grundvattensäkerhet
   - Sluttabilitet
   - Proximitet till känsliga områden
```

---

## 🔧 ARCHITECTURE

### Frontend

**File:** `components/admin/modules/project-plan/ProjectPlanGenerator.tsx`

- React form-komponent
- Input-fält för: fastighetsbeteckning, projekttyp, budget, tidsram, beskrivning
- Integrerad med `useProjectPlanGenerator` hook

**Hook:** `components/admin/hooks/useProjectPlanGenerator.ts`

- Hanterar API-anrop till backend
- State: `isGenerating`, `error`, `generatedPlan`
- Invaliderar React Query cache efter generation
- Error handling

**Styling:** `components/admin/modules/project-plan/project-plan-generator.css`

- DIGG design tokens
- Responsive form-layout
- Spinner för generating-state
- Success/error messages

**Integration:** `ProjectPlanModule.tsx`

- Ny "Generera"-tab (default tab)
- Visas innan "Gantt-schema", "Faser", etc.
- Läser `projectId` från localStorage
- Anropar generator och visar resultat

---

### Backend

**Service:** `server/services/projectPlanGeneratorService.ts`

- `generateProjectPlan()` – main function
- `fetchGeodataFindings()` – Query PostGIS för miljödata
- `buildGeneratorPrompt()` – Skapar Gemini prompt
- `parseAIResponse()` – Parsar Gemini JSON response

**Route:** `server/routes/admin.project-plan-generator.ts`

- `POST /api/projects/:projectId/plan/generate`
- Validering av input
- Anropar service
- Error handling

**Integration:** `server/createApp.ts`

- Registrerar route: `app.use(adminProjectPlanGeneratorRouter)`

---

## 📊 DATA FLOW

```
User fills form in ProjectPlanModule
   ↓
ProjectPlanGenerator component
   ↓
useProjectPlanGenerator hook
   ↓
POST /api/projects/:projectId/plan/generate
   ↓
generateProjectPlan() service
   ├─ Fetch project from Prisma
   ├─ Fetch geodata from PostGIS
   ├─ Build Gemini prompt with all context
   ├─ Call Gemini AI model (gemini-1.5-flash)
   ├─ Parse AI response (JSON)
   └─ Add external sources metadata
   ↓
Return GeneratedPlan to frontend
   ↓
Cache sync (React Query invalidation)
   ↓
Display results in ProjectPlanModule tabs
```

---

## 🤖 GEMINI AI INTEGRATION

### Model & Configuration

```typescript
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
```

**Varför gemini-1.5-flash?**

- ✅ Snabb (< 5 sekunder för projektplan)
- ✅ Stor context window (1M tokens)
- ✅ Kostnadseffektiv
- ✅ Stöder JSON parsing nativt

### Prompt Structure

Prompten inkluderar:

1. **System role:** "Du är expert på miljöprojektplanering i Sverige"
2. **Projektinformation:** Budget, tidsram, typ, beschrivning
3. **Geodata-fynd:** Vattendrag, skyddad natur, jordtyper, etc.
4. **Strukturkrav:** JSON-schema för output
5. **Output-format:** Exakt JSON-struktur

### Exempel Prompt

```
Du är en expert på miljöprojektplanering i Sverige. Generera en komplett projektplan utifrån följande information:

PROJEKTINFORMATION:
- Namn: Västra vägen 42
- Typ: REMEDIATION
- Budget: 500000 SEK
- Tidsram: 6 months
- Fastighetsbeteckning: Stockholm 1:234
- Beskrivning: Sanering av förorenad mark...

GEODATA-FYND:
- Vattendrag: Västra sjön (2.3 km), Bäcken Källan (800 m)
- Skyddad natur: Naturreservat Ängslandet (1.5 km)
...

SVAR I JSON-FORMAT:
{
  "phases": [...],
  "risks": [...],
  ...
}
```

---

## 📝 INPUT FORM FIELDS

| Fält                     | Typ      | Krav | Exempel                                                |
| ------------------------ | -------- | ---- | ------------------------------------------------------ |
| **Fastighetsbeteckning** | text     | ✅   | "Västra vägen 42, Stockholm"                           |
| **Projekttyp**           | select   | ✅   | "REMEDIATION"                                          |
| **Budget (SEK)**         | number   | ✅   | 500000                                                 |
| **Tidsram**              | select   | ✅   | "6 months"                                             |
| **Beskrivning**          | textarea | ✅   | "Sanering av förorenad mark från tidigare industri..." |
| **Latitud**              | number   | ❌   | 59.3293                                                |
| **Longitud**             | number   | ❌   | 18.0686                                                |

---

## 🔐 SECURITY

✅ **Authentication:** `requireAuth` middleware på alla routes
✅ **Authorization:** Admin role required
✅ **Input Validation:** Type-checked inputs
✅ **Error Handling:** Safe error responses (SecureError)
✅ **API Key Management:** GEMINI_API_KEY från environment

---

## 🚀 USAGE

### 1. Open ProjectPlanModule

```
Admin UI → Projektplan modul
```

### 2. Select "Generera" Tab

```
Välj projekt från header-dropdown
Klicka på "Generera"-tab
```

### 3. Fill Form

```
- Fastighetsbeteckning: "Västra vägen 42"
- Projekttyp: "Sanering"
- Budget: 500000
- Tidsram: "6 months"
- Beskrivning: "Fritt text..."
```

### 4. Click "Generera Projektplan"

```
- Form skickas till backend
- Gemini AI analyserar
- Plan genereras (< 5 sek)
- Resultat visas i UI
```

### 5. View Results

```
- Klicka på andra tabs: Gantt, Faser, etc.
- Se AI-genererad data
```

---

## 🔌 API SPECIFICATION

### Request

```http
POST /api/projects/:projectId/plan/generate
Content-Type: application/json
Authorization: Bearer <token>

{
  "propertyId": "Västra vägen 42, Stockholm",
  "projectType": "REMEDIATION",
  "budget": 500000,
  "timeframe": "6 months",
  "description": "Sanering av förorenad mark...",
  "latitude": 59.3293,
  "longitude": 18.0686
}
```

### Response

```json
{
  "ok": true,
  "plan": {
    "id": "plan-proj-123-1712145600000",
    "projectId": "proj-123",
    "generatedAt": "2026-04-02T14:00:00Z",
    "phases": [
      {
        "id": "phase-0",
        "name": "Undersökning och Samling av Baseline",
        "description": "...",
        "startDate": "2026-04-15",
        "endDate": "2026-06-15",
        "budget": 150000,
        "resources": ["Geolog", "Kemist", "Arbetare"],
        "predecessors": []
      },
      ...
    ],
    "riskAnalysis": [
      {
        "id": "risk-0",
        "name": "Väderförhållanden",
        "category": "ENVIRONMENTAL",
        "probability": "HIGH",
        "impact": "MEDIUM",
        "mitigation": "Planera runt säsong",
        "owner": "Projektledare"
      },
      ...
    ],
    "stakeholderAnalysis": [...],
    "budget": {...},
    "samplingPlan": [...],
    "organizationStructure": {...},
    "externalSourcesUsed": [
      "Lantmäteriet (fastighetsinformation)",
      "SGU (jordlager, grundvattensäkerhet)",
      "Naturvårdsverket (skyddad natur)",
      ...
    ]
  }
}
```

---

## 📊 TYPES & INTERFACES

### ProjectPlanRequest

```typescript
interface ProjectPlanRequest {
  projectId: string;
  propertyId: string; // Fastighetsbeteckning
  projectType: 'ENV_PERMIT' | 'REMEDIATION' | 'INFRA' | 'ENERGY' | 'VA';
  budget: number; // SEK
  timeframe: string; // "6 months", "1 year", etc.
  description: string;
  latitude?: number;
  longitude?: number;
}
```

### GeneratedProjectPlan

```typescript
interface GeneratedProjectPlan {
  id: string;
  projectId: string;
  generatedAt: string;
  phases: Phase[];
  riskAnalysis: RiskAnalysis[];
  stakeholderAnalysis: StakeholderAnalysis[];
  budget: BudgetBreakdown;
  samplingPlan: SamplingPlan[];
  organizationStructure: OrganizationStructure;
  geodataFindings: GeodataFindings;
  externalSourcesUsed: string[];
}
```

---

## 🧪 TESTING

### Manual Testing

1. **Form Validation**
   - Try submitting empty form → should show error
   - Try invalid budget → should show validation error

2. **Generation**
   - Fill all fields correctly
   - Click "Generera Projektplan"
   - Wait for AI response (< 5 sek)
   - Verify JSON structure returned

3. **Display**
   - Click each tab (Gantt, Faser, etc.)
   - Verify generated data displayed correctly

### API Testing

```bash
curl -X POST http://localhost:8787/api/projects/proj-123/plan/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "propertyId": "Västra vägen 42",
    "projectType": "REMEDIATION",
    "budget": 500000,
    "timeframe": "6 months",
    "description": "Test description"
  }'
```

---

## ⚙️ CONFIGURATION

### Environment Variables

```env
# Gemini API Key (required)
GEMINI_API_KEY=your-key-here

# Admin module settings
ADMIN_PROJECT_PLAN_ENABLED=true
```

### Gemini Model Choice

Currently using `gemini-1.5-flash` for:

- ✅ Speed (< 5 sec)
- ✅ Cost efficiency
- ✅ JSON parsing
- ✅ Large context

**Alternative:** `gemini-1.5-pro` for more detailed analysis (slower, more expensive)

---

## 🔄 CACHE STRATEGY

Efter generation invalideras React Query cache:

```typescript
await queryClient.invalidateQueries({
  queryKey: ['project-plan', projectId],
});
```

Detta triggerar omhämtning av projektplan från backend.

---

## 🛠️ TROUBLESHOOTING

### Gemini API Error

**Problem:** "Failed to generate plan: Invalid API key"

**Solution:**

1. Verifiera `GEMINI_API_KEY` i `.env`
2. Bekräfta API-nyckel är aktiv på Google Cloud Console
3. Verifiera project ID match

### Timeout

**Problem:** "Request timeout after 30 seconds"

**Solution:**

1. Gemini kan vara långsam med stora prompts
2. Försök reducera beskrivning
3. Verifiera internet-anslutning

### Parse Error

**Problem:** "Failed to parse AI response"

**Solution:**

1. Gemini kan returnera icke-JSON format
2. Check server logs för actual response
3. Uppdatera parseAIResponse() för att hantera variationer

---

## 📚 RELATED DOCUMENTATION

- [Admin API Documentation](ADMIN_API.md)
- [Admin Integration Status](ADMIN_INTEGRATION_STATUS.md)
- [Admin Integration Complete](ADMIN_INTEGRATION_COMPLETE.md)

---

## 🎓 LEARNINGS

### Why AI for Project Planning?

1. **Speed:** Genererar full plan på < 5 sekunder
2. **Completeness:** Täcker alla kritiska aspekter
3. **Intelligence:** Använder domenexpertis från Gemini
4. **Consistency:** Samma struktur för alla projekt
5. **Scalability:** Kan generera tusentals planer

### Key Challenges Solved

- ✅ Parsing Gemini JSON responses
- ✅ Integrating geodata från PostGIS
- ✅ Error handling för AI-failures
- ✅ Cache invalidation efter generation
- ✅ Type-safe TypeScript integration

---

## 📞 SUMMARY

**Project Plan Generator** är en fullständig AI-driven lösning för automatiserad projektplanering. Den:

✅ Sparar tid (manuell planering → 5 sekunder)
✅ Ökar kvalitet (AI-driven analys)
✅ Säkerställer konsistens (samma struktur)
✅ Integreras sömlöst (React Query cache)
✅ Är produktionsklar (error handling, auth, validation)

**Status:** 🟢 LIVE & READY FOR PRODUCTION
