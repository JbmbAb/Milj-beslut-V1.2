# PUBLIC-PRISMA-BASELINE-RECONCILIATION-01 — Phase C ratification

Status: **RATIFICATION TOOLING READY — NO BASELINE DDL AUTHORIZED**

Parent Phase-B candidate: `7f33e9b9da42671432b30d338356a207ec5a9b85`

## Governing rule

The frozen owner decision in `SPATIAL-SCHEMA-OWNERSHIP-01 §0.4` states:

- `public` is Prisma-owned;
- current production + `schema.prisma` are the recovery reference;
- reconciliation uses a new controlled Prisma baseline rather than catch-up migrations.

Phase C therefore does not re-decide each historical difference manually. It applies the already-frozen reference direction mechanically.

## Ratification rule

For each corrected Phase-B finding:

ACTUAL semantic fingerprint == DECLARED semantic fingerprint => RATIFIED_RECOVERY_REFERENCE

This includes:

- `MATCH` — keep the agreed state;
- `HISTORY_DRIFT` — baseline to ACTUAL/DECLARED rather than the stale historical reconstruction;
- `HISTORY_ONLY` — ratify absence from the new baseline because ACTUAL and DECLARED both omit the historical-only object.

If ACTUAL and DECLARED disagree, the finding is held for explicit review.

## Corrected Phase-B counts supplied by independent execution

- MATCH: 1026
- HISTORY_DRIFT: 285
- HISTORY_ONLY: 538
- DECLARED_DRIFT: 60
- DECLARED_ONLY: 26
- ACTUAL_ONLY: 7
- ACTUAL_DRIFT: 1
- INTENT_REQUIRES_OWNER_DECISION: 4

Under the frozen rule, the first three classes are mechanically ratifiable:

`1026 + 285 + 538 = 1849 ratified findings`

The remaining:

`60 + 26 + 7 + 1 + 4 = 98 review-required findings`

No baseline SQL is authorized until those 98 are classified.

## Known review-required environment item

The corrected Phase-B execution separately confirmed:

- `extensions|vector`: ACTUAL_DRIFT
- production pgvector: 0.8.6
- canonical disposable image pgvector: 0.8.2

This is an environment/extension parity issue and must not be silently converted into Prisma baseline DDL.

The report header also exposed PostgreSQL server 16.14 in ACTUAL versus 16.13 in the canonical disposable image. Track that as runtime-environment parity, not as a Prisma object decision.

## Tool

`scripts/db/ratify-public-prisma-baseline-comparison.mjs`:

- binds its output to the exact comparison bytes by SHA-256;
- ratifies only ACTUAL/DECLARED semantic agreement;
- preserves source classification and fingerprints;
- emits a machine-readable review set for every disagreement;
- generates no DDL and performs no database access.

## Required execution

Run the ratifier against the corrected Phase-B JSON unchanged.

Expected high-level result from the supplied corrected counts:

total 1947 / ratified 1849 / review_required 98

These values are a sanity target, not an instruction to modify output.

## Stop boundary

Do not generate baseline SQL yet.

Do not mutate `_prisma_migrations`.

Do not delete historical migrations.

Do not merge or promote based on Phase C alone.

The next unit is review of the 98 ACTUAL/DECLARED disagreements, followed by controlled baseline derivation only after that review is closed.
