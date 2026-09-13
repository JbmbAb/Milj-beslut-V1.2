# PUBLIC-PRISMA-BASELINE-RECONCILIATION-01 — Phase B

Status: **COMPARATOR_IMPLEMENTATION_READY — NO BASELINE DDL AUTHORIZED**

Parent candidate: b15781ad7e049cb398c863aa9ca51ffac715b354

## Goal

Produce one structural three-way comparison using the same catalog contract for ACTUAL, DECLARED and HISTORICAL.

ACTUAL is the verified recovery-reference capture. DECLARED is a disposable database materialized from current prisma/schema.prisma. HISTORICAL is a disposable empty database reconstructed only by the canonical Prisma migration chain.

The comparator does not choose authority. It classifies evidence.

## Required state generation

### ACTUAL

Use the already verified Phase-A bundle. Do not regenerate it unless the candidate SHA or database reference changes.

### HISTORICAL

Create a disposable PostGIS/PostgreSQL database from the repository's canonical test/recovery image. From the exact candidate checkout, apply only the canonical Prisma migration chain with prisma migrate deploy. Then run the same Phase-A catalog SQL against that disposable database.

Do not copy objects from ACTUAL into HISTORICAL.

### DECLARED

Create a second disposable PostgreSQL/PostGIS database. Materialize current prisma/schema.prisma into the empty disposable database using Prisma schema tooling. Mutation is allowed only in this disposable database.

Then run the exact same Phase-A catalog SQL.

If Prisma cannot materialize an Unsupported(...) or other declared object, record that limitation explicitly rather than hand-creating an equivalent. Non-Prisma-expressible production objects are intentionally allowed to surface as comparison findings.

## Comparator

Run node scripts/db/compare-public-prisma-baseline-catalogs.mjs with --actual, --declared, --historical, --out-json and --out-md.

The comparator validates the capture contract and compares relations, columns, constraints, indexes, enums, views, materialized views, functions, triggers, RLS policies, sequences and extensions.

Classifications:

- MATCH
- HISTORY_DRIFT
- DECLARED_DRIFT
- ACTUAL_DRIFT
- ACTUAL_ONLY
- DECLARED_ONLY
- HISTORY_ONLY
- INTENT_REQUIRES_OWNER_DECISION

## Interpretation

HISTORY_DRIFT is the strongest automatic candidate for baseline reconciliation because ACTUAL and DECLARED independently agree while migration-derived state differs. It remains evidence, not authorization.

ACTUAL_ONLY must not be deleted automatically. It may represent a required non-Prisma-expressible object such as a specialized index or function.

HISTORY_ONLY must not be recreated automatically. It may represent historical DDL intentionally absent from running and declared schema.

INTENT_REQUIRES_OWNER_DECISION always blocks automatic baseline derivation.

## Current historical facts

Current main contains 31 canonical migration.sql migrations and 3 loose SQL files directly under prisma/migrations. The loose SQL files are not canonical Prisma migration directories.

A 2026-08-17 drift recon found production and schema.prisma nearly aligned while the migration chain was stale. That evidence is regression context only and must not replace the 2026-09-13 ACTUAL capture.

## Required output

Return the comparator JSON and Markdown unchanged, plus exact ACTUAL bundle checksum, DECLARED catalog checksum, HISTORICAL catalog checksum, candidate SHA, disposable database/container identities, commands used to materialize DECLARED and HISTORICAL, and explicit confirmation that the recovery-reference database was not mutated.

Final status: COMPARISON_COMPLETE_NOT_RATIFIED.

## STOP

Do not generate baseline SQL yet. Do not delete or rewrite historical migrations. Do not mutate _prisma_migrations. Do not merge or promote based on this report alone.

Controlled-baseline derivation starts only after the three-way report has been independently reviewed.
