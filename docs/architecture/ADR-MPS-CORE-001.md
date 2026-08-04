# ADR-MPS-CORE-001: MPS-CORE Review Constitution

**Status:** Freeze Candidate  
**Scope:** Package 20+ Runtime, Package 21 Control Plane, Package 22 Governance/Evolution, framtida Package 23+  
**Owner:** MPS Architecture Governance  

## 1. Purpose

MPS-CORE etablerar gemensamma invariants för alla systemkomponenter som producerar, konsumerar eller beslutar baserat på immutabla artefakter.

Alla framtida paket SHALL granskas mot denna konstitution.

Målet är att förhindra:
- identitetsdrift
- implicit tillit
- referensförfalskning
- runtime-läckage
- återanvändning av gamla beslut
- icke-reproducerbara governance-beslut

## 2. Core Principle

MPS-CORE bygger på fyra fundament:

```text
Immutable Artifact Identity
            |
            v
Explicit Verified References
            |
            v
Deterministic Evidence Computation
            |
            v
Governance From Verified State
```

Alla beslutskritiska flöden SHALL följa denna riktning.

## 3. Artifact Identity Constitution

### 3.1 CanonicalArtifact

Alla persistenta domänobjekt SHALL vara `CanonicalArtifacts`.

Minimum:
```typescript
interface CanonicalArtifact {
    artifact_id: string;
    artifact_type: ArtifactType;
    content_hash: string;
    schema_version: string;
    signature: ArtifactSignature;
}
```

### 3.2 Identity Rule

`artifact_id` SHALL vara deterministiskt härlett från `content_hash`.

Exempel:
```text
content bytes
      |
      v
canonical serialization
      |
      v
SHA-256
      |
      v
content_hash
      |
      v
artifact_id
```

Ingen komponent får:
- generera nytt `artifact_id`
- ändra `content_hash`
- regenerera identitet efter skapande

### 3.3 WORM Rule

Canonical artifacts SHALL vara Write Once, Read Many.

**Tillåtet:**
```text
PUT identical content_hash
        |
        v
idempotent success
```

**Förbjudet:**
```text
existing hash
        |
        v
different bytes
        |
        v
IMMUTABILITY_VIOLATION
```

## 4. Reference Constitution

### 4.1 Explicit Reference Rule

Alla relationer mellan artifacts SHALL använda:
```typescript
interface ContentReference {
    hash: string;
    artifact_type: ArtifactType;
}
```

Förbjudet:
- `candidateId:string`
- `planName:string`
- `runtimePointer:string`

### 4.2 Reference Verification Rule

En `ContentReference` är inte giltig bara för att den existerar. Varje resolution SHALL verifiera:

```text
Requested Reference
        |
        v
ArtifactRepository.get()
        |
        v
Loaded Artifact Identity
        |
        v
assertContentReferenceMatches()
```

Invariant: `reference.hash === artifact.content_hash`
Annars: `REFERENCE_MISMATCH`

## 5. Derived Computation Constitution

### 5.1 Categories

Alla värden klassificeras:

**Category A — Identity**
Exempel: `artifact_id`, `content_hash`, `signature`
Regel: immutable, signed, persistent

**Category B — Evidence**
Exempel: `RuntimeResult.artifact`, `ShadowEvaluationArtifact`, `PromotionDecisionArtifact`
Regel: verified input, canonical artifact, replayable

**Category C — Derived Computation**
Exempel: `FitnessScore`, ranking, latency score, cost score
Regel: computed from verified evidence
MEN: En Category C value SHALL inte betraktas som evidence.

### 5.2 Trust Boundary Recalculation Rule

Vid varje governance trust boundary:
```text
Verified Evidence
        |
        v
Recompute Derived Value
        |
        v
Decision
```

**Förbjudet:**
```text
Old FitnessScore
        |
        v
New PromotionDecision
```

En beräknad Category C value:
- får lagras för audit
- får visas historiskt
- får inte återanvändas som auktorisation

## 6. Runtime Separation Constitution

### 6.1 Canonical Artifact

**Tillåtet:** identity, semantic metadata, domain content
**Förbjudet:** timestamps, durations, traces, worker ids, execution metrics

