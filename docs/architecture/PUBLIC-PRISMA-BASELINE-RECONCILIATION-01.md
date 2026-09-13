# PUBLIC-PRISMA-BASELINE-RECONCILIATION-01

Status: **RECON_CAPTURE_READY — NO DDL AUTHORIZED**

Base SHA: 0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85

## Governing frozen decision

docs/architecture/SPATIAL-SCHEMA-OWNERSHIP-01.md §0.4 governs this unit.

The frozen contract is:

- public is Prisma-owned;
- current production + schema.prisma are the recovery reference;
- the broken historical migration chain must not be forced onto production;
- the chosen repair is a controlled Prisma baseline reconciliation, not a series of catch-up migrations;
- after reconciliation, the governed Prisma migration chain resumes as the sole DDL authority for public.

A prior draft implementation attempt in PR #132 used catch-up migrations. It was closed before merge after this frozen decision was re-read. Its DDL is rejected and non-authoritative.

## Why this recon is required

Independent cold verification established that canonical migration history can report successful deployment while still producing a public schema inconsistent with canonical schema/runtime requirements.

Known examples include:

- BankIdSession.identity_environment declared and used but absent from historical reconstruction;
- User.organisationId nullable in schema.prisma but created NOT NULL by the historical chain;
- project_context_bindings required by live LU runtime but absent from historical reconstruction.

Those examples justify the recon; they do not define the whole baseline. The frozen decision requires the complete actual public state to be inventoried before a new baseline is authored.

## Phase A — read-only capture

This unit adds only capture tooling.

### scripts/db/public-prisma-baseline-catalog.sql

SELECT-only catalog extraction of the complete public schema surface relevant to recovery:

- relations;
- columns, types, nullability and defaults;
- constraints;
- indexes;
- enums;
- views/materialized views;
- functions;
- triggers;
- row-level-security policies;
- sequences;
- extensions.

Objects owned by PostgreSQL extensions are excluded from the Prisma-object inventory and represented instead by extension name/version/schema. This prevents PostGIS/pgvector/other extension members that happen to live in public from being mistaken for Prisma baseline DDL.

### scripts/db/capture-public-prisma-baseline-recon.ps1

Windows-oriented capture wrapper that:

1. requires an explicit database URL;
2. requires the expected database name;
3. requires the exact expected Git HEAD SHA;
4. refuses a dirty working tree;
5. positively checks current_database() before capture;
6. forces PostgreSQL sessions to default_transaction_read_only=on;
7. passes the database URL to child PostgreSQL tools via process environment rather than command-line arguments;
8. captures catalog JSON;
9. captures a pg_dump --schema-only --schema=public snapshot;
10. captures the Prisma migration ledger if present;
11. copies the exact schema.prisma;
12. hashes every file under prisma/migrations;
13. emits SHA-256 checksums for the capture bundle;
14. never persists the database URL.

The capture directory is created outside the repository by default.

## Phase B — comparison (not implemented here)

After an authorized operator produces a capture bundle from the intended production/recovery database, a separate unit must compare three states:

ACTUAL = production public catalog + schema-only dump
DECLARED = prisma/schema.prisma
HISTORICAL = current Prisma migration files + _prisma_migrations ledger

Every difference must be classified, at minimum, as:

- MATCH
- DECLARED_ONLY
- ACTUAL_ONLY
- HISTORY_ONLY
- HISTORY_DRIFT
- ACTUAL_DRIFT
- INTENT_REQUIRES_OWNER_DECISION
- UNKNOWN

No baseline DDL may be generated merely by choosing one side mechanically.

## Phase C — ratification and controlled baseline (future)

Only after Phase B is independently reviewed may the intended public state be ratified and a controlled Prisma baseline designed.

That future unit must define:

- exact cutover procedure;
- exact relationship to existing _prisma_migrations rows;
- how already-running production is baselined without replaying destructive history;
- how an empty database reconstructs the same ratified schema;
- rollback/recovery behavior;
- independent clean-room proof;
- DEV-GOV/promotion requirements.

## Safety boundary

This unit:

- contains no DDL;
- applies no migration;
- mutates no database state;
- changes no runtime behavior;
- does not claim the database is already reproducible;
- does not claim PROVEN.

The next legitimate artifact is a captured bundle plus a Phase-B comparison report.