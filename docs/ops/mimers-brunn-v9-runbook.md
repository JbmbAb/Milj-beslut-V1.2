# Mimers Brunn v9 — drift & recovery runbook

**ADR:** [ADR-042](../architecture/ADR-042-mimers-brunn-v9.md)  
**Scope:** CAS + FileEventLog + **CAS-primary** evolve bridge (V3 as index) + ArtifactStore→CAS migration  
**Language:** Treat as **produktionsklassad arkitektur** with platform-specific durability notes below. Say **produktionstestad** only for the OS/durability matrix row you actually ran. Sovereign Edition requires proven properties — see [Definition of Done](../architecture/mimers-brunn-v9-sovereign-definition-of-done.md).

## CAS-primary identity chain

```text
Domain payload
  → ManifestBuilder (fluent) / DescriptorFactory
  → CAS (bytes)
  → Mimers Promotion (CAS)
  → EvolutionLedger / EventLog
  → PromotionArtifactV3 index + mimers-binding/ sidecar
```

All durable identities are CAS digests. FileArtifactStore `promotion/` keys are WORM indexes, not source of truth.

## Layout

```text
<mimers-root>/
  cas/                 FileCASRepository (objects/ + tmp/)
  ledger/
    segments/NNNNNNNN/ append-only event segments + MANIFEST.json (default)
    checkpoints/NNNNNNNN.json  chained Merkle roots (signed when configured)
    events/            legacy flat layout (readable; adopted as closed segment 1)
    tmp/               durable commit scratch

<artifact-root>/
  promotion/sha256:…   WORM V3 index (unchanged by migration)
  mimers-binding/…     Side-car CAS/ledger pointers (lazy/one-shot migration)
  migration-report/…   Human-readable copy of CAS migration report
```

Create backend:

```bash
# env opt-in (recommended for local/prod dual-write)
# MIMERS_ROOT=./tmp-mimers
# MIMERS_DURABILITY_MODE=best-effort   # or strict on Linux
# MIMERS_REQUIRED=true                 # fail-closed: no MIMERS_ROOT → throw

# programmatic
# createPersistentMimersBackend(root, { durabilityMode, maxEventsPerSegment: 1000 })
# resolveMimersBackendFromEnv({ fallbackRoot })
# requireMimersBackendFromEnv({ fallbackRoot })  # CAS-primary
# verifyPromotionAgainstBackend(artifact, backend, { verifyDescriptors: true })
```

`FileEventLog` rotates closed segments every `maxEventsPerSegment` (default 1000). On each close it writes a **chained Merkle checkpoint** (`rootHash` + `previousRoot`) under `ledger/checkpoints/`. Use `listSegments()` / `listCheckpoints()` for ops; hash chain + checkpoint chain are verified on reload.

Wrap ArtifactStore with `PolicyEnforcingArtifactStore` so `promotion/` is WORM (no overwrite/delete). With Mimers sealed, V3 is an **index** (`manifestHash` + `metadata.mimersPromotionHash`); use `verifyPromotionAgainstCas` / `verifyPromotionAgainstBackend` to assert CAS truth.
## Durability support matrix

| Mode | Meaning | Windows (NTFS) | Linux |
| --- | --- | --- | --- |
| `none` | No file/dir fsync — tests only | OK for unit/CI | OK for unit/CI |
| `best-effort` | fsync when possible; log and continue on dir sync errors | **Default for local Windows** — dir `fsync` often `EPERM`/`EINVAL` | Prefer for desktops |
| `strict` | Dir fsync failure → `DurabilityError` | Not recommended unless verified | **Preferred for Linux production** |

