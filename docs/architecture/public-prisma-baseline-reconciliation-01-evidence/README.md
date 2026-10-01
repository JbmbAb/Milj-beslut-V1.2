# PUBLIC-PRISMA-BASELINE-RECONCILIATION-01 — frozen evidence

Status: **EVIDENCE ONLY — no baseline DDL, no DB writes, no ledger mutation.**

This directory preserves, byte-for-byte, the frozen output artifacts of Phase B, Phase C
and Phase C2 of the public-schema Prisma baseline reconciliation program. Nothing in this
directory was regenerated when it was committed here — every file is an exact copy of the
artifact whose hash is recorded below, and that hash was independently re-verified against
the recorded value immediately before this commit was made.

**Do not regenerate any of these files.** A fresh run of the comparator or ratifier could
legitimately produce different bytes (e.g. if production state has moved on since capture),
which would silently invalidate every downstream disposition that cites these exact hashes.
If a phase needs to be redone, do it as a new, separately named artifact — never overwrite
one of these.

## Lineage

- Phase A (read-only recovery-reference capture): [PR #133](https://github.com/JbmbAb/Milj-beslut-V1.2/pull/133), candidate `b15781ad7e049cb398c863aa9ca51ffac715b354`
- Phase B (three-way ACTUAL/DECLARED/HISTORICAL comparison): [PR #134](https://github.com/JbmbAb/Milj-beslut-V1.2/pull/134), corrected candidate `7f33e9b9da42671432b30d338356a207ec5a9b85`
- Phase C (mechanical ratification of ACTUAL==DECLARED agreement): [PR #135](https://github.com/JbmbAb/Milj-beslut-V1.2/pull/135), candidate `f1d3f4be51ef9c23fa51e5cfb4f68942fd34ce8a`
- Phase C2 (cold, independent disposition of the 98 `HOLD` findings): produced 2026-09-13 by an isolated agent given only the Phase B/C artifacts below — no hypotheses from the Phase C session were supplied to it.

Totals: **1947** objects compared → **1849** ratified in Phase C → **98** held for review, disposed in Phase C2 as:

```
COMPARISON_ARTIFACT          25
NAME_TRUNCATION_EQUIVALENT   50
TRUE_SCHEMA_DRIFT            19
OWNER_DECISION_REQUIRED       4
UNRESOLVED                    0
-----------------------------
TOTAL                         98
```

**Phase C2's disposition is a candidate, not an accepted conclusion.** Per this program's
standing "never self-verify" discipline, it has not yet been independently re-verified or
owner-reviewed. The next units are:
- **Phase C3** — an independent, adversarial challenge pass that attempts to falsify the 98
  Phase-C2 dispositions (especially `COMPARISON_ARTIFACT`, `NAME_TRUNCATION_EQUIVALENT`, and
  `TRUE_SCHEMA_DRIFT`), without regenerating Phase B/C or resolving the 4
  `OWNER_DECISION_REQUIRED` items itself.
- **HISTORICAL-RECONSTRUCTION-01** — a diagnostic unit investigating why migration
  `20260820150000_add_project_context_binding` is entirely absent from the HISTORICAL
  (migration-replay) reconstruction used in Phase B, and whether the reconstruction
  tooling can systematically miss other migrations. This does not change any of the 98
  Phase-C2 dispositions above; it is a prerequisite check on the tooling before Phase D
  is allowed to build an authoritative baseline on top of it.

Phase D (constructing the actual new Prisma baseline) does not start until both of those
are done and their results have been reviewed.

## Files and their frozen SHA-256

| File | SHA-256 |
|---|---|
| `phase-b-comparison.json` | `7e0bcd73d758561418b32166e76d56dfda5f15b1b03ec96e5d26d3dc24b9226a` |
| `phase-c-ratification.json` | `0b39643bcef44ba77aa7fd9c7581fbe39defba527ded1aa59c45334cfaeafca8` |
| `phase-c-ratification.md` | `704692060fa2ba649b79d4cf04adc93356399100bb776d01548f7d4ec344ef27` |
| `phase-c2-disposition.json` | `016c0bcb5fa5707e36747091ed339b5bcb6316faee3f43e152fc74b6a34d5268` |
| `phase-c2-disposition.md` | `651de71c8c9c66f9a7083de6bf4051418e83046863a16339e642e5a522d2c9c1` |

Verify with `sha256sum` (or `Get-FileHash -Algorithm SHA256` on Windows) before relying on
any of these files for a downstream decision.
