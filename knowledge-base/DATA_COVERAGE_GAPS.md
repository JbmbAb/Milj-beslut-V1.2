# Data coverage gaps — sammanfattning för AI-agenter

**Canonical:** [docs/architecture/data-coverage-gaps.md](../docs/architecture/data-coverage-gaps.md)  
**Senast fullverifierad mot PostGIS:** **2026-07-28**.

## Policy

- **Läs aldrig gap-docs utan `COUNT(*)` i PostGIS.**
- Default Mimers Brunn: skörda om från källan; re-import bara om tabellen faktiskt är tom/saknas.
- Fastighetsuppslag: `PROPERTY_LOOKUP_MODE=postgis` (ingen live-LM-fallback).

## Finns i PostGIS (INTE gap)

Fastighet, LM våg 2–3, topo, vatten/VISS/SVAR, EBH, skydd, SKS, SGU-kärna, MSB stabilitet — se canonical.

**Fyllt 2026-07-27 från arkiv:** byggnadsminnen 2.6k, kulturmiljo 85k, nv_naturreservat 6k, friluftsliv 22k + leder 12k, MSB PFRA 30 + stora olyckor 822.

**Fyllt 2026-07-28:** HYPE klimatindikatorer historisk 3.3M + RCP 9.9M; flyg-gamma översiktlig 10.2M punkter (EPSG:3006).

## Verkliga gap kvar

| Område | Status |
|--------|--------|
| LM Hydrografi Direkt | Parkerad (efter sommaren) |
| FAPI servitut | Saknas |
| Raster COG / PDF-RAG / Drive | Parkerad / drift |

## Kodkartor

- Fill-script: `scripts/import/fill-empty-gaps-from-archive.ts`
- Registry: `scripts/import/config/importRegistry.ts`
- Gamma manifest: `scripts/import/write-gamma-manifest.ts`
