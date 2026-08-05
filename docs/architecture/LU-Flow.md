# LU v1.0 – Konsultflöde (Frozen)

**Runtime freeze:** [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) — *Execution Kernel v1.0 – LU Cutover Complete* (`lu-runtime-v1`).  
Ändra inte den normativa exekveringsmodellen utan ny ADR.

## 0. UI entry (default)

Default produkt-UI är `MimerProductShell` (via `AppShell`) — inte `TechnicalDashboardHub`.

| Flagga | Effekt |
|--------|--------|
| *(ingen)* | MimerProductShell: Start / Lokalisering (`LuWorkspace`) / Admin-konsol |
| `VITE_ENABLE_LEGACY_UI=1` | Rollback till TechnicalDashboardHub + legacy mode-kort |

LU-produkt-UI är **`LuWorkspace`** — inte `LocalizationStudyUI` (legacy, ej produktväg).

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

## 5. LU Assessment Engine (enda väg — cutover klar)

```
Localization Report
        → Evidence
        → ExecutionKernel.admit
        → CapabilityExecutor → invoke LURuleEngine
        → Artifacts (Mimers CAS)
        → Findings + Attempt/Outcome (+ Prisma ExecutionTicket)
        → LuWorkspace
```

Ingen parallell RuleEngine-bypass. `LURuleEngine` körs **bara** som invoke-handler under Admission.  
CAS: `MIMERS_ROOT` (fallback `.data/mimers`); tickets: Prisma default, `LU_MPS_TICKETS=file` fallback.  
Evolution-produktloop: **av** tills det finns tillräckligt med verkliga produktionskörningar.

Se [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) (normativ runtime), [ADR-29](./ADR-29-Runtime-Contract-Freeze-ExecutionKernel.md) (identitetsfreeze) och [MPS-Execution-Motor-Implementation-Plan.md](./MPS-Execution-Motor-Implementation-Plan.md).

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
