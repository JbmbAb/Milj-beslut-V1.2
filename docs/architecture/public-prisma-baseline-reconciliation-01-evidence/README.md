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

**Phase C2's disposition was a candidate, not an accepted conclusion**, per this program's
standing "never self-verify" discipline — and Phase C3 (below) has since found it partially
wrong. `phase-c2-disposition.{json,md}` are kept exactly as originally produced (never
edited or regenerated); C3's corrections live in their own file and are layered on top by
this README, not by rewriting C2's output.

## Phase C3 — adversarial challenge (2026-09-14)

An independent third pass was given Phase B, Phase C, and Phase C2's actual output (unlike
C2, which was blind) and told to actively try to falsify each of the 98 dispositions,
prioritizing the highest-risk categories (`COMPARISON_ARTIFACT`, `NAME_TRUNCATION_EQUIVALENT`),
without regenerating any input and without resolving the 4 `OWNER_DECISION_REQUIRED` items
itself.

**Result: 85 of 98 SUSTAINED, 13 OVERTURNED — all 13 within `COMPARISON_ARTIFACT`, all
corrected to `TRUE_SCHEMA_DRIFT`:**
- 12 items: the entire `localization_geometry_supersessions` table (relation, 6 columns, 2
  constraints, 3 indexes). C2 accepted a migration-file comment ("raw SQL access, not a
  Prisma model") as proof of legitimate absence from `schema.prisma`, but applied a
  stricter, correct standard to structurally identical cases elsewhere in its own report.
- 1 item: the `legal_corpus_chunks_record_id_chunk_index_chunk_version_key` constraint. C2
  called it a comparison-tool extraction gap; C3 proved via full migration-history trace
  (plus a repo-wide grep showing this Prisma migration engine never emits
  `ADD CONSTRAINT ... UNIQUE`) that it is a real, undocumented out-of-band rename against
  production.

**Corrected disposition tally for the 98 review items (supersedes the Phase C2 table above):**

```
COMPARISON_ARTIFACT          12   (was 25 in C2; -13)
NAME_TRUNCATION_EQUIVALENT   50   (unchanged, all sustained)
TRUE_SCHEMA_DRIFT            32   (was 19 in C2; +13)
OWNER_DECISION_REQUIRED       4   (unchanged, all sustained)
UNRESOLVED                    0
-----------------------------
TOTAL                         98
```

The real remaining count requiring owner treatment before a baseline can be proposed is
therefore **36** (32 `TRUE_SCHEMA_DRIFT` + 4 `OWNER_DECISION_REQUIRED`), not 23.

C3 also flagged (methodology notes only, no disposition changes): one `NAME_TRUNCATION_EQUIVALENT`
item's evidence text contains an unverified truncation-mechanism narrative that doesn't
actually reproduce the observed name even though the disposition itself holds up under
direct field comparison; and the `NAME_TRUNCATION_EQUIVALENT` label covers two distinct
underlying mechanisms, not one. Full detail, per-item ledger, and reasoning in
`phase-c3-challenge.md`.

## Still open before Phase D

- **MIGRATION-HISTORY-RECONCILIATION-01** — a separate, still-open diagnostic unit (not yet
  landed as evidence here) triggered by a HISTORICAL-RECONSTRUCTION-01 finding: four
  `migration.sql` files that were evidently applied against real ACTUAL/DECLARED databases
  are untracked in git (never committed to any ref). Before any recovery migration is
  authored, that unit must produce an explicit per-statement table (DDL → applied-in-production
  evidence → represented in schema.prisma → covered by a later committed migration →
  disposition) for all four files, so that any recovery migration is written fresh from
  today's authoritative state with a documented link back to the old file — never by
  re-inserting an old untracked migration into the middle of git history.
- Owner review of the corrected 36-item remainder (32 `TRUE_SCHEMA_DRIFT` + 4
  `OWNER_DECISION_REQUIRED`) and of both C3's and MIGRATION-HISTORY-RECONCILIATION-01's
  findings.

Phase D (constructing the actual new Prisma baseline) does not start until all of the above
is done and reviewed.

## Files and their frozen SHA-256

| File | SHA-256 |
|---|---|
| `phase-b-comparison.json` | `7e0bcd73d758561418b32166e76d56dfda5f15b1b03ec96e5d26d3dc24b9226a` |
| `phase-c-ratification.json` | `0b39643bcef44ba77aa7fd9c7581fbe39defba527ded1aa59c45334cfaeafca8` |
| `phase-c-ratification.md` | `704692060fa2ba649b79d4cf04adc93356399100bb776d01548f7d4ec344ef27` |
| `phase-c2-disposition.json` | `016c0bcb5fa5707e36747091ed339b5bcb6316faee3f43e152fc74b6a34d5268` |
| `phase-c2-disposition.md` | `651de71c8c9c66f9a7083de6bf4051418e83046863a16339e642e5a522d2c9c1` |
| `phase-c3-challenge.json` | `8b0ceedd58a6bdb04728e15da8159916156f19b99eae2e69a430fb8f014c47de` |
| `phase-c3-challenge.md` | `7cc9f7a3390e612e98732390ec79888093d821c7b1f82fa0b3ee57bf95b23b01` |

Verify with `sha256sum` (or `Get-FileHash -Algorithm SHA256` on Windows) before relying on
any of these files for a downstream decision.
