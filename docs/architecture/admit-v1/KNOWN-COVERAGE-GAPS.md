# Kända täckningsluckor i de styrda LU-lagren (ADMIT v1)

**Status:** underlag till registret `server/modules/localization/knownCoverageGaps.ts`. Dokumentet är **inte** en del av det frysta ADMIT v1-kontraktet (`LAYER-ID-CONTRACTS-V1.md`, `ADMIT-V1-SET.md`) och ändrar det inte.
**Syfte:** registrets påståenden ska kunna följas inne i repot (Dev-Gov, CI). Varje post nedan har samma `gap_id` som i registret.
**Infört:** 2026-10-02 (U20CDF2, låg 3). Uppgifterna är ett utdrag. Ingen databas lästes för detta dokument.

## NATURA2000_SPA_103_OF_558_ABSENT (KNOWN_INCOMPLETE_DATA)

| Fält | Värde |
|---|---|
| Lager | `lu.natura2000` (`env.natura2000_area`) |
| Dataset (ADMIT v1 `source_sha256`, `.shp`) | `a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02` |
| Påstående | 103 av 558 SPA-områden saknas i den styrda tabellen. Live-mängden är FID 0–454, och de 103 kodade områdena FID 455–557 saknas. |
| Datum | 2026-09-25 (avstämning i DB provenance lane) |
| Omkontroll | **Ej omkontrollerad mot nuvarande tabell.** Siffran gäller per 2026-09-25. Den förblir märkt så (`rechecked_against_current_table: false`, `basis_sv` "enligt avstämning 2026-09-25, ej omkontrollerad mot nuvarande tabell") tills en ny census har verifierat den. |
| Ägarbeslut | D-5 är öppet: får `env.natura2000_area` förbli det LU-kopplade lagret, eller ska det läsas in igen från en verifierad källa? |

**Verifierat utdrag.** Källan är rapporten `DB-LANE-RECONCILIATION-CRITIC.md` (task CRIT, 2026-09-25). Den ligger utanför repot, i huvudcheckoutens `Claude outputs/db-provenance-lane-2026-09-25/`. Radnumren avser den rapporten:

- **:41** Repo-kopians `.dbf` är `storage/manifests/admit-v1-import/lu.natura2000/data/SPA_rikstackande.dbf`, med SHA-256 `7f9438ca2f93cf5d017a494db0ada29da55e2dcb5cbc58424bc02bb009a367de`.
  - Headern anger 558 poster.
  - Byte 888 710 till filens slut är 0x00.
  - floor((888 710 − 641) / 1 949) = 455.
  - Märkning: OFFLINE-MEASURED, PROVEN.
- **:44** Offline-referensfilens header: `features 558`, `site_code_distinct_nonnull 558`, `n_fid_455_557 103` och `n_fid_455_557_coded 103`. Märkning: ARTIFACT-DERIVED.
- **:46** LIVE-omläsning 2026-09-25 10:00:24Z: `env.natura2000_area` har 455 rader och `ogc_fid` 1..455. Märkning: LIVE, PROVEN.
- **:103** P-9:
  - Live-mängden är FID 0..454 av den intakta `.dbf` som är lika med H:-mastern.
  - 103 kodade områden (FID 455–557) saknas.
  - Repots sidecar är nollfylld från byte 888 710.
  - Grinden i ADMIT v1 hashar bara primärfilen.
- **:173** D-5: ägarbeslutet om lagret är öppet (se tabellen ovan).

## Övriga poster i registret

Kontraktsposterna (`CONTRACT_SCOPE`) har sin källa direkt i det frysta kontraktet i repot. De behöver inget utdrag här:

| gap_id | Källa |
|---|---|
| `NATURA2000_SPA_ONLY` | `LAYER-ID-CONTRACTS-V1.md:22`, `ADMIT-V1-SET.md:60` |
| `PROTECTED_AREA_NATURRESERVAT_ONLY` | `LAYER-ID-CONTRACTS-V1.md:20`, `ADMIT-V1-SET.md:58` |
| `WATER_PROTECTION_NV_ONLY` | `LAYER-ID-CONTRACTS-V1.md:21`, `ADMIT-V1-SET.md:16-29,68` |
