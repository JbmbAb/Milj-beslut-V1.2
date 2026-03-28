# I/O-kontrakt for examenspipeline

## Version
- Contract version: `1.0.0`

## Input (`ExamSnapshotInput`)
Mappen ska innehalla:
1. `cases.csv`
2. `requirements.csv`
3. `citations.csv`
4. `summary.json`

## Faltkrav
### cases.csv
Minst falt:
- `CaseId`
- `DocumentId`
- `Kommun`
- `Myndighet`
- `Dokumenttyp`
- `KallaFil`

### requirements.csv
Minst falt:
- `RequirementId`
- `CaseId`
- `DocumentId`
- `Kravkategori`
- `Kravsubkategori`
- `KravtextCitat`
- `Verifieringsstatus`
- `VerifieradJaNej`
- `VerifieradAv`
- `VerifieradDatum`

### citations.csv
Minst falt:
- `CitationId`
- `RequirementId`
- `DocumentId`
- `QuoteText`
- `PageNumber` eller `Kommentar`
- `VerifieradJaNej`
- `VerifieradAv`
- `VerifieradDatum`

## Processad dataset (`ExamVerifiedDataset`)
- Normaliserad kopia i `working/<label>/`
- Kvalitetsgate rapport i `quality_gate_report.json`
- Fryst version i `verified/<dataset-label>/`

## Rapportartefakter (`ExamReportArtifacts`)
Output i `output/<release-label>/`:
1. `table_a_arenden_per_myndighet.csv`
2. `table_b_kravfrekvens_per_kategori.csv`
3. `table_c_kommunskillnader_yt_lakvatten.csv`
4. `table_d_krav_per_avfall_ewc.csv`
5. `evidensindex.csv`
6. `report_summary.json`
7. `examensrapport_utkast.md`
8. `report_artifacts_manifest.json`
