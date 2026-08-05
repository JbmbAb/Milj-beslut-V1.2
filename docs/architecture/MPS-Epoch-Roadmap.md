# MPS Epoch Roadmap — Execution Platform & Knowledge Platform

Canonical multi-epoch roadmap after **Execution Kernel v1.0 – LU Cutover Complete** (ADR-30).

| Epoch | Name | Goal | Status |
|-------|------|------|--------|
| **I** | Frozen Core + LU Runtime | First domain on a single execution spine | ✅ **Closed** |
| **II** | **Execution Platform** | Universal execution platform for any miljöprocess | 🟡 **Active** |
| **III** | Knowledge Platform | Data foundation → assessments → evolution → adaptive | 🔵 **Later** |
| **IV** | Ecosystem Platform | External APIs, plugins, partners, multi-client | ⚪ **Long-term** |

Governing ADRs: [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) · [ADR-31](./ADR-31-Post-LU-Platform-Infrastructure-Focus.md)

**Naming note:** Epoch II is *Execution Platform*, not “Platform Kernel”.  
`ExecutionKernel` is one component inside the platform (alongside Queue, Registry, Workflow, Projection, …).

---

## Epoch I ✅ Frozen

| Deliverable | Notes |
|-------------|--------|
| Frozen Core | Package24 / identity contracts |
| LU Runtime v1 | Reference client only |
| ExecutionKernel v1 | Normative motor API (component) |
| Mimers CAS | Sole artifact store for kernel writes |
| Replay + Admission | On the production path |

**Discipline:** Do not reopen LU Runtime v1 for motor experiments.

---

## Epoch II — Execution Platform

**Mål:** en **generell exekveringsplattform** — inte bara en kernel-komponent.  
Detta är **inte** LU-arbete. LU är bara första klienten.

**Definition of Done:** *Execution Platform v1* — vilken miljöprocess som helst kan köras på samma plattform (Queue → Registry → Capability → Workflow → CAS → Projection → UI).

### Normative build order

```
2.1 Execution Infrastructure
        ↓
2.2 Execution Model
        ↓
2.3 Registry Runtime
        ↓
2.4 Capability Runtime
        ↓
2.5 Workflow Runtime
        ↓
2.6 Mimers Integration
        ↓
2.7 Projection Layer
        ↓
2.8 Runtime Observability
```

Registry precedes Capability/Workflow so the registry is the sole truth before workflows become general. Hard-coded capability/workflow bindings are removed in this epoch.

### 2.1 Execution Infrastructure

| Component | Responsibility |
|-----------|----------------|
| **ExecutionQueue v1** | Durable ticket ingress / ordering |
| **LeaseManager** | Worker leases with timeout reclaim |
| **RetryEngine** | Deterministic retry policy |
| **IdempotencyManager** | Duplicate-safe enqueue / complete |
| **Crash Recovery** | Resume after process death without information loss |
| **Replay Scheduler** | Schedule / drive replay without mutating domain logic |

**Resultatinvariant:** En execution SHALL kunna återupptas efter processkrasch utan informationsförlust.

Baseline today: Prisma/file `ExecutionTicketQueue` + lease timeout + adversarial tests.

### 2.2 Execution Model

Semantic model central to everything later (aligns with ADR-29 freeze + extensions):

| Identity / concept | Role |
|--------------------|------|
| **ExecutionManifest** | What is admitted to run |
| **ExecutionAttempt** | One try at a manifest |
| **ExecutionOutcome** | Result of an attempt |
| **ExecutionSession** | Correlates related attempts / tickets / replays |
| **ReplayIdentity** | Replay artifact identity / equivalence proof binding |
| **TicketIdentity** | Durable queue ticket bound to a manifest |

This is the *semantic* surface. Infrastructure (2.1) implements durability around it; registries and workflows resolve against it.

### 2.3 Registry Runtime

Registry becomes the **only** runtime source of truth (before capabilities/workflows go fully general):

| Registry | Role |
|----------|------|
| Capability Registry | Versioned capability definitions |
| Workflow Registry | Workflow definitions / graphs |
| Rule Registry | Conformance / domain rule bindings |
| Provider Registry | Spatial / document / external providers |
| Release Registry | Release-bound snapshots |

**Invariant:** ExecutionKernel SHALL NOT know concrete implementations — only resolve via registry + ports.

