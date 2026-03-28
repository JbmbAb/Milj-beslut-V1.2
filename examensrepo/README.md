# Examensrepo - verifieringsstyrd sammanstallning

Detta ar en separat kodbas for examensarbetet. Syftet ar att sammanstalla juridiska krav for mellanlagringsplattor med human-in-the-loop och full sparbarhet.

## Mal
1. Halla examensflodet separerat fran produktens releaseflode.
2. Krava verifiering innan rapportgenerering.
3. Generera tabeller A-D, evidensindex och rapportutkast pa verifierad data.

## Struktur
- `input/` inkommande snapshots
- `working/` normaliserad arbetsdata
- `verified/` frysta datasetversioner
- `output/` rapportartefakter
- `docs/` metod, kontrakt, runbook
- `tools/` pipeline scripts

## Datakontrakt
Snapshoten ska innehalla:
1. `cases.csv`
2. `requirements.csv`
3. `citations.csv`
4. `summary.json`

Formella I/O-typer finns i `contracts/exam.types.d.ts`.

Kallan kan vara befintlig produkt-export (`requirement_cases.csv`, `requirement_rows.csv`, `requirement_citations.csv`, `requirement_summary.json`) via importscript.

## Snabbstart
```powershell
cd examensrepo
npm run snapshot:import -- --from=../docs/qa/requirements-model --label=latest
npm run snapshot:normalize -- --snapshot=./input/snapshots/latest --label=current
npm run citations:backfill-links -- --dataset=./working/current
npm run verification:queue -- --dataset=./working/current
```

Helkornig pipeline (stannar fore rapportbygge om quality gate faller):
```powershell
npm run pipeline:run -- --from=../docs/qa/requirements-model --label=demo --quality-soft
```

Verifiera rader manuellt i din verifieringsprocess och uppdatera `working/current/*.csv`.

Kvalitetsgate:
```powershell
npm run verification:gate -- --dataset=./working/current
```

Bygg rapportartefakter (blockeras om inget ar VERIFIED):
```powershell
npm run report:build -- --dataset=./working/current --out=./output/release-current
```

Frys verifierad datasetversion:
```powershell
npm run dataset:freeze -- --dataset=./working/current --label=dataset-v1
```

## Regelverk
1. Endast `VERIFIED` rader far inga i slutresultat.
2. Kravrad maste ha `VerifieradAv` + `VerifieradDatum`.
3. Citation maste vara verifierad och ha sidnummer eller kommentar.
4. Kategorierna `Ytkonstruktion` och `DagvattenLakvatten` flaggas for dubbelgranskning.

## Separering till eget Git-repo
Om du vill ha helt frikopplad historik:
```powershell
cd examensrepo
git init
git add .
git commit -m "Initialize exam repository"
```

## Rapportprofil
- Forfattare: Jimmy Bruce (Nitoves)
- Standard: Harvard svensk
- Slutleverans: rapportutkast + verifierad bilagematris + evidensindex
