# Data coverage gaps (Mimers Brunn)

Status: levande dokument. Senast uppdaterad: **2026-06-26**.

**Placering:** `docs/architecture/` — beskriver *vad som saknas eller är parkerat* i geodata-ryggraden.  
**Relaterat:** [future-optimizations-backlog.md](./future-optimizations-backlog.md) (AI/prod), [import-librarian-only-policy.md](./import-librarian-only-policy.md), [gemini-enterprise-access.md](../ops/gemini-enterprise-access.md).

Kärndataset som redan är stängda enligt golden rule dokumenteras i `storage/manifests/archive-local-verify-registry.json` — inte här.

## Statusnyckel

| Status | Betydelse |
|--------|-----------|
| **Klart** | Stängt enligt golden rule (manifest v2 + SHA-256 + audit) |
| **Parkerad** | Medvetet uppskjuten; ingen prod-import idag |
| **Gap** | Saknas eller legacy; kräver arbete |
| **Optimering** | Finns men bör förbättras |

**Gyllene regel:** Skörda om från källan om källan är tillgänglig och nedladdningen är rimligt snabb. Legacy-adoption endast i undantagsfall. Se `AGENTS.md`.

---

## Klart (referens)

| Dataset | Status | Bevis |
|---------|--------|-------|
| LM nationell: fastighetsytor, linjer, byggnad, marktäcke | **Klart** | 14/14 verified i `archive-local-verify-registry.json` (2026-06-26) |
| SGU Tier 1 + Tier 2 kärndataset | **Klart** | Samma audit; Stranderosion + Jordarter750k promotade 2026-06-26 |
| SGU Miljögifter (analys + provplats), SGU-HYPE Klimatindikatorer (historisk, rcp, områden) & Genomsläpplighet | **Klart** | Integrerade i central importRegistry.ts och sguHarvestSources.ts (2026-07-25) |

---

## Raster-pipelinen (Parkerad)

**SGU Jorddjup Bergyta 50 m (GeoTIFF)** hoppades över. Raster hör inte hemma i PostGIS.

**Framtida optimering:** Separat COG-pipeline + tile server. Relaterat: `scripts/db/promote-raster-cog.mjs`, `scripts/import/convert-nmd-to-cog.ts`.

---

## PDF/dokument-arkivet (Parkerad)

Ostrukturerade och PDF-tunga kommunmappar (t.ex. Göteborgs stabilitetszoner) laddas ner och hashas i Master Archive, men vektoriseras inte.

**Framtida optimering:** Separat RAG-pipeline/vektordatabas. Arkiv under `GEO_Master_Archive/Documents/Sources/`.

---

## Ny vatten-harvest (Gap)

Gammal VISS- och SVAR-data klassas som **legacy/unverified**. `Data/VISS` och `Data/SMHI` är tomma; inga `viss.*` / `hydro.*`-tabeller i PostGIS.

| Källa | Script | Källa-URL | Mimers-status |
|-------|--------|-----------|---------------|
| VISS, SMED, LST vattenskydd | `harvest-viss-to-master.ts` | WFS ext-geodata.lansstyrelsen.se | WFS → måste materialiseras till GPKG |
| SMHI SVAR 2022 | `import-smhi-huvudavrinningsomraden.ts` | opendata-view.smhi.se WFS | **Policyavvikelse:** live-WFS |
| LM Hydrografi | `harvest-lm-hydrografi-to-master.ts` | `api.lantmateriet.se/ogc-features/v1/hydrografi` | **BLOCKERAD (Mimers Brunn-undantag):** Nedladdning vektor ej godkänd för vår LM-app (token=200, `/collections`=200, `/items`=403 kod 900910). Endast **Hydrografi Direkt (visnings-WMS/WFS)** finns → får bara användas som **temporärt live-kartlager**, materialiseras EJ till arkivet. |
| topo10 vatten (legacy) | `import-topo10-only.ts` | `E:\GIS-Utbildning\...` | Legacy; `topo10.vatten` = 0 rader |
| topo10 väg | `import-topo10-only.ts` | Legacy `E:\` | `topo10.vag` saknas i DB |

**Nästa steg:** Download-first (Atom/ZIP/OGC Features → GPKG) med manifest v2 + SHA-256.

---

## Förorenade områden / EBH (Gap)

Saknas i spatial ryggrad. Tabellen `env.sgu_ebh_contaminated_site` är ej verifierad i librarian-flöde.

**Nästa steg:** Bulk-nedladdning via Naturvårdsverket/Dataportal.

---

## Lantmäteriet våg 2 & 3 (Gap)

Våg 0 (fastighetsytor, linjer, byggnader) är säkrad.

**Saknas:**

- Belägenhetsadresser (`belagenhetsadresser` i STAC-vektor)
- Administrativ indelning (`kommun-lan-rike`)
- Ortnamn (`ortnamn`)
- Rättigheter/servitut (FAPI) — när API tillåter

---

## MCF stabilitetskartering (Klart — feature freeze)

Nationell stabilitet för **finkorniga jordar** + **översiktlig finkornig** är promotad till `env.msb_stabilitetszon`.

**Parkerat (medvetet):** `moran-grovkorninga-jordar` och `oversiktlig-stabilitetskartering-i-moran-och-grova-jordar` — .gdb/format-träsk, ingen normaliserare-ändring under feature freeze.

---

## MSB översvämningskartering (Gap → pågår)

| Domän | Lastkaj (PDF) | Vektor (INSPIRE WFS) | PostGIS |
|-------|---------------|----------------------|---------|
| oversvamning-alv | Metod-PDF | `NZ_Oversvamning_100/200/BHF` | `climate.flood_risk_area` |
| oversvamning-kust | Metod-PDF | samma nationella lager | samma |
| oversvamning-malaren | Metod-PDF | samma nationella lager | samma |
| oversvamning-vattendrag | Metod-PDF | samma nationella lager | samma |

**Arkitektur:** Lastkaj-mapparna innehåller **PDF-rapporter** per vattendrag/kust/äl v/Mälaren. Själva **vektorpolygonerna** (100-/200-årsflöden) hämtas download-first från `inspire.msb.se/geoserver/oversvamning/wfs`.

**Scripts:**
- `harvest-msb-oversvamning-to-master.ts` — WFS → GPKG
- `prepare-msb-oversvamning-gpkg.ts` — merge → Librarian
- `harvest-mcf-oversvamning-pdfs-to-master.ts` — PDF → `Documents/Sources/MCF/Oversvamning/`

---

## LM Hydrografi (BLOCKERAD)

`https://geodata.naturvardsverket.se/nedladdning/` finns inte i `importRegistry`. Innehåller bl.a. Stomkartor (raster).

**Not:** Ersätter inte LM Hydrografi Direkt (vektor).

---

## Drive-synk / Master Archive (Gap — drift)

8 objekt hamnade i Drive "Hitta utan att leta". **Lokal H: är source of truth** tills synken är åtgärdad.

---

## Lärdomar (Batch A)

Legacy-adoption utan `files_detail`/SHA-256 kostar mer än ren omhämtning. Default = skörda om (inristat i `AGENTS.md` 2026-06-26).

---

## Referenser

| Dokument | Innehåll |
|----------|----------|
| `storage/manifests/archive-local-verify-registry.json` | LM/SGU kärnaudit |
| `knowledge-base/DATA_COVERAGE_GAPS.md` | Kortversion för Gemini Enterprise |
| `docs/archive/README.md` | Pekare till canonical docs (legacy-planer borttagna) |
| `knowledge-base/NATIONAL_HARVESTING_PHASES.md` | LST 2068 dataset (Fas 1–5) |
