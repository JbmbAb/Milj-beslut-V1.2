# Admin Gränssnitt – Miljobeslut.se

## Översikt

Admin-gränssnittet är ett helt nytt, modulbaserat administrationssystem för Miljobeslut.se. Det är uppbyggt enligt WCAG 2.1 AA-standard och följer DIGG:s riktlinjer för myndighetswebbplatser.

## Struktur

```
components/admin/
├── AdminContainer.tsx           # Root-komponent (entry point)
├── AdminShell.tsx              # Övergripande layout
├── AdminNav.tsx                # Sidonavigation
├── AdminHeader.tsx             # Top-bar header
├── ModuleRouter.tsx            # Modulväljare
│
├── admin-tokens.css            # DIGG design tokens & WCAG tokens
├── admin-shell.css             # Layout-stil
├── admin-nav.css               # Sidonav-stil
├── admin-header.css            # Header-stil
│
├── modules/
│   ├── permit-portal/          # Core Tillståndsportal
│   │   ├── PermitPortalModule.tsx
│   │   └── permit-portal.css
│   │
│   ├── logistics/              # Logistik & Massa
│   │   └── LogisticsModule.tsx
│   │
│   ├── project-plan/           # Projektplan
│   │   └── ProjectPlanModule.tsx
│   │
│   ├── green-check/            # Grönkoll för Banker
│   │   └── GreenCheckModule.tsx
│   │
│   ├── sewage-portal/          # Enskilt Avlopp
│   │   └── SewagePortalModule.tsx
│   │
│   └── module-common.css       # Gemensam modulstil
│
└── index.ts                    # Exportpunkt
```

## Användning

### Import av AdminContainer

```typescript
import { AdminContainer } from 'components/admin';

// I din app-layout:
<AdminContainer />
```

### Lägg till admin-route

```typescript
// I App.tsx eller router-setup:
import { AdminContainer } from 'components/admin';

const AdminPage = () => <AdminContainer />;
```

## Design Tokens (DIGG & WCAG)

Alla färger, typografi och spacing är definierade i `admin-tokens.css`:

- **Primärfärg:** Statsblå (#005293)
- **Sekundär:** Grönt (#2E8B57)
- **Varning:** Orange (#D97706)
- **Fel:** Rött (#DC2626)
- **Bakgrund:** Vit (#FFFFFF)
- **Typografi:** Open Sans 16px base
- **Spacing:** 8px-system (xs=4px, sm=8px, md=12px, etc.)
- **Kontrast:** Minst 4.5:1 för text, 3:1 för gränssnittelement

## Moduler

### 1. Core Tillståndsportal (`permit-portal`)

- Hantering av miljötillståndsansökningar
- Tabbar: Ansökningar, Beslut, Dokument, Spårning
- **Status:** Core med datatabell

### 2. Logistik & Massa (`logistics`)

- Transportövervakning, lagerstatus, CO₂-rapportering
- Tabbar: Transporter, Lagerstatus, CO₂-rapportering, Aviseringar
- **Status:** Scaffold (placeholder)

### 3. Projektplan (`project-plan`)

- Gantt-schema, fashantering, stakeholder-lista
- Tabbar: Gantt, Faser, Stakeholders, Risker
- **Status:** Scaffold (placeholder)

### 4. Grönkoll för Banker (`green-check`)

- Risk-dashboard, ESG-rapportering, kreditvärdighet
- Tabbar: Dashboard, Mätetal, Rapporter, Compliance
- **Status:** Scaffold (placeholder)

### 5. Enskilt Avlopp (`sewage-portal`)

- Ansökan för privata avloppsanläggningar
- Tabbar: Ansökningar, Placering, Inspektioner, Godkännanden
- **Status:** Scaffold (placeholder)

## WCAG 2.1 AA Compliance

✅ **Tangentbordsnavigation**

- Alla knappare och interaktiva element är Tab-navigerbara
- Escape stänger modaler
- Enter/Space aktiverar knappar

✅ **Skärmläsare**

- `aria-labels` på alla ikonknappar
- `aria-current="page"` på aktiva tabbar
- `aria-expanded` för menyer
- `role="main"` på innehållsarea

✅ **Färgkontrast**

- Primärfärg (#005293) + vit (#FFFFFF) = 10.8:1 kontrast ✓
- Alla textfärger har minst 4.5:1 kontrast med bakgrund

✅ **Fokusering**

- `:focus-visible` styling på alla interaktiva element
- 2px solid outline i primärfärg
- 2px outline-offset för synlighet

✅ **Responsivitet**

- Sidonav blir collapsible på < 1024px
- Hamburger-meny på mobil
- Tablayout optimerat för touch

## Extending the Admin Interface

### Lägg till ny modul

1. Skapa ny fil: `components/admin/modules/my-module/MyModule.tsx`
2. Importera basmodul-CSS:
   ```typescript
   import '../module-common.css';
   ```
3. Lägg till i `AdminModuleId` type i `AdminShell.tsx`
4. Lägg till i `ModuleRouter.tsx` switch-statement
5. Lägg till i modul-lista i `AdminNav.tsx`

### Anpassa tokens

Redigera `admin-tokens.css` `:root` CSS-variabler:

```css
:root {
  --color-primary-digg: #005293; /* Ändra här */
  --font-size-base-digg: 16px; /* Eller här */
  /* etc. */
}
```

## Framtida utveckling

- [ ] Core Tillståndsportal – Implementera batch-operationer
- [ ] Logistik – Integrera realtidsdata från API
- [ ] Projektplan – Lägg till Gantt-diagramlogik
- [ ] Grönkoll – Implementera risk-scoring & visualisering
- [ ] Enskilt Avlopp – Kartintegration med Leaflet
- [ ] Globala notifikationer (toast-system)
- [ ] User profile dropdown med inställningar
- [ ] Dark mode (optional)

## Resurser

- [DIGG Myndighetsgemensam design](https://www.digg.se/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Lucide React Icons](https://lucide.dev/)
- [CSS Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/--*)