### 6.2 RuntimeResult

```typescript
interface RuntimeResult {
    artifact: CanonicalArtifact;
    telemetry: RuntimeTelemetry;
}
```

### 6.3 Runtime Boundary

`RuntimeResult` SHALL:
- aldrig bli `CanonicalArtifact`
- aldrig signeras som artifact
- aldrig lagras i ArtifactRepository
- aldrig användas direkt av PromotionPolicy

### 6.4 Runtime Unwrapping Rule

Alla governance-, promotion- och archive-flöden SHALL konsumera `runtimeResult.artifact`.

**Förbjudet:** `PromotionPolicy.evaluate(runtimeResult)`
**Tillåtet:** `PromotionPolicy.evaluate(runtimeResult.artifact)`

## 7. Actor Identity Constitution

### 7.1 ActorReference

Alla aktörer:
```typescript
interface ActorReference {
    identity_ref: ContentReference;
    role: ActorRole;
}
```

### 7.2 Closed Role Union

**Förbjudet:** `role:string`
**Tillåtet:**
```typescript
type ActorRole =
 | "EVOLUTION_AGENT"
 | "HUMAN_OPERATOR"
 | "SYSTEM_PROCESS"
 | "GOVERNANCE_REVIEWER";
```

## 8. Governance Constitution

Governance får endast fatta beslut baserat på:
```text
CanonicalArtifact
        |
        v
Verified Reference
        |
        v
Verified Evidence
        |
        v
Recomputed Metrics
        |
        v
Decision Artifact
```

**Förbjudet:** `RuntimeResult`, Caller supplied score, Unverified reference, Cached fitness.

## 9. Replay Constitution

### 9.1 Replay Rule

Replay SHALL återanvända:
- existerande artifact identities
- existerande candidate artifacts
- existerande plans

Replay SHALL NOT:
- regenerera mutations
- skapa nya canonical artifacts
- skapa nya plan identities

### 9.2 Retry Clarification

Replay-förbudet gäller canonical identity.
Det förbjuder INTE:
```text
PlanArtifact
      |
      +--> ExecutionAttempt A
      |
      +--> ExecutionAttempt B
```

Retry SHALL:
- skapa ny ExecutionAttempt identity
- behålla samma PlanArtifact
- länka ancestry

## 10. Migration Constitution

Schemaändring:
```text
Artifact v1
      |
      v
Migration
      |
      v
Artifact v2
```

Kräver:
- ny canonical serialization
- ny content_hash
- ny signature

Gamla signatures får inte återanvändas.

## 11. Mandatory Review Checklist

Alla nya artifacts SHALL svara JA på:

1. **Identity**
Är identiteten: hashbaserad? signerad? immutable?

2. **References**
Är alla relationer: explicit ContentReference? verifierade vid resolution?

3. **Runtime Separation**
Är: telemetry utanför artifact? runtime state isolerat?

4. **Schema Evolution**
Introduceras ny schema-version?
Om ja: finns migration? invalidieras gamla signatures? definieras compatibility policy?

## 12. Mandatory Test Requirements

Varje paket som implementerar denna ADR SHALL innehålla attackerande tester.

Minimikrav:

- **Identity Attack**: valid artifact + missing signature = `SIGNATURE_REQUIRED`
- **Reference Attack**: valid artifact A + valid reference B = `REFERENCE_MISMATCH`
- **Asymmetric Reference Attack**: `expected.schema_ref=A` + `actual.schema_ref=undefined` = `SCHEMA_REFERENCE_MISMATCH`
- **Runtime Poisoning Attack**: Execution 1 telemetry X vs Execution 2 telemetry Y = telemetry differs, artifact hash identical
- **Governance Lineage Attack**: Candidate A + Evaluation B but `B.candidate_ref != A.hash` = reject
- **Derived Value Attack**: Evaluation A (quality=0.9) vs Evaluation B (quality=0.1) = `Fitness(A) != Fitness(B)`

## 13. Final Principle

MPS-CORE invariant:
- Evolution produces artifacts.
- Runtime produces evidence.
- Computation derives measurements.
- Governance approves only verified relationships.
