# LU v1.0 – Konsultflöde (Frozen)

## 1. Skapa uppdrag
Konsulten initierar ett nytt LU-projekt.

## 2. Välj fastighet
Systemet hämtar geometri och metadata. property_ref skapas.

## 3. Spatial Evidence Collection
```
UI → SpatialQueryRequest → Spatial Engine → Provider → SpatialEvidenceArtifact[]
```

## 4. Document Evidence Collection
```
Document Provider → DocumentEvidenceArtifact[]
```

## 5. LU Assessment Engine

### Legacy (default)
```
Evidence → LURuleEngine → Findings → LocalizationAssessmentArtifact
```

### ExecutionKernel strangler (`LU_MPS_MOTOR=1`)
```
Evidence → build Manifest → ExecutionKernel.admit
        → CapabilityExecutor (ImplementationResolver → invoke LURuleEngine)
        → Attempt/Outcome in ArtifactRepository
        → Findings projection for report UI
```

Se [ADR-29](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md) och [MPS-Execution-Motor-Implementation-Plan.md](./MPS-Execution-Motor-Implementation-Plan.md).

## 6. Findings-granskning
Konsulten ser exakt:
- vilket bevis
- vilken regel
- vilken motivering

## 7. GIS-granskning
Klick på polygon → evidence + regel + finding.

## 8. Consultant Commentary
Konsulten skriver egen kommentar (separerad från system_summary).

## 9. Audit-graf validering
Systemet verifierar:
- evidensclosure
- regelversioner
- release_hash
- invariants

## 10. Rapportgenerering
```
LocalizationAssessmentArtifact → ReportProjection → HTML → PDF
```
