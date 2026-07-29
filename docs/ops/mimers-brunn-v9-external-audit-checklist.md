# Mimers Brunn v9 — external (third-party) audit checklist

**Purpose:** Let an independent party verify integrity using **only** durable files (`cas/` + `ledger/`) and public scripts — no ArtifactStore, no application DB, no evolve index.

**Related:** [Definition of Done](../architecture/mimers-brunn-v9-sovereign-definition-of-done.md) · [ops runbook](./mimers-brunn-v9-runbook.md) · `npm run mimers:verify`

---

## What the auditor receives

1. Prefer a pre-built **audit bundle**:

```bash
npm run mimers:audit-bundle -- --root /path/to/mimers-root --out ./tmp-artifacts/mimers-audit-bundle
```

   Bundle contains `cas/`, `ledger/`, `VERIFY_REPORT.json`, `BUNDLE_MANIFEST.json`, `AUDIT_README.md`.

2. Or a raw offline archive with only:
   - `cas/` — FileCASRepository objects
   - `ledger/` — segments + checkpoints (and legacy `events/` if present)

3. Optional: `BACKUP_MANIFEST.json` from `mimers:backup-restore`

4. This repository (or a release tarball) sufficient to run `npm ci` and the verify script

**Out of scope for this checklist:** live NFS failover, production secrets, Vertex/GCP credentials, third-party legal opinion.

---

## Procedure (machine-verifiable)

```bash
# 1) Install toolchain (Node 22+)
npm ci

# 2) Point at the provided Mimers root (cas/ + ledger/ only)
npm run mimers:verify -- --root /path/to/mimers-root

# Expect: JSON report with ok=true, L0/L1/L2 CLEAN, checkpointChainOk=true
```

Optional stronger checks (same root):

```bash
# Cold empty-node reconstitution is proven by the project gate; auditor may
# re-run after copying cas+ledger to a fresh directory:
npm run mimers:cold-start   # self-seeded proof; or copy root and re-verify
```

---

## Pass criteria (sign-off form)

| # | Check | Pass? | Notes |
| --- | --- | --- | --- |
| 1 | Archive contains only `cas/` + `ledger/` (no DB dump required) | ☐ | |
| 2 | `mimers:verify -- --root …` exits 0 / `ok: true` | ☐ | Attach JSON report |
| 3 | `events` count matches backup manifest (if provided) | ☐ | |
| 4 | Merkle / checkpoint chain reported OK | ☐ | |
| 5 | Auditor did **not** need ArtifactStore or evolve DB | ☐ | |

**Auditor:** _________________  
**Date:** _________________  
**Report artifact path/hash:** _________________

---

## Status vs Sovereign DoD

| Item | Status |
| --- | --- |
| Checklist + offline verify script exist | PROVEN (procedure) |
| Independent external organization has signed above form | UNPROVEN until filed |

Do **not** mark “oberoende tredjepartsrevision” PROVEN without a completed sign-off form from a party outside the implementation team.
