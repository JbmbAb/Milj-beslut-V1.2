# Mimers Brunn v9 — drift & recovery runbook

**ADR:** [ADR-042](../architecture/ADR-042-mimers-brunn-v9.md)  
**Scope:** CAS + FileEventLog + dual-write evolve bridge + ArtifactStore→CAS migration  
**Language:** Treat as **produktionsklassad arkitektur** with platform-specific durability notes below. Say **produktionstestad** only for the OS/durability matrix row you actually ran (`npm run mimers:bench` + fault-injection tests).

## Layout

```text
<mimers-root>/
  cas/                 FileCASRepository (objects/ + tmp/)
  ledger/              FileEventLog (events/NNNNNNNN.json + tmp/)

<artifact-root>/
  promotion/sha256:…   WORM V3 index (unchanged by migration)
  mimers-binding/…     Side-car CAS/ledger pointers (lazy/one-shot migration)
  migration-report/…   Human-readable copy of CAS migration report
```

Create backend:

```bash
# programmatic: createPersistentMimersBackend(root, { durabilityMode })
```

## Durability support matrix

| Mode | Meaning | Windows (NTFS) | Linux |
| --- | --- | --- | --- |
| `none` | No file/dir fsync — tests only | OK for unit/CI | OK for unit/CI |
| `best-effort` | fsync when possible; log and continue on dir sync errors | **Default for local Windows** — dir `fsync` often `EPERM`/`EINVAL` | Prefer for desktops |
| `strict` | Dir fsync failure → `DurabilityError` | Not recommended unless verified | **Preferred for Linux production** |

Hard links: CAS and ledger use `link(temp, dest)`. `tmp/` and `objects/` / `events/` **must** share a filesystem (asserted at CAS init).

## Daily health (fast path)

Never run full L3 on the request path.

1. Open `FileEventLog` / call `initialize()` — fails closed on chain break (`LedgerCorruptionError`).
2. `RecoveryOrchestrator.auditL0()` — hash chain only.
3. Optional: `auditL1()` — ledger refs exist in CAS.

```text
L0 CLEAN + L1 CLEAN  →  serve
L0/L1 CORRUPTED      →  page ops, do not auto-repair silently
```

## Drift / incident playbooks

### A. Ledger hash chain broken

Symptoms: `LedgerCorruptionError` on reload; L0 `CORRUPTED`.

1. Stop writers to that ledger directory.
2. Copy `ledger/` to forensic quarantine (preserve evidence).
3. Identify first bad `events/NNNNNNNN.json` (gap, truncate, or hash mismatch).
4. Restore from last known-good backup **or** rebuild from CAS promotions via re-seal only if business accepts a new genesis (document in a migration report).
5. Do **not** hand-edit event JSON.

### B. CAS bitrot / size mismatch

Symptoms: L2/L3 `bitrot` or descriptor size errors.

1. Quarantine: move corrupt object out of `cas/objects/` (keep bytes).
2. If content is recoverable from ArtifactStore / upstream, re-`put` via `ManifestBuilder` / `FileCASRepository.put` (idempotent for identical bytes).
3. Re-run `auditL2` then `auditL3`.
4. If promotion index points at missing CAS object, run lazy binding: `ensurePromotionMimersBinding`.

### C. Dual-write lag (V3 without Mimers binding)

Symptoms: `promotion/sha256:…` exists; no `manifestHash` / no `mimers-binding/`.

```bash
# dry-run
npm run mimers:migrate-cas -- --artifacts <artifact-root> --mimers <mimers-root> --dry-run

# apply (forbidden at process startup — operator only)
npm run mimers:migrate-cas -- --artifacts <artifact-root> --mimers <mimers-root>
```

WORM keys under `promotion/` are never rewritten. Bindings land under `mimers-binding/`; report is CAS-addressed.

### D. Crash between CAS put and ledger append

Expected: CAS object exists; no ledger event. Retry `EvolutionLedger.commitPromotion` / `MimersPromotionBackend.seal` with same content → idempotent ledger append (`findByPromotionHash` / content address).

### E. Parallel workers

In-process: `EvolutionLedger` serializes commits. Cross-process: rely on CAS `EEXIST` same-bytes and FileEventLog immutable seq files. Prefer single writer per ledger directory.

## Recovery levels

| Level | Command surface | When |
| --- | --- | --- |
| L0 | `auditL0()` | Every process start / deploy probe |
| L1 | `auditL1()` | After deploy, before enabling writers |
| L2 | `auditL2({ signing, requireSignatures })` | Weekly / after key rotation |
| L3 | `auditL3({ concurrency })` | Background scrub; abortable |

## Regression gate

```bash
npm run mimers:bench
```

Fails if put/append/L0 budgets regress beyond thresholds in `scripts/mimers/regression-benchmark.ts`.

## Related tests

- `tests/unit/mimers/fault-injection.test.ts` — crash/EEXIST/EXDEV/bitrot/signatures  
- `tests/unit/mimers/file-event-log.test.ts` — persistent ledger reload  
- `tests/unit/mimers/migrate-artifact-store-to-cas.test.ts` — lazy + one-shot migration  
- `tests/unit/evolvePhase3.test.ts` — dual-write orchestrator path  
