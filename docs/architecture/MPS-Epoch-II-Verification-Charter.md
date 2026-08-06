# MPS Epoch II — Verification Charter

**Status:** Normative for Epoch II release readiness.  
**Scope:** Execution Platform verification only (not Epoch III Knowledge).  
**Companion:** [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md)

Implementation of tracks 2.1–2.9 is **complete**. This charter defines when the platform is **verified** and **qualified** for release — not merely “implementation closed”.

```
Execution Platform
──────────────────
Implementation  ✅ Complete
Verification    ✅ Complete   (Fas 1–7 + 8A)
Qualification   ✅ Fas 9 — Qualified for Knowledge Platform
Architecture Freeze  🟡 Next bridge before Epoch III (not a product RC)
```

**Milestone tag:** `execution-platform-v1.0-qualified` (push only after clean-checkout + doc revision + freeze review).  
Epoch III SHALL NOT start until Architecture Freeze (bugfixes-only on the runtime surface). This is architectural governance — not a product Release Candidate. See [MPS-Epoch-Roadmap.md](./MPS-Epoch-Roadmap.md).

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
8. **Performance gate (Fas 8A)** — Release Performance Gate green against golden baselines in CI.

**Fas 8B Scalability Qualification** is **not** a release blocker.  
**Fas 9 Platform Qualification** is the formal close-out that records all gates before Epoch III.

---

## Nine verification levels (+ qualification)

| # | Level | Purpose |
|---|--------|---------|
| 1 | Architecture Invariants | Frozen-core proofs for the Execution Platform |
| 2 | Runtime Infrastructure | Queue, lease, retry, crash, duplicate tickets |
| 3 | Registry Runtime | Resolution, freeze, release isolation, hash golden |
| 4 | Capability Runtime | Generic lifecycle across domains |
| 5 | Workflow Runtime | Ordering, replay, failure recovery, nested/parallel |
| 6 | Mimers Integration | CAS round-trip, rebuild, corruption, CAS-only replay |
| 7 | Projection Layer | Never source of truth; rebuild identity |
| 8A | Release Performance Gate | CI regression ceilings + golden baselines |
| 8B | Scalability Qualification | Optional large-scale / endurance (not every commit) |
| 9 | Adversarial | Tamper / wrong release / flood / replay attack / fake capability |
| **Q** | **Platform Qualification** | Formal checklist close-out (Fas 9) |

### Blocking vs recommended vs performance

| Class | Meaning | Levels / suites |
|-------|---------|-----------------|
| **Blocking** | Must be 100% green for Release | L1 Architecture; Generality (LU+Dummy+Synthetic); L3 integrity (freeze/release/hash); L6 CasCorruption/CasReplay; L7 ProjectionRebuild; L9 Adversarial gate; L8A Performance Gate; crash/lease/retry from L2 |
| **Recommended** | Strong quality; land before Release if feasible | L2 QueueDeterminism golden; L5 Nested/Parallel; CrossPlatform OS CI matrix; L4 extra domain fixtures |
| **Scalability (8B)** | Optional qualification; never CI-every-commit | 1M artifacts/replay, 1k workers, endurance, leak/GC |
| **Qualification (Fas 9)** | Formal release close-out | Single checklist → “Qualified for Knowledge Platform” |

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

| # | Suite | Class | Proves |
|---|--------|-------|--------|
| 5.1 | **WorkflowFailureRecovery** | **Blocking** | Crash at step N → resume at N (not 1); `execution_order` preserved; completed artifacts reused; no new identities for completed steps; no duplicate capability runs |
| 5.2 | **WorkflowReplay** | **Blocking** | Workflow → Artifacts → Replay → identical content_hash / graph order |
| 5.3 | **WorkflowOrdering** | **Blocking** | A→B→C never becomes A→C→B |
| 5.4 | NestedWorkflow | Recommended | After 5.1–5.3 green |
| 5.5 | ParallelCapability | Recommended | After 5.1–5.3 green — higher complexity |

**Code:** `packages/mps-runtime/src/verification/workflow/`

## Level 6 — Mimers Integration

CasRoundTrip · CasRebuild · CasCorruption · CasReplay (CAS only — never PostGIS)

## Level 7 — Projection Layer

| Suite | Class | Proves |
|-------|--------|-------|
| ProjectionPurity | Blocking | Projection never mutates CAS |
| **ProjectionRebuild** | **Blocking** | `DELETE` all projections → rebuild from artifacts → identical `batch_hash` / UI hashes |

**Code:** `packages/mps-runtime/src/verification/projection/` + `EphemeralProjectionStore`

## Level 8A — Release Performance Gate (blocking for release CI)

**Purpose:** Catch performance regressions before release. Not enormous; always runnable in CI.  
**Shall not** drive architecture decisions — ceilings exist only to detect regressions.

