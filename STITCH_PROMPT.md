# Stitch / Bolt.new / Lovable — Instruktioner för UI-slutförande

> Kopiera ett avsnitt i taget och klistra in i Stitch (bolt.new eller lovable.dev).  
> Ladda alltid in de angivna kontextfilerna som bilagor/uploads först.

---

## 📋 Hur du använder den här filen

1. Öppna Stitch / Bolt.new / Lovable
2. Ladda upp kontextfilerna som anges
3. Klistra in prompten i chatten
4. Granska och testa output i förhandsvisningen
5. Kopiera de ändrade filerna och skicka till Copilot agent för TS/lint-check

---

## Uppgift 1: Komplett MarketIntelView med transportbokning

### Filer att ladda upp
- `types.ts`
- `constants.ts`
- `components/MarketIntelView.tsx`
- `components/StatsOverview.tsx`
- `components/PermitTable.tsx`

### Prompt

```
Jag har en React/TypeScript-komponent `MarketIntelView.tsx` för en svensk miljöapp som hanterar logistik av schaktmassor.

Komponenten hanterar:
- Statistikvy (bifall/avslag på tillstånd)
- Transportbokning (välj mottagare, mängd, chaufför, fordon)
- EWC-kodval (avfallskoder)

**Problem:** Transportbokningsformuläret (driverName, vehicleId, reviewerName, origin, destination) är svårt att förstå utan kontext. Informationen presenteras som en lång lista med input-fält.

**Önskat resultat:**
1. Dela upp transportbokningsformuläret i tre tydliga sektioner med rubriker:
   - "🚛 Transport" (chaufför + fordon)
   - "📍 Rutt" (origin + destination)
   - "👤 Granskare" (reviewerName)
2. Lägg till en kompakt sammanfattningspanel ("Bokningsöversikt") bredvid formuläret som visar:
   - Vald EWC-kod + beskrivning
   - Vald mottagare + adress
   - Mängd i ton
   - Beräknad kostnad (om `massAmount > 0`: visa `(massAmount * 125).toLocaleString('sv-SE') + ' kr'`)
3. "Boka transport"-knappen ska ha tydlig laddnings-spinner (isBooking-state finns redan)
4. Lägg till en tom-state (om `permits.length === 0`): visa meddelande "Inga tillstånd laddade — kontrollera databaskopplingen"

**Designkrav:**
- Mörkt tema: `bg-slate-950`, kort `bg-slate-800 border border-slate-700`
- Rundade hörn: `rounded-[2rem]`
- Primärknapp: `bg-emerald-500 hover:bg-emerald-400 text-white font-bold`
- Bevara ALL befintlig logik (runTransportComplianceFlow, syncPermitToArchive etc.)
- Bevara alla TypeScript-typer

Returnera enbart den uppdaterade `MarketIntelView.tsx`.
```

---

## Uppgift 2: WeatherRisk med offline-fallback och manuell refresh

### Filer att ladda upp
- `types.ts`
- `components/WeatherRisk.tsx`

### Prompt

```
Jag har en React/TypeScript-komponent `WeatherRisk.tsx`. Den anropar `predictWeatherRisk(municipality)` från en Gemini AI-service och visar väderprognosrisk.

**Problem:**
1. Ingen knapp för att uppdatera prognosen manuellt
2. Felmeddelandet vid nätverksfel är svårt att skilja från en vanlig "Låg risk"-ruta
3. Om `municipality` är tom sträng kraschar anropet tyst

**Önskat resultat:**
1. Lägg till validering: om `municipality` är tom/undefined, visa "Välj en kommun för att se väderprognosrisk" (tom state) i stället för att göra fetch
2. Lägg till en "🔄 Uppdatera"-knapp i hörnet av kortet som triggar om fetch-anropet
3. Separera error-state från success-state visuellt:
   - Error: `bg-slate-900 border border-red-900` + röd varnings-ikon + "Kunde inte hämta prognos"
   - Success: befintlig färgkodning (grön/gul/röd beroende på risk-level)
4. Visa tidsstämpel "Senast uppdaterad: HH:MM" efter lyckad hämtning

**Bevara:**
- `WeatherRisk as WeatherRiskType` typen
- `predictWeatherRisk`-anropet
- Befintliga CSS-klasser för risk-nivåer

Returnera enbart den uppdaterade `WeatherRisk.tsx`.
```

