# ADR: Single Materialization Authority (Commit H.4)

**Status:** ACTIVE / FROZEN
**Beroende av:** `ADR-MPS-MATERIALIZATION-BOUNDARY.md`, `ADR-MPS-CAS-STORAGE-BOUNDARY.md`
**Blockerar:** TV-3 (PostgreSQL Partition Strategy)

## Bakgrund

Efter H.3 hade Frozen Core inget tekniskt problem kvar, men ett auktoritetsproblem på
plattformsnivå: frågan "vem har rätt att skapa Decision Authority?" hade mer än ett svar.

Inventeringen visade tre kandidater, inte två, och den farligaste var inte den mest
uppenbara.

| Kodväg | Producerar | Bedömning |
| :-- | :-- | :-- |
| `mps-materialization/MaterializationPipeline` | `DecisionImpactArtifact` | Kanonisk auktoritet |
| `alpha-runtime/runtime/ArtifactMaterializer` | `RegistryReference` (exekveringsutdata) | Felnamngiven projektion |
| `alpha-runtime/execution/MaterializerJob` | `DecisionImpactArtifact` i Postgres | Oreglerad andra auktoritet |

`ArtifactMaterializer` skapade aldrig beslutsartefakter. Den byggde exekveringsreferenser
men bar auktoritetens språk och använde en egen canonicalizer.

`MaterializerJob` var den verkliga andra sanningsskaparen. Den skrev
`DecisionImpactArtifact` direkt till Postgres med en egen `JSON.stringify`-hash, förbi
lineage closure, med hårdkodad `lineage_sequence`, och med `extraction_model` inbakat i
hashdomänen — en direkt MAT-I04-överträdelse där en LLM-modellsträng blev en del av
artefaktens identitet.

### Namnrymdskollisionen

Allvarligast: `alpha-runtime/recovery/CanonicalizerRegistry` registrerade
`dg-canonical-1` — samma canonical version-id som `mps-decision-governance` — men med en
**annan algoritm**:

```
governance:  SHA256( "dg-canonical-1" + "\n" + canonicalizeStrict(payload) )
runtime:     SHA256( "dg-canonical-1" + "||" + JSON.stringify(deepSort(payload)) )
```

Hela poängen med C-02 är att versionen identifierar algoritmen. Två algoritmer under
samma id upphäver den garantin.

## Beslut

### MAT-I05 — Single Materialization Authority

*Normativ formulering:*
Only registered MaterializationPipeline implementations SHALL create DecisionImpactArtifact authority.

Tillåtet:

```
Evidence
   |
   v
MaterializationPipeline
   |
   v
DecisionImpactArtifact
```

Förbjudet:

```
Runtime
   |
   v
(any other materializer)
   |
   v
DecisionImpactArtifact
```

### Authority registry

`mps-materialization/MaterializationAuthority` bär en whitelist. Registrerad från start:
`MaterializationPipeline` i `mps-materialization`. Att registrera ytterligare en
sanningsproducent kräver en ADR-referens och kan inte tyst överta ett befintligt id.

`assertSingleMaterializationAuthority(id)` avvisar allt annat med
`MAT_I05_UNREGISTERED_AUTHORITY`. Grinden sitter vid varje skrivväg, även de som ligger
utanför `mps-materialization`.

### Runtime: Alternativ B för projektion, Alternativ A för auktoritet

Båda alternativen tillämpades, på rätt kodväg:

- `ArtifactMaterializer` → **`ArtifactProjectionBuilder`** (Alternativ B). Metoden
  `materialize()` heter nu `project()`. Den bygger runtime-projektioner: exekveringsutdata,
  replay-referenser och UI-representation. Aldrig beslutsidentitet.
- `CanonicalIdentityProvider.generateDecisionIdentity` → `generateProjectionIdentity`.
- `MaterializerJob` → **Alternativ A**, men ännu inte migrerad. Dess skrivväg går genom
  `DecisionArtifactRepository`, som nu kräver registrerad auktoritet. Jobbet är därmed
  satt i karantän: det misslyckas i stället för att prägla oauktoriserad sanning.
  Migrationen är att bygga en `VerifiedEvidenceSet` från ärendet och delegera till
  `MaterializationPipeline` — runtime orkestrerar, materialisering äger auktoritet.

### Canonical version-namnrymden

`dg-` är reserverat för decision-governance. Runtime-registret avvisar sådana id med
`CANONICALIZER_NAMESPACE_VIOLATION` och äger i stället `runtime-projection-1`.

## Verkställande tester

`packages/mps-materialization/tests/MaterializationAuthorityBoundary.test.ts`

| Kontroll | Innebörd |
| :-- | :-- |
| Registret innehåller exakt en auktoritet | En sanningsproducent |
| Oregistrerade producenter avvisas | `MAT_I05_UNREGISTERED_AUTHORITY` |
| Registrering utan ADR avvisas | Att lägga till auktoritet är ett medvetet beslut |
| `DecisionArtifactRepository` grindar båda skrivvägarna | Ingen väg förbi grinden |
| `ArtifactProjectionBuilder` saknar `createDecisionImpactArtifact` och `materialize` | Projektion, inte auktoritet |
| Runtime-källor nämner inte `DecisionImpactArtifact` i kod | Statisk gräns |
| Runtime kan inte lösa upp `dg-`-id | En algoritm per canonical version |

## Konsekvens för TV-3

Grunden är nu entydig inför fysisk skalning:

```
Authority (en väg)
    |
    v
CAS
    |
    v
Materialization
    |
    v
Retrieval
    |
    v
Runtime (projektion)
    |
    v
Database indexes
```

Frågorna "vilken artifact hash gäller, vilken lineage gäller, vilken replay är korrekt"
har ett svar. TV-3 kan börja.

## Kvarstående

`MaterializerJob` är i karantän, inte migrerad. Så länge den ligger kvar är den död kod
som kastar vid skrivning. Den bör antingen migreras enligt Alternativ A eller tas bort.
