# PUBLIC-PRISMA-BASELINE-RECONCILIATION-01 — Phase C.1 review triage

Status: **TRIAGE TOOLING READY — NO BASELINE DDL AUTHORIZED**

Parent Phase-C candidate: `f1d3f4be51ef9c23fa51e5cfb4f68942fd34ce8a`

## Purpose

Phase C left 98 findings where ACTUAL and DECLARED did not share the same semantic fingerprint.

This pass does not decide schema intent. It separates known comparison/provisioning artifacts and mechanically equivalent naming differences from genuine structural disagreements.

## Triage classes

### PRISMA_SYSTEM_LEDGER_ARTIFACT

Any finding belonging to relation `_prisma_migrations` is Prisma migration-engine metadata rather than an application model declared in `schema.prisma`. It is excluded from application baseline-object review. Treatment of the migration ledger itself is a later baseline-adoption procedure.

### ENVIRONMENT_EXTENSION_PARITY

`extensions|vector` is database runtime provisioning parity. The observed 0.8.6 versus 0.8.2 version difference is handed to `POSTGRES-EXTENSION-PARITY-01`, not converted into Prisma baseline DDL.

### MECHANICAL_NAME_DIVERGENCE

For constraints and indexes only, the triager may pair one ACTUAL-only and one DECLARED-only object when:

- both belong to the same relation;
- their complete structural signatures match after removing the object identifier;
- for indexes, only the index identifier in `CREATE [UNIQUE] INDEX <name> ON ...` is normalized;
- pairing is unique.

This identifies PostgreSQL/Prisma identifier naming or 63-character truncation effects without claiming a canonical name. These remain baseline-design blockers because adoption must choose names that are safe for both existing production and fresh reconstruction.

### MECHANICAL_RENDERING_DIVERGENCE

For the same constraint/index identity, if the name-insensitive structural signature is identical, the finding is isolated as rendering-only rather than schema-intent drift.

### AMBIGUOUS_STRUCTURAL_NAME_PAIR

If more than one possible structural counterpart exists, the tool refuses to pair them automatically.

### TRUE_SCHEMA_REVIEW_REQUIRED

Anything else remains an explicit ACTUAL-versus-DECLARED contract disagreement and requires owner-intent review before baseline derivation.

## Safety

The triager:

- consumes only the corrected Phase-B comparison JSON and Phase-C ratification JSON;
- verifies the ratification is bound to the exact comparison bytes by SHA-256;
- performs no database access;
- generates no DDL;
- mutates no ledger or migration files;
- does not auto-ratify name-only differences.

## Known environment note

PostgreSQL server 16.14 in ACTUAL versus 16.13 in the canonical disposable image is tracked as runtime-environment parity outside the 1947 object findings.

## Stop boundary

After triage, only `TRUE_SCHEMA_REVIEW_REQUIRED` and any `AMBIGUOUS_STRUCTURAL_NAME_PAIR` findings belong in the owner-intent review. Mechanical naming findings move to baseline-design naming policy; system-ledger and extension parity move to their own procedures.

No baseline SQL is authorized by this phase.
