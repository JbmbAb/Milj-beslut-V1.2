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

## Fokusläge: Enskilt avlopp, C-anmälan, Lokaliseringsutredning, Admin panel

Använd detta fokusläge när designarbetet ska koncentreras till de mest affärskritiska myndighetsflödena.

### Snabbfix: när Figma-output blir för röd

Om förslaget blir "rött" i helheten (inte bara felstatus), kör denna styrning direkt innan övrig prompt:

```text
Färgkorrigering för Miljöbeslut:
- Bas-UI får inte vara röd.
- Primär färg: #6366f1 (indigo).
- Sekundär färg: #14b8a6 (teal).
- Neutrala ytor: vit / ljusgrå i ljusvy, hög kontrast för text.
- Röd färg används ENDAST för blockerande fel, avslag och kritiska varningar.
- Varning utan blockering använder amber/orange, inte röd bakgrund.
- Primära knappar och aktiva states ska vara indigo/teal, inte röd.
```

### Kontext att ladda in (i denna ordning)

1. `types.ts`
2. `tokens.json`
3. `tokens.css`
4. `components/AppContentRouter.tsx`
5. `components/admin/modules/sewage-portal/SewagePortalView.tsx`
6. `components/admin/modules/c-notification-mass/CNotificationMassUI.tsx`
7. `components/LocalizationStudyUI.tsx`
8. `components/admin/AdminContainer.tsx`
9. `components/admin/AdminShell.tsx`
10. `components/admin/AdminNav.tsx`
11. `components/admin/AdminHeader.tsx`

### Prompt (kopiera till Figma Make)

```text
Du hjälper mig att förbättra UI-flöden i Miljöbeslut med fokus på fyra moduler:
1) Enskilt avlopp
2) C-anmälan (schaktmassor)
3) Lokaliseringsutredning
4) Admin panel

Mål:
- Tydlig, myndighetsnära informationshierarki
- Kortare väg till beslut/inskick
- Konsistent interaktionsmönster mellan moduler

VIKTIGT:
- Behåll befintlig logik, API-kontrakt och TypeScript-typer.
- Ändra inte endpoint paths.
- Behåll svensk text i gränssnittet.

Funktionsfokus per modul:

A) Enskilt avlopp (SewagePortalView)
- Behåll stegflödet: property -> analysis -> systemSelection -> requirements -> documents -> submission -> confirmation.
- Förtydliga varje steg med progressindikator och stegbeskrivning.
- Markera blockerande valideringar tydligt (PE-intervall, fastighetsdata, dokumentkrav).
- Behåll koppling till skyddsnivå, systemval och gate-status.

B) C-anmälan schaktmassor (CNotificationMassUI)
- Behåll stegflödet: Fastighet & GIS -> Delbeslut -> Inlämning.
- Lyft fram GIS-risk, platsbegränsningar och gate-beslut (PERMIT_REQUIRED, NOTIFICATION_REQUIRED, EXEMPT).
- Gör beslut och nästa åtgärd visuellt entydiga.

C) Lokaliseringsutredning (LocalizationStudyUI)
- Behåll kartdrivet arbetsflöde och alternatives.
- Gör det enklare att gå från platsval till körning av utredning och export.
- Visa warnings och datakällestatus med tydlig allvarlighetsgrad.

D) Admin panel (AdminContainer/AdminShell/AdminNav/AdminHeader)
- Förbättra orientering: aktiv modul, breadcrumb, status och snabba admin-åtgärder.
- Behåll modulstrukturen och nav-logik.
- Säkerställ bra desktop- och mobilbeteende för sidonav och topbar.

Designriktning:
- Modern myndighetsnära UI
- Hög kontrast och tydlig typografi
- Konsekventa knappar, badges, tabeller och varningskomponenter
- Fokus på läsbarhet och handläggningshastighet
- Färgprofil: indigo + teal som bas, rött endast för kritisk status

Leveransformat:
- Returnera endast uppdaterade filer som faktiskt ändras.
- Ingen pseudo-kod.
```

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

---

## Uppgift 5: Komplett flöde för AI Fastighetsdossier

### Kontext att ladda in (i denna ordning)

1. `types.ts`
2. `tokens.json`
3. `tokens.css`
4. `components/DossierDashboard.tsx`
5. `app/components/MapComponent.tsx`
6. `app/routes/api.dossier.$propertyId.tsx`
7. `components/TechnicalDashboardHub.tsx`
8. `components/AppContentRouter.tsx`

### Prompt

