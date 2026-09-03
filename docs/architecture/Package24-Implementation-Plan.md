# Package24 Implementation Plan v1.0
**Status: Frozen (as a historical implementation-sequencing record — see
revalidation below)**
**Version: 1.0**
**Authority (as originally written): MIMER‑20 Constitution — now historical, see below**
**Validated by: MCS‑001**

**Provenance note (2026-08-30, revalidated 2026-08-30):** `ADR-24-20-Constitution.md`,
cited above as this plan's semantic authority, is **HISTORICAL / NORMATIVE_TODAY:
false**, superseded platform-wide by `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`. A
read-only semantic revalidation was performed during document-authority closure
(2026-08-30) against the current constitution, current `ADR-24-21..26` (all still
exist and are unaltered by this revalidation), and current code/tests. Findings:

| Claim | Classification | Note |
| --- | --- | --- |
| Header "Authority: MIMER‑20 Constitution" | **HISTORICAL** | ADR-24-20's own invariants (`MIMER-20-I1..I15`) have zero code references anywhere in this repository (confirmed by grep during the original 2026-08-30 audit) — this plan's practical authority was always its own `IMP-24-I*` invariants and the `mps-compliance` code, not `MIMER-20-I*` enforcement. |
| `IMP‑24‑I1`–`IMP‑24‑I6` (identity non-creation, canonical byte authority, contract purity, validation purity, registry snapshot determinism, canonical artifact lifecycle) | **CURRENT** | Package-24-internal design rules for `mps-compliance`; not redesigned or revalidated line-by-line here (out of this unit's scope), but nothing found that contradicts them. |
| `IMP‑24‑I7` ("CanonicalSerializer är den enda auktoriteten som får producera CanonicalBytes") | **CONFLICTS_WITH_CURRENT_AUTHORITY (unresolved — flagged, not patched)** | `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md` §5 establishes multiple, separately-owned canonicalizer namespaces (`dg-*` owned by `mps-decision-governance`, `runtime-projection-*` by `alpha-runtime`, `sv-*` by Spatial Governance Domain) — i.e. the current constitution already treats canonical serialization authority as namespace-partitioned, not singular. This plan's "the only authority" wording was not corrected here because doing so would require deciding whether Package-24's serializer is itself a namespace owner or must integrate with the `ADR-MPS-CONSTITUTIONAL-INVARIANTS` namespace model — a real architectural question outside a documentation-closure unit's authority. |
| "Repository Structure" (`artifacts/`, `canonical/`, `conformance/`, `validators/`, `errors/`) | **HISTORICAL (superseded by growth, not contradicted)** | Current `packages/mps-compliance/src/` also contains `audit/`, `dependency-analyzer/`, `matrix/`, `profiles/`, `reports/`, `unit/` — the plan's listed structure is a true subset of what exists today, not wrong, just incomplete. Not rewritten here (would be redesigning the plan's documentation, not correcting a stale authority claim). |
| "Conformance Mapping" table (`24‑21..26` only) | **CURRENT, but incomplete relative to actual Package-24 footprint** | Real, vitest-exercised implementation for the separate `ADR‑24‑07..19` governs-list range now also exists (`packages/mps-dep`, `packages/mps-registry`, `packages/mps-governance`, `packages/mps-events`, `packages/mps-compliance/package24/*.test.ts` — see the corrected mapping table in `ADR-24-20-Constitution.md`), but none of it is described anywhere in this plan. Not added here — extending this plan's Conformance Mapping is a substantive content addition, not a stale-reference correction, and is out of this closure unit's scope. |
| "Final Statement" ("...är nu: konstitutionellt korrekt... Det är det normativa bootstrap‑kontraktet för hela Mimer Frozen Core.") | **HISTORICAL** | "Konstitutionellt korrekt" rested on `ADR-24-20`, which is no longer normative; "det normativa bootstrap-kontraktet för hela Mimer Frozen Core" is also no longer accurate on its own terms, since real Package-24 implementation now extends beyond what this plan documents (row above). This statement is left unedited below as the plan's original closing claim, superseded by this table — patching the prose itself would blur the line between "what was claimed then" and "what is corrected now." |

This plan's Package-24-specific *design content* (Phases 0–8, Commit Sequence,
Implementation Invariants `IMP-24-I1..I7`) is otherwise left unrevalidated
line-by-line and unredesigned — that remains out of this documentation-closure
unit's scope, per the classification table above.

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
