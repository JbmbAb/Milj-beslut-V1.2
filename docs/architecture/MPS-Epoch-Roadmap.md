# MPS Epoch Roadmap — Execution Platform & Knowledge Platform

Canonical multi-epoch roadmap after **Execution Kernel v1.0 – LU Cutover Complete** (ADR-30).

**Status:** Normative / frozen for planning (revise only via ADR).  
Governing ADRs: [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) · [ADR-31](./ADR-31-Post-LU-Platform-Infrastructure-Focus.md)

---

## Overarching principle (all epochs)

```
Execution Platform SHALL remain domain-agnostic.

All domain functionality SHALL be implemented as
capabilities, workflows, rules and projections.

The Execution Platform SHALL NOT contain domain-specific logic.
```

This is the governing principle for Epochs II–IV.  
`ExecutionKernel` is one component inside the Execution Platform — not the platform itself.

| Epoch | Name | Goal | Status |
|-------|------|------|--------|
| **I** | Frozen Core + LU Runtime | First domain on a single execution spine | ✅ **Closed** |
| **II** | **Execution Platform** | Universal, domain-agnostic execution platform | ✅ **Qualified (Fas 9)** |
| — | Architecture Freeze | Governance freeze of the runtime surface | ✅ **In effect** |
| **III** | Knowledge Platform | Knowledge Foundation → assessments → evolution → adaptive | ⏳ **Ready to start** (Knowledge Foundation first) |
| **IV** | Ecosystem Platform | External APIs, plugins, partners, multi-client | ⚪ **Long-term** |

### Platform stack (normative)

Earlier, LU was the product. Now LU is a **client** of the platform.

```
Knowledge Platform
        ▲
Assessment Platform   ← LU is a reference Assessment Capability / client
        ▲
Execution Platform    ← domain-agnostic motor (qualified v1.0)
        ▲
Frozen Core
```

That separation is the point of the platform: domain value sits above a verified, frozen execution foundation.

### Bridge before Epoch III (normative)

Do **not** start Epoch III immediately after Fas 9. This is an **architectural qualification bridge**, not a product “Release Candidate” (RC in the shipping sense).

```
Execution Platform v1.0 (Qualified)
        │
        ▼
Architecture Freeze   (= governance freeze of the runtime surface)
        │
        ▼
Knowledge Platform (Epoch III) — Knowledge Foundation first
```

**Architecture Freeze (governance freeze) means:**

| Allowed | Forbidden |
|---------|-----------|
| Bug fixes | New runtime features |
| Test / verification hardening | New execution contracts |
| Docs / ops clarification | New identity fields |
| Fas 8B optional evidence | New registry principles |

### Milestone tag policy

| Step | Status |
|------|--------|
| Local annotated tag `execution-platform-v1.0-qualified` | ✅ Created (points at freeze/docs sync) |
| `git push origin execution-platform-v1.0-qualified` | ⏳ **Deferred** |

**Push the tag only when** the first real Knowledge Foundation component runs on the frozen Execution Platform **without** changing ExecutionKernel, Registry, or CAS contracts — e.g. Mimers Harvester → CAS, first Document Intelligence pipeline, or first Knowledge Graph ingest. That proves the freeze holds under the next layer, not only under verification suites.

### Pre-tag freeze review (runtime surface)

Question: *Is there anything here we already expect to break in Epoch III?*

| Surface | Freeze basis | Epoch III expectation |
|---------|--------------|------------------------|
| Runtime contracts (`EXECUTION_CONTRACT_FREEZE_VERSION` 1.0.0) | ADR-29 identities + model | **No break** — Knowledge/Assessment add capabilities & artifacts above the motor |
| Identity fields (`FrozenIdentities`) | Required members frozen | **No break** — new knowledge types are new artifact majors, not widened execution identities |
| Registry principles (sole resolve, release-bound snapshot, `registry_hash`) | ADR-31 / §2.3 | **No break** — new domains register; principles stay |
| CAS / Mimers path | Sole artifact store for execution writes | **No break** — Knowledge Foundation writes more CAS content; path remains CAS-only |
| Workflow contracts (ordered refs, nested/`parallel_group`) | Registry + WorkflowRuntime | **No break** — composition already domain-agnostic |

