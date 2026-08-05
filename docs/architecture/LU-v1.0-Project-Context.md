# LU Project Context v1.0 (Frozen)

Detta dokument kompletterar LU Architecture Charter v1.0 genom att definiera `LUProjectContextArtifact` som en förstaklassig kontext i domänen.

## ⭐ LU-ProjectContextArtifact
Detta är den fjärde artefakten i LU-domänen.
Den är inte en sanningskälla.
Den är kontext för analysen.

Den är inte en del av governance.
Den är inte en del av Frozen Core.
Den är payload ovanpå ArtifactContract, precis som övriga LU-artifacts.

**ArtifactContract + payload**
```ts
artifact_type: "lu_project_context"

payload: {
  project_description: string
  activity_description: string
  planned_activity: string

  property_ref: ArtifactReference

  release_hash: ReleaseHash
}
```

### Varför behövs den?
För att LU ska svara på konsultens verkliga fråga:
“Är den här planerade verksamheten lämplig på den här platsen?”

Inte:
“Vilka risker finns på fastigheten?”

### Viktigt:
- Projektkontexten är immutable.
- Den är inte UI-state.
- Den är inte en del av assessment.
- Den är refererad av assessment.

---

## ⭐ Uppdatering av LocalizationAssessmentArtifact
Assessment ska nu referera projektkontexten:

```ts
payload: {
  project_context_ref: ArtifactReference

  property_ref: ArtifactReference

  findings: readonly AssessmentFinding[]

  evidence_refs: readonly ArtifactReference[]

  rule_refs: readonly {
    rule_id: RuleId
    rule_version: RuleVersion
  }[]

  system_summary: string
  consultant_commentary_ref?: ArtifactReference
}
```

Detta gör audit-grafen komplett:
```
LocalizationAssessment
     |
     +-- ProjectContext
     |
     +-- Property
     |
     +-- SpatialEvidence
     |
     +-- DocumentEvidence
     |
     +-- Rules
     |
     +-- Findings
```

---

## ⭐ UX-flöde

**Startvy: LU Workspace**
```
Nytt LU-uppdrag
```

**Steg 1 — Projektbeskrivning**
Formulär:
- Projekt: “Ny industrietablering”
- Verksamhet: “Tillverkning av komponenter”
- Planerad omfattning: “5 000 m² byggnad, 50 anställda”
- Övrigt: “Kemikalier kan förekomma”

`UI → LUProjectContextCreateRequest → LU Application → LUProjectContextArtifact`

**Steg 2 — Fastighet**
```
Sök fastighet: [__________]
[Visa på karta]

Vald fastighet:
ABC 1:123
Geometri verifierad (SWEREF99 TM)
```
`UI → PropertyReference → LU Application → property_ref artifact`

**Steg 3 — Starta LU**
`UI → LUCreateRequest → LU Application`
LU Application:
- binder projektkontext + property_ref
- kör SpatialQueryContract
- skapar SpatialEvidenceArtifact[]
- hämtar dokument → DocumentEvidenceArtifact[]
- kör LU Assessment Engine
- skapar LocalizationAssessmentArtifact (immutable)

**Steg 4 — GIS-granskning**
Klick → evidence + regel + finding.

**Steg 5 — Consultant Commentary**
Separat artifact:
```
ConsultantNoteArtifact
```
Assessment refererar den via `consultant_commentary_ref`.

**Steg 6 — Rapport**
`Artifacts → ReportProjection → HTML → PDF`

---

## ⭐ Arkitekturkonstitution – tillägg

**Ny regel: Project Context Boundary**
`LUProjectContextArtifact` är en domänartefakt som beskriver analysens kontext.
- Den får aldrig ersätta evidens.
- Den får aldrig påverka governance.
- Den får aldrig ligga i UI-state.
- Den får endast skapas av LU-services.

**Ny regel: Assessment must reference project_context_ref**
Varje `LocalizationAssessmentArtifact` måste referera exakt en `LUProjectContextArtifact`.

**Ny regel: Project Context is not truth**
Projektkontexten är inte en sanningskälla.
Den är en analyskontext.
All sanning kommer från evidens.

---

## ⭐ Repo-struktur (Referens)

```
packages/
  mps-compliance/          ← Frozen Core
  mps-artifact-store/
  mps-governance/

  mps-lu/                  ← LU Application
    artifacts/
      LocalizationAssessmentArtifact
      SpatialEvidenceArtifact
      DocumentEvidenceArtifact
      LUProjectContextArtifact

    domain/
      AssessmentFinding
      CanonicalGeometry
      RelevantDocument

    rules/
      LU-WATER-001
      LU-PROTECTED-001
      LU-EBH-001

    services/
      LUAssessmentService
      LUProjectContextService
      EvidenceClosureValidator

    projections/
      LUReportProjection

    tests/
      ArchitectureBoundary.test.ts

  spatial-provider-postgis/ ← Adapter
  document-provider/
  report-renderer/
  ui-lu-workspace/
  ui-gis-viewer/
```
