# Data coverage gaps (Mimers Brunn)

Status: levande dokument. Senast fullverifierad mot PostGIS: **2026-07-28** (`miljobeslut-postgres`).

**Regel:** Läs aldrig detta som sanning utan `COUNT(*)` i DB. Tidigare versioner påstod tomma tabeller som redan var fyllda.

**Relaterat:** [import-librarian-only-policy.md](./import-librarian-only-policy.md), `storage/manifests/archive-local-verify-registry.json`, [DATA_COVERAGE_GAPS.md](../../knowledge-base/DATA_COVERAGE_GAPS.md).

## Statusnyckel

| Status | Betydelse |
|--------|-----------|
| **I PostGIS** | Har rader — ingen re-import |
| **Tom tabell** | Relation finns, 0 rader |
| **Saknas** | Ingen tabell / ingen produkt |
| **Parkerad** | Medvetet uppskjuten |

---

## I PostGIS (kärna) — verifierat 2026-07-27

### Lantmäteriet / fastighet / topo

| Tabell | Rader |
|--------|------:|
| `core.property_unit` | 4 642 928 |
| `env.registerenhetsomradesytor` | 4 395 642 |
| `env.registerenhetsomradeslinjer` | 49 434 |
| `core.belagenhetsadress` / `env.belagenhetsadress` | 3 938 111 |
| `core.ortnamn` | 990 623 |
| `core.kommuner` | 2 766 |
| `core.lan` | 198 |
| `core.rike` | 9 |
| `env.marktacke` | 3 279 185 |
| `topo10.byggnad` | 9 479 965 |
| `topo10.mark` | 3 495 247 |
| `topo10.vag` | 3 023 801 |
| `topo10.vatten` | 838 935 |
| `topo10.anlaggning` | 37 180 |
| `topo50.*` / `topo250.*` / `topo1m.*` | fyllda (vatten/väg/mark m.m.) |

**LM våg 2–3 (adresser, ortnamn, adm.indelning) är INTE gap** — tidigare docs ljög.

### Vatten / VISS / SMHI / översvämning

| Tabell | Rader |
|--------|------:|
| `topo10.vatten` | 838 935 |
| `topo50.vatten` | 696 013 |
| `viss.vattenforekomster_ytvatten` | 23 804 |
| `viss.vattenforekomster_grundvatten` | 3 702 |
| `viss.status_sjoar` / `_vattendrag` / `_grundvatten` | 7 453 / 15 688 / 3 702 |
| `hydro.svar2022_*` / `water_catchment` | ~24–26k |
| `hydro.svaro_2016` | 53 538 |
| `hydro.huvudavrinningsomraden` | 111 |
| `climate.flood_risk_area` | 225 |
| `env.water_protection_area` | 6 572 |
| `env.wetland` | 359 269 |

API: `getHydroLayer` → VISS sjöar + `topo10.vatten` (2026-07-27).

### EBH / skydd / skog / stabilitet

| Tabell | Rader |
|--------|------:|
| `env.ebh_potentiellt_fororenade_omraden` | 85 429 |
| `env.protected_area` | 40 928 |
| `env.natura2000_area` | 13 761 |
| `env.msb_stabilitetszon` | 1 258 |
| `env.sks_avverkningsanmalan` | 131 122 |
| `env.sks_nyckelbiotoper` | 67 097 |
| `env.sks_biotopskydd` | 9 062 |
| `env.sks_naturvardsavtal` | 5 576 |

### SGU (urval — många fler tabeller fyllda)

