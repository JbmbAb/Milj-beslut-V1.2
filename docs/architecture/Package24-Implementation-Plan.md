# Package24 Implementation Plan v1.0
**Status: Frozen**
**Version: 1.0**
**Authority: MIMER‑20 Constitution**
**Validated by: MCS‑001**

**Provenance note (2026-08-30):** `ADR-24-20-Constitution.md`, cited below as this
plan's semantic authority, is now **HISTORICAL / NORMATIVE_TODAY: false**,
superseded platform-wide by `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`. This plan's
Package-24-specific content (`ADR-24-20`→`ADR-24-26`, all of which exist on disk)
is left unrevalidated here — that is outside this documentation-normalization
unit's scope. Anyone relying on this plan's authority claim should first confirm
whether Package-24 has since been reconciled against the current constitution.

## Purpose
Package24 Implementation Plan v1.0 definierar de tillåtna implementationsegenskaperna för Mimer Package‑24.
Den fungerar som ett bootstrap‑kontrakt mellan:
- ADR‑24‑20 → ADR‑24‑26 (semantisk auktoritet)
- Package‑24 (implementationsgränser)
- mps‑compliance (kontrakts- och canonical‑lager)
- MCS‑001 (konformansverifiering)

Planen introducerar inga nya semantiska regler.
Den definierar hur ADR‑semantik får implementeras utan att bryta konstitutionen.

## Implementation Invariants
Dessa invariants gäller för alla Package‑24 implementationer.

**IMP‑24‑I1 — Identity Non‑Creation**
Implementationer får inte skapa artifact‑identiteter.
Identiteter bärs, de skapas inte.
ArtifactContract får endast bära identitet som tilldelats av identity authority.

**IMP‑24‑I2 — Canonical Byte Authority**
CanonicalBytes MÅSTE produceras innan:
- hashing
- signering
- lagring
- verifiering

Hashing får aldrig ske på icke‑canonical representationer.

**IMP‑24‑I3 — Artifact Contract Purity**
ArtifactContract definierar endast representationens form.
ArtifactContract får inte:
- skapa identitet
- beräkna hash
- mutera payload
- fatta governance‑beslut
- utföra validering

**IMP‑24‑I4 — Validation Purity**
MCS‑validatorer får endast:
- läsa canonical artifacts
- producera deterministiska resultat

Validatorer får inte:
- mutera artifacts
- skapa identitet
- ändra canonical bytes

**IMP‑24‑I5 — Registry Snapshot Determinism**
Validatorer får endast använda RuleRegistrySnapshot.
Validatorer får inte:
- upptäcka regler dynamiskt
- ladda regler vid runtime
- mutera regeluppsättningen

## Artifact Contract Lifecycle
Den enda tillåtna livscykeln för canonical artifacts är:

```
Artifact Semantic State
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

**IMP‑24‑I6 — Canonical Artifact Lifecycle**
Implementationer får inte:
- beräkna hash före canonical serialization
- publicera artifacts innan canonical bytes existerar
- mutera publicerade artifacts
- regenerera identitet efter publicering

Förbjudna övergångar:
```
Artifact Contract
        ↓
ContentHash
        ↓
Canonicalization  (FÖRBJUDET)

Published Artifact
        ↓
Mutation
        ↓
Re-publication    (FÖRBJUDET)

Published Artifact
        ↓
Identity Regeneration (FÖRBJUDET)
```
Canonical identity representerar exakt ett immutabelt semantiskt tillstånd.

## Canonical Serialization Authority
**IMP‑24‑I7 — Canonical Serialization Authority**
CanonicalSerializer är den enda auktoriteten som får producera CanonicalBytes.
Artifacts får inte:
- implementera egen serialisering
- exponera canonical serialization‑metoder
- hash:a runtime‑objekt
- definiera alternativa canonical representations
- bero på språk- eller objektlayout

Enda giltiga väg:
```
Artifact Semantic State
        ↓
CanonicalSerializer
        ↓
CanonicalBytes
        ↓
