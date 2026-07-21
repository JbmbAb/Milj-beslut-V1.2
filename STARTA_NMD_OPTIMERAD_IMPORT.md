# Starta NMD Optimerad Import

Den vanliga NMD-importen till `env.land_cover` blev langsam eftersom den byggde GiST-index samtidigt som PostgreSQL skrev full WAL med kort checkpoint-fonster.

Detta ar nu forberett for en snabbare omstart.

## Lage nu

- Aktiv NMD-import ska stoppas och `env.land_cover` tommas.
- `env.land_cover_shape_geom_idx` tas bort fore import.
- `env.land_cover` satts i `UNLOGGED`-lage under bulkimporten.
- PostgreSQL far snabbare bulkprofil under importen.

## Viktig fil

Kor allt via:

`scripts/data-pipeline/nmd_optimized_import.ps1`

## Efter omstart av datorn

Stall dig i repo-roten `C:\Dev\miljobeslut-platform-recovery` och kor:

```powershell
pwsh -ExecutionPolicy Bypass -File .\scripts\data-pipeline\nmd_optimized_import.ps1 -Mode start
```

## Kontrollera status under korning

```powershell
pwsh -ExecutionPolicy Bypass -File .\scripts\data-pipeline\nmd_optimized_import.ps1 -Mode status
```

## Nar NMD ar klar

Detta aterstaller normal tabelltyp, aterbygger spatialt index och lagger tillbaka normala DB-installningar:

```powershell
pwsh -ExecutionPolicy Bypass -File .\scripts\data-pipeline\nmd_optimized_import.ps1 -Mode finalize
```

## Vad `prep` gor

Detta lage ar for att rensa och forbereda om importen ska startas om fran noll:

```powershell
pwsh -ExecutionPolicy Bypass -File .\scripts\data-pipeline\nmd_optimized_import.ps1 -Mode prep
```

Det gor foljande:

- stoppar gamla `nmd`-processer
- trunkerar `env.land_cover`
- droppar `env.land_cover_shape_geom_idx`
- satter `env.land_cover` till `UNLOGGED`
- stanger av autovacuum pa just den tabellen under importen
- satter snabbare bulkprofil i PostgreSQL

## Viktigt

- Starta inte om datorn mitt i den nya importen.
- Kor alltid `finalize` efter att importen ar klar.
- `vatmark` ar redan klar; detta galler bara NMD / `env.land_cover`.
