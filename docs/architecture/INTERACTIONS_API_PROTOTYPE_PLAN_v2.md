# Implementation Plan v2: Interactions API Prototype

**Status:** För formellt godkännande (prototyp/pilot — ej produktion)  
**Datum:** 2026-06-01  
**Scope:** Isolerad testbädd parallellt med befintlig Vertex/`generateContent`-kedja

---

## 1. Syfte

Utvärdera Googles **Interactions API** (`interactions.create`) i **stateful** läge (`store=true`, `previous_interaction_id`) med modellen **`gemini-3.5-flash`**, utan att påverka plattformens befintliga AI-tjänster (`vertexAiService.ts`, `aiProviderImplementation.ts`).

**Exit-kriterium för pilot:** Manuell + automatiserad verifiering (se §8). Därefter beslut om Vertex-migrering när Google levererar Interactions på Vertex AI.

**Explicit icke-mål (v1):**

- Ingen koppling till krav/tillstånd/C-anmälan/lokaliseringsflöden
- Ingen ändring av `GeminiAiProvider` / produktions-AI
- Ingen produktionsdeploy av test-endpoint

---

## 2. Bakgrund och begränsningar

| Aspekt | Nuvarande plattform | Interactions-prototyp |
|--------|---------------------|------------------------|
| SDK | `@google-cloud/vertexai` | `@google/genai` (nytt) |
| API | `generateContent` | `interactions.create` |
| Auth (prod) | `VERTEX_PROJECT_ID` + ADC | **Gemini API-nyckel (AI Studio)** |
| Vertex Interactions | — | **Ej tillgängligt ännu** (roadmap hos Google) |
| API-status | Stabil prod-väg | **Public beta** — breaking changes möjliga |

Produktion fortsätter använda Vertex + `generateContent` tills Interactions finns på Vertex och har passerat intern godkännande.

Referens: [Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions/interactions-overview)

---

## 3. Arkitekturprinciper

1. **Modulärt:** Kod under `server/modules/ai/interactions/` — inte i monoliten.
2. **Feature-flaggat:** All prototyp-kod inaktiv utan explicit env.
3. **Auth + tenant:** Samma mönster som övriga projekt-API:er (`requireAuth`, `assertProjectAccess`).
4. **Dataminimering:** Följ [ADR-005](ADR-005-vertex-ai-data-minimization.md) — inga riktiga fastighetsbeteckningar, personnamn eller diarienummer i testprompter.
5. **Dual retention:** Google lagrar Interaction (1–55 dagar beroende på tier) + lokal session i Postgres — dokumentera i pilotlogg.

---

## 4. Miljövariabler

Lägg till i `.env.example` (prototyp-sektion):

```env
# ── Interactions API prototype (Gemini API — NOT production Vertex) ──
INTERACTIONS_PROTOTYPE_ENABLED=false
INTERACTIONS_GEMINI_API_KEY=          # AI Studio key; dev/pilot only
INTERACTIONS_MODEL=gemini-3.5-flash
INTERACTIONS_STORE=true               # explicit for stateful test
```

**Regler:**

- `INTERACTIONS_GEMINI_API_KEY` är **separat** från produktionens Vertex/ADC-upplägg.
- `.env.example` ska tydliggöra att consumer-nyckeln endast gäller denna isolerade pilot (inte plattformens prod-AI).
- I `NODE_ENV=production` ska test-endpoint **aldrig** mountas, oavsett flagga.

---

## 5. Beroenden

### 5.1 SDK

- **Action:** Installera `@google/genai`.
- **Version:** Minimum enligt Google docs: `1.33.0+`. **Pinna exakt version** efter `npm view @google/genai version` (t.ex. `"@google/genai": "x.y.z"` utan `^` i pilotfas).
- **Behåll:** `@google-cloud/vertexai` oförändrat för prod.

### 5.2 Prisma — `InteractionPrototypeSession`

**Action:** Ny modell i `prisma/schema.prisma` (namn medvetet specifikt — undvik generiskt `ChatSession`):

