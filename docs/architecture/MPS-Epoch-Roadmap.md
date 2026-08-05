# MPS Epoch Roadmap — Platform Kernel & Knowledge Platform

Canonical multi-epoch roadmap after **Execution Kernel v1.0 – LU Cutover Complete** (ADR-30).

| Epoch | Name | Goal | Status |
|-------|------|------|--------|
| **I** | Frozen Core + LU Runtime | First domain on a single execution spine | ✅ **Closed** |
| **II** | Platform Kernel | Universal execution motor for any miljöprocess | 🟡 **Active** |
| **III** | Knowledge Platform | Knowledge, assessments library, evolution | 🔵 **Later** |

Governing ADRs: [ADR-30](./ADR-30-LU-Runtime-v1-Freeze-ExecutionKernel-Cutover.md) · [ADR-31](./ADR-31-Post-LU-Platform-Infrastructure-Focus.md)

---

## Epoch I ✅ Frozen

| Deliverable | Notes |
|-------------|--------|
| Frozen Core | Package24 / identity contracts |
| LU Runtime v1 | Reference client only |
| ExecutionKernel v1 | Normative motor API |
| Mimers CAS | Sole artifact store for kernel writes |
| Replay + Admission | On the production path |

**Discipline:** Do not reopen LU Runtime v1 for motor experiments.

---

## Epoch II — Platform Kernel (Generalisering)

**Mål:** göra ExecutionKernel till plattformens **universella** exekveringsmotor.  
Detta är **inte** LU-arbete. LU är bara första klienten.

**Definition of Done (Epoch II):** *Execution Platform v1* — en generell motor som kan köra vilken miljöprocess som helst, inte bara LU.

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

Baseline today: Prisma/file `ExecutionTicketQueue` + lease timeout + adversarial tests. Epoch II hardens this into the full stack above.

### 2.2 Workflow Runtime

Implement the **real** WorkflowEngine (not contracts alone):

```
Workflow → Step 1 → Step 2 → Step 3 → Artifacts → Replay
```

Requirements: multi-capability execution graph, deterministic step order, full-workflow replay.

### 2.3 Capability Runtime

Capabilities are fully generic. Same runtime for:

- LU · Avlopp · C-anmälan · Kontrollplan · …

**Invariant:** No domain code inside runtime. Domains register implementations; kernel only invokes via ports.

### 2.4 Registry Runtime

Registry becomes the runtime source of truth:

| Registry | Role |
|----------|------|
| Capability Registry | Versioned capability definitions |
| Workflow Registry | Workflow definitions / graphs |
| Rule Registry | Conformance / domain rule bindings |
| Provider Registry | Spatial / document / external providers |
| Release Registry | Release-bound snapshots |

**Invariant:** ExecutionKernel SHALL NOT know concrete implementations — only resolve via registry + ports.

### 2.5 Mimers Brunn Integration

Kernel SHALL never talk directly to PostGIS or files:

```
ArtifactRepository → Resolver → CAS → Mimers Brunn
```

Providers and harvest sit *outside* the kernel; they produce artifacts that enter CAS.

### 2.6 Runtime Observability

Complete without mutating artifact identity:

- Replay logs  
- Execution graph  
- Lineage  
- Deterministic tracing  

Observability is a projection layer — not a second source of truth.

### Epoch II build order (normative)

1. Execution Infrastructure (2.1)  
2. Workflow Runtime (2.2)  
3. Capability Runtime (2.3)  
4. Registry Runtime (2.4)  
5. Mimers Integration hardening (2.5)  
6. Observability (2.6)  

New ADRs in this epoch SHOULD target these workstreams, not LU-specific motor forks.

---

## Epoch III — Knowledge Platform

**Start only when Epoch II’s Execution Platform v1 is done.**  
Then the platform grows knowledge — not the other way around.

### 3.1 Mimers Brunn Expansion

National knowledge base, offline-first:

```
Harvester → CAS → Evidence → Spatial → Documents → Knowledge
```

### 3.2 Document Intelligence

Not only store documents — metadata, versions, relations, legal references, document lineages.

### 3.3 Spatial Intelligence

Expand geo layers: SGU, Naturvårdsverket, Länsstyrelser, SMHI, hydrologi, klimat, historiska kartor, …

### 3.4 Assessment Library

LU is the first assessment. Same motor for:

Lokaliseringsutredning · C-anmälan · Kontrollplan · Natura 2000 · Förorenad mark · Vattenskydd · Artskydd · …

**Without a new motor** — new domain rules + workflows only.

### 3.5 Evolution (only now)

Enough real admitted, replayable artifacts exist:

```
Execution → Metrics → Replay → Candidate → Evaluation → Admission → Promotion
```

Evolution MUST NOT change production directly. Always:

```
Replay → Verifiering → Admission → Promotion
```

### 3.6 Self Optimization

Only after 3.5. May propose / select:

- retrieval strategies · workflow tuning · search params · new rules · indexes · cache strategies  

**MUST NOT** self-modify Frozen Core or other governing contracts.

---

## Separation of concerns

| Epoch | Builds | Does not build |
|-------|--------|----------------|
| **II** | Technical execution platform | Domains, knowledge harvest, self-learning |
| **III** | Knowledge + intelligence on the platform | A second execution motor |

New services SHOULD become new domain rules and workflows on a finished motor — not special-cased implementations.