**Watch (additive, not a forced break):** `ProviderKind` (`spatial` \| `document` \| `external`) may gain kinds for Knowledge Foundation — treat as **additive registry entry evolution** under a minor registry version, not as rewriting resolve/freeze principles.

**Verdict:** Architecture Freeze is real — Epoch III SHOULD NOT require breaking the Execution Platform v1.0 surface.

---

## Epoch I ✅ Frozen

| Deliverable | Notes |
|-------------|--------|
| Frozen Core | Package24 / identity contracts |
| LU Runtime v1 | **Reference implementation of an Assessment Capability** |
| ExecutionKernel v1 | Normative motor API (component) |
| Mimers CAS | Sole artifact store for kernel writes |
| Replay + Admission | On the production path |

**Discipline:** Do not reopen LU Runtime v1 for motor experiments.

---

## Epoch II — Execution Platform v1

```
Execution Platform
──────────────────
Implementation  ✅ Complete   (tracks 2.1–2.9)
Verification    ✅ Complete   (Fas 1–7 + 8A Release Performance Gate)
Qualification         ✅ Fas 9 — Execution Platform v1.0 Qualified
Architecture Freeze   ✅ In effect (bugfixes only on runtime surface)
Local tag             ✅ execution-platform-v1.0-qualified (not pushed)
Epoch III             ⏳ Knowledge Foundation next
Remote tag push       ⏳ After first KF component runs without contract changes
```

**Mål:** en **generell, domänagnostisk exekveringsplattform**.  
Inte LU-arbete. LU är **klient** / referens-Assessment Capability — inte produkten.

**Implementation DoD:** tracks 2.1–2.9 closed.  
**Qualification DoD:** [MPS-Epoch-II-Verification-Charter.md](./MPS-Epoch-II-Verification-Charter.md) — Fas 1–7 + 8A + Fas 9.  
**Not Qualification DoD:** Fas 8B Scalability Qualification (optional / scheduled).  
**Architecture Freeze:** in effect. Epoch III may begin at Knowledge Foundation; remote tag push waits for freeze proof under real KF load.

### Normative build order

```
2.1  Execution Infrastructure
        ↓
2.2  Execution Contracts & Model
        ↓
2.3  Registry Runtime
        ↓
2.4  Mimers Integration
        ↓
2.5  Capability Runtime
        ↓
2.6  Workflow Runtime
        ↓
2.7  Projection Layer
        ↓
2.8  Runtime Observability
        ↓
2.9  Execution Platform Security
```

**Why Mimers before Capability/Workflow:** Capability Runtime must work against the real `ArtifactRepository` → CAS from day one — avoid building Workflow against a temporary store.

**Why Registry before Mimers/Capability:** Registry is the sole truth for what may be resolved; hard-coded bindings are removed in this epoch.

### 2.1 Execution Infrastructure ✅

| Component | Responsibility | Code |
|-----------|----------------|------|
| **ExecutionQueue v1** | Durable ticket ingress / ordering | `ExecutionTicketQueue` + Prisma/file |
| **LeaseManager** | Worker leases with timeout reclaim | `execution-infrastructure/LeaseManager` |
| **RetryEngine** | Deterministic retry policy | `execution-infrastructure/RetryEngine` |
| **IdempotencyManager** | Duplicate-safe enqueue / complete | `execution-infrastructure/IdempotencyManager` |
| **Crash Recovery** | Resume after process death without information loss | `CrashRecovery` + `recover()` |
| **Replay Scheduler** | Schedule / drive replay without mutating domain logic | `ReplayScheduler` |

**Facade:** `ExecutionInfrastructure` in `@miljobeslut/mps-control-plane`.

