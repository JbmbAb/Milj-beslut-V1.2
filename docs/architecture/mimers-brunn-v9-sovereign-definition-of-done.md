# Mimers Brunn v9 — Definition of Done: Sovereign Edition

**Princip:** Arkitektur färdig ≠ egenskaper bevisade.  
Systemet är “klart” först när egenskaperna är demonstrerade under verkliga driftförhållanden — tillräckligt för juridisk, regulatorisk och långsiktig revisionsbörda.

**Identitetskedja (arkitektur):**

```text
Ledger event → promotionHash → CAS bytes
            → manifestHash → CAS bytes → descriptors → SHA-256
```

**Relaterat:** [ops-runbook](../ops/mimers-brunn-v9-runbook.md) · [ADR-042](./ADR-042-mimers-brunn-v9.md) · [hardening-evaluation](./mimers-brunn-v9-sovereign-hardening-evaluation.md)

---

## Statustecken

| Tecken | Betydelse |
| --- | --- |
| PROVEN | Automatiserat bevis finns och körs i CI/lokal gate |
| PARTIAL | Delbevis finns; lucka dokumenterad |
| UNPROVEN | Krävs för Sovereign DoD; ej ännu demonstrerat |

---

## Översikt (efter ops proof-slice)

Kärnans logiska modell är bevisad. Kvar är främst miljö- och driftberoende validering.

| Egenskap | Status | Bevis |
| --- | --- | --- |
| CAS-integritet | PROVEN | Byte-CAS / L2 / `mimers:verify` |
| Extern verifiering | PROVEN | `npm run mimers:verify` |
| Cold-start replay | PROVEN | `npm run mimers:cold-start` |
| Multi-segment replay | PROVEN | `npm run mimers:ops-proof` · `ops-proof-slice.test.ts` |
| Checkpoint-baserad recovery | PROVEN | `buildCheckpointAcceleratedPlan` · ops-proof |
| Merkle-kedjans korrekthet | PROVEN | chained checkpoints + ops-proof root match |
| Linux strict durability | PARTIAL | Matris i runbook; ej registrerad prod-körning |
| NFS/failover | PARTIAL | Supportmatris dokumenterad; failover ej kört |
| Oberoende tredjepartsrevision | UNPROVEN | Kräver extern miljö/signoff |

Fault injection (korrupt segment / avbruten skrivning / saknad checkpoint) ingår i `mimers:ops-proof` och stödjer §2/§4.

---

## 1. Integritet (cryptographic integrity)

**Krav**

- Varje promotion kan verifieras: ledger-event → `manifestHash` → CAS-bytes → SHA-256
- Signaturer och attesteringar är deterministiskt reproducerbara
- Lineage är komplett och obruten

**Beviskrav:** L2-verifiering + extern verifierare + replay-verifiering

