# ADR-24-00 Appendix A — Informative Architecture View (Revised)

**Paket-24 Metaarchitecture — Definitions, Executions, Governance, Promotion, Repository, Registry**

```text
                         ┌───────────────────────────────┐
                         │         POLICY ARTIFACT       │
                         └───────────────┬───────────────┘
                                         │ governs
                                         ▼
                         ┌───────────────────────────────┐
                         │   GOVERNANCE APPROVAL ARTIFACT│
                         └───────────────┬───────────────┘
                                         │
                                         ▼
                         ┌───────────────────────────────┐
                         │  GOVERNANCE DECISION ARTIFACT │
                         └───────────────┬───────────────┘
                                         │
                                         ├──────────────► Application Definition
                                         │
                                         ├──────────────► Workflow Definition
                                         │
                                         ├──────────────► Capability Definition
                                         │
                                         └──────────────► Promotion Layer
                                         
                                         
                 ┌──────────────────────────────────────────────────────────┐
                 │                    ARTIFACT REPOSITORY                   │
                 │                 (Canonical Truth, Resolution)            │
                 └───────────────┬──────────────────────────────────────────┘
                                 │ resolves
                                 │
                                 ▼
        ┌───────────────────────────────┐
        │     APPLICATION DEFINITION    │
        └───────────────┬──────────────┘
                        │ contains
                        ▼
        ┌───────────────────────────────┐
        │      WORKFLOW DEFINITION      │
        └───────────────┬──────────────┘
                        │ contains
                        ▼
        ┌───────────────────────────────┐
        │     CAPABILITY DEFINITION     │
        └───────────────┬──────────────┘
                        │
                        │ instantiates (deterministic)
                        ▼
        ┌───────────────────────────────┐
        │    CAPABILITY EXECUTION       │
        └───────────────┬──────────────┘
                        ▼
        ┌───────────────────────────────┐
        │     WORKFLOW EXECUTION        │
        └───────────────┬──────────────┘
                        ▼
        ┌───────────────────────────────┐
        │    APPLICATION EXECUTION      │
        └───────────────┬──────────────┘
                        ▼ produces candidate
        ┌───────────────────────────────┐
        │    PROMOTION CANDIDATE        │
        └───────────────┬──────────────┘
                        ▼ evaluated
        ┌───────────────────────────────┐
        │    PROMOTION EVALUATION       │
        └───────────────┬──────────────┘
                        ▼ decides
        ┌───────────────────────────────┐
        │    PROMOTION DECISION         │
        └───────────────┬──────────────┘
                        │ persists canonical promotion artifacts
                        ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │                    ARTIFACT REPOSITORY                   │
                 │                 (Canonical Truth, Resolution)            │
                 └───────────────┬──────────────────────────────────────────┘
                                 │
                                 ├──────────────► Registry (Discovery Projection)
                                 │                   (Index, not Truth)
                                 │
                                 └──────────────► Runtime Resolution
```

## Relationstyper (Appendix A.1)

| Relation | Semantik |
| :--- | :--- |
| **contains** | Definition-hierarki (APL → WF → CAP) |
| **governs** | Governance styr artefakter och promotion |
| **resolves** | ArtifactRepository är enda resolution-punkten |
| **instantiates** | Deterministisk execution från definition |
| **produces** | Execution producerar PromotionCandidate |
| **evaluated** | PromotionEvaluation analyserar kandidat |
| **decides** | PromotionDecision fattas deterministiskt |
| **persists** | PromotionDecision persistas i Repository |
| **discovers** | Registry är projektion av Repository |

## Compliance-taxonomin (Appendix A.2)

### Compliance Classes (ADR-24-00)

| Klass | Beskrivning |
| :--- | :--- |
| **001** | Identity / Ownership |
| **002** | Repository Resolution |
| **003** | Boundary / Isolation |
| **004** | Determinism / Replay |
| **005** | Provenance / Integrity |
| **006+** | Domain-specific invariants |

Diagrammet följer dessa implicit:
- Definitions → 001
- Repository → 002
- Governance/Promotion boundaries → 003
- Execution/Replay → 004
- Provenance chains → 005
- Registry projection → 006+

## Varför detta nu är korrekt enligt Paket-24

✔ Registry är en projektion, inte en slutpunkt
✔ Promotion persistar i Repository, inte "skriver sanningen"
✔ Governance är styrande, inte sekventiell
✔ Definitioner är en hierarki, inte en pipeline
✔ Execution är en separat axel
✔ ArtifactRepository är navet för all resolution
✔ Relationstyper är semantiskt definierade
✔ Diagrammet är informativt, inte normativt
✔ ADR-24-00 är nu helt konsekvent med bilden
