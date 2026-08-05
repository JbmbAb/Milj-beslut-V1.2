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
| **II** | **Execution Platform** | Universal, domain-agnostic execution platform | 🟡 **Active** |
| **III** | Knowledge Platform | Data → assessments → evolution → adaptive | 🔵 **Later** |
| **IV** | Ecosystem Platform | External APIs, plugins, partners, multi-client | ⚪ **Long-term** |

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

## Epoch II — Execution Platform

**Mål:** en **generell, domänagnostisk exekveringsplattform**.  
Inte LU-arbete. LU är referensklient / Assessment Capability.

**Definition of Done:** *Execution Platform v1* — vilken miljöprocess som helst kan köras via samma plattform utan domänkod i runtime.

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

### 2.4 Mimers Brunn Integration

Kernel SHALL never talk directly to PostGIS or files:

```
ArtifactRepository → Resolver → CAS → Mimers Brunn
```

Providers and harvest sit *outside* the platform; they produce artifacts that enter CAS. Capability/Workflow runtimes consume only repository ports backed by Mimers.

### 2.5 Capability Runtime

Capabilities are fully generic. Domains (LU, avlopp, C-anmälan, …) register implementations.

**Invariant:** No domain-specific logic inside the Execution Platform.

### 2.6 Workflow Runtime

Real WorkflowEngine:

```
Workflow → Step 1 → Step 2 → Step 3 → Artifacts → Replay
```

Registry-backed step resolution, deterministic order, full-workflow replay — against Mimers-backed ArtifactRepository.

### 2.7 Projection Layer

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

### 2.8 Runtime Observability

Without mutating artifact identity:

- Replay logs · execution graph · lineage · deterministic tracing  

Side channel / projection — not a second source of truth.

### 2.9 Execution Platform Security

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

---

## Epoch III — Knowledge Platform

**Start only when Epoch II’s Execution Platform v1 is done.**

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