Linux strict: PROVEN på ubuntu-latest via `.github/workflows/mimers-sovereign.yml` ([run 30475536400](https://github.com/JbmbAb/Milj-beslut-V1.2/actions/runs/30475536400)) med `MIMERS_REQUIRE_LINUX_STRICT=true npm run mimers:durability-matrix`.

Hard links: CAS and ledger use `link(temp, dest)`. `tmp/` and `objects/` / `events/` / `segments/` **must** share a filesystem (asserted at CAS init).

### Platform proofs (§6)

```bash
npm run mimers:backup-restore
npm run mimers:durability-matrix
npm run mimers:sovereign
# NFS / shared FS (requires real mount):
# MIMERS_NFS_ROOT=/mnt/mimers-nfs npm run mimers:nfs-proof
# Also exercises durability-matrix NFS cell:
# MIMERS_NFS_ROOT=/mnt/mimers-nfs npm run mimers:durability-matrix
# Linux CI forces strict:
# MIMERS_REQUIRE_LINUX_STRICT=true npm run mimers:durability-matrix
# Third-party handoff:
# npm run mimers:audit-bundle -- --root <mimers-root>
```

CI workflow: [`.github/workflows/mimers-sovereign.yml`](../../.github/workflows/mimers-sovereign.yml) (ubuntu-latest).

External auditor: [external-audit-checklist](./mimers-brunn-v9-external-audit-checklist.md) · `npm run mimers:audit-bundle`.

NFS / shared FS: [nfs-validation](./mimers-brunn-v9-nfs-validation.md) · `MIMERS_NFS_ROOT=… npm run mimers:nfs-proof`.

| Check | Pass criteria |
| --- | --- |
| Backup/restore | Offline copy of `cas/`+`ledger/` → wipe live → restore → identical Merkle/hashes + CLEAN |
| Durability `none` / `best-effort` | Write+reload PROVEN on current OS |
| Durability `strict` | **PROVEN on Linux CI** ([run 30475536400](https://github.com/JbmbAb/Milj-beslut-V1.2/actions/runs/30475536400)); UNSUPPORTED acceptable on Windows NTFS |
| NFS/failover | `mimers:nfs-proof` with real mount → `ok: true` + evidence JSON |

### Fas 4 acceptance gate

```bash
npx vitest run tests/unit/mimers/fas4-acceptance.test.ts
npm run mimers:verify
npm run mimers:cold-start
npm run mimers:ops-proof
npm run mimers:backup-restore
npm run mimers:durability-matrix
npm run mimers:bench
npm run evolve:integration
```

| Check | Pass criteria |
| --- | --- |
| Byte-CAS | `putBytes` roundtrip + `putCanonical` digest stable |
| Builder | Fluent ManifestBuilder via DescriptorFactory |
| Segments | Rotation + reload hash chain CLEAN |
| Checkpoints | `previousRoot` chain across closed segments |
| Recovery | `recoverFromLedger()` CLEAN for healthy ledger |
| UUIDProvider | `setUUIDProvider` swaps event ids without ledger rewrite |
| External verify (§1/§5) | `mimers:verify` CLEAN without ArtifactStore/DB |
| Cold-start (§3) | Empty node from CAS+ledger only → identical hashes |
| Multi-segment + ckpt recovery (§3) | `mimers:ops-proof`: Merkle/hashes match; checkpoint ≡ full replay |
| Fault injection (§2/§4) | Corrupt segment / truncated write / missing ckpt (fail-closed vs backfill) |
| Backup/restore (§6) | `mimers:backup-restore` identical after wipe |
| Durability matrix (§6) | `mimers:durability-matrix` platform gate OK |

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

1. Run L3 with quarantine (moves corrupt bytes under `cas/quarantine/`, keeps evidence):

```ts
await recovery.auditL3({ quarantine: true });
```

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

## Recovery levels (Verifier → Repair → Recovery)

| Component | Surface | Role |
| --- | --- | --- |
| **IntegrityVerifier** | `auditL0` / `auditL1` / `auditL2` | Hash chain, CAS existence, crypto — no mutation |
| **CasRepair** | `auditL3({ quarantine })` / `quarantineDigests` | Scrub + quarantine corrupt objects |
| **SystemRecovery** | `recoverFromLedger()` | Ledger→CAS reconstitution report |

`RecoveryOrchestrator` is the facade (`verifier` / `repair` / `recovery` fields + legacy `auditL*`).

| Level | Command surface | When |
| --- | --- | --- |
| L0 | `auditL0()` | Every process start / deploy probe |
| L1 | `auditL1()` | After deploy, before enabling writers |
| L2 | `auditL2({ signing, requireSignatures })` | Weekly / after key rotation |
| L3 | `auditL3({ concurrency, quarantine })` | Background scrub; abortable |
| Full | `recoverFromLedger()` | Incident: prove which events are reconstitutable |

## Regression gate

```bash
npm run mimers:bench
```

Fails if put/append/L0 budgets regress beyond thresholds in `scripts/mimers/regression-benchmark.ts`.

## Related tests

- `tests/unit/mimers/fault-injection.test.ts` — crash/EEXIST/EXDEV/bitrot/signatures  
- `tests/unit/mimers/file-event-log.test.ts` — persistent ledger reload + segments/checkpoints  
- `tests/unit/mimers/fas4-acceptance.test.ts` — M1–M7 acceptance gate  
- `tests/unit/mimers/migrate-artifact-store-to-cas.test.ts` — lazy + one-shot migration  
- `tests/unit/evolvePhase3.test.ts` — CAS-primary orchestrator path  