| Tabell | Rader |
|--------|------:|
| `env.sgu_well` / `sgu_well_actual` | 832 535 |
| `env.sgu_well_lager` | 1 351 866 |
| `env.sgu_soil_type_25k_100k` | 2 956 837 |
| `env.sgu_fastmark_stabilitet` | 2 956 837 |
| `env.sgu_blockighet` | 1 712 465 |
| `env.sgu_jorddjupsmodell_10m` | 1 736 629 |
| `env.sgu_aktsamhet_efterarbetad` | 242 296 |
| `env.sgu_landslide_feature` | 50 373 |
| `env.sgu_grundvattenforekomst` | 13 739 |
| `env.env_sgu_grundvatten_sarbarhet` | 9 340 |
| `env.sgu_borrhal` / `sgu_kallor` | 36 672 / 14 460 |
| `env.sgu_erosion_aktiv` | 204 |
| Plus berggrund BG50k, landform, maringeologi, m.fl. | >0 |

---

## Tomma / saknade (uppdaterat efter arkiv→PostGIS 2026-07-27)

### Fyllda från Master Archive denna session

| Tabell | Rader |
|--------|------:|
| `env.msb_stora_olyckor` | 822 |
| `env.msb_pfra_pastevent` | 30 |
| `env.byggnadsminnen` | 2 615 |
| `env.kulturmiljo_omrade` | 85 424 |
| `env.nv_naturreservat` | 6 027 |
| `env.friluftsliv` | 21 568 |
| `env.friluftsliv_leder` | 12 015 |
| `env.sgu_permeability` / `_coverage` | 2 956 837 / 896 |
| `env.sgu_groundwater_magazine` (+7 sidolager) | 9 368 |
| `env.sgu_hydraulisk_konduktivitet_berg` | 404 903 |
| `env.sgu_hydraulisk_konduktivitet_berg_rast` | 826 tiles (Out-of-DB, 100 m) |
| `env.sgu_grundvattenkvalitet_provplats` | 5 013 |
| `env.sgu_miljogifter_provplats` | 14 105 |
| `env.sgu_hype_omraden` | 29 597 |
| `env.sgu_hype_klimatindikatorer_historisk` | 3 310 668 |
| `env.sgu_hype_klimatindikatorer_rcp` | 9 932 004 |
| `env.sgu_flyg_gamma_oversiktlig` | 10 221 157 |

### SGU-import avslutad denna session (verifierat COUNT)

| Tabell | Rader |
|--------|------:|
| `env.sgu_grundvattenkvalitet_analys` | 1 398 475 |
| `env.sgu_miljogifter_analys` | 1 997 774 |

`VACUUM (ANALYZE)` körd på nya SGU-kärntabeller.

### SGU-import 2026-07-28 (verifierat COUNT)

| Tabell | Rader |
|--------|------:|
| `env.sgu_hype_klimatindikatorer_historisk` | 3 310 668 |
| `env.sgu_hype_klimatindikatorer_rcp` | 9 932 004 |
| `env.sgu_flyg_gamma_oversiktlig` | 10 221 157 |

### Kvarstår / parkering

| Område | Status | Kommentar |
|--------|--------|-----------|
| LM Hydrografi Direkt | **Parkerad** | efter sommaren; topo10 räcker |
| FAPI rättigheter/servitut | **Saknas** | avtal/API |
| `/master-archive` H:-mount i Docker | **Trasig** (Google Shared Drive) | Out-of-DB hydraul-TIFF via `/var/lib/postgresql/geo_rasters/`; kanonisk fil på H: |

**Fyllt 2026-07-28:** HYPE klimatindikatorer (historisk + RCP); flyg-gamma översiktlig (harvest + PostGIS).

---

## Gör inte

- Re-import av vatten, EBH, topo, LM adresser/ortnamn/adm, SGU wells/jordarter m.m. “för att docs sa gap”.
- Live-LM-fallback för fastighetsuppslag (default = PostGIS).

## Referenser

| Dokument | Innehåll |
|----------|----------|
| `storage/manifests/archive-local-verify-registry.json` | Manifest-audit (kompletterar, ersätter inte COUNT) |
| `knowledge-base/DATA_COVERAGE_GAPS.md` | Kort AI-index — synkad med detta |
| `scripts/import/config/importRegistry.ts` | Importmål |