```

Du hjälper mig att förbättra ett komplett React/TypeScript-flöde för AI Fastighetsdossier i Miljöbeslut.

Målet är att användaren ska kunna gå från startsida till färdig dossier utan att fastna:

1. Öppna modulkortet "AI Fastighetsdossier"
2. Ange fastighetsbeteckning
3. Starta analys
4. Se riskklass, karta och rekommendationer
5. Exportera PDF

VIKTIGT:

- Behåll all befintlig datalogik och API-kontrakt mot `/api/dossier/:propertyId`.
- Ändra inte endpoint-paths.
- Behåll TypeScript-typer.
- Behåll svensk text i UI.

UI-krav för DossierDashboard:

- Headerkort med:
  - Fastighetsrubrik
  - Input för fastighetsbeteckning
  - CTA: "Kör ny analys"
  - CTA: "Uppdatera analys"
  - CTA: "Exportera PDF"
- Visa chips med 3 snabbsök-förslag.
- Visa tydlig laddningsstate (första laddning + refresh).
- Visa inline-varning om senaste körning misslyckades.
- Behåll riskbanner med färgkod:
  - HÖG = röd
  - MEDEL = orange
  - LÅG = grön
- Behåll två-kolumnslayout desktop och enkelkolumn mobil.
- Rekommendationssektion ska ha fallback om listan är tom.
- Lägg alltid diskret fotnot:
  "Human-in-the-loop: juridisk slutgranskning krävs."

Interaktionskrav:

- Enter i input ska starta analys.
- "Kör ny analys" ska vara disabled under pågående laddning.
- "Uppdatera analys" ska visa spinner under laddning.
- Klick på snabbsök-chip ska fylla input och starta analys direkt.

Designriktning:

- Modern myndighetsnära UI (ren, tydlig, hög kontrast)
- Primär accent: #0f5238
- Ytor: vitt mot ljus grå bakgrund
- Radius: rundade kort (xl/2xl)
- Fokus på läsbarhet före dekor

Leveransformat:

- Returnera ENDAST uppdaterad `components/DossierDashboard.tsx`.
- Inga extra filer.
- Ingen pseudo-kod.

```

---

## Demo Figma-organisation — sharp demo (maj 2026)

Använd detta avsnitt när gränssnittet ska struktureras i Figma inför demo. Prioriterar **Huvudmoduler** (`Core_WORKFLOW`), dossier och app-shell — inte admin/legacy.

### Befintlig Figma-kontext i repo

| Källa | Status |
|-------|--------|
| `FIGMA_FILE_ID` i `.env.example` | Tom — ingen aktiv fil kopplad |
| `src/figma-components/manifest.json` | Delvis export från fil `Ip0100hC1M8J4HhJ3vx498` ("Untitled") |
| Code Connect (`*.figma.ts`) | Saknas i kodbasen |
| Figma MCP (`use_figma`) | Kräver autentisering i Cursor — endast `mcp_auth` exponerades vid senaste försök |

**Rekommenderad fil:** Skapa ny Design-fil `Miljöbeslut — Demo UI (2026-05)` eller koppla befintlig fil och sätt `FIGMA_FILE_ID`.

### Figma-filstruktur (sidor och frames)

```
📄 00 — Shell & Navigation
   └─ Frame: AppShell / Desktop 1440
      ├─ AppSidebar (280px, mörk #0a0a0c)
      ├─ AppHeader (h-20, slate-950/50)
      └─ Content slot (PriorityModulePortfolio som default)

📄 01 — Modulportfölj (Core_WORKFLOW / tab core)
   └─ Frame: PriorityModulePortfolio
      ├─ Hero: "Enskilt avlopp, C-anmälan och lokaliseringsutredning"
      └─ 4 modulkort (avlopp, massor, kemikalier, lokaliseringsutredning)

📄 02 — Enskilt avlopp
   └─ Frame: SewagePortalView — steg 1 Fastighet
   └─ Frame: SewagePortalView — steg 2 GIS-analys (+ SewageMapView)
   └─ Frame: SewagePortalView — steg 3 Systemval (SewageSystemSelector)
   └─ Frame: SewagePortalView — steg 4–6 Krav / Dokument / Inskickning

📄 03 — C-anmälan schaktmassor
   └─ Frame: CNotificationMassUI — Fastighet & GIS
   └─ Frame: CNotificationMassUI — Delbeslut (MPF + EWC)
   └─ Frame: CNotificationMassUI — Inlämning (+ MassMapView)

📄 04 — Lokaliseringsutredning
   └─ Frame: LocalizationStudyUI — kartvy + sidopaneler
      ├─ Karta (600px höjd, geodata-lager)
      ├─ Panel: Fastighet
      ├─ Panel: Geodata-lager (checkbox-lista)
      └─ Panel: Valda alternativ

📄 05 — Dossier & Core (demo-stöd)
   └─ Frame: DossierDashboard — analysresultat
   └─ Frame: CoreWorkflowView — projektöversikt (valfritt för demo)

📄 99 — Design tokens
   └─ Variabler: indigo/teal primär, slate neutral, DIGG admin (moduler)
```

### Design tokens (bind i Figma — inte hårdkodade hex i frames)

| Token / CSS | Användning |
|-------------|------------|
| `#6366f1` / indigo-600 | Primär CTA, aktiv nav, modulportfölj |
| `#14b8a6` / teal-600 | Sekundär accent, kemikalier-modul |
| `#0f5238` | Dossier primär (grön myndighet) |
| `#005293` (`--color-primary-digg`) | Admin/modul-formulär |
| `#0a0a0c`, slate-950 | AppSidebar bakgrund |
| `#f9f9ff`, `#f8f9fa` | Lokaliseringsutredning / dossier yta |
| Röd | **Endast** blockerande fel, AVSLAG, HÖG risk |
| Amber | Varning utan blockering, otillgängliga geodata-lager |

