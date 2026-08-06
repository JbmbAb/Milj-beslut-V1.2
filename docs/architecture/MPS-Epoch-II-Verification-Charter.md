# MPS Epoch II — Verification Charter

**Status:** Normative for Epoch II release readiness.  
**Scope:** Execution Platform verification only (not Epoch III Knowledge).  
**Companion:** [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md)

Implementation of tracks 2.1–2.9 is **complete**. This charter defines when the platform is **verified** and thus releasable.

```
Execution Platform
──────────────────
Implementation  ✅ Complete
Verification    🟡 In Progress
Release         🔒 Pending
```

---

## Definition of Done (blocking)

Epoch II SHALL NOT be marked Release-ready until **all** of the following are demonstrated:

1. **Generality** — Platform runs at least **LU**, **DummyCapability**, and **Synthetic Workflow** with no domain-specific code inside runtime packages.
2. **Replay** — Replay artifacts are byte-identical (same content hashes) to the original execution spine.
3. **Crash resume** — Execution resumes after process death without information loss (infra gates).
4. **Registry sole truth** — Capability/workflow resolution only via RegistryRuntime snapshot (never “latest floating”).
5. **CAS sole truth** — Artifacts persist/read only via Mimers CAS path (no PostGIS in replay).
6. **Projection purity** — Projections can be deleted and rebuilt to an identical result from artifacts.
7. **Adversarial gate** — Unified adversarial suite is green (blocking for release).

Performance suites are **not** DoD blockers; they are regression/release quality signals.

---

## Nine verification levels

| # | Level | Purpose |
|---|--------|---------|
| 1 | Architecture Invariants | Frozen-core proofs for the Execution Platform |
| 2 | Runtime Infrastructure | Queue, lease, retry, crash, duplicate tickets |
| 3 | Registry Runtime | Resolution, freeze, release isolation, hash golden |
| 4 | Capability Runtime | Generic lifecycle across domains |
| 5 | Workflow Runtime | Ordering, replay, failure recovery, nested/parallel |
| 6 | Mimers Integration | CAS round-trip, rebuild, corruption, CAS-only replay |
| 7 | Projection Layer | Never source of truth; rebuild identity |
| 8 | Performance | Throughput/scale — must not drive architecture |
| 9 | Adversarial | Tamper / wrong release / flood / replay attack / fake capability |

### Blocking vs recommended vs performance

| Class | Meaning | Levels / suites |
|-------|---------|-----------------|
| **Blocking** | Must be 100% green for Release | L1 Architecture; Generality (LU+Dummy+Synthetic); L3 integrity (freeze/release/hash); L6 CasCorruption/CasReplay; L7 ProjectionRebuild; L9 Adversarial gate; crash/lease/retry from L2 |
| **Recommended** | Strong quality; land before Release if feasible | L2 QueueDeterminism golden; L5 Nested/Parallel; CrossPlatform OS CI matrix; L4 extra domain fixtures |
| **Performance / regression** | Never architectural gates | L8 (10k executions, workers, CAS/queue benches) |

---

## Level 1 — Architecture Invariants (blocking)

| Test | Proves |
|------|--------|
| `ExecutionDeterminism` | Same manifest + registry snapshot + input → identical artifact ids, hashes, graph, outcome |
| `ReplayDeterminism` | Execution → Artifacts → Replay → Artifacts (byte-identical hashes) |
| `IdentityIsolation` | Time, TZ, locale, hostname, worker id, trace id, telemetry, logs, PID do not affect identity |
| `CrossPlatformReplay` | Canonical/env-neutral hashes; OS matrix recommended in CI |
| `ExecutionGraphOrdering` | A→B→C never reorders to B→A |

**Code:** `packages/mps-runtime/src/verification/architecture/`

## Level 2 — Runtime Infrastructure

QueueDeterminism · LeaseRecovery · RetryIdempotency · CrashRecovery · DuplicateTicket  

**Existing base:** `ExecutionInfrastructure` + DurableTicketQueue adversarial (CI).

## Level 3 — Registry Runtime

RegistryResolution · RegistryFreeze · ReleaseIsolation · RegistryDeterminism / RegistryHashGolden

## Level 4 — Capability Runtime (Generality Proof)

| Fixture | Role |
|---------|------|
| LU | Real domain Assessment Capability |
| DummyCapability | Minimal domain |
| Synthetic Workflow | Domain-less multi-step execution |

Lifecycle for each: Admit → Capability/Workflow → Artifacts → Replay — no special-case runtime code.

**Code:** `packages/mps-runtime/src/verification/generality/`

## Level 5 — Workflow Runtime

| Priority | Suite |
|----------|--------|
| High | FailureRecovery, Replay, Ordering |
| Later / costlier | Nested, Parallel |

## Level 6 — Mimers Integration

CasRoundTrip · CasRebuild · CasCorruption · CasReplay (CAS only — never PostGIS)

## Level 7 — Projection Layer

ProjectionPurity · **ProjectionRebuild** (`DELETE` → rebuild → identical)

## Level 8 — Performance (last)

Scale/regression only. Architecture decisions SHALL NOT be driven by these numbers.

## Level 9 — Adversarial (blocking release gate)

Single CI gate aggregating:

- Tampered Artifact / Registry  
- Wrong Release  
- Fake Capability  
- Duplicate Ticket Flood  
- Replay Attack  

---

## Verification build order (normative)

```
1  Verification Charter          ← this document
2  Architecture Invariants
3  Generality Proof (LU + Dummy + Synthetic Workflow)
4  Registry + Mimers integrity
5  Workflow (FailureRecovery first)
6  Projection rebuild
7  Adversarial unified gate
8  Performance
```

---

## CI policy

- **Blocking verification** suites SHALL be listed under MPS infra / verification gates in `.github/workflows/ci.yml`.
- Adversarial gate SHALL be blocking for release once introduced.
- Performance suites MAY run on schedule or manual workflow — not required for every PR.

---

## Status tracking

| Phase | Status |
|-------|--------|
| Charter | ✅ |
| Architecture Invariants | ✅ (`mps-runtime/src/verification/architecture`) |
| Generality Proof | ✅ (`mps-runtime/src/verification/generality`) |
| Registry + Mimers | ✅ (`mps-runtime/src/verification/integrity`) |
| Workflow depth | ⚪ |
| Projection rebuild | ⚪ |
| Adversarial gate | ⚪ |
| Performance | ⚪ |
| **Release** | 🔒 Pending |