---

## Uppgift 3: GanttChart med riktiga datum och zoom

### Filer att ladda upp
- `types.ts`
- `constants.ts`
- `components/GanttChart.tsx`

### Prompt

```
Jag har en React/TypeScript-komponent `GanttChart.tsx` som visar en Gantt-grafik för projektplanering av miljötillstånd.

**Önskat resultat:**
1. Lägg till en zoom-kontroll (knappar "Dag / Vecka / Månad") som ändrar tidsaxelns granularitet
2. Nutidsmarkör: en vertikal röd linje som visar `new Date()` i rätt position
3. Hovra-tooltip: när musen är över en aktivitet, visa en liten popup med:
   - Aktivitetens namn
   - Startdatum + slutdatum
   - Status (DONE/IN_PROGRESS/PENDING)
4. Klick på en aktivitet öppnar en enkel modal med en `<textarea>` för anteckningar (spara till `notes`-state)

**Designkrav:**
- Mörkt tema: `bg-slate-900`
- DONE: `bg-emerald-600`, IN_PROGRESS: `bg-blue-600`, PENDING: `bg-slate-600`
- Nutidsmarkör: `border-l-2 border-red-500`
- Tooltip: `bg-slate-800 border border-slate-600 rounded-xl p-3 text-sm shadow-2xl`
- Bevara ALL befintlig logik och TypeScript-typer

Returnera enbart den uppdaterade `GanttChart.tsx`.
```

---

## Uppgift 4: ProjectOrgChart med redigerbar rollstruktur

### Filer att ladda upp
- `types.ts`
- `components/ProjectOrgChart.tsx`

### Prompt

```
Jag har en React/TypeScript-komponent `ProjectOrgChart.tsx` som visar ett organisationsschema för ett miljötillståndsprojekt.

**Önskat resultat:**
1. Gör rollkorten redigerbara: dubbelklick på ett namn → inline-textredigering (input-fält i kortet)
2. Lägg till en "Lägg till roll"-knapp längst ned som öppnar en mini-form med fält:
   - Rollnamn
   - Ansvarsbeskrivning
   - Välj överordnad (dropdown av befintliga roller)
3. Lägg till "Ta bort"-knapp (rött X) på varje kort (utom rotnoden)
4. Visa "Senast ändrad: [datum]" diskret i hörnet av varje kort
5. Lägg till en "Exportera som PDF"-knapp (anropa `window.print()` som fallback)

**Designkrav:**
- Mörkt tema: `bg-slate-950`
- Kort: `bg-slate-800 border border-slate-700 rounded-2xl`
- Aktiv redigering: `border-emerald-500 shadow-emerald-500/20`
- Bevara ALL befintlig logik och TypeScript-typer

Returnera enbart den uppdaterade `ProjectOrgChart.tsx`.
```

---

## ✅ Checklista efter Stitch-körning

Innan du skickar output till Copilot agent — kontrollera:

- [ ] Inga nya npm-paket introducerade (inga `import X from 'some-new-lib'`)
- [ ] Alla befintliga TypeScript-interfaces bevarade
- [ ] Inga hårdkodade strängar som borde vara variabler
- [ ] State-hantering: inga `any`-typer i nya useState
- [ ] Tailwind-klasser är standard
- [ ] Event handlers matchar befintliga callback-signaturer

Copilot agent kör sedan: `npx tsc --noEmit && npx eslint . --quiet && npm test`

---

## 🔁 Arbetsflöde: Stitch → Copilot agent

```
1. Stitch genererar ny komponent
2. Du kopierar TSX-filen
3. Du öppnar en ny issue/chat med Copilot agent med meddelandet:
   "Här är ny [KomponentNamn].tsx från Stitch — validera och integrera"
   + bifoga filinnehållet
4. Copilot agent:
   a. Ersätter den gamla filen
   b. Kör tsc + eslint
   c. Fixar eventuella fel
   d. Pushar till PR
```
