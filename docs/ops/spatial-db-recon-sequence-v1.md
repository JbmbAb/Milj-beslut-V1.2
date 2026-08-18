# SPATIAL_DB_RECON_SEQUENCE_V1

Sequencing note for the three open spatial/database units. Written so whoever picks them up does
not have to re-derive the dependency.

```
DB-1  (FROZEN 2026-08-18)
 └── DB-0-SAFETY   ← P0, runs before both
      ├── DB-2
      └── DB-3
```

`DB-1` is **frozen** — see `docs/architecture/SPATIAL-SCHEMA-OWNERSHIP-01.md` §0. It blocked both
downstream units; both are now conceptually unblocked.

`DB-1` surfaced a critical safety defect that now precedes them. `DB-2` and `DB-3` do not block each
other — run them sequentially in either order after `DB-0-SAFETY`, one WIP at a time.

---

## DB-0-SAFETY — "Prevent test GIS seeding from targeting production"

**P0. RUNS BEFORE DB-2 AND DB-3.**

```text
SEVERITY   CRITICAL SAFETY GUARD
STATUS     KNOWN_BROKEN
RULE       test/destructive DB utilities must positively prove
           they target an approved disposable test database
           before any DROP/CREATE operation
```

`tests/setup/seedGisStubs.ts` loads `.env.test` with `override: false` and falls back to `.env` —
production `miljobeslut`. `.env.test` is gitignored and untracked, so on a clean checkout it does
not exist. The file then runs `DROP EXTENSION IF EXISTS postgis CASCADE` plus ~20
`DROP TABLE ... CASCADE`, with no guard on the resolved database name. Dropping the postgis
extension CASCADE removes every geometry column — the ≈11.9 GB inventoried in DB-1 §2b.
`provision-spatial-test-db.ts` guards against exactly this; `seedGisStubs.ts` does not.

Ahead of DB-2/DB-3 because a mistaken test invocation can destroy production.

## DB-1 — `SPATIAL_SCHEMA_OWNERSHIP-01`

**FROZEN 2026-08-18. Recon complete, owner decision frozen, implementation not part of the unit.**

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

Ownership model now frozen: **`public` is Prisma-owned.** Resolve `DocumentChunk` within Prisma
authority — but only after the **baseline reconciliation** decided in DB-1 §0.4. Do not use the
spatial provisioner as schema authority.

Note: two untracked migration directories for this already sit in the working tree. They predate
the baseline decision and must be re-assessed against §0.4 before use.

## DB-3 — `SPATIAL_PROTECTED_AREA_COLUMN_CONTRACT-01`

**Decided in DB-1 §0.5: option C** — source-faithful materialization *plus* a separate canonical
normalized read model. Not a spelling choice; the recon found four competing shapes.

```text
env.protected_area     = canonical normalized read model
ogr2ogr source shape   ≠ canonical schema authority
skyddstyp              = source observation
protection_type        = normalized canonical discriminator
```

DB-3 still owns: the physical name/schema of the source-faithful layer (no raw-schema convention
exists yet, so DB-1 deliberately left it open), and the explicit governed transform.

The original prohibition stands and was shown to have already been violated: DB-1 §3c found that
`tests/setup/seedGisStubs.ts` fabricates `nvr_id, name, protection_type, decision_status` — exactly
the contract production lacks. That is how this stayed hidden.

---

## Ordering against the other open units

```
1. TEST_DISCOVERY_WORKTREE_ISOLATION-01     done — see this unit's commit
2. Type-check the LU verdict consumer boundary   affects release proof
3. DB-1                                     FROZEN 2026-08-18
4. DB-0-SAFETY                              P0 — destructive-path guard
5. DB-2 / DB-3                              either order, WIP=1
6. tsx/libuv exit-127 in harvest runner
7. QUARANTINE_DEDUP_INDEX-01
8. P2-RUNTIME-01 core variant
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
