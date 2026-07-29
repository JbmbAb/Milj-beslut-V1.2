# ADR-042 — Mimers Brunn v9 Core Extraction + WORM Promotion Architecture

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Scope | Fas 4 Enterprise Edition |
| Decision | Låst för implementation |
| Date | 2026-07-29 |
| Amendment | Merkle layers, metrics contract, crypto agility (2026-07-29) |

## Decision

1. **`packages/mimers-brunn-core`** (`@miljobeslut/mimers-brunn-core`) is the authoritative owner of canonical serialization, hashing, CAS addressing, manifest validation, signing abstraction, ledger primitives, and Merkle verification.
2. Integration uses a **Bridge** (Legacy → Compatibility Adapter → Mimers v9). No big-bang replacement.
3. WORM promotions: `ApprovalRecord` → `PromotionArtifactV3` → sealed CAS; never embed approval state in the promotion.
4. **Content identity** = RFC8785 canonicalize → SHA-256 → CAS address. **AES-256-GCM** is a separate confidentiality layer and never forms the object identity.
5. Existing “AES-1.0” in this codebase means **Artifact Envelope Specification** (envelope fields stripped from hash/sign), not Advanced Encryption Standard.
6. WORM is **policy-enforced** (`immutable`, `allowOverwrite: false` on `promotion/*`).
7. Migration is **lazy on read** plus an **explicit one-shot script** that emits `migration-report.json` (itself a CAS object). Startup migrate-all is forbidden.
8. **Crypto agility:** `HashAlgorithm` and `SignatureAlgorithm` are first-class types in manifest, attestation, and verification — not free-form strings only.
9. **Independent Merkle verification layers** (content vs events):

```
CAS Merkle  →  Ledger Merkle  →  Checkpoint  →  Signed Checkpoint
```

Content store and event log can be verified independently.

## Dependency direction

```
Evolution Engine  -->  @miljobeslut/mimers-brunn-core
```

Forbidden: `mimers-brunn-core` → `server/evolve`.

## Crypto agility (first-class)

```ts
type HashAlgorithm = 'sha256' | 'sha512' | 'blake3';
type SignatureAlgorithm = 'ECDSA_P256_SHA256' | 'Ed25519' | 'RSA_PSS_SHA256';
```

These appear on manifests, attestations, signature envelopes, and verifiers so algorithms can migrate without redesign.

## Stable metrics contract

Names are stable for dashboards (OpenTelemetry adapter maps to these):

| Metric | Kind |
|--------|------|
| `cas.put.duration` | histogram |
| `cas.get.duration` | histogram |
| `cas.bytes` | counter |
| `cas.cache.hit` | counter |
| `cas.cache.miss` | counter |
| `ledger.append.duration` | histogram |
| `ledger.verify.duration` | histogram |
| `audit.l0.duration` | histogram |
| `audit.l1.duration` | histogram |
| `audit.l2.duration` | histogram |
| `audit.l3.duration` | histogram |

Gauges use proper ObservableGauge semantics in the OTel adapter (not UpDownCounter misuse).

## Delivery order

### P1 — Foundations

- **P1A** CAS + CommitStrategy
- **P1B** Manifest + Builder
- **P1C** Ledger v2 + hash chain + UUIDv7
- **P1D** Idempotent `commitPromotion`
- **P1E** SLSA-inspired `ArtifactAttestation`

### P2 — Verification & observability

- **P2A** Ledger Merkle checkpoint
- **P2B** CAS Merkle checkpoint
- **P2C** Recovery L0–L3
- **P2D** OpenTelemetry adapter + metrics contract

### P3 — Hardening

- Fault injection, crash recovery suite, drift runbooks, benchmark/regression suite

## Locked WORM contracts

- `ApprovalRecord` v1: `decision: 'approved' | 'rejected'`, `decidedBy`, ISO `createdAt`
- `PromotionArtifactV3` requires `approvalRecordId`; forbids inlined `approvalDecision`
- `SigningKeyProvider.sign/verify` over `Uint8Array` ↔ `SignatureEnvelope`
- `ArtifactPolicy` for namespace immutability

## Consequences

- Cryptographic primitives move out of evolve ownership.
- Dual verification via `IntegrityProvider` during migration.
- Content and ledger integrity can be audited on separate Merkle roots.
- Algorithm upgrades are data-driven, not architecture rewrites.
