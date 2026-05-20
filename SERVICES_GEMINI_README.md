# Setup och användning för Gemini-servertjänst

Kort: `services/geminiService.ts` är nu serverside. Du måste exponera dess funktioner via en server-route (Remix route eller Express) och aldrig importera den från klientkod.

1. API-nyckel

- Sätt `GEMINI_API_KEY` i servermiljön (produktion) eller i din lokala `.env` för utveckling.

Exempel `.env` (lägg i projektroten):

GEMINI_API_KEY=sk-...din-nyckel...

OBS: Om du använder Vite endast för klienten, lägg inte servernycklar i `VITE_`-prefixet för att undvika exponering.

2. Remix - snabbstart

- Skapa filen `app/routes/api/gemini.ts` (finns redan som exempel) och gör POST-anrop från klienten till `/api/gemini`.

Exempel klient-anrop:

```js
const res = await fetch('/api/gemini', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'analyzePermitRisk', payload: { permit } }),
});
const data = await res.json();
if (!data.ok) throw new Error(data.error);
console.log(data.result);
```

3. Express - snabbstart

- Filen `server/geminiApi.express.ts` är ett exempelrouter. Montera den i din Express-app:

```ts
import express from 'express';
import geminiRouter from './server/geminiApi.express';
const app = express();
app.use(geminiRouter);
app.listen(3000);
```

4. Beroenden

- Installera SDK och eventuella serverpaket i ditt projekt:

```bash
npm install @google/generative-ai express body-parser
```

5. Säkerhets- och storleksnoteringar

- Skicka aldrig API-nyckeln till klienten.
- För bild-/filöverföringar, skicka base64 eller använd filuppladdning till serveren och proxy till SDK:n.
- Överväg att begränsa payload-storlek och lägga in rate-limiting och autentisering på `/api/gemini`.

6. Felsökning

- Kör utvecklingsservern och kontrollera serverloggar när du anropar endpointen.

```powershell
cd "c:\Users\jimmy\Desktop\utvecklings arbete\Kod\Ny mapp\miljobeslut-1.0"
npm run dev
```

Klistra in eventuella fel här så hjälper jag dig vidare.