**Resultatinvariant:** En execution SHALL kunna återupptas efter processkrasch utan informationsförlust.

### 2.2 Execution Contracts & Model ✅

Semantic **objects** and governing **contracts/policies**:

| Contracts / identities | Role |
|------------------------|------|
| **ExecutionManifest** | What is admitted to run |
| **ExecutionAttempt** | One try at a manifest |
| **ExecutionOutcome** | Result of an attempt |
| **ExecutionSession** | Correlates attempts / tickets / replays |
| **ReplayIdentity** | Replay artifact / equivalence-proof binding |
| **TicketIdentity** | Durable queue ticket bound to a manifest |
| **ExecutionPolicy** | Cross-cutting execution constraints |
| **AdmissionPolicy** | Who/what may be admitted |
| **RetryPolicy** | Deterministic retry behaviour |

Objects describe *what happened*. Policies describe *what is allowed*. Both are part of the frozen semantic surface (extends ADR-29; additive `execution_session`).

**Code:** `packages/mps-runtime/src/contracts/model/` — policies shared with Execution Infrastructure; LU kernel client persists `ExecutionSession` after admit.

### 2.3 Registry Runtime ✅

Sole runtime source of truth:

| Registry | Role |
|----------|------|
| Capability Registry | Versioned capability definitions |
| Workflow Registry | Workflow definitions / graphs |
| Rule Registry | Conformance / domain rule bindings |
| Provider Registry | Spatial / document / external providers |
| Release Registry | Release-bound snapshots |

**Invariant:** ExecutionKernel SHALL NOT know concrete implementations — only resolve via registry + ports.

**Code:** `packages/mps-runtime/src/registry/` — `RegistryRuntime` facade; LU seeds via `createLuRegistryRuntime` and binds invoke handlers to `implementation_ref`.

### 2.4 Mimers Brunn Integration ✅

Kernel SHALL never talk directly to PostGIS or files:

```
ArtifactRepository → Resolver → CAS → Mimers Brunn
```

Providers and harvest sit *outside* the platform; they produce artifacts that enter CAS. Capability/Workflow runtimes consume only repository ports backed by Mimers.

| Component | Responsibility | Code |
|-----------|----------------|------|
| **MimersIntegration** | Sole facade: create / assertReady / rebuildIndex | `mps-runtime/src/mimers/MimersIntegration` |
| **ArtifactResolver** | Read-by-ref → CAS envelope | `CasArtifactResolver` |
| **CasBackedArtifactRepository** | Put + compose resolver | `repository/CasBackedArtifactRepository` |
| **MimersByteStorageBackend** | artifact_id ↔ Mimers hash index | `repository/MimersByteStorageBackend` |

**Invariant:** Product path obtains storage only via `MimersIntegration` (or thin `createKernelArtifactRepository` alias). `MIMERS_REQUIRED` fail-closed.

### 2.5 Capability Runtime ✅

Capabilities are fully generic. Domains (LU, avlopp, C-anmälan, …) register implementations.

**Invariant:** No domain-specific logic inside the Execution Platform.

| Component | Responsibility | Code |
|-----------|----------------|------|
| **CapabilityRuntime** | Registry resolve → `implementation_ref` → handler → frozen exec artifact | `mps-runtime/src/capability/CapabilityRuntime` |
| **asExecutorPort** | `CapabilityExecutorPort` for ExecutionKernel | same |
| **Domain composition root** | Register handlers (e.g. LURuleEngine) | `mps-lu` / other domains |

### 2.6 Workflow Runtime ✅

Real WorkflowEngine:

```
Workflow → Step 1 → Step 2 → Step 3 → Artifacts → Replay
```

Registry-backed step resolution, deterministic order, full-workflow replay — against Mimers-backed ArtifactRepository.

| Component | Responsibility | Code |
|-----------|----------------|------|
| **WorkflowRuntime** | Ordered steps → CapabilityRuntime → frozen workflow exec | `mps-runtime/src/workflow/WorkflowRuntime` |
| **asExecutorPort** | `WorkflowExecutorPort` for ExecutionKernel | same |
| **replay** | Re-run + content_hash equivalence | same |