| Bevis | Status | Var |
| --- | --- | --- |
| L2 cryptographic audit | PROVEN | `IntegrityVerifier.auditL2`, fault-injection, fas4-acceptance |
| CAS-primary index verify | PROVEN | `verifyPromotionAgainstCas` / evolve Phase3 |
| Extern verifierare (endast CAS+ledger, ingen ArtifactStore/DB) | PROVEN | `npm run mimers:verify` · `prove-external-verify.ts` |
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
| Crash before commit / EEXIST / EXDEV | PROVEN | `fault-injection.test.ts` |
| WORM policy on `promotion/` | PROVEN | `PolicyEnforcingArtifactStore`, env-and-policy tests |
| Segment rotation append-only | PROVEN | `file-event-log.test.ts` |
| L0–L3 never silent-fix | PROVEN | Fel i `AuditReport.errors`; karantän kräver `quarantine: true`; saknad checkpoint: `checkpointPolicy=fail-closed` (Verifier) vs `backfill` (Repair) — `mimers:ops-proof` |
| Full durability-matris kört på Linux+NFS | UNPROVEN | Matris i runbook; “produktionstestad” endast för körd rad |

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
| Idempotent `commitPromotion` | PROVEN | ledger / file-event-log tests |
| `recoverFromLedger` reachability | PROVEN | SystemRecovery / fas4-acceptance |
| Cold-start på tom nod (ny process, endast CAS+ledger-filer) | PROVEN | `npm run mimers:cold-start` · `prove-cold-start-replay.ts` |
| Multi-segment cold-start under last | PROVEN | `npm run mimers:ops-proof` (många segment, Merkle+kedja+hashes) |
| Checkpoint-accelerated ≡ full replay | PROVEN | `buildCheckpointAcceleratedPlan` + ops-proof (tid + korrekthet) |
| Replay-benchmark under last | PROVEN | ops-proof mäter `coldStartMs`, `eventsPerSec`, `heapUsedMb`; `mimers:bench` för commit/L0 |

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
| Bitrot → L2/L3 CORRUPTED | PROVEN | fault-injection |
| Ledger chain break → L0 CORRUPTED | PROVEN | fault-injection / FileEventLog |
| Korrupt segment / avbruten skrivning | PROVEN | `mimers:ops-proof` faultInjection |
| Saknad checkpoint: fail-closed vs backfill | PROVEN | `checkpointPolicy` · ops-proof |
| Explicit quarantine policy | PROVEN | `auditL3({ quarantine: true })` vs default stop-only |
| Verifier / Repair / Recovery split | PROVEN | M6 komponenter + checkpointPolicy |

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
| Offline verify CLI (CAS+ledger only) | PROVEN | `npm run mimers:verify` |
| Chained Merkle checkpoints + optional sign | PROVEN | FileEventLog checkpoints / M5 · ops-proof Merkle-root match |
| Audit-manual (mänsklig procedur) | PARTIAL | Denna DoD + [runbook](../ops/mimers-brunn-v9-runbook.md) recovery-nivåer |
| Oberoende tredje-parts körning dokumenterad | UNPROVEN | Kräver extern miljö/signoff |

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
| Durability support matrix (dokument) | PROVEN (dok) | [runbook](../ops/mimers-brunn-v9-runbook.md) |
| Windows lokal best-effort | PARTIAL | Utvecklingsmaskin / CI om Windows |
| Linux `strict` durability | PARTIAL | Matris i runbook; ej registrerad prod-körning |
| NFS/failover | PARTIAL | Supportmatris dokumenterad; failover ej kört i gate |
| Backup/restore av CAS+ledger-träd | UNPROVEN | Driftprocedur utanför kärnbevis |

---

## Sovereign gate (kör lokalt / CI)

```bash
npm run mimers:accept          # M1–M7 acceptance
npm run mimers:verify -- --root <mimers-root>   # extern verify (eller self-seed)
npm run mimers:cold-start      # cold-start replay proof
npm run mimers:ops-proof       # multi-segment + checkpoint recovery + fault injection
npm run mimers:bench
npm run evolve:integration     # CAS-primary evolve smoke
npx vitest run tests/unit/mimers/ops-proof-slice.test.ts
npx vitest run tests/unit/mimers/fault-injection.test.ts
```

**Sovereign Edition = PROVEN på §1–§5 i denna miljö + dokumenterad körning av §6-matrisraden ni påstår.**

Kärnans logiska modell är bevisad under last och felinjicering. Kvarvarande luckor är främst **miljö- och driftberoende** (Linux strict, NFS, backup/restore, tredjepartsrevision).

---

## Vad som *inte* räknas som klart

- “Välkonstruerat / modulärt / CAS-drivet / ledger-baserat”
- Enbart arkitektur- eller API-komplettering utan bevis
- Opt-in-vägar som aldrig körts under felinjicering

När §1–§6 är PROVEN (inkl. plattformsrad för §6) är kärnan:

> En suverän integritetskärna som kan bära 10–20 års revision, rättsprocesser, regulatoriska krav och återställning.
