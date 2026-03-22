# Valideringsflode for kravdata (cases + requirements + citations)

## Syfte

Detta flode ersatter "en stor CSV" som primar arbetsyta med en normaliserad struktur:

1. `requirement_cases.csv` for arende-/dokumentmetadata.
2. `requirement_rows.csv` for ett krav per rad.
3. `requirement_citations.csv` for spårbar citatniva.

Slutlig analys ska bara anvanda rader som ar manuellt verifierade.

## Kora normaliserad export

```powershell
npm run requirements:model
```

Med filter:

```powershell
npm run requirements:model -- --project-id=<PROJECT_ID> --limit-docs=200 --max-per-document=4
```

Output skrivs till:
`docs/qa/requirements-model/`

## Filer som skapas

1. `requirement_cases.csv`
2. `requirement_rows.csv`
3. `requirement_citations.csv`
4. `requirement_summary.json`

## Manuell validering (human-in-the-loop)

1. Granska per `CaseId` / `KallaFil`.
2. Bekrafta metadata i `requirement_cases.csv`:
   - `Kommun`, `Myndighet`, `Diarienummer`, `Dokumenttyp`, `Dokumentdatum`.
3. Granska varje kravrad i `requirement_rows.csv`:
   - citatet finns i kallfil
   - kategori och kravniva ar korrekt
   - satt `VerifieradJaNej=Ja` och fyll `VerifieradAv`, `VerifieradDatum`
4. Granska `requirement_citations.csv` for citatspår:
   - fyll sida/span dar det ar mojligt
   - markera verifieringsstatus

## Regler for analys

1. Slutrapport ska baseras pa `VerifieradJaNej=Ja`.
2. Kategorierna `Ytkonstruktion` och `DagvattenLakvatten` ska dubbelgranskas.
3. Rader med `Feltyp` eller tom karnmetadata exkluderas tills korrigering ar gjord.

## Databasmodell (Prisma)

Migrationen `prisma/migrations/20260302_requirements_model/migration.sql` introducerar:

1. `RequirementCase`
2. `RequirementRecord`
3. `RequirementCitation`
4. enum `RequirementVerificationStatus`

For att applicera lokalt:

```powershell
npm run prisma:migrate
npm run prisma:generate
```

## Adminlage: Examensrapport Studio

Adminpanelen innehaller nu en verifieringsdriven rapportstudio som anvander samma modell.

Flode:

1. Oppna `Admin Console` och logga in som admin.
2. I sektionen `Examensrapport Studio`, filtrera verifieringskon.
3. Valj kravrad, granska citat och oppna PDF via `DocumentId`-route.
4. Satt citat till `REVIEWED` eller `VERIFIED`.
5. Satt kravrad till `VERIFIED` med `verifiedBy`.
6. Kontrollera rapportpanelen (default `VERIFIED_ONLY`).
7. Exportera CSV-zip och DOCX.

Tekniska regler:

1. `VERIFIED` for kravrad blockeras tills alla citat ar `REVIEWED`/`VERIFIED`.
2. `VERIFIED` for citat blockeras utan `verifiedBy` och pageNumber eller kommentar.
3. Rapportsummering och export inkluderar endast `VERIFIED` som standard.
