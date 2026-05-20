# Development Governance: Miljobeslut.se Portal

Detta dokument fastställer rutinerna för utveckling, beslutsfattande och kvalitetssäkring i projektet. Syftet är att säkerställa att alla (mänskliga och AI-utvecklare) följer samma väg framåt.

---

## 1. Kärnprinciper

### 1.1 EN AI-kommitör

GitHub Copilot Agent är den **ENDA** AI som får commita kod till repot.

- Andra AI-verktyg (t.ex. Google AI Studio, Figma Make, Gemini CLI) fungerar som analytiker och lösningsarkitekter.
- Dessa verktyg levererar input och kodförslag till användaren, som i sin tur instruerar Copilot Agent att genomföra och commita ändringarna.

### 1.2 Människa-i-loopen (Human-in-the-loop)

Användaren (Människan) har det slutgiltiga ansvaret och mandatet.

- Alla Pull Requests (PRs) måste godkännas av användaren innan de mergas.
- Strategiska beslut tas av användaren efter analys från AI-verktygen.
- Kritiska beslut rörande säkerhet och GDPR kräver alltid användarens explicita godkännande.

### 1.3 Kvalitet Först

Ingen kod accepteras om den inte uppfyller följande krav:

- **TypeScript:** 0 fel.
- **ESLint:** 0 varningar/fel.
- **Tester:** 100% godkända.
- **Testtäckning:** Minst 70%.
  Ingen kod mergas utan att dessa kvalitetsgrindar har passerats.

### 1.4 Tidig Struktur

- **Modulregistret** (`docs/architecture/modulregister_ombyggnad.md`) är den enda sanningen för modulernas status.
- Sidospår (legacy, experiment, oanvänd kod) identifieras och arkiveras eller kasseras omedelbart.
- Experimentell kod ska separeras tydligt från produktionskod.

---

## 2. Beslutsflöden och Eskalering

### 2.1 Tekniska beslut

Mindre tekniska beslut fattas av AI-verktygen (t.ex. Gemini CLI) inom ramen för den etablerade arkitekturen. Om ett beslut avviker från arkitekturplanen ska det eskaleras till användaren.

### 2.2 Arkitekturbeslut

Större förändringar i systemdesignen kräver en uppdatering av `docs/architecture/ombyggnadsstrategi_bygga_nytt_bygga_ratt.md` och användarens godkännande.

### 2.3 Konfliktlösning

Vid motstridiga instruktioner eller designval mellan olika AI-verktyg ska användaren agera domare och fatta det slutgiltiga beslutet.

---

## 3. Dagliga och Veckovisa Rutiner

### 3.1 Varje morgon (Utvecklingsstart)

1. `git pull origin main` för att synka med senaste kod.
2. `npm run typecheck && npm run lint && npm run test:unit` för att verifiera hälsan i repot.

### 3.2 Vid Pull Request

1. Copilot Agent kör automatiskt kvalitetskontroller.
2. Användaren granskar ändringarna mot kraven i Modulregistret.
3. PR mergas endast vid fullständig godkänd kontroll.

### 3.3 Varje vecka

- Recension av öppna PRs (rekommenderat max 3 samtidigt).
- Självutvärdering: Följs governance-reglerna?
- Uppdatera Modulregistret vid behov.

### 3.4 Varje månad

- Djupgranskning av kodbas, dokumentation och processer.
- Uppdatering av strategidokument vid behov.
- Identifiering av nya hot och möjligheter.

---

## 4. Kvalitetsgrindar

| Grind    | Verktyg            | Krav                |
| -------- | ------------------ | ------------------- |
| Typning  | TypeScript (tsc)   | Inga fel            |
| Kodstil  | ESLint             | Inga varningar/fel  |
| Logik    | Vitest / Jest      | 100% godkända       |
| Täckning | Vitest coverage    | > 70%               |
| Säkerhet | Inbyggd granskning | Godkänd av människa |

---

## 5. Dokumentation

All ny funktionalitet ska dokumenteras i:

- `README.md` (vid behov)
- Relevanta dokument i `docs/architecture/`
- `CHANGELOG.md` (inför release)
