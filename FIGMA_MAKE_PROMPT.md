# Figma Make — Instruktioner för UI-slutförande

> Kopiera ett avsnitt i taget och klistra in i Figma Make.  
> Ladda alltid in filer i den ordning som anges under "Kontext att ladda in".

---

## 📋 Hur du använder den här filen

1. Öppna Figma Make (antigravity / Dev Mode)
2. Ladda in kontextfilerna i angiven ordning
3. Klistra in prompten
4. Granska output — exportera den ändrade TSX-filen
5. Skicka tillbaka TSX till Copilot agent för TS/lint-verifiering

---

## Uppgift 1: Omdesigna ExecutiveSummary (Beslutsöversikt)

### Kontext att ladda in (i denna ordning)

1. `types.ts`
2. `constants.ts`
3. `tokens.json`
4. `tokens.css`
5. `components/ExecutiveSummary.tsx`

### Prompt

```
Du hjälper mig att förbättra en React/TypeScript-komponent för en svensk miljötillståndsapplikation.

Komponenten heter `ExecutiveSummary` och är en beslutsöversiktsvy. Den visar statistik om projektplaner, steg-gates, dokument och datakällor.

**Nuläge:** Komponenten är funktionell men saknar tydlig visuell hierarki. Korten ser likadana ut, det är svårt att snabbt förstå vilka värden som är kritiska.

**Önskat resultat:**
- Behåll ALL befintlig logik och state (useProjectStructure, fetch('/api/datasources/health') etc.)
- Förbättra layout: använd ett 3-kolumns rutnät med KPI-kort (stor siffra + etikett + trend-ikon)
- Lägg till färgkodning: grön = OK/BIFALL, gul = varning, röd = blockerad/AVSLAG
- Gör rubrikerna i `tokens.css`-stilens typografi (font-black uppercase tracking)
- Lägg till en "Systemstatus" rad längst ned som visar `datasourceHealth` som chip-badges
- Mobilanpassning: 1 kolumn under 768px, 2 kolumner under 1024px

**Designkrav:**
- Bakgrundsfärg: `#0f172a` (slate-950)
- Kortfärg: `#1e293b` (slate-800) med `border border-slate-700`
- Rundade hörn: `rounded-[2rem]`
- Använd Font Awesome-ikoner (fas-prefix) som redan laddas i index.html
- Behåll alla befintliga TypeScript-typer utan ändringar

Returnera enbart den uppdaterade `ExecutiveSummary.tsx`-filen, komplett och klar att användas.
```

---

## Uppgift 2: Förbättra PermitPortalView (Tillståndsansökan)

### Kontext att ladda in (i denna ordning)

1. `types.ts`
2. `constants.ts`
3. `tokens.json`
4. `tokens.css`
5. `components/PermitPortalView.tsx`
6. `components/ApplicationWizard.tsx`

### Prompt

```
Du hjälper mig att förbättra en React/TypeScript-komponent för en svensk miljötillståndsapplikation.

Komponenten heter `PermitPortalView`. Den har två lägen: `mode="map"` (kartutforskare) och `mode="apply"` (ny ansökan med steg-för-steg-guide).

**Nuläge i "apply"-läget:** Formuläret visar allt på en gång — EWC-kodsökning, kommunval, åtgärdsknapp och dokumentlista. Det är svårt att följa flödet som ny användare.

**Önskat resultat för "apply"-läget:**
- Skapa ett tydligt 3-stegs progressindikator längst upp: "1. Välj kod → 2. Konfigurera → 3. Granska"
- Steg 1: Sökruta för EWC-kod + kodbeskrivning-panel (redan i koden som `filteredCodes`)
- Steg 2: Kommunval + åtgärdsbeskrivning (redan i koden som `selectedProfile`)
- Steg 3: Sammanfattning + "Generera ansökningsutkast"-knapp
- Varje steg ska ha en "Nästa"-knapp som aktiveras när stegets val är komplett
- Använd `useState` för att hålla reda på aktivt steg (0, 1, 2)

**Designkrav:**
- Stegindikatorn: cirkel med siffra + text, aktiv = `bg-emerald-500`, klar = `bg-slate-600`, kommande = `bg-slate-800`
- Bakgrundsfärg: `#0f172a` (slate-950)
- Behåll ALL befintlig logik (handleGenerateDraft, evaluateGate, useProjectStructure etc.)
- Behåll TypeScript-typerna oförändrade
- "map"-läget ändras inte alls

