# ADR: Materialization Contract Reconciliation (Commit H.3)

**Status:** ACTIVE / FROZEN
**Beroende av:** `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`, `ADR-MPS-CAS-STORAGE-BOUNDARY.md`
**Blockerar:** TV-3 (PostgreSQL Partition Strategy)

## Bakgrund

CAS-frysningen (H.1/H.2) gjorde en djupare fråga synlig. TV-3 handlar om vilka tabeller
som är index och projektioner, men det förutsätter att man vet vilken kodväg som skapar
Decision Authority. Vid H.2 fanns två konkurrerande Materialization-kontrakt committade
samtidigt, plus en tredje materialiserare i `alpha-runtime`.

Split brain, som det såg ut:

```
Kontrakt A (index.ts + gate-tester)     Kontrakt B (src/MaterializationPipeline.ts)
new MaterializationPipeline({           new MaterializationPipeline(
  repository, lineage                     canonicalizer_id, materialization_version,
})                                        rule_version, evidenceResolver,
materialize(evidence)                     decisionRepository, lineageResolver
                                        )
                                        materialize(evidenceSet, context)
```

Samtidigt hade `mps-decision-governance` tappat sin frysta C-02-implementation:
`hashVersionedCanonicalPayload`, payload-byggarna och `lineage_scope` fanns kvar i
`index.ts` men inte i källfilerna. Effekten var 29 röda tester och två olika svar på
frågan "vad är ett artefakts identitet".

## Beslut

Det finns exakt **en** kanonisk Materialization Boundary:

```
new MaterializationPipeline({
    evidenceResolver,
    lineageValidator,
    identityProvider,
    repository
})

materialize(evidenceSet)
```

Alla fyra beroenden injiceras. Motiveringen är MAT-I02: materialisering får inte beräkna
identitet själv. Pipelinen ska därför inte känna till hashning, CAS-layout, runtime eller
databas — den känner bara till ordningen.

Kontrakt B avvecklas. `DecisionImpactFactory` och `ports/DecisionRepository` tas bort.
Ingen adapter införs mellan kontrakten: en permanent adapter hade bevarat två sanningar
bakom ett gemensamt namn.

## Konstitutionell ordning

```
resolve evidence
      |
      v
build DecisionFacts
      |
      v
build EvidenceSet
      |
      v
lineage closure        <-- inget blir auktoritativt före denna punkt (C-03)
      |
      v
build DecisionImpact
      |
      v
commit to CAS          <-- gated av MIMER-MAT-I01
```

## Identitetsauktoritet

`MaterializationIdentityProvider` är porten mot `mps-decision-governance`.
Identitet ägs av governance-lagret och lånas ut till materialiseringen:

| Ansvar | Ägare |
| :-- | :-- |
| Kanonisk form och hash | `mps-decision-governance` |
| Deterministisk projektion av fakta | `mps-materialization` |
| Fysisk lagring och sökväg | `mps-cas-boundary` |

## Definition of Done (uppfylld)

| Område | Krav | Status |
| :-- | :-- | :-- |
| Materialization | MAT-I01 lineage closure | grön |
| Materialization | MAT-I02 identity authority | grön |
| Materialization | MAT-I03 canonicalizer binding | grön |
| Materialization | MAT-I04 provenance isolation | grön |
| Governance | C-02 canonical domain separation | grön |
| Governance | C-03 lineage closure | grön |
| Governance | C-05 materialization replay | grön |
| Identity | EvidenceSetIdentitySnapshot | grön |
| Identity | CanonicalIdentity | grön |

## Uppföljning (avslutad i H.4)

Denna ADR lämnade en öppen observation: en tredje kodväg i `alpha-runtime` såg ut att
producera beslutsidentitet. Utredningen i H.4 visade att den vägen byggde
runtime-projektioner, medan den verkliga andra sanningsskaparen var `MaterializerJob`.

Frågan är avgjord av `ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY.md` (MAT-I05).
`ArtifactMaterializer` heter numera `ArtifactProjectionBuilder`, och alla skrivvägar mot
Decision Authority går genom det registrerade materialiseringskontraktet.