ContentHash
```
Det garanterar:
- byte‑nivå‑likhet
- deterministisk hashing
- stabila signaturer
- replay determinism
- cross‑platform reproducibility

## Repository Structure
```
packages/
 └── mps-compliance/
      ├── artifacts/
      │    ├── ArtifactContract.ts
      │    ├── ArtifactId.ts
      │    ├── ArtifactReference.ts
      │    ├── ArtifactType.ts
      │    └── ContentHash.ts
      │
      ├── canonical/
      │    ├── CanonicalBytes.ts
      │    ├── CanonicalSerializer.ts
      │    ├── CanonicalRules.ts
      │    └── CanonicalValidator.ts
      │
      ├── conformance/
      │    ├── RuleRegistryBuilder.ts
      │    ├── RuleRegistrySnapshot.ts
      │    ├── ConformanceEngine.ts
      │    ├── ValidationContext.ts
      │    ├── ValidationResult.ts
      │    └── ComplianceReport.ts
      │
      ├── validators/
      │    ├── ActorValidator.ts
      │    ├── SignatureValidator.ts
      │    ├── ExecutionValidator.ts
      │    ├── CapabilityValidator.ts
      │    ├── RetentionValidator.ts
      │    └── ReplayValidator.ts
      │
      └── errors/
           └── ComplianceError.ts
```

## Normative Dependency Graph
```
                 ADR-24-20 Constitution
                         |
                         v
              Artifact Contract Boundary
                         |
                         v
              Canonical Bytes Foundation
                         |
                         v
              Immutable MCS Kernel
                         |
        +----------------+----------------+
        |                                 |
        v                                 v
 ADR-24-21 Actor Trust             ADR-24-22 Signature
        |                                 |
        +---------------+-----------------+
                        |
                        v
              ADR-24-25 Execution Identity
                        |
                        v
              ADR-24-26 Capability Trust
                        |
                        v
              ADR-24-24 Retention
                        |
                        v
              ADR-24-23 Replay & Audit
                        |
                        v
                  MCS-001 Matrix
```

## Phase Structure

**Phase 0 — Canonical Foundation**
Implement:
- ArtifactContract
- ArtifactId
- ArtifactReference
- ArtifactType
- ContentHash
- CanonicalBytes
- CanonicalSerializer
- CanonicalRules
- CanonicalValidator
- ComplianceError

**Phase 1 — Immutable MCS Kernel**
Implement:
- RuleRegistryBuilder
- RuleRegistrySnapshot
- ConformanceEngine
- ValidationContext
- ValidationResult
- ComplianceReport

**Phase 2 — ADR‑24‑21 Actor Trust**
Ordning:
- TrustAnchor
- TrustDomain
- Actor
- ActorLifecycle
- TrustDelegation

**Phase 3 — ADR‑24‑22 Signature**

**Phase 4 — ADR‑24‑25 Execution Identity**
Ordning:
- ExecutionIdentity
- CapabilityResolution
- ExecutionManifest
- ExecutionAttempt
- ExecutionOutcome

**Phase 5 — ADR‑24‑26 Capability Trust**

**Phase 6 — ADR‑24‑24 Retention**

**Phase 7 — ADR‑24‑23 Replay & Audit**

**Phase 8 — MCS‑001 Conformance Matrix**

## Commit Sequence

**Commit 1**
```
feat(mps-compliance): introduce canonical artifact foundation
```

**Commit 2**
```
feat(mps-compliance): introduce immutable MCS validation kernel
```

**Commit 3**
```
feat(mps-governance): implement ADR-24-21 actor trust contracts
```

## Conformance Mapping
| ADR | Invariant | Validator | Test |
| :--- | :--- | :--- | :--- |
| 24‑21 | ACT‑21‑I* | ActorValidator | ACT_* |
| 24‑22 | SIG‑22‑I* | SignatureValidator | SIG_* |
| 24‑23 | AUD‑23‑I* | ReplayValidator | AUD_* |
| 24‑24 | RET‑24‑I* | RetentionValidator | RET_* |
| 24‑25 | EXEC‑25‑I* | ExecutionValidator | EXEC_* |
| 24‑26 | CAP‑26‑I* | CapabilityValidator | CAP_* |

## Final Statement
Package24 Implementation Plan v1.0 är nu:
- konstitutionellt korrekt
- deterministiskt
- replay‑bart
- audit‑bart
- framtidssäkert
- implementeringssäkert
- komplett

Det är det normativa bootstrap‑kontraktet för hela Mimer Frozen Core.
