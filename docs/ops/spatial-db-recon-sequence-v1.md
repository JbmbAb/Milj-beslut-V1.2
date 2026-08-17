# SPATIAL_DB_RECON_SEQUENCE_V1

Sequencing note for the three open spatial/database units. Written so whoever picks them up does
not have to re-derive the dependency.

```
DB-1
 ├── DB-2
 └── DB-3
```

`DB-1` blocks both. `DB-2` and `DB-3` do not block each other — run them sequentially in either
order, one WIP at a time.

---

## DB-1 — `SPATIAL_SCHEMA_OWNERSHIP-01`

**FIRST / BLOCKING.**

Which migration or runtime layer owns creation and evolution of:

- `core.property_unit`
- `core.normalize_designation`
- `env.sgu_well`
- `env.ebh_potentiellt_fororenade_omraden`
- related spatial schema objects

No downstream schema repair may be frozen before this is answered. Both units below are
consequences of that ownership being undecided, so fixing either first repairs a symptom and
invites it back.

Relevant prior art: `scripts/db/provision-spatial-test-db.ts` (commit `5d82b0f`) already encodes a
load-bearing ordering — admin creates role, database and extensions; the test role runs
`prisma migrate deploy`; admin then creates spatial objects. That split is evidence about where
ownership currently sits, not a decision that it belongs there.

## DB-2 — `PRISMA_SCHEMA_MIGRATION_DRIFT-01`

Runs only after DB-1. Resolve the `DocumentChunk` schema/migration drift **according to the
ownership model frozen in DB-1**, not according to whichever side is easier to change.

## DB-3 — `SPATIAL_PROTECTED_AREA_COLUMN_CONTRACT-01`

Runs only after DB-1. Determine the canonical spelling — `nvrid` or `nvr_id` — from source and
schema ownership, then migrate and query consistently.

Explicitly forbidden: picking whichever spelling currently makes tests pass. A column contract
settled by test convenience is a contract nobody decided.

---

## Ordering against the other open units

```
1. TEST_DISCOVERY_WORKTREE_ISOLATION-01     done — see this unit's commit
2. Type-check the LU verdict consumer boundary   affects release proof
3. DB-1
4. DB-2 / DB-3                              either order, WIP=1
5. tsx/libuv exit-127 in harvest runner
6. QUARANTINE_DEDUP_INDEX-01
7. P2-RUNTIME-01 core variant
```

## `WORKTREE-CONCURRENCY-01`

Concrete evidence, not an annoyance: during one session another agent committed
`95587ef refactor(naming): replace Loke runtime names with functional terms` onto the same branch
mid-turn, and twelve test files appeared in the working tree under the first agent's feet.

For parallel sessions:

```
one semantic unit -> one branch/worktree -> one writer -> no shared index
```

Safer than several agents on one branch and index. It also removes the class of failure where a
suite result changes for reasons unrelated to the unit being proved.
