# Data coverage gaps — sammanfattning för AI-agenter

**Canonical (fullständig):** [docs/architecture/data-coverage-gaps.md](../docs/architecture/data-coverage-gaps.md)  
**Uppdatera båda** när gap-status ändras. Senast synkad: **2026-07-26**.

## Klart (LM/SGU kärna)

14/14 dataset verifierade med manifest v2 + SHA-256 (`archive-local-verify-registry.json`, 2026-06-26).  
SGU Miljögifter, HYPE-klimat & Genomsläpplighet integrerade i `importRegistry.ts` (2026-07-25).  
MCF stabilitetszon (`env.msb_stabilitetszon`) — feature freeze.

## Öppna gap (prioritet)

| Område | Status | Nästa steg |
|--------|--------|------------|
| Vatten (VISS, SMHI, LM Hydrografi) | Gap | Download-first; LM Hydrografi vektor **blockerad** (403) — endast temp WMS/WFS |
| MSB översvämningskartering | Pågår | WFS → GPKG + PDF lastkaj |
| EBH / förorenade områden | Gap | NV bulk-nedladdning |
| LM våg 2–3 | Gap | Adresser, adm.indelning, ortnamn, FAPI |
| Raster (SGU Bergyta 50m) | Parkerad | COG + tile server, ej PostGIS |
| PDF-kommunkartor | Parkerad | RAG-pipeline, ej vektorisering |
| Drive-synk | Drift | H: = source of truth |

## Policy

- Default: skörda om från källan (Mimers Brunn golden rule).
- Legacy-adoption endast om källan försvunnen eller omhämtning opraktisk.
- PostGIS-import endast via librarian-manifest (`import-librarian-only-policy.md`).

## Kodkartor

- Registry: `scripts/import/config/importRegistry.ts`
- Spatial schema: `prisma/spatial/*.sql`
- Harvest: `scripts/import/`, `scripts/data-pipeline/`
