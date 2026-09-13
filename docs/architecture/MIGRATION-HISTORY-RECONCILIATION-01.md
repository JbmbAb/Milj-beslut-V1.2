# MIGRATION-HISTORY-RECONCILIATION-01

Status: **IMPLEMENTATION_READY — NOT independently verified**

Base SHA: `0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85`

## Purpose

Reconcile canonical Prisma schema/runtime requirements with the schema produced by canonical migration history, without editing historical migrations.

This unit is deliberately limited to the migration-history defects established during WORKTREE-TRIAGE-01 and its independent cold verification.

## M1 — Project.name

No action.

Canonical main already contains `20260824110000_add_project_name`; the stale-worktree migration is a hard duplicate and is not reintroduced.

## M2 — BankIdSession.identity_environment

Canonical `prisma/schema.prisma` requires:

- `BankIdSession.identityEnvironment String @default("LEGACY") @map("identity_environment")`

Canonical migration history previously added `identity_environment` only to `User`.

The new forward migration:

- creates the BankIdSession column when absent;
- accepts an already-existing column only when it is canonical `TEXT NOT NULL DEFAULT 'LEGACY'`;
- fails closed on an incompatible pre-existing column.

## M3 — User.organisationId nullability

The initial migration creates `User.organisationId TEXT NOT NULL`.

Canonical Prisma schema requires `organisationId String?` and an optional Organisation relation.

The new forward migration:

- requires the column to exist and remain `TEXT`;
- drops `NOT NULL` when necessary;
- leaves an already-nullable canonical column unchanged.

No foreign key is removed.

## M4 — project_context_bindings

Canonical Prisma schema and live runtime require `public.project_context_bindings`, but canonical migration history did not create the base table.

The new forward migration creates the projection when absent with:

- the nine canonical columns;
- primary key on `id`;
- unique `binding_artifact_id`;
- unique project/context tuple;
- lookup index for the same tuple;
- `project_id -> Project.id` with ON DELETE RESTRICT / ON UPDATE CASCADE.

If the table already exists, the migration does not silently mutate unknown state. It validates the table shape, primary key, foreign key and required indexes and fails closed if the pre-existing object is incompatible.

## Existing-database inspection

`scripts/db/inspect-migration-history-reconciliation-01.sql` is read-only and reports:

- current connection identity;
- relevant columns/defaults/nullability;
- constraints and referential actions;
- indexes;
- Prisma migration ledger.

The script must be run only after the operator confirms the intended database target.

## Static regression test

`tests/unit/migrationHistoryReconciliation.test.ts` binds the reconciliation migration to the canonical Prisma declarations and prevents M1 from being reintroduced.

## Verification boundary

This implementation does **not** claim PROVEN.

Required independent verification:

1. exact candidate SHA checkout;
2. disposable clean PostgreSQL/PostGIS database;
3. full `prisma migrate deploy` from empty state;
4. `prisma migrate status`;
5. catalog verification of M2/M3/M4;
6. second run against a simulated already-canonical state;
7. explicit incompatible-state test proving fail-closed behavior;
8. read-only inspection of the actual target database before promotion;
9. relevant runtime smoke tests for BankIdSession and ProjectContextBinding.

No merge or promotion is authorized by this document.
