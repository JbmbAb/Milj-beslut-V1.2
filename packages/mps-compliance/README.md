# mps-compliance
**Status: Bootstrap Foundation**
**Package: Package‑24**
**Authority: MIMER‑20 Constitution**
**Validated by: MCS‑001**

## Purpose
`mps-compliance` provides the canonical contract, serialization, and conformance foundation for Mimer Package‑24.

Detta paket existerar för att säkerställa:
- artifact identity integrity
- canonical byte determinism
- immutable validation
- governance‑controlled conformance
- replay‑compatible verification

`mps-compliance` definierar inte domänsemantik.
Domänsemantik definieras av ADR‑24‑20 → ADR‑24‑26.

Detta paket definierar *hur* implementationen får bete sig.

## Core Principles

### Identity is carried, never created
Artifacts får inte generera identitet.

**Förbjudet:**
```ts
createArtifactId()
generateIdentity()
recalculateArtifactIdentity()
```

ArtifactContract får endast bära:
- `artifact_id`
- `artifact_type`
- `content_hash`
- `references`

Identitet kommer alltid från identity authority, aldrig från implementationen.

### CanonicalBytes precede hashing
Enda giltiga sekvensen:
```
Semantic State
 ↓
Artifact Contract
 ↓
CanonicalSerializer
 ↓
CanonicalBytes
 ↓
ContentHash
```

**Förbjudet:**
```
Object
 ↓
JSON.stringify()
 ↓
Hash
```
Runtime‑representationer får aldrig hashas.

### CanonicalSerializer is the only serialization authority
Artifacts får inte implementera:
```ts
artifact.serialize()
artifact.toJSON()
artifact.canonicalize()
```

Canonical bytes får endast komma från:
```
CanonicalSerializer
```
Detta förhindrar canonical drift och alternativa representationer.

### Validators are pure
Validatorer:

**MAY:**
- läsa artifacts
- resolve:a referenser
- evaluera invariants
- producera ValidationResult

**MUST NOT:**
- mutera artifacts
- skapa identitet
- skriva canonical bytes
- ändra registry state

Validatorer är rena funktioner.

### RuleRegistry is immutable
Runtime använder:
```
RuleRegistrySnapshot
```

Aldrig:
```
RuleRegistry
```

Regler byggs genom:
```
RuleRegistryBuilder
        ↓ freeze()
RuleRegistrySnapshot
```
Snapshots är immutabla, hashbara och versionerade.

## Canonical Artifact Lifecycle
Enda giltiga livscykeln:
```
Semantic State
        ↓
Artifact Contract
        ↓
Canonical Serialization
        ↓
CanonicalBytes
        ↓
ContentHash
        ↓
Artifact Publication
        ↓
MCS Validation
```

### Invalid transitions
```
Artifact Contract
        ↓
Hash
        ↓
Canonicalization  (FÖRBJUDET)
```
```
Published Artifact
        ↓
Mutation
        ↓
Re-publication    (FÖRBJUDET)
```
```
Published Artifact
        ↓
Identity Regeneration (FÖRBJUDET)
```
Canonical identity representerar exakt ett immutabelt semantiskt tillstånd.

## Package Boundaries

### `artifacts/`
Definierar representationens gränser.

Innehåller:
- `ArtifactContract`
- `ArtifactId`
- `ArtifactReference`
- `ArtifactType`
- `ContentHash`

Artifacts får inte:
- validera sig själva
- serialisera sig själva
- beräkna hash

### `canonical/`
Äger canonical representation.

Innehåller:
- `CanonicalBytes`
- `CanonicalSerializer`
- `CanonicalRules`
- `CanonicalValidator`

`CanonicalSerializer` är enda auktoriteten för canonical bytes.

### `conformance/`
Äger MCS‑exekveringen.

Innehåller:
- `RuleRegistryBuilder`
- `RuleRegistrySnapshot`
- `ConformanceEngine`
- `ValidationContext`
- `ValidationResult`
- `ComplianceReport`

### `validators/`
Innehåller ADR‑specifika invariantkontroller.

Exempel:
```
ActorValidator        → ADR‑24‑21
SignatureValidator    → ADR‑24‑22
ExecutionValidator    → ADR‑24‑25
CapabilityValidator   → ADR‑24‑26
RetentionValidator    → ADR‑24‑24
ReplayValidator       → ADR‑24‑23
```

## Dependency Order
Implementation följer:
```
Canonical Foundation
        ↓
MCS Kernel
        ↓
Actor Trust
        ↓
Signature
        ↓
Execution
        ↓
Capability
        ↓
Retention
        ↓
Replay
        ↓
MCS Matrix
```
Detta är den konstitutionella kausaliteten.

## Forbidden Implementation Patterns
Följande är arkitekturella brott:

❌ Runtime identity generation
```ts
const id = generateId()
```

❌ Direct JSON hashing
```ts
hash(JSON.stringify(value))
```

❌ Artifact self‑serialization
```ts
artifact.toJSON()
```

❌ Mutable validation
```ts
validator.fixArtifact()
```

❌ Dynamic rule discovery
```ts
loadRulesDuringValidation()
```

## First Commit
Första implementationen:
```
feat(mps-compliance): introduce canonical artifact foundation
```

Skapar:
- `artifacts/`
- `canonical/`
- `errors/`

Etablerar:
- `ArtifactContract`
- `CanonicalBytes`
- `CanonicalSerializer`
- `ContentHash` boundary

## Definition of Done
Canonical foundation är komplett när:
- CanonicalBytes är ett förstaklassobjekt
- ContentHash beror endast på CanonicalBytes
- ArtifactContract skapar ingen identitet
- Serializer authority är absolut
- Canonical rules är testbara
- Validatorer har ingen mutationsväg

## Final Principle
`mps-compliance` är inte:
- ett storage‑lager
- ett runtime‑lager
- ett governance‑lager

Det är den exekverbara gränsen som säkerställer:
```
ADR Semantics
      ↓
Canonical Artifacts
      ↓
Deterministic Verification
```
Detta är fundamentet för Mimer Frozen Core.