Källa: `tokens.css`, `FIGMA_MAKE_PROMPT.md` (färgkorrigering), `components/admin/admin-tokens.css`, Tailwind-klasser i komponenterna.

### Kod → Figma frame (mapping)

| Kodkomponent | Figma frame | Nyckel-UI (svenska) |
|--------------|-------------|---------------------|
| `AppShell` | `00/AppShell Desktop 1440` | Sidebar + header + content |
| `AppSidebar` | (del av shell) | Miljöbeslut.se, Arbetsytor, Navigering |
| `AppHeader` | (del av shell) | Aktiv tab, REDO/GATES chips |
| `PriorityModulePortfolio` | `01/Modulportfölj` | 4 modulkort + "Starta utredning" |
| `SewagePortalView` | `02/Enskilt avlopp — steg *` | Fastighet → GIS → Systemval → Krav → Dokument → Inskickning |
| `SewageMapView` | (inbäddad i steg 2) | Skyddsnivå, brunnar, riskpoäng |
| `SewageSystemSelector` | (inbäddad i steg 3) | Rekommenderade/blockerade system |
| `CNotificationMassUI` | `03/C-anmälan — *` | Fastighet & GIS / Delbeslut / Inlämning |
| `MassMapView` | (inbäddad) | GIS, geofence, MPF-beslut |
| `LocalizationStudyUI` | `04/Lokaliseringsutredning` | Karta, geodata-lager, alternativ |
| `DossierDashboard` | `05/Fastighetsdossier` | Riskklass, karta, rekommendationer, PDF |
| `CoreWorkflowView` | `05/Core workflow` | Projekt, sök, klassificering (valfritt) |

### Stegflöden att spegla exakt

**Enskilt avlopp:** Fastighet → GIS-analys → Systemval → Krav → Dokument → Inskickning → Bekräftelse

**C-anmälan massor:** Fastighet & GIS → Delbeslut (MPF + EWC) → Inlämning  
Gate-beslut att visa visuellt: `PERMIT_REQUIRED`, `NOTIFICATION_REQUIRED`, `EXEMPT`

**Lokaliseringsutredning:** Fastighetshämtning → kartval av alternativ → geodata-lager → kör utredning → export

### Prompt för Figma Make / MCP (kopiera efter fil skapats)

```text
Organisera Miljöbeslut demo-UI i befintlig filstruktur (sidor 00–05 enligt FIGMA_MAKE_PROMPT.md).

Regler:
- Svenska etiketter exakt som i koden (AppSidebar, stegnav, knappar).
- Primär indigo #6366f1, sekundär teal #14b8a6 — INTE röd som bas-UI.
- Använd auto-layout; wrapper 1440px för desktop shell.
- Modulformulär: ljus yta (slate-50 / vit), shell: mörk sidebar.
- Behåll komponentnamn = kodfilnamn i frame-titel.
- Publicera återanvändbara komponenter: SidebarLink, ModuleStepPill, ModuleCard, RiskBanner, MapPlaceholder.

Kontext att ladda (i ordning):
1. tokens.css + components/admin/admin-tokens.css
2. components/app/AppShell.tsx
3. components/AppSidebar.tsx + AppHeader.tsx
4. components/PriorityModulePortfolio.tsx
5. components/admin/modules/sewage-portal/SewagePortalView.tsx
6. components/admin/modules/c-notification-mass/CNotificationMassUI.tsx
7. components/LocalizationStudyUI.tsx
8. components/DossierDashboard.tsx
```

### Manuella steg (MCP blockerad)

1. **Cursor → Settings → MCP** — autentisera Figma-plugin (`plugin-figma-figma`); verifiera att `use_figma`, `create_new_file`, `get_metadata` syns.
2. Skapa eller öppna Design-fil; sätt `FIGMA_FILE_ID` lokalt (commita inte token).
3. Kör prompten ovan i Figma Make eller via MCP `use_figma` (inkrementellt, en sektion per anrop).
4. **Valfritt:** Kör `generate_figma_design` mot localhost för pixel-perfekt kart-/kartpanelsreferens (LocalizationStudyUI, MassMapView).
5. Publicera komponenter till team library → skapa Code Connect (`*.figma.ts`) med `node-id` från publicerade komponenter.
6. Uppdatera `src/figma-components/manifest.json` via befintlig export-pipeline när filen är klar.

### Code Connect (när Figma-komponenter finns)

Skapa vid publicering (exempelplatser):

- `components/AppSidebar.figma.ts`
- `components/PriorityModulePortfolio.figma.ts`
- `components/admin/modules/sewage-portal/SewagePortalView.figma.ts`
- `components/admin/modules/c-notification-mass/CNotificationMassUI.figma.ts`
- `components/LocalizationStudyUI.figma.ts`
- `components/DossierDashboard.figma.ts`

Kräver: Figma Organization/Enterprise, publicerade komponenter, URL med `node-id`.

```