```prisma
model InteractionPrototypeSession {
  id                 String   @id @default(cuid())
  userId             String
  organisationId     String
  projectId          String?
  lastInteractionId  String?  // uppdateras varje tur
  model              String   @default("gemini-3.5-flash")
  purpose            String   @default("INTERACTIONS_PROTOTYPE")
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  user         User         @relation(fields: [userId], references: [id])
  organisation Organisation @relation(fields: [organisationId], references: [id])
  project      Project?     @relation(fields: [projectId], references: [id])

  @@index([userId, createdAt])
  @@index([organisationId])
  @@index([projectId])
  @@schema("public")
}
```

**Relationer:** Lägg till motsvarande `InteractionPrototypeSession[]` på `User`, `Organisation`, `Project`.

**Migration:** `npx prisma migrate dev --name add_interaction_prototype_session` (lokal dev).  
**Generate:** `npx prisma generate`.

**Stateful semantik:**

- Tur 1: `interactions.create({ input, store: true })` → spara `interaction.id` som `lastInteractionId`.
- Tur 2+: `interactions.create({ input, previous_interaction_id: session.lastInteractionId, store: true })` → **ersätt** `lastInteractionId` med nytt id.

---

## 6. Modulstruktur (ny kod)

```
server/modules/ai/interactions/
  interactionsClient.ts          # GoogleGenAI init + config guard
  interactionsService.ts         # generateWithInteractions(...)
  interactionsSessionRepository.ts  # Prisma CRUD för InteractionPrototypeSession
  interactionsPrototype.routes.ts   # POST /api/prototype/interactions
  types.ts
```

Montera router i `server/createApp.ts` **endast om:**

```ts
process.env.NODE_ENV !== 'production'
  && process.env.INTERACTIONS_PROTOTYPE_ENABLED === 'true'
```

---

## 7. Tjänst — `interactionsService.ts`

### 7.1 Client-init (korrekt SDK)

```ts
import { GoogleGenAI } from '@google/genai';

const client = new GoogleGenAI({
  apiKey: process.env.INTERACTIONS_GEMINI_API_KEY,
});
```

**Använd inte** `@google-cloud/vertexai` / `VertexAI` för Interactions i v1.

### 7.2 Signatur

```ts
export async function generateWithInteractions(input: {
  prompt: string;
  previousInteractionId?: string;
  systemInstruction?: string;  // måste skickas varje tur om den ska gälla
  model?: string;
  store?: boolean;
}): Promise<{
  interactionId: string;
  outputText: string;
  status: string;
  stepCount: number;
  usage?: unknown;
}>
```

### 7.3 API-anrop

```ts
const interaction = await client.interactions.create({
  model: process.env.INTERACTIONS_MODEL ?? 'gemini-3.5-flash',
  input: input.prompt,
  store: input.store ?? true,
  previous_interaction_id: input.previousInteractionId,
  system_instruction: input.systemInstruction,
});
```

Returnera `interaction.id`, `interaction.output_text`, `interaction.status`, `interaction.steps?.length`, `interaction.usage`.

### 7.4 Resiliens

- Circuit breaker (samma mönster som `vertexAiService.ts`) eller enkel retry med timeout.
- Tydliga fel om nyckel saknas eller prototyp-flagga av.

---

## 8. Test-endpoint

**Route:** `POST /api/prototype/interactions`

**Middleware:**

- `requireAuth`
- `rateLimitByUser` (samma ordning som localization)
- Guard: prototyp enabled + not production

**Body:**

```json
{
  "prompt": "string (required)",
  "sessionId": "string (optional)",
  "projectId": "string (optional, för access-kontroll)"
}
```

**Flöde:**

1. Validera `prompt` (max längd, t.ex. 8k tecken).
2. Om `sessionId`: hämta session, verifiera `userId` + `organisationId`, läs `lastInteractionId`.
3. Om `projectId`: `assertProjectAccess(authUser, projectId, organisationId)`.
4. Anropa `generateWithInteractions({ prompt, previousInteractionId: session?.lastInteractionId })`.
5. Skapa eller uppdatera `InteractionPrototypeSession` med nytt `lastInteractionId`.
6. Audit-logga skapande/uppdatering (referens `INT-PROT-{sessionId}`).
7. Returnera:

