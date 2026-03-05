# Runbook

## 1) Importera snapshot
```powershell
cd examensrepo
npm run snapshot:import -- --from=../docs/qa/requirements-model --label=latest
```

## 2) Normalisera till working-dataset
```powershell
npm run snapshot:normalize -- --snapshot=./input/snapshots/latest --label=current
```

## 3) Backfill citation-lankar (utan verifiering)
```powershell
npm run citations:backfill-links -- --dataset=./working/current
```

## 4) Bygg verifieringsko
```powershell
npm run verification:queue -- --dataset=./working/current
```

## 5) Manuellt verifieringspass
1. Uppdatera `working/current/requirements.csv`
2. Uppdatera `working/current/citations.csv`
3. Sakerstall `Verifieringsstatus=VERIFIED`, `VerifieradJaNej=Ja`, `VerifieradAv`, `VerifieradDatum`

## 6) Kor kvalitetsgate
```powershell
npm run verification:gate -- --dataset=./working/current
```

## 7) Bygg rapportartefakter
```powershell
npm run report:build -- --dataset=./working/current --out=./output/release-current
```

## 8) Frys dataset-version
```powershell
npm run dataset:freeze -- --dataset=./working/current --label=dataset-v1
```

## 9) Paket till handledare/examinator
Leverera:
- `output/release-current/examensrapport_utkast.md`
- `output/release-current/table_*.csv`
- `output/release-current/evidensindex.csv`
- `verified/dataset-v1/dataset_freeze_manifest.json`
