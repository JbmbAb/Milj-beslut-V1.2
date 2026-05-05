# Stitch Prompt – Miljöbeslut.se Metrics

## Syfte
Denna fil dokumenterar hur Google Stitch används för metrics-synk i Miljöbeslut.se.

## Konfiguration
- **Projekt-ID:** `9118488730778694849`
- **Projekt-URL:** `https://stitch.withgoogle.com/projects/9118488730778694849`
- **Konfigurationsfil:** `stitch.json`
- **Synkskript:** `scripts/sync-stitch.ts`
- **Connection type:** `full_sync`
- **Miljö:** `demo-mvp`

## Miljövariabler (krävs i `.env`)
```env
STITCH_PROJECT_URL=https://stitch.withgoogle.com/projects/9118488730778694849
STITCH_API_KEY=<din-api-nyckel>
```

## Regler (från AGENTS.md)
- Stitch används **enbart** för metrics-synk via `scripts/sync-stitch.ts`.
- Kör **manuellt** – aldrig automatiskt i CI.
- Modifierar **inte** kod, komponenter eller scheman.
- Om Stitch inte används aktivt inom 60 dagar → avvecklas.

## Köra synk
```bash
npx ts-node scripts/sync-stitch.ts
```

## Metrics som synkas
| Metric | Beskrivning |
|---|---|
| `total_documents` | Totalt antal dokument i databasen |
| `municipality_coverage` | % dokument med normaliserad kommundata |
| `decision_type_coverage` | % dokument med beslutskategori |
| `text_extraction_status` | % dokument med extraherad/chunkad/embedded text |

## Prompt för Stitch (UI)
När du öppnar Stitch-projektet, använd följande kontext:

```
Projekt: Miljöbeslut.se (miljobeslut-se-2.0)
Miljö: demo-mvp
Databas: PostgreSQL (miljobeslut)
Schema: public
Primär tabell: DocumentRecord
Coverage-metriken uppdateras manuellt via scripts/sync-stitch.ts.
```

## Relaterade filer
- `stitch.json` – Projektkonfiguration
- `scripts/sync-stitch.ts` – Synkskript
- `AGENTS.md` – AI-arbetsfördelning (Stitch-regler)
