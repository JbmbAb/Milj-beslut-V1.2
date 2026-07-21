# Data coverage gaps — sammanfattning för AI-agenter

Senast uppdaterad: **2026-06-26**. Fullständig version: `docs/architecture/data-coverage-gaps.md`.

## Klart (LM/SGU kärna)

14/14 dataset verifierade med manifest v2 + SHA-256 (`archive-local-verify-registry.json`, 2026-06-26).

## Öppna gap (prioritet)

| Område | Status | Nästa steg |
|--------|--------|------------|
| Vatten (VISS, SMHI, LM Hydrografi) | Gap | VISS/SMHI download-first; LM Hydrografi **sist** (live OGC, nycklar klara) |
| MCF stabilitet | Gap | 2 ZIP resume + normalisera + librarian import |
| EBH / förorenade områden | Gap | NV bulk-nedladdning |
| LM våg 2–3 | Gap | Adresser, adm.indelning, ortnamn, FAPI |
| Raster (SGU Bergyta 50m) | Parkerad | COG + tile server, ej PostGIS |
| PDF-kommunkartor | Parkerad | RAG-pipeline, ej vektorisering |
| Drive-synk | Drift | H: = source of truth |

## Policy

- Default: skörda om från källan (Mimers Brunn golden rule).
- Legacy-adoption endast om källan försvunnen eller omhämtning opraktisk.
- PostGIS-import endast via `import-librarian-manifest.ts`.

## Kodkartor

- Registry: `scripts/import/config/importRegistry.ts`
- Spatial schema: `prisma/spatial/*.sql`
- Harvest scripts: `scripts/import/`, `scripts/data-pipeline/`
