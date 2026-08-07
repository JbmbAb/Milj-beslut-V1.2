# ADR-MPS-022: Package 22 — Diagnostic Governance Layer

| Field | Value |
| --- | --- |
| **Status** | **FROZEN** |
| **Date** | 2026-08-07 |
| **Revision** | 022.1 — 22.1–22.4 implemented; 22.5 Replay Differential paused |
| **Owner** | MPS Architecture Governance |
| **Scope** | Diagnostic evidence for harvest/governance/runtime executions |
| **Depends on** | ADR-MPS-CORE-001, Package 21 Control Plane / replay contracts, Mimers Brunn v2.0.1 |
| **Non-goals** | Mutating Package 21 replay; treating logs as truth; early Replay Differential |

---

## 0. Frozen architecture boundary

```text
                 PACKAGE 21
              Replay Truth
ExecutionManifest
        |
        v
ReplayEngine
        |
        v
Historical Result

                 PACKAGE 22
            Diagnostic Truth
Execution
        |
        v
ExecutionEventLog
        |
        v
FailureArtifact
        |
        v
Root Cause Evidence
```

| Package | Question |
| --- | --- |
| **P21 Replay** | “Kan vi bevisa vad som hände?” |
| **P22 Diagnostics** | “Kan vi bevisa varför det hände?” |

**Shared references (allowed):** `execution_id`, `artifact_hash`, `ledger_sequence`

**Hard rules:**

- P21 MUST NEVER read P22 to produce a replay result.
- P22 MUST NEVER modify P21 identity.
- P22 may only **observe and prove**.

This is the dual-track model.

---

## 1. Decision

Package 22 is a **separate governance evidence layer**, not “better logging”.

It answers:

> Why did this execution land here, which step caused it, which rule stopped it, which evidence was used, and can we prove that after the fact?

---

## 2. Principles (normative)

### P22-1 — Dual track isolation

Diagnostic artifacts SHALL NOT modify replay identity.

### P22-2 — Event ordering

`ExecutionEvent.sequence` SHALL define order. Timestamp SHALL NOT define order.

### P22-3 — Event immutability / governance stream

`ExecutionEventLog` is an **immutable append-only governance evidence stream**.

```text
❌ application log → database table

✅ State transition
      → Canonical Event
      → Canonical serialization
      → Content hash
      → Immutable Event Record
```

Committed event sequence **N** MUST NEVER change after commit.

### P22-4 — Failure evidence integrity

`FailureArtifact` is a CanonicalArtifact. Terminal `BLOCKED` SHOULD reference at least one FailureArtifact.

### P22-5 — Error identity stability

Error codes SHALL remain semantically stable. Meaning changes require a new code (deprecate old; introduce new).

### P22-6 — Correlation completeness

```text
request_id → execution_id → event_sequence → artifact_hash → ledger_sequence
```

---

## 3. ExecutionEvent (22.1)

### Identity (enters hash)

```ts
type ExecutionEventIdentity = {
  execution_id: string;
  sequence: number;
  from_state: HarvestExecutionState;
  to_state: HarvestExecutionState;
  stage: ExecutionStage;
  input_refs: readonly ContentReference[];
  output_refs: readonly ArtifactReference[];
  previous_event_hash?: string;
  transition_hash: string;
};
```

### Metadata (excluded from identity hash)

```ts
type ExecutionEventMetadata = {
  occurred_at: Timestamp;
  actor: string;
  runtime_version?: string;
  request_id?: string;
};
```

`sequence` is truth. Not `occurred_at`.

`previous_event_hash` chains to prior event’s `transition_hash` (undefined for sequence 1). Complements EventLedger; does not replace it.

---

## 4. FailureArtifact (22.2 — implemented)

**Home:** `packages/mps-diagnostics/` — `FailureArtifact.ts`, `FailureArtifactBuilder.ts`, `canonicalFailureIdentity.ts`

### Identity

```ts
type FailureArtifactIdentity = {
  failure_code: string;
  stage: ExecutionStage;
  execution_id: string;
  input_refs: ContentReference[];
  evidence_refs: ArtifactReference[];
  failed_controls: string[];
  diagnostics: Json;
};
```

### Metadata

```ts
type FailureArtifactMetadata = {
  created_at: Timestamp;
  host?: string;
  runtime_version?: string;
  request_id?: string;
};
```

**MUST NOT enter hash:** stack traces, file paths, hostname, timestamps, random IDs.

### Conformance (22.2)