**Note:** LU product path remains capability-only (ADR-30); workflow seed is exercised by platform tests. Kernel `execute()` still capability-primary until a workflow entrypoint ADR.

### 2.7 Projection Layer ✅

```
Execution → Artifacts → Projection → UI
```

**Not** `Execution → UI`.

**Normative invariants:**

```
Projection SHALL NEVER become a source of truth.

Projection SHALL be reproducible from immutable artifacts.
```

Same principle as Governance: UI and audit views are derived; CAS artifacts remain authoritative. Aligns with `mps-ui-contract` adapters.

| Component | Responsibility | Code |
|-----------|----------------|------|
| **ProjectionRuntime** | Read-only views via ArtifactResolver | `mps-runtime/src/projection/ProjectionRuntime` |
| **ArtifactProjectionView** | Frozen body + `projection_hash` | `ProjectionContracts` |
| **UI adapter** | View → presentation DTO (no CAS) | `mps-ui-contract/RuntimeProjectionAdapter` |

### 2.8 Runtime Observability ✅

Without mutating artifact identity:

- Replay logs · execution graph · lineage · deterministic tracing  

Side channel / projection — not a second source of truth.

| Component | Responsibility | Code |
|-----------|----------------|------|
| **ObservabilityRuntime** | Collect side-channel bundle from RuntimeState / replay / workflow | `mps-runtime/src/observability/ObservabilityRuntime` |
| **DeterministicTrace** | `trace_id` / spans from content hashes (no wall-clock) | `ObservabilityContracts` |
| **ObservabilityBundle** | Frozen graph + lineage + optional replay_log + `bundle_hash` | same |

**Invariant:** Observability MUST NOT `put` CAS or mutate frozen artifact identity. Ops telemetry (`mps-telemetry`) remains orthogonal.

### 2.9 Execution Platform Security ✅

Security is part of the **execution platform**, not the Knowledge Platform and not a full IAM product in this epoch:

```
Identity → Admission → Authorization → Capability Invocation → Artifact Signing
```

| Concern | Role in Epoch II |
|---------|------------------|
| Identity | Actor / principal bound into admission context |
| Admission | Policy gate before execute |
| Authorization | Capability invoke entitlement |
| Artifact Signing | Integrity of persisted outcomes / attestations |

Scope: execution-path trust. Not: full org IAM, SSO product surface, or partner federation (those belong later / Epoch IV).

| Component | Responsibility | Code |
|-----------|----------------|------|
| **SecurityRuntime** | bindPrincipal → admit → authorize → attest | `mps-runtime/src/security/SecurityRuntime` |
| **CapabilityGrant** | Principal ↔ capability entitlement | `SecurityContracts` |
| **OutcomeAttestation** | HMAC attest over outcome content_hash | `HmacSigningKeyProvider` |

**Implementation complete (2.1–2.9).** Release readiness is governed by the [Verification Charter](./MPS-Epoch-II-Verification-Charter.md). Domain logic remains outside the platform (capabilities / workflows / rules / projections only).

### Verification → Qualification (normative close-out)

| Phase | Role | Class |
|-------|------|-------|
| Fas 1–7 | Architecture → Adversarial | Blocking |
| **Fas 8A** | Release Performance Gate (golden ceilings in CI) | **Blocking for release** |
| Fas 8B | Scalability Qualification (1M / endurance / leak) | Optional — not every commit |
| **Fas 9** | Platform Qualification checklist | Formal close-out |

Fas 9 ends with: **Execution Platform v1.0 – Qualified for Knowledge Platform**  
That is distinct from “Implementation Closed” and from “Epoch III started”.

**Milestone tag:** `execution-platform-v1.0-qualified` — fixed reference for a verified Execution Platform. Prefer this over commit archaeology when Evolution / Knowledge later needs a known-good base.

