# ADR: CAS Storage Boundary (Commit H.1 — TV-2.1)

**Status:** ACTIVE / FROZEN
**Beroende av:** `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`, `ADR-RUNTIME-SNAPSHOT-BOUNDARY.md`
**Blockerar:** TV-3 (PostgreSQL Partition Strategy), TV-4 (PostGIS), TV-5 (Ingest Throughput)

## Syfte

CAS är inte lagring. CAS är **identitets- och auktoritetsgränsen** i plattformen.
Därför får CAS aldrig behandlas som en implementationsdetalj under en databas- eller
prestandaoptimeringsfas.

```
Canonical Truth
      |
      v
     CAS
      |
      +---- Database indexes
      |
      +---- Retrieval projections
      |
      +---- Runtime acceleration
```

Allt under CAS i diagrammet är härledbart och får kastas bort och byggas om.
CAS får det inte.

## Frysta definitioner

CAS **är**:

- immutable
- content addressed
- storage independent
- utan runtime state

CAS **är inte**:

- databas
- cache
- sökindex
- AI-minne

## Frysta invariants

### CAS-I02 — Immutable Object

*Normativ formulering:*
An object stored in CAS SHALL be identified solely by the cryptographic digest of its bytes.
CAS SHALL NOT expose any operation that changes the bytes bound to an existing digest.

```
same hash
+
different bytes
=
impossible
```

Konsekvens: skrivoperationen är `put(bytes) -> hash`, aldrig `put(hash, bytes)` som
auktoritativ väg. Repliker som måste skriva vid en känd digest verifierar digest mot
omräknat innehåll och avvisar avvikelse med `CAS_IMMUTABILITY_VIOLATION`.

### CAS-I03 — Storage Independence

*Normativ formulering:*
Artifact identity, artifact hash and replay capability SHALL be invariant under physical relocation.

```
disk A
  |
  v
disk B
```

ska inte ändra:

- hash
- artifact identity
- replay capability

Konsekvens: mount root får aldrig ingå i identitet eller i den kanoniska objektsökvägen.
Roten appliceras först i det fysiska lagret, som en ren sammanfogning.

### CAS-I04 — Runtime Non Authority

*Normativ formulering:*
Runtime storage SHALL hold only derived, discardable state.
Runtime storage SHALL NOT hold, represent or reconstruct Decision Authority.

Tillåtet i runtime:

```
runtime/
snapshots/
cache/
temporary/
```

Förbjudet i runtime:

```
DecisionFacts
EvidenceAuthority
MaterializedTruth
```

Överträdelse avvisas med `CAS_RUNTIME_AUTHORITY_VIOLATION`.

## Fysisk gräns (verkställs i Commit H.2)

### CASPathResolver

Enda ansvar:

```
hash
 |
 v
path
```

Aldrig:

```
path
 |
 v
identity
```

### CASRepository

Tillåtna operationer: `put(bytes)`, `get(hash)`, `exists(hash)`.
Förbjudna operationer: `update(hash)`, `replace(hash)`, `mutate(hash)`.

### CASRuntimeBoundary

Separat guard, inte en repository-flagga. Stoppar `runtime.save(DecisionImpactArtifact)`
med `CAS_RUNTIME_AUTHORITY_VIOLATION`.

## Verkställande tester (krav innan TV-3)

| Invariant | Test | Innebörd |
| :-- | :-- | :-- |
| CAS-I05 | Path Determinism | `hash X` ger samma path i miljö A och miljö B |
| CAS-I06 | No Reverse Identity | CAS-path kan lokalisera objekt; godtycklig filsökväg kan aldrig skapa identitet |
| CAS-I07 | Runtime Isolation | `runtime.store(decisionArtifact)` kastar `CAS_RUNTIME_AUTHORITY_VIOLATION` |

## Konsekvens för PostgreSQL

Före CAS-frysning:

```
Postgres
 |
 +-- data
 +-- truth
 +-- indexes
 +-- search
```

Efter CAS-frysning:

```
CAS                Postgres
 |                  |
 +-- truth          +-- lookup
                    +-- projection
                    +-- acceleration
                    +-- analytics
```

Först när CAS-I02–CAS-I07 är gröna får TV-3 påbörjas. Då optimeras en databas som redan
vet exakt vad den är till för.

**Uppföljning:** [TV-3.0 — PostgreSQL Physical Data Strategy Freeze](./TV-3.0-PostgreSQL-Physical-Data-Strategy-Freeze.md) (**FRYST**).