```json
{
  "ok": true,
  "sessionId": "...",
  "interactionId": "...",
  "outputText": "...",
  "status": "completed",
  "meta": { "model": "gemini-3.5-flash", "stepCount": 3 }
}
```

---

## 9. Medvetet utelämnat i v1

| Plan v1 | v2-beslut |
|---------|-----------|
| Ändra `aiProviderImplementation.ts` | **Skippa** tills pilot verifierad |
| Generiskt `ChatSession` | **`InteractionPrototypeSession`** |
| `POST /api/test/interactions` utan guard | **`/api/prototype/interactions`** + auth + flagga |
| `VertexAI`-init | **`GoogleGenAI` + Gemini API-nyckel** |
| Lös SDK-version `^2.7.0` | **Pinna exakt** efter verifiering |

---

## 10. Verifiering och test

### 10.1 Manuell (acceptanskriterier)

1. **DB:** Ny rad i `InteractionPrototypeSession` efter första anrop.
2. **Tur 1:** Prompt *"Hi, my name is Environment Investigator"* → ny `sessionId` + `interactionId`.
3. **Tur 2:** Samma `sessionId`, prompt *"What is my name?"* → modellen svarar korrekt **utan** att klienten skickar historik.
4. **Obs:** Logga `status`, `usage`, `steps` (agentic thoughts om tillgängliga).
5. **Negativt:** Utan auth → 401.
6. **Negativt:** `INTERACTIONS_PROTOTYPE_ENABLED=false` → 404.
7. **Negativt:** `NODE_ENV=production` → route ej mountad.

### 10.2 Automatiserad

- **Unit:** Mock `@google/genai` — verifiera `previous_interaction_id` skickas på tur 2.
- **Unit:** Session repository — skapande + uppdatering av `lastInteractionId`.
- **Integration (valfritt):** Skip om nyckel saknas (`describe.skipIf`).

### 10.3 Jämförelse (observation)

- Kör samma enkla prompt via befintlig `generateTextWithVertex` och notera latency/kostnad i pilotrapport (ingen funktionell paritet krävs).

---

## 11. GDPR och säkerhet

- **Inga produktionsdata** i prompter (ADR-005).
- **Google-side retention:** 1 dag (free) / 55 dagar (paid) — dokumentera i pilotrapport.
- **Lokal retention:** Session-rader följer projektets GDPR-rutin; ev. TTL/radering i senare steg.
- **Audit:** Logga session create/update (ej full prompt i prod-loggar om känsligt — truncera).

---

## 12. Implementationsordning

| # | Steg | Uppskattad risk |
|---|------|-----------------|
| 1 | Env + `.env.example` | Låg |
| 2 | `@google/genai` (pinned) | Låg |
| 3 | Prisma-modell + migrate | Medel (kräver lokal DB) |
| 4 | `interactionsClient` + `interactionsService` | Medel |
| 5 | Repository + routes + createApp mount | Medel |
| 6 | Unit tests | Låg |
| 7 | Manuell verifiering + pilotrapport | — |
| 8 | *(Senare)* Provider-toggle / Vertex-migrering | Hög — eget beslut |

---

## 13. Formellt godkännande — checklista

Godkännare bekräftar:

- [ ] Prototypen är **Gemini API-only**; prod Vertex oförändrad
- [ ] Test-endpoint **aldrig** i produktion
- [ ] ADR-005 dataminimering gäller testprompter
- [ ] Beta-risk och breaking changes accepteras för pilot
- [ ] Ingen koppling till `aiProviderImplementation` i v1
- [ ] Exit: Vertex Interactions + separat prod-godkännande innan skarp drift

**Signatur / datum:** ___________________________

---

## 14. Relaterade filer (befintlig kod)

- `server/services/vertexAiService.ts` — prod AI (orörd)
- `server/services/aiProviderImplementation.ts` — prod provider (orörd i v1)
- `server/modules/localization/localizationOrchestrator.ts` — mönster för auth + project access
- `docs/architecture/ADR-005-vertex-ai-data-minimization.md` — promptregler