| Benchmark | Scale (counts in golden) |
|-----------|--------------------------|
| ExecutionManifests | 10 000 |
| Replay | 10 000 |
| Concurrent workers | 100 |
| CAS lookups | 100 000 |
| Registry resolve | 100 000 |
| Queue | 10 000 ops |
| Workflow | 1 000 runs |

**Golden baselines:** `packages/mps-runtime/src/verification/performance/baselines/release-gate.v1.json`  
**Suite:** `packages/mps-runtime/src/verification/performance/ReleasePerformanceGate.test.ts`  
**Update baselines (intentional):** `MPS_UPDATE_PERF_BASELINE=1` then re-run the suite.

CI asserts `ceilings_ms`; `measured_ms_reference` records the last intentional capture for human comparison.

## Level 8B — Scalability Qualification (optional)

**Purpose:** “Can the platform grow?” — not a every-commit / every-PR requirement.

Examples (manual / scheduled / dedicated runners):

- 1 000 000 artifacts  
- 1 000 000 replay  
- 1 000 concurrent workers  
- 24 h endurance  
- Long-lived lease recovery  
- Memory leak / GC stability  

Results MAY be archived as qualification evidence; failures do **not** block Fas 8A or Fas 9 unless product owners elevate them.

## Level 9 — Adversarial (blocking release gate)

Single CI gate: `packages/mps-runtime/src/verification/adversarial/AdversarialGate.test.ts`

| Attack | Expected |
|--------|----------|
| Tampered Artifact | WORM / hash verify fail |
| Tampered Registry | Freeze reject; evil key unresolved |
| Wrong Release | Admit denied; no capability exec |
| Fake Capability | Registry + admission reject |
| Duplicate Ticket Flood | 100 keys → 1 ticket |
| Replay Attack | Original attempt/outcome identities unchanged |

---

## Fas 9 — Platform Qualification

Final verification close-out. Not an implementation track — a **qualification record**.

When every item below is ✅, Epoch II may be declared:

> **Execution Platform v1.0 – Qualified for Knowledge Platform**

| Gate | Status |
|------|--------|
| Architecture Invariants | ✅ |
| Infrastructure | ✅ |
| Registry Integrity | ✅ |
| Capability Generality | ✅ |
| Workflow Recovery | ✅ |
| Mimers Integrity | ✅ |
| Projection Purity | ✅ |
| Adversarial Gate | ✅ |
| Performance Gate (8A) | ✅ |

### Qualification record

**Execution Platform v1.0 – Qualified for Knowledge Platform**

Recorded: 2026-08-06 · Evidence: verification suites under `packages/mps-runtime/src/verification/` + CI gate “MPS Epoch II verification gates”.  
Fas 8B Scalability Qualification remains optional post-qualify evidence.

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
8A Release Performance Gate      ← CI release regression
8B Scalability Qualification     ← optional / scheduled
9  Platform Qualification        ← formal “Qualified for Knowledge Platform”
```

---

## CI policy

- **Blocking verification** suites SHALL be listed under MPS infra / verification gates in `.github/workflows/ci.yml`.
- Adversarial gate SHALL be blocking for release.
- **Fas 8A Performance Gate SHALL run in CI** (release regression).
- Fas 8B SHALL NOT run on every commit; use schedule/manual workflow.
- Fas 9 is a documentation/status close-out after 8A (and blocking gates) are green.

---

## Status tracking

| Phase | Status |
|-------|--------|
| Charter | ✅ |
| Architecture Invariants | ✅ (`mps-runtime/src/verification/architecture`) |
| Generality Proof | ✅ (`mps-runtime/src/verification/generality`) |
| Registry + Mimers | ✅ (`mps-runtime/src/verification/integrity`) |
| Workflow depth | ✅ Blocking 5.1–5.3 green; Nested/Parallel recommended (landed, non-blocking) |
| Projection rebuild | ✅ (`mps-runtime/src/verification/projection`) |
| Adversarial gate | ✅ (`mps-runtime/src/verification/adversarial/AdversarialGate.test.ts`) |
| Performance Gate (8A) | ✅ (`mps-runtime/src/verification/performance/ReleasePerformanceGate.test.ts`) |
| Scalability Qualification (8B) | ⚪ Optional — not every commit |
| Platform Qualification (Fas 9) | ✅ Qualified for Knowledge Platform |
| Cross-platform OS matrix | ⚪ Recommended CI matrix (local env-neutral suite exists) |
| **Architecture Freeze** | 🟡 Next — then Epoch III (Knowledge Foundation first); not a product RC |
| **Milestone tag** | `execution-platform-v1.0-qualified` (local until pre-tag checks pass) |
