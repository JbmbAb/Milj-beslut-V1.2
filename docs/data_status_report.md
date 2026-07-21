# Statusrapport: Miljöbeslut Geodata & PostGIS

Denna rapport sammanfattar nuvarande status för geodata i Miljöbeslut-plattformen per 2026-04-27.

## 📊 PostGIS Databas (Skarpt läge)

| Datakategori | Tabellnamn | Antal rader | Status |
| :--- | :--- | :--- | :--- |
| **Jordarter** | `env.sgu_soil_type` | 4 455 885 | ✅ Skarpt |
| **Vägnät** | `env.lm_vag` | 2 199 999 | ✅ Skarpt |
| **Förorenad mark** | `env.sgu_ebh_contaminated_site` | 85 313 | ✅ Skarpt |
| **Fornlämningar** | `culture.monument` | 348 377 | ✅ Skarpt |
| **Vattenskydd** | `env.water_protection_area` | 1 643 | ✅ Skarpt |
| **Klimat (Brunnar)** | `env.sgu_well` | 2 305 176 | ⚠️ Endast klimatindikatorer |

## 📂 Importpipelinen (`Miljobeslut_Ops_Pipeline`)

Följande datamängder finns redo i `storage/extracted/` men kan behöva verifieras eller importeras på nytt för att ersätta klimatdata/mock-data:

### 🎯 Prioriterade för import
1.  **Brunnsarkivet:** `brunnar/brunnar.gpkg` (619 MB). Detta är det faktiska brunnsarkivet som bör ersätta `env.sgu_well` för att möjliggöra avståndsanalyser till dricksvattentäkter.
2.  **Hydrografi:** `Avrinningsomraden_2016` och `SVAR2022`. Viktigt för att beräkna avstånd till ytvatten och recipienter.

### 📦 Övrigt uppackat material
- `seveso`: Anläggningar med farliga ämnen.
- `Myrskyddsplan_2007`: Skyddade våtmarker.
- `jorddjupsmodell`: Viktigt för infiltrationsbedömningar vid enskilda avlopp.

## 🚀 Nästa steg
- [ ] Genomför import av `brunnar.gpkg` till en ny tabell `env.sgu_well_actual`.
- [ ] Uppdatera `sguService.ts` att peka på den riktiga brunnsdatan.
- [ ] Verifiera SMHI-kopplingen för skarpa avrinningsområden (SVAR2022).