---

## Epoch III — Knowledge Platform

**Start only after Architecture Freeze.** Qualification (Fas 9) is necessary but not sufficient.

**Do not begin with Evolution.** Evolution needs large volumes of real, replayable artifacts. Normative order:

```
IIIA  Knowledge Foundation
        Mimers Brunn as national knowledge base
        Document Intelligence
        Spatial Intelligence
        Evidence relations
        Knowledge Graph
        Knowledge Index
        ↓
IIIB  Assessment Library / Assessment Platform
        ↓
IIIC  Evolution
        ↓
IIID  Adaptive Platform
```

### IIIA — Knowledge Foundation (data layer)

| Area | Scope |
|------|--------|
| Harvester | Ingest into Mimers / CAS |
| Document Intelligence | Metadata, versions, relations, legal refs, lineages |
| Spatial Intelligence | SGU, NV, länsstyrelser, SMHI, hydrologi, klimat, historiska kartor, … |
| Evidence relations | Cross-links between spatial / document / execution evidence |
| Knowledge Graph | Structured relations over CAS evidence |
| **Knowledge Index** | How knowledge is **found** (search/retrieval index) |

```
CAS → Evidence → Knowledge Graph → Knowledge Index → Search
```

| Knowledge Graph | Knowledge Index |
|-----------------|-----------------|
| Describes **relations** | Describes **how knowledge is found** |

Offline-first on riktigt.

### IIIB — Assessment Platform

**LU is the reference implementation of an Assessment Capability.**

Same Execution Platform for:

Lokaliseringsutredning · Avlopp · C-anmälan · Natura 2000 · Kontrollplan · Förorenad mark · Vattenskydd · Artskydd · …

**Without a new motor** — new capabilities, workflows, rules, and projections only.

### IIIC — Evolution

Only after IIIA/IIIB produce **large volumes of real** admitted, replayable execution artifacts (not tests).

**Absolute invariant:**

```
Evolution SHALL NEVER execute against production state.
```

Always:

```
Replay → Candidate → Evaluation → Admission → Promotion
```

```
Execution → Metrics → Replay → Candidate → Evaluation → Admission → Promotion
```

Evolution = **create better candidates**. Never mutate live production directly.

### IIID — Adaptive Platform (Self Optimization)

**Separate from Evolution.** Only after IIIC is established.

| Evolution (IIIC) | Adaptive (IIID) |
|------------------|-----------------|
| Generate better candidates | Choose better strategies **under drift** |
| Offline evaluate → promote | Runtime strategy selection |

**Adaptive Platform MAY optimize:**

- retrieval · cache · workflow ordering · ranking  

**Adaptive Platform SHALL NOT:**

- modify Frozen Core  
- modify Registry Releases  
- modify Capability Definitions  
- modify Rule Definitions  
- modify Artifact Identity  

---

## Epoch IV — Ecosystem Platform (long-term)

After motor + knowledge are solid:

| Area | Examples |
|------|----------|
| External integrations | Authority / partner systems |
| Public / partner APIs | Stable external contracts |
| Plugin / capability ecosystem | Third-party capabilities under registry admission |
| Partner connections | Onboarding, trust, tenancy |
| Additional client applications | Beyond primary product shell |

Keeps Epochs I–III focused: first motor, then knowledge, then ecosystem.

---

## Separation of concerns

| Epoch | Builds | Does not build |
|-------|--------|----------------|
| **II** | Domain-agnostic Execution Platform (infra, contracts, registry, Mimers, capability, workflow, projection, observability, security) | Knowledge harvest, assessment libraries, evolution, ecosystem |
| **III** | Knowledge foundation → assessments → evolution → adaptive | A second execution motor; partner ecosystem |
| **IV** | Ecosystem (APIs, plugins, partners, multi-client) | Replacing the motor or Frozen Core |

New services SHOULD become capabilities, workflows, rules, and projections on a finished platform — not special-cased engines.