| ID | Rule |
| --- | --- |
| **F22-1** | Identity determinism — same failure identity ⇒ same `artifact_hash` |
| **F22-2** | Metadata isolation — `created_at`/host/runtime/request change ⇒ same hash |
| **F22-3** | Evidence binding — `input_ref` change ⇒ new hash |
| **F22-4** | Diagnostic canonicalization — key order irrelevant (`{a:1,b:2}` = `{b:2,a:1}`) |
| **F22-5** | BLOCKED ⇒ `FailureArtifactReference` **REQUIRED** in Diagnostic Governance (`ExecutionEventLog`), **never** in ReplayEngine |

Chain after 22.2:

```text
request_id → execution_id → ExecutionEventLog → transition → BLOCKED
  → FailureArtifact → failure_code → evidence_refs
```

---

## 5. FailureCodeRegistry (22.3 — implemented)

**Home:** `FailureCodeTypes.ts`, `FailureCodeRegistry.ts`, `registry/failure-codes.ts`

MPS registry (not a bare enum). Answers only: *What does this code mean?*  
MUST NOT create FailureArtifacts. MUST NOT put severity/retry/ownership into FailureArtifact identity.

```ts
interface FailureCodeRegistry {
  readonly registry_version: string; // "1"
  resolve(code: string): FailureCodeDefinition;
  exists(code: string): boolean;
}
```

| ID | Rule |
| --- | --- |
| **F22-6** | A `failure_code` SHALL have exactly one semantic meaning; meaning change ⇒ new code |
| **F22-6.1** | Unknown code ⇒ `resolve` throws |
| **F22-6.2** | Known code meaning is stable |
| **F22-6.3** | Duplicate code definitions at registry build ⇒ throw |
| **F22-6.4** | `registry_version` exposed for catalog verification |

Chain after 22.3:

```text
Execution → Event Timeline → FailureArtifact → FailureCodeRegistry → Governed Meaning
```

---

## 5b. CorrelationContext (22.4 — implemented)

**Home:** `CorrelationContext.ts`, `CorrelationResolver.ts`

Correlation is **navigation / observability**, not identity.

| Identity Truth | Correlation Truth |
| --- | --- |
| P21 Replay hashes, P22 artifact/transition hashes | How to find things |

Frozen chain:

```text
request_id → execution_id → event_sequence → artifact_hash → ledger_sequence
```

Optional `trace_root_id` for future OTEL — transport only, never hashed.

| ID | Rule |
| --- | --- |
| **F22-7** | Correlation metadata SHALL NOT participate in artifact identity hashing |
| **F22-7.1** | request_id → execution_id |
| **F22-7.2** | execution_id → event sequences |
| **F22-7.3** | execution_id → failure artifact hashes |
| **F22-7.4** | Correlation mutation does not change identity hash |

Resolver builds search paths only — does not create truth.

Chain after 22.4:

```text
Request → Execution → Timeline → Failure Evidence → Failure Meaning → Trace Navigation
```

---

## 6. Conformance invariants (frozen)

| ID | Rule |
| --- | --- |
| **P22-C1** | Dual Track Isolation — Diagnostic artifacts SHALL NOT modify replay identity. |
| **P22-C2** | Event Ordering — `sequence` defines order; timestamp does not. |
| **P22-C3** | Event Immutability — Committed events SHALL NOT mutate. |
| **P22-C4** | Failure Evidence Integrity — Diagnostic track: `BLOCKED` transitions REQUIRE `FailureArtifactReference` (F22-5). ADR “SHOULD” remains for non-event administrative edges outside the log. |
| **P22-C5** | Error Identity Stability — codes semantically stable; meaning change ⇒ new code. |
| **P22-C6** | Correlation Completeness — `request_id` traceable through the frozen chain. |

---

## 7. Implementation order

```text
22.1 ExecutionEvent.ts + ExecutionEventLog.ts   ← DONE
22.2 FailureArtifact.ts (+ Builder, canonical identity, BLOCKED bind)  ← DONE
22.3 FailureCodeRegistry.ts                     ← DONE
22.4 CorrelationContext.ts                      ← DONE
22.5 ReplayDifferential.ts                      ← PAUSED (needs stable policy/error registries + event history)
```

Replay Differential requires stable Policy/Rule/Error registries + event history + manifest identity.

---

## 8. Package home

`packages/mps-diagnostics/` — isolated; MUST NOT import Package 21 replay mutators.

---

## 9. References

- `docs/architecture/ADR-MPS-CORE-001.md`
- `packages/mps-data-governance/src/HarvestOrchestratorTypes.ts`
- `docs/architecture/mimers-brunn-v2.0.1.md`