Returnera enbart den uppdaterade `PermitPortalView.tsx`-filen, komplett och klar att användas.
```

---

## Uppgift 3: Designa onboarding/välkomstskärm (ny komponent)

### Kontext att ladda in (i denna ordning)

1. `types.ts`
2. `constants.ts`
3. `tokens.json`
4. `tokens.css`
5. `components/App.tsx` (bara för att förstå InterfaceMode-typen och hur TechnicalDashboardHub används)

### Prompt

````
Du hjälper mig att skapa en ny React/TypeScript-komponent för en svensk miljötillståndsapplikation som kallas "Miljöbeslut".

Applikationen hjälper miljökonsulter och projektledare att hantera tillståndsansökningar, logistik av schaktmassor och GDPR-compliance.

**Uppgift:** Skapa en ny komponent `WelcomeScreen.tsx` som visas när användaren öppnar appen för första gången (innan de väljer ett läge).

**Komponenten ska innehålla:**
1. Logotyp/rubrik: "Miljöbeslut V1.2" med grön accentfärg (`#22c55e`)
2. Kort tagline: "Komplett verktyg för miljötillstånd, masshantering och compliance"
3. Fyra feature-kort (ett per InterfaceMode):
   - 🏗️ **Ansökningsflöde** — Steg-för-steg tillståndsansökan
   - 🚛 **Logistik & massor** — Fraktbörsen och EWC-kodshantering
   - 📋 **Projektstyrning** — Gantt, milstolpar och GIS-riskanalys
   - ✅ **Regelefterlevnad** — GDPR, audit-trail och compliance-poäng
4. En "Kom igång"-knapp per kort som anropar `onSelect(mode: InterfaceMode)`
5. En diskret fotnot: "Kräver Gemini API-nyckel för AI-funktioner"

**Props-interface:**
```typescript
interface WelcomeScreenProps {
  onSelect: (mode: 'Core_WORKFLOW' | 'LOGISTICS_MARKET' | 'PROJECT_MANAGER' | 'PERMIT_PORTAL' | 'COMPLIANCE_AUDIT' | 'ADMIN_CONSOLE') => void;
}
````

**Designkrav:**

- Mörkt tema: bakgrund `#0f172a` (slate-950)
- Kort: `#1e293b` med `border border-slate-700 rounded-[2rem]`
- Hover-effekt: `hover:border-emerald-500 hover:shadow-emerald-500/10`
- Rubrik med gradient: `from-white to-slate-400`
- Mobilanpassad: 1 kolumn → 2 kolumner → 4 kolumner
- Använd Font Awesome-ikoner (fas-prefix)
- Ingen extern import utöver React

Returnera enbart `WelcomeScreen.tsx`, komplett och klar att användas.

```

---

## Uppgift 4: Mobilanpassning av sidomenyn i App.tsx

### Kontext att ladda in (i denna ordning)
1. `types.ts`
2. `tokens.css`
3. `components/App.tsx`

### Prompt

```

Du hjälper mig att mobilanpassa sidomenyn i en React/TypeScript-applikation.

Filen är `components/App.tsx`. Sidomenyn har klassen `w-[220px]` och är alltid synlig — på mobil tar den upp för mycket plats.

**Önskat resultat:**

1. Lägg till en hamburgermeny-knapp (`fas fa-bars`) som visas på skärmar under 768px (Tailwind: `md:hidden`)
2. Sidomenyn ska på mobil vara `fixed inset-y-0 left-0 z-50 w-[220px]` med `transform transition-transform`
3. Öppnad = `translate-x-0`, stängd = `-translate-x-full`
4. Bakgrundsoverlay (`bg-black/50`) när menyn är öppen, klick stänger menyn
5. Lägg till `const [mobileMenuOpen, setMobileMenuOpen] = useState(false)` i App-komponenten
6. När ett menyval klickas på mobil: stäng menyn automatiskt
7. På desktop (≥768px): sidomenyn visas alltid, hamburgermeny-knappen döljs

**Designkrav:**

- Ändra inte sidebarens utseende, bara lägg till responsive-logik
- Behåll ALL befintlig routing och tab-logik oförändrad
- Bakgrundsoverlay ska ha `backdrop-blur-sm`
- Stängknapp (`fas fa-xmark`) längst upp i menyn på mobil

Returnera enbart den uppdaterade `App.tsx`-filen, komplett och klar att användas.

```

---

## ✅ Checklista efter Figma Make-körning

Innan du skickar output till Copilot agent — kontrollera:

- [ ] Inga nya `import`-satser av externa paket som inte redan finns i `package.json`
- [ ] Alla TypeScript-typer bevarade (inga `any` tillagda i känsliga delar)
- [ ] Font Awesome-ikoner används med `fas`-prefix (inte `fa-solid`)
- [ ] Tailwind-klasser är standard (inga anpassade klasser som saknas i config)
- [ ] Befintlig logik (hooks, fetch-anrop, callbacks) är orörd

Copilot agent kör sedan: `npx tsc --noEmit && npx eslint . --quiet`
```
