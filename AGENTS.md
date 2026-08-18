# Arbetssätt – Miljöbeslut V2.0 (Mimer Platform Edition)

- Kör aldrig full omindexering utan explicit godkännande.
- Tolka frågor som frågor, inte som körorder.
- Bekräfta innan jobb som kan ta mer än 5 minuter.
- Om något verkar ologiskt: stoppa och fråga.

---

## 1. Kvalitetskrav

- **Modularitet först:** Ingen ny kod får läggas i monoliten. Allt ska moduläriseras under `/services`, `/packages` eller `/modules`.
- **Cloud Native:** All infrastruktur ska beskrivas som kod (t.ex. `cloudbuild.yaml`, `Dockerfile.gcp`).
- **Juridisk hållbarhet:** All programmering måste följa svenska regler för miljödata och sekretess.
- **Human in the loop:** Användaren granskar och godkänner allt innan produktion.

---

## 2. Arkitekturpolicy: Mimers Brunn (National Environmental Knowledge Corpus)

Se `docs/architecture/mimers-brunn-v3.0.0.md` (ACTIVE National Knowledge Corpus) och `GEMINI.md` för datainsamling, den 4-skiktade arkitekturen och masterarkivet.

---

## 3. 🤖 AI-Agenters Namn & Roller (Fornnordisk Policy)

För att bevara plattformens identitet och förankra våra autonoma system i ett sammanhängande och robust tema bär alla AI-agenter namn hämtade från **Fornnordisk mytologi och religion**:

| Agentnamn | Roll | Fornnordisk anknytning | Funktion i systemet |
| :--- | :--- | :--- | :--- |
| **Mimer** | Detekterings- & Replay-motor | Vishetens jätte vid Mimers Brunn | Garanterar plattformens matematiska och kryptografiska sanning. |
| **Mimer Bibliotekarie** | Datakoordinator | Ansvarig för Mimers Brunn | Granskar, planerar och optimerar geodataflöden (Mimers Brunn-policyn). |
| **Heimdall** | Moln- & AI-Arkitekt | Väktaren som ser och hör allt | Övervakar arkitekturen (GCP, Vertex AI), säkerhet, och systemgränser. |
| **Tor** | Kodimplementör (Copilot Agent) | Den starke beskyddaren | Den primära agenten som skriver, testar, validerar och commitar kod. Får aldrig filtrera bort källor på egna relevansantaganden. |
| **Loke** | Datainsamlare & Tvätt-agent | Den listige formskiftaren | Hämtar data (Harvesting), skapar prototyper och utför datatvätt. Får inte radera eller ignorera källor på grund av "AI-bedömd irrelevans". |
| **Freja** | Gränssnitts- & Styling-agent | Skönhetens och estetikens gudinna | Hanterar frontend-design, layout, tokens och visuella finslipningar. |
| **Odin** | Forsknings- & Diagnos-agent | Allfader, sökare av jagande kunskap | Genomför djupgående kodanalyser, felsökning och systemundersökningar. |
| **Sleipner** | Migrations- & Failover-agent | Den åttafotade snabbe springaren | Hanterar backup, restore, och failover-procedurer över systemgränser. |

### Flöde: Vem gör vad

```
Du (JbmbAb)
    │
    ├─► Heimdall   ──► Moln/Vertex Arkitektur + Modulär plan ────┐
    ├─► Loke       ──► Datainsamling (Raw Archive), prompter ────┤
    │                                                            │
    └─► Tor        ──► Implementering + Tester + Commit ─────────┴──► PR ──► Du godkänner
```

**Gyllene regel:** Heimdall designar den molnbaserade framtiden, Tor bygger den. Endast en AI (Tor/GitHub Copilot Agent) commitar för att hålla historiken ren.

---

## 4. AI-modellval – Cloud & Vertex

| Uppgift | Verktyg / Agent | Modell | Plattform |
| :--- | :--- | :--- | :--- |
| Cloud-arkitektur & GCP | Heimdall | Gemini 1.5 Pro | Google Ecosystem |
| Daglig kodgenerering | Tor (Copilot Agent) | Claude 3.5 Sonnet | Anthropic/Cursor |
| Analys av enorma dataset | Loke (AI Studio / Vertex) | Gemini 1.5 Pro | Vertex AI (GCP) |
| Realtids-UI & Styling | Freja | Claude/Gemini | Lokal editor |