### 2.4 Capability Runtime

Capabilities are fully generic. Same runtime for LU · Avlopp · C-anmälan · Kontrollplan · …

**Invariant:** No domain code inside runtime. Domains register implementations; kernel only invokes via ports.

### 2.5 Workflow Runtime

Real WorkflowEngine (not contracts alone):

```
Workflow → Step 1 → Step 2 → Step 3 → Artifacts → Replay
```

Requires registry-backed step resolution, deterministic order, full-workflow replay.

### 2.6 Mimers Brunn Integration

Kernel SHALL never talk directly to PostGIS or files:

```
ArtifactRepository → Resolver → CAS → Mimers Brunn
```

Providers and harvest sit *outside* the kernel; they produce artifacts that enter CAS.

### 2.7 Projection Layer

Explicit separation of execution truth from product surfaces:

```
Execution → Artifacts → Projection → UI
```

**Not** `Execution → UI`.

Projections adapt artifacts for LuWorkspace, future assessment UIs, audit viewers, etc., without becoming a second source of truth. Aligns with `mps-ui-contract` adapters.

### 2.8 Runtime Observability

Complete without mutating artifact identity:

- Replay logs · execution graph · lineage · deterministic tracing  

Observability is a projection/side channel — not artifact mutation.

---

## Epoch III — Knowledge Platform

**Start only when Epoch II’s Execution Platform v1 is done.**  
Then grow knowledge — not the other way around.

### IIIA — Knowledge Foundation (data layer)

| Area | Scope |
|------|--------|
| Harvester | Ingest into Mimers / CAS |
| Document Intelligence | Metadata, versions, relations, legal refs, document lineages |
| Spatial Intelligence | SGU, NV, länsstyrelser, SMHI, hydrologi, klimat, historiska kartor, … |
| Evidence relations | Cross-links between spatial / document / execution evidence |
| Knowledge Graph | Structured knowledge over CAS evidence |

```
Harvester → CAS → Evidence → Spatial → Documents → Knowledge Graph
```

Offline-first on riktigt.

### IIIB — Assessment Platform

LU is the first assessment. Same Execution Platform for:

Lokaliseringsutredning · Avlopp · C-anmälan · Natura 2000 · Kontrollplan · Förorenad mark · Vattenskydd · Artskydd · …

**Without a new motor** — new domain rules + workflows + projections only.

### IIIC — Evolution

Only after IIIA/IIIB produce **large volumes of real** admitted, replayable execution artifacts (not tests):

```
Execution → Metrics → Replay → Candidate → Evaluation → Admission → Promotion
```

Evolution MUST NOT change production directly:

```
Replay → Verifiering → Admission → Promotion
```

Evolution = **create better candidates**.

### IIID — Adaptive Platform (Self Optimization)

**Separate from Evolution.** Only after IIIC is established.

| Evolution (IIIC) | Adaptive / Self Optimization (IIID) |
|------------------|--------------------------------------|
| Generate better candidates offline | Choose better strategies **under drift** |
| Candidate → evaluate → promote | Retrieval / workflow / cache / search tuning |

May tune: retrieval strategies, workflows, search params, indexes, cache strategies.  
**MUST NOT** self-modify Frozen Core or other governing contracts.

---

## Epoch IV — Ecosystem Platform (long-term)

Kept out of I–III so those epochs stay focused on motor + knowledge:

| Area | Examples |
|------|----------|
| External integrations | Authority / partner systems |
| Public / partner APIs | Stable external contracts |
| Plugin / capability ecosystem | Third-party capabilities under registry admission |
| Partner connections | Onboarding, trust, tenancy |
| Additional client applications | Beyond primary Mimer product shell |

Epoch IV broadens the platform **after** Execution Platform + Knowledge Platform are solid.

---

## Separation of concerns

| Epoch | Builds | Does not build |
|-------|--------|----------------|
| **II** | Execution platform (infra, model, registry, capability, workflow, CAS, projection, observability) | Knowledge harvest, assessment libraries, evolution, ecosystem |
| **III** | Knowledge foundation → assessments → evolution → adaptive strategies | A second execution motor; partner ecosystem |
| **IV** | Ecosystem (APIs, plugins, partners, multi-client) | Replacing the motor or Frozen Core |

New services SHOULD become new domain rules, workflows, and projections on a finished platform — not special-cased implementations.
