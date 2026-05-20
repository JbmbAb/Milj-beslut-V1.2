# Arbetsfördelning & Workflow (AI Agent vs VS Code)

För att undvika kodkonflikter, spaghettikod och att "vänstra handen inte vet vad den högra gör", delar vi upp arbetet strikt. Detta gör plattformen extremt robust och låter båda AI-verktygen (jag här i webben vs din lokala Copilot/Cursor i VS Code) briljera på det de är bäst på.

---

## 🏗️ 1. Backendarbetsbänk (Ditt fönster med mig / Agenten)

**Mitt ansvarsområde:** Arkitektur, datamodeller, backend-logik, tunga pipelines.

Ge mig de svåra, systemövergripande uppgifterna. Jag har hela kontexten för plattformens databas och affärslogik.

**Exempel på uppgifter du ger MIG:**

- _"Skapa ett nytt Zod-schema och en Prisma-databasmodell för att spara väderdata."_
- _"Bygg ett Python/TypeScript-skript som läser 1000 PDF:er och använder OCR."_
- _"Implementera en `upsert`-logik för att stoppa dubletter i databasen."_
- _"Koppla ihop Lantmäteriets API så vi kan hämta fastighetsgränser server-side."_
- _"Skriv tester (unit tests) för vår nya risk-analys-motor."_

**Fördel:** Jag tappar inte bort mig i komplexa beroenden, jag skriver säker backend-kod och ser till att appen kompilerar utan type-errors (`npm run typecheck`).

---

## 🎨 2. Frontend & "Sista Milen" (Din VS Code / Cursor / Copilot)

**Ditt ansvarsområde med Copilot:** React-komponenter, Tailwind-design, UI-tillstånd, och att koppla ihop _mina_ backend-API:er med dina vyer.

Din lokala AI ser exakt var musen är, vilken fil du har öppen, och kan spotta ur sig 30 rader Tailwind-CSS på två sekunder.

**Exempel på uppgifter du ger din LOKALA Copilot/Cursor:**

- (Markera en React-knapp) _"Copilot, gör den här knappen rund och lägg till en hover-effekt med Tailwind."_
- _"Cursor, skapa ett nytt formulär i `components/PermitPortalView.tsx` som tar in EWC-kod och anropar `/api/v1/classification`."_
- _"Auto-komplettera den här React Hooken som lyssnar på `onChange` i input-fältet."_
- _"Ge mig ett diagram-bibliotek (Recharts) och plotta den här JSON-datan."_

**Fördel:** Du får millisekund-snabb respons i editorn för visuella ändringar och slipper förklara för mig exakt hur en skugga eller padding ska se ut.

---

## 🔄 3. Överlämningen (Hur vi pratar med varandra)

När du sitter i gränslandet mellan oss två, använd detta arbetssätt:

1.  **Du säger till mig:** _"Bygg ett komplett endpoint för att spara en rapport. Säg till när det är klart."_
2.  **Jag bygger det:** Jag skapar Prisma, API-routen och testerna. Min kod committas till Git.
3.  **Jag bekräftar:** _"Klart! Din route ligger på `POST /api/v1/report`. Payload är `{"name": "test"}`."_
4.  **Du går till VS Code:** Du skapar filen `ReportView.tsx` och säger till Copilot: _"Här är en ny dashboard, skapa ett formulär som POST:ar till `/api/v1/report`."_

### 🚨 Den Gyllene Regeln: Tvinga oss framåt med Git

Om du kodar mycket i VS Code, **spara och gör en Commit (`git add . && git commit -m "UI updates"`)** _innan_ du ber mig om något stort.

När jag ska börja jobba, hämtar jag det senaste läget. Genom att checka in koden skapar vi "Save Points" som gör att varken du eller jag någonsin kan förstöra varandras arbete permanent.
