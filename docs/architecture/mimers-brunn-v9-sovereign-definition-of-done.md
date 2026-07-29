# Mimers Brunn v9 — Definition of Done: Sovereign Edition

**Princip:** Arkitektur färdig ≠ egenskaper bevisade.  
Systemet är “klart” först när egenskaperna är demonstrerade under verkliga driftförhållanden — tillräckligt för juridisk, regulatorisk och långsiktig revisionsbörda.

**Fasbyte:** Det finns ingen uppenbar arkitektonisk “nästa stora komponent” kvar att bygga. Återstående arbete är **operativ validering**, **miljöspecifik robusthet** och **oberoende verifiering**.

**Identitetskedja (arkitektur):**

```text
Ledger event → promotionHash → CAS bytes
            → manifestHash → CAS bytes → descriptors → SHA-256
```

**Relaterat:** [ops-runbook](../ops/mimers-brunn-v9-runbook.md) · [external-audit-checklist](../ops/mimers-brunn-v9-external-audit-checklist.md) · [ADR-042](./ADR-042-mimers-brunn-v9.md) · [hardening-evaluation](./mimers-brunn-v9-sovereign-hardening-evaluation.md) · CI: [Mimers Sovereign Gate](https://github.com/JbmbAb/Milj-beslut-V1.2/actions/workflows/mimers-sovereign.yml)

---

## Statustecken

| Tecken | Betydelse |
| --- | --- |
| PROVEN | Automatiserat bevis finns och körs i CI/lokal gate |
| PARTIAL | Delbevis finns; lucka dokumenterad |
| UNPROVEN | Krävs för Sovereign DoD; ej ännu demonstrerat |

---

## Översikt

| Egenskap | Status | Bevis (test / script / CI / runbook) |
| --- | --- | --- |
| CAS-integritet | PROVEN | `tests/unit/mimers/cas-bytes.test.ts` · L2 · `npm run mimers:verify` · [runbook](../ops/mimers-brunn-v9-runbook.md) |
| Extern verifiering | PROVEN | `scripts/mimers/prove-external-verify.ts` · `npm run mimers:verify` · Sovereign Gate |
| Cold-start replay | PROVEN | `prove-cold-start-replay.ts` · `sovereign-dod-proofs.test.ts` · `npm run mimers:cold-start` |
| Multi-segment replay | PROVEN | `prove-ops-replay.ts` · `ops-proof-slice.test.ts` · `npm run mimers:ops-proof` |
| Checkpoint-baserad recovery | PROVEN | `buildCheckpointAcceleratedPlan` · ops-proof · [runbook](../ops/mimers-brunn-v9-runbook.md) |
| Merkle-kedjans korrekthet | PROVEN | chained checkpoints · ops-proof root match · Sovereign Gate |
| Linux `strict` durability | PROVEN | `MIMERS_REQUIRE_LINUX_STRICT=true npm run mimers:durability-matrix` via CI (Mimers Sovereign Gate, [run 30475536400](https://github.com/JbmbAb/Milj-beslut-V1.2/actions/runs/30475536400)) · [workflow](../../.github/workflows/mimers-sovereign.yml) |
| Backup/restore av CAS+ledger | PROVEN | `prove-backup-restore.ts` · `platform-ops-proofs.test.ts` · `npm run mimers:backup-restore` |
| Extern audit-checklista (procedur) | PROVEN | [external-audit-checklist](../ops/mimers-brunn-v9-external-audit-checklist.md) |
| NFS/failover | PARTIAL | Matris-cell SKIPPED utan mount; kör `MIMERS_NFS_ROOT=… npm run mimers:durability-matrix` |
| Oberoende tredjepartsrevision (signoff) | UNPROVEN | Extern part fyller i checklistan och bifogar `mimers:verify`-rapport |

Fault injection (korrupt segment / avbruten skrivning / saknad checkpoint) ingår i `mimers:ops-proof` och stödjer §2/§4.

### Återstår i praktiken

1. **NFS/failover** — verklig delad filsystemsmount + durability-matris.  
2. **Oberoende revision** — extern part verifierar beviskedjan och dokumenterar resultatet.  
3. ~~Linux `strict`~~ — PROVEN via CI.

---

## Beviskatalog (reproducerbar kedja)

Varje PROVEN-påstående ska kunna följas till körbart bevis:

| Gate | Kommando | CI |
| --- | --- | --- |
| Full sovereign svit | `npm run mimers:sovereign` | [mimers-sovereign.yml](../../.github/workflows/mimers-sovereign.yml) |
| Extern offline verify | `npm run mimers:verify -- --root <cas+ledger>` | Sovereign Gate step |
| Cold-start | `npm run mimers:cold-start` | Sovereign Gate step |
| Multi-segment + ckpt + faults | `npm run mimers:ops-proof` | Sovereign Gate step |
| Backup/restore | `npm run mimers:backup-restore` | Sovereign Gate step |
| Durability matrix | `npm run mimers:durability-matrix` | artifact `mimers-durability-matrix.json` |
| Unit proofs | `npx vitest run tests/unit/mimers/` | Sovereign Gate + `test-unit` |

**Referens-CI (Linux `strict` PROVEN):** [actions/runs/30475536400](https://github.com/JbmbAb/Milj-beslut-V1.2/actions/runs/30475536400) (`success`, ubuntu-latest).

---

## 1. Integritet (cryptographic integrity)

**Krav**

- Varje promotion kan verifieras: ledger-event → `manifestHash` → CAS-bytes → SHA-256
- Signaturer och attesteringar är deterministiskt reproducerbara
- Lineage är komplett och obruten

**Beviskrav:** L2-verifiering + extern verifierare + replay-verifiering

| Bevis | Status | Var |
| --- | --- | --- |
| L2 cryptographic audit | PROVEN | `IntegrityVerifier.auditL2` · `fault-injection.test.ts` · `fas4-acceptance.test.ts` |
| CAS-primary index verify | PROVEN | `verifyPromotionAgainstCas` · `evolvePhase3.test.ts` |
| Extern verifierare (endast CAS+ledger) | PROVEN | `npm run mimers:verify` · `prove-external-verify.ts` · Sovereign Gate |
| Replay-verifiering av hashes / Merkle / kedja | PROVEN | `npm run mimers:ops-proof` · `ops-proof-slice.test.ts` |

---

## 2. Immutabilitet (append-only + WORM)

**Krav**

- Ledger är append-only under kraschtester
- CAS är immutabel under race-conditions
- Policy-enforcement förhindrar overwrite i alla lägen
- Recovery L0–L3 producerar aldrig “tyst korrigering”

**Beviskrav:** Fault-injection + durability-matris + segment-rotation

| Bevis | Status | Var |
| --- | --- | --- |
| Crash before commit / EEXIST / EXDEV | PROVEN | `tests/unit/mimers/fault-injection.test.ts` |
| WORM policy on `promotion/` | PROVEN | `PolicyEnforcingArtifactStore` · `env-and-policy.test.ts` |
| Segment rotation append-only | PROVEN | `file-event-log.test.ts` |
| L0–L3 never silent-fix | PROVEN | `AuditReport.errors`; `quarantine: true` opt-in; `checkpointPolicy` · `mimers:ops-proof` |
| Linux `strict` durability | PROVEN | `MIMERS_REQUIRE_LINUX_STRICT=true npm run mimers:durability-matrix` via CI (Mimers Sovereign Gate, [run 30475536400](https://github.com/JbmbAb/Milj-beslut-V1.2/actions/runs/30475536400)) |
| NFS durability/failover | PARTIAL | Kräver `MIMERS_NFS_ROOT` på delad mount |

---

## 3. Återställning (full replay)

**Krav**

- Hela systemet kan återställas från enbart CAS + ledger
- Replay återskapar exakt samma `manifestHash` och `promotionHash`
- Replay är deterministisk och idempotent
- Recovery på tom nod producerar korrekt system

**Beviskrav:** Cold-start replay + drift-runbook + replay-benchmark

| Bevis | Status | Var |
| --- | --- | --- |
| Idempotent `commitPromotion` | PROVEN | ledger / `file-event-log.test.ts` |
| `recoverFromLedger` reachability | PROVEN | `SystemRecovery` · `fas4-acceptance.test.ts` |
| Cold-start på tom nod | PROVEN | `npm run mimers:cold-start` · `prove-cold-start-replay.ts` · `sovereign-dod-proofs.test.ts` |
| Multi-segment cold-start under last | PROVEN | `npm run mimers:ops-proof` · `ops-proof-slice.test.ts` |
| Checkpoint-accelerated ≡ full replay | PROVEN | `checkpointAccelerated.ts` · ops-proof |
| Backup → wipe → restore | PROVEN | `npm run mimers:backup-restore` · `platform-ops-proofs.test.ts` |
| Replay-benchmark under last | PROVEN | ops-proof metrics · `npm run mimers:bench` · [runbook](../ops/mimers-brunn-v9-runbook.md) |

---

## 4. Detektion (deterministic corruption detection)

**Krav**

- Korrupta CAS-objekt upptäcks deterministiskt
- Ledger-gap upptäcks deterministiskt
- Hash-mismatch → definierad åtgärd (karantän **eller** stopp)
- Recovery gissar/reparerar aldrig tyst

**Beviskrav:** L3-karantän + verifier/repair-split + korruptionssuite

| Bevis | Status | Var |
| --- | --- | --- |
| Bitrot → L2/L3 CORRUPTED | PROVEN | `fault-injection.test.ts` |
| Ledger chain break → L0 CORRUPTED | PROVEN | `fault-injection.test.ts` / `FileEventLog` |
| Korrupt segment / avbruten skrivning | PROVEN | `mimers:ops-proof` `faultInjection` |
| Saknad checkpoint: fail-closed vs backfill | PROVEN | `checkpointPolicy` · ops-proof |
| Explicit quarantine policy | PROVEN | `auditL3({ quarantine: true })` vs default stop-only |
| Verifier / Repair / Recovery split | PROVEN | M6 · [runbook](../ops/mimers-brunn-v9-runbook.md) recovery-nivåer |

**Policy (låst):** utan `quarantine: true` är standardåtgärden **stopp/rapportera** (ingen mutation). Karantän är opt-in repair. Saknade checkpoints: `fail-closed` = Verifier, `backfill` = Repair.

---

## 5. Revision (external verifiability)

**Krav**

- Extern part kan verifiera historiken utan intern databas
- Lineage, signaturer, manifest och CAS räcker för korrekthet
- Merkle-checkpoints är signerade och reproducerbara
- Audit-kedjan är maskinverifierbar

**Beviskrav:** Extern verifierare + Merkle-policy + audit-manual

| Bevis | Status | Var |
| --- | --- | --- |
| Offline verify CLI (CAS+ledger only) | PROVEN | `npm run mimers:verify` · Sovereign Gate |
| Chained Merkle checkpoints + optional sign | PROVEN | FileEventLog M5 · ops-proof Merkle-root match |
| Audit-manual (mänsklig procedur) | PROVEN | [external-audit-checklist](../ops/mimers-brunn-v9-external-audit-checklist.md) |
| Oberoende tredje-parts signoff | UNPROVEN | Ifylld checklista + bifogad verify-rapport från extern part |

---

## 6. Operativ robusthet (real-world durability)

**Krav**

- Failover på Linux, Windows, NFS
- Recovery efter ström-/disk-/nät-/FS-fel
- Replay snabb nog för drift
- Benchmarks under belastning

**Beviskrav:** Benchmark-suite + failover-tester + supportmatris

| Bevis | Status | Var |
| --- | --- | --- |
| Micro-benchmark gate | PROVEN | `npm run mimers:bench` |
| Multi-segment load metrics | PROVEN | `npm run mimers:ops-proof` |
| Backup/restore av CAS+ledger-träd | PROVEN | `npm run mimers:backup-restore` · `platform-ops-proofs.test.ts` |
| Durability matrix runner | PROVEN | `npm run mimers:durability-matrix` · artifact `tmp-artifacts/mimers-durability-matrix.json` |
| Windows lokal `best-effort` | PROVEN | durability-matrix cell (lokal Windows-körning) |
| Linux `strict` | PROVEN | `MIMERS_REQUIRE_LINUX_STRICT=true npm run mimers:durability-matrix` via CI (Mimers Sovereign Gate, [run 30475536400](https://github.com/JbmbAb/Milj-beslut-V1.2/actions/runs/30475536400)) |
| NFS/failover | PARTIAL | Sätt `MIMERS_NFS_ROOT` på delad mount; se [runbook](../ops/mimers-brunn-v9-runbook.md) |

---

## Sovereign gate (kör lokalt / CI)

```bash
npm run mimers:sovereign       # accept + verify + cold-start + ops + backup + durability
npm run mimers:verify -- --root <mimers-root>
npm run mimers:bench
npm run evolve:integration
npx vitest run tests/unit/mimers/ops-proof-slice.test.ts
npx vitest run tests/unit/mimers/platform-ops-proofs.test.ts
npx vitest run tests/unit/mimers/fault-injection.test.ts
```

CI: [`.github/workflows/mimers-sovereign.yml`](../../.github/workflows/mimers-sovereign.yml) (ubuntu-latest, `MIMERS_REQUIRE_LINUX_STRICT=true`).

**Sovereign Edition (kärna):** §1–§5 PROVEN + Linux `strict` PROVEN i CI.  
**Kvar till full §6:** NFS/failover + oberoende tredjepartssignoff.

---

## Vad som *inte* räknas som klart

- “Välkonstruerat / modulärt / CAS-drivet / ledger-baserat”
- Enbart arkitektur- eller API-komplettering utan bevis
- Opt-in-vägar som aldrig körts under felinjicering
- Att checklistan finns utan extern signoff (procedur ≠ oberoende revision)

När §1–§6 är PROVEN (inkl. NFS-rad och extern signoff) är kärnan:

> En suverän integritetskärna som kan bära 10–20 års revision, rättsprocesser, regulatoriska krav och återställning.
