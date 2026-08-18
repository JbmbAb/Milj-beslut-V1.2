# SPATIAL-SCHEMA-OWNERSHIP-01 — FROZEN

**Status:** **RECON COMPLETE — OWNER DECISION FROZEN.** Implementation is not part of this unit.
**Frozen:** 2026-08-18 by repository owner.
**Database inspected:** `miljobeslut` @ localhost:5432 (the production instance named in `.env`), read-only.
**Date of inspection:** 2026-08-17.

```text
RECON              COMPLETE
OWNER DECISION     FROZEN
IMPLEMENTATION     NOT PART OF THIS UNIT
THREAD STATUS      READY TO CLOSE AFTER FREEZE IS COMMITTED
```

Sections 1–3c below are the recon evidence and are unchanged. Section 0 is the frozen decision and
governs; where the earlier *recommendation* text in section 4 differs in emphasis, section 0 wins.

---

## 0. FROZEN DECISION

### 0.1 Core text

```text
SPATIAL_SCHEMA_OWNERSHIP-01 — FROZEN

1. public is Prisma-owned.
2. Current production + schema.prisma are the recovery reference
   for creation of a reconciled Prisma baseline.
3. After reconciliation, public DDL changes occur only through
   the governed Prisma migration chain.
4. env, core, hydro, climate and canonical topo spatial objects
   are owned by a versioned spatial DDL chain independent of Prisma.
5. ETL, ogr2ogr and source files are data materializers.
   They MUST NOT implicitly define canonical database schemas.
6. lm_staging is ETL-owned ephemeral state and carries no
   canonical product authority.
7. Test provisioning consumes canonical DDL.
   Test helpers MUST NOT define alternative production semantics.
8. core.property_unit and core.normalize_designation receive one
   canonical definition in the spatial DDL chain.
   Embedded copies in ETL/test utilities are non-authoritative.
9. env.protected_area is a canonical normalized read model.
   Source-faithful NVR attributes are preserved in a separate
   source materialization layer and transformed explicitly.
10. hydro.water_catchment must have an authored, versioned creator
    before LU cold-start reproducibility can be claimed.
11. Unknown/dead relations such as topo10.vatten and
    env.kulturmiljo_omrade remain NOT_PROVEN until explicitly
    admitted to the spatial chain or their consumers are removed.
```

### 0.2 The central invariant

```text
UPSTREAM FILE SCHEMA
≠ canonical database schema

ogr2ogr
= loader / materializer

versioned spatial DDL
= schema authority
```

This is the load-bearing part of the freeze. Today `ogr2ogr -overwrite` lets an external agency
file define the database structure at import time (§3b). That stops.

### 0.3 Ownership by schema

| Schema / object | Authoritative owner | Rule |
|---|---|---|
| `public` | **Prisma migrations** | Prisma owns the application schema. Out-of-band DDL forbidden after baseline reconciliation. |
| `env` | **Versioned spatial DDL chain** | ETL/ogr2ogr may fill data but **must not define the table contract**. |
| `core` | **Versioned spatial DDL chain** | Same contract for `property_unit`, functions, triggers, indexes. |
| `hydro` | **Versioned spatial DDL chain** | Incl. `hydro.water_catchment`; must be cold-startable. |
| `climate` | **Versioned spatial DDL chain** | Not Prisma. |
| `topo10` | **Versioned spatial DDL chain, or the code is retired** | Must not remain an implicit runtime assumption. |
| `lm_staging` | **ETL-owned, ephemeral staging** | No product code may treat it as canonical schema. |
| spatial test DDL | **No owner** | Tests consume canonical DDL; they may not invent alternative production contracts. |

### 0.4 `public` — baseline reconciliation, not catch-up migrations

Two distinct time concepts are frozen:

```text
CURRENT RECOVERY REFERENCE
= production + schema.prisma

FUTURE AUTHORITY
= Prisma migration chain
```

Not contradictory. The recon shows `schema.prisma` substantially matches production while the
migration history does not (§1b). The broken chain is therefore **not** to be forced onto
production. Instead: (1) inventory and ratify the intended production state, (2) create a new
controlled Prisma baseline, (3) migrations resume as sole DDL authority for `public`.

**Chosen: baseline reconciliation.** Explicitly rejected: a long series of catch-up migrations
imitating a history that already contains created-then-vanished tables.

### 0.5 `env.protected_area` — decision C

Neither A nor B as exclusive winner. **C: source-faithful materialization + a separate canonical
normalized read model.**

```text
SOURCE-FAITHFUL LAYER
NVR: nvrid, namn, skyddstyp, beslstatus, ...
            ↓ explicit governed transform
CANONICAL PROTECTED-AREA MODEL
nvr_id / source_id, name, protection_type, decision_status, source_dataset, ...
```

Raw data stays faithful to the agency source; normalization becomes an explicit transformation
instead of a hidden `ogr2ogr -sql`.

`env.protected_area` denotes the **canonical normalized read model** — the name is generic and the
application already expects multiple protection types. The source-faithful NVR materialization
must therefore **stop competing for that same name**. Its exact name/schema is DB-3's to settle
(e.g. a `raw`/`source` surface, or dataset-specific materialization); DB-1 deliberately does not
fix a new physical name while the repo has no established raw-schema convention.

```text
skyddstyp        = source observation
protection_type  = normalized canonical discriminator
```

Both legitimate — at different layers.

### 0.6 `core.property_unit` and `core.normalize_designation`

The three competing DDL definitions (§3b) are replaced by **one versioned spatial definition**.
`scripts/db/sync-property-unit-from-env.ts` may in future do `populate / refresh / transform`, but
**not** `CREATE TABLE`, `CREATE FUNCTION`, `CREATE TRIGGER`, or define the index contract. Same for
`core.normalize_designation` — and that one matters especially because the test definition has
**different semantics**, not merely duplication (§3c).

### 0.7 `TEST_SCHEMA_PARITY-01` — frozen invariant

```text
TEST_SCHEMA_PARITY-01
Tests may instantiate or seed canonical schemas.
Tests may not independently define production schema semantics.
```

Both `scripts/db/provision-spatial-test-db.ts` and `tests/setup/seedGisStubs.ts` are
**consumers/materializers, not authority**. `seedGisStubs.ts` may not create a convenient
`protected_area` with `nvr_id`, `name`, `protection_type` just to make tests pass. That finding
explains how DB-3 stayed hidden: the test environment fabricated exactly the contract production
lacked.

---

## 1. Correction to the original finding

The finding named four unowned objects and identified the Prisma chain as the sole candidate owner. Inspection changes the picture in three ways, each of which makes the problem larger rather than smaller.

**a) A second migration chain exists in the repository, and it has never been applied to production.**

`prisma/spatial/*.sql` is applied by `scripts/db/spatial-bootstrap.ts` (`npm run db:spatial`), which records each file with a checksum in a `spatial_migrations` ledger table. That chain does claim ownership of `core.property_unit` and `core.normalize_designation` — in `prisma/spatial/004_property_unit_core.sql`.

But the ledger table `spatial_migrations` **does not exist in the production database**. The bootstrap creates it unconditionally on first run, so its absence is proof that `npm run db:spatial` has never been run against production. `prisma/spatial/` is therefore not the owner of anything in production; it is an unapplied parallel chain whose contents happen to resemble what is there.

**b) The drop is not one table, it is eleven.**

`20260513044100_rename_filename_to_name_in_spatial_migrations` is a Prisma drift-sync migration. It DROPs:

`core.lm_byggnad`, `core.lm_mark`, `env.natura2000_area`, `env.protected_area`, `env.sgu_blockighet`, `env.sgu_landslide_feature`, `env.sgu_punktobjekt`, `env.sgu_soil_type`, `env.sgu_soil_type_25k_100k`, `env.sgu_well`, `env.water_protection_area`

A later migration, `20260608085544_sync_schema_and_organisation`, DROPs a further six. The net effect of the Prisma chain on `env`/`core` is: create empty stubs in `20260512194513`, then drop all of them. **The Prisma chain today owns no spatial object in production.** Every one of those tables nonetheless exists in production, populated — meaning they were rebuilt outside both chains after the drops ran.

**c) `env.sgu_well` in production is a table, not a view, and the compat chain would not reproduce it.**

`prisma/spatial/003_sgu_compat_views.sql` defines `env.sgu_well` as `CREATE VIEW ... AS SELECT * FROM env.sgu_well_actual`. In production `env.sgu_well` is a **table** with 831,332 rows and 270 MB, and `env.sgu_well_actual` **does not exist**. The same applies to `env.sgu_ground_layer_1m` over `env.sgu_bedrock` — neither side exists. Running the spatial chain against production today would not recreate production; parts of it would fail or produce different objects.

**Net position: production's entire spatial schema is unowned by any committed chain.** The four objects in the finding were a sample, not the set.

---

## 2. Inventory (task item 1)

### 2a. The governed LU path — `SpatialLayerRegistry`

`packages/spatial-provider-postgis/src/SpatialLayerRegistry.ts` is fail-closed and binds exactly three layers. This is the authoritative list for the spatial provider:

| Layer | Table | Rows | Size | Created by a migration? |
|---|---|---|---|---|
| `water` | `env.sgu_well` | 831,332 | 270 MB | **No** — created then DROPped by Prisma; spatial chain defines it as a view over a table that doesn't exist |
| `ebh` | `env.ebh_potentiellt_fororenade_omraden` | 85,429 | 21 MB | **No** — appears in no migration in either chain |
| `protected_area` | `env.protected_area` | 6,002 | 21 MB | **No** — created then DROPped by Prisma |

All three governed layers are unowned. The provider's fail-closed guarantee covers *which* layers may be queried, not whether those layers can be rebuilt.

### 2b. Data-bearing objects in `env`/`core`/`hydro`

Ordered by irreplaceability. None of these is created by any applied migration.

| Object | Rows | Size | Notes |
|---|---|---|---|
| `core.property_unit` | 4,642,928 | 6,368 MB | + trigger `property_unit_normalize_trg`, 6 indexes incl. GIN trgm |
| `env.registerenhetsomradesytor` | 4,395,642 | 2,707 MB | Lantmäteriet register units |
| `env.sgu_soil_type_25k_100k` | 999,999 | 2,225 MB | note: exactly 999,999 — see §5 |
| `env.sgu_well` | 831,332 | 270 MB | governed layer |
| `env.ebh_potentiellt_fororenade_omraden` | 85,429 | 21 MB | governed layer |
| `env.sks_nyckelbiotoper` | 67,097 | 66 MB | not in any migration or the registry |
| `env.sgu_landslide_feature` | 50,373 | 12 MB | DROPped by Prisma chain |
| `hydro.water_catchment` | 24,296 | 198 MB | only object in `hydro` |
| `env.protected_area` | 6,002 | 21 MB | governed layer |
| `env.water_protection_area` | 1,643 | 20 MB | DROPped by Prisma chain |
| `env.natura2000_area` | 455 | 5.3 MB | DROPped by Prisma chain |

**≈ 11.9 GB of national geodata, reproducible from no committed source.**

Functions, also unowned by any applied migration: `core.normalize_designation(text)`, `core.trg_property_unit_normalize()`.

### 2c. Empty stub tables

Present but 0 rows: `core.lm_mark`, `core.lm_byggnad`, `env.registerenhetsomradeslinjer`, `env.sgu_soil_type`, `env.sgu_blockighet`, `env.sgu_punktobjekt`, `env.sgu_fastmark_stabilitet`, `env.sgu_aktsamhet_efterarbetad`, `env.env_sgu_grundvatten_sarbarhet`, `env.msb_stabilitetszon`, `env.msb_stora_olyckor`, `env.msb_pfra_pastevent`, `env.sgu_jorddjupsmodell_10m`, `env.sgu_jorddjupsmodell_bergyta_50m`, `env.svaro_2016`, `env.viss_sw_varo_risk`.

These are safe to drop or adopt without data risk. They should still be decided deliberately, not left ambiguous.

### 2d. Referenced by live code but absent from production

This is a second defect the inventory surfaced. These objects are queried by server routes and services, and **do not exist**:

| Object | Referenced from |
|---|---|
| `topo10.vatten`, `topo10.vag`, `topo10.byggnad`, `topo10.mark` | `server/services/publicUiService.ts`, `server/services/spatialAuditService.ts`, `server/modules/property/propertyPipelineContext.ts` |
| `hydro.streams`, `hydro.lakes` | `server/routes/gis.routes.ts`, `server/datasources/mapLayerCatalog.ts`, `components/MapView.tsx` |
| `env.marktacke` | `server/services/markCoverService.ts` |
| `env.nv_naturreservat` | `server/routes/geodata.routes.ts` |
| `env.lst_vattenskyddsomrade`, `env.raa_fornlamning`, `env.friluftsliv`, `env.friluftsliv_leder`, `env.wetland`, `env.kulturmiljo_omrade`, `env.geo_master_archive` | various routes/scripts |
| `env.sgu_ground_layer`, `env.sgu_ground_layer_1m`, `env.sgu_well_actual`, `env.sgu_bedrock`, `env.sgu_erosion_feature`, `env.sgu_permeability`, `env.sgu_aktsamhetsomrade` | SGU import/compat paths |
| `lm.fastighet`, `lm.fastighet_app_v`, `audit.property_change_log` | `prisma/spatial/01_setup_partitioned_properties.sql` (never applied) |

The `topo10` and `hydro` schemas exist but are empty or near-empty. The `lm` schema does not exist at all (only `lm_staging`). The migration-chain/running-system disagreement noted in the original finding is therefore bidirectional: the chain drops things the app uses, and the app queries things nothing has ever created.

---

## 3. Authoritative definitions captured (task item 2)

Full column/type/index/constraint definitions for the eleven data-bearing objects, plus both function bodies and the trigger definition, were read from production and are reproduced in the appendix below. Two points worth flagging now:

**The test-database DDL diverges from production.** `scripts/db/provision-spatial-test-db.ts` creates `env.sgu_well` with two columns (`id`, `geom`); production has 33. `env.protected_area` is created with four columns; production has five (`ogc_fid` PK, not `nvrid`). `env.ebh_...` is created with `fid`/`geom`; production has 13 columns. The script is honest that it creates "the minimum the tests touch" — but it means the spatial proofs run against a schema shape that is not production's, so a query depending on any other column would pass provisioning and fail in production.

**`core.property_unit` in production carries NOT NULL constraints the test DDL omits** — `source_key`, `designation`, `designation_norm`, `source_dataset` are all NOT NULL in production and nullable in the test database, and production has a `BEFORE INSERT OR UPDATE` trigger populating `designation_norm` that the test database does not have. Tests inserting a row without `source_dataset` pass locally and would fail in production.

---

## 3b. Ownership freeze table (DB-1)

Per-object determination. `TARGET OWNER` was proposed here and is now **RATIFIED** by the freeze (§0.3).

| OBJECT | CURRENT CREATOR | CURRENT OWNER | PRODUCTION CREATION PATH | TEST CREATION PATH | MIGRATION STATUS | TARGET OWNER (ratified) | OPEN CONFLICT |
|---|---|---|---|---|---|---|---|
| `core.property_unit` | `scripts/db/sync-property-unit-from-env.ts` (embedded `CREATE TABLE IF NOT EXISTS`) | **None.** De facto an ETL script | Sync script creates the table, then populates from `env.registerenhetsomradesytor` | `provision-spatial-test-db.ts` | Absent from Prisma chain. Defined in `prisma/spatial/004`, **never applied** | Versioned spatial chain | **3 competing DDLs.** Production is a hybrid: sync-script shape + trigger `property_unit_normalize_trg` (only in `004`) + `property_unit_municipality_name_idx` (in no repo artifact). Test DDL drops all NOT NULLs and the trigger |
| `core.normalize_designation(text)` | `sync-property-unit-from-env.ts` via `CREATE OR REPLACE` | **None.** Last writer wins, silently | Sync script | `provision-spatial-test-db.ts` (verbatim copy) **and** `tests/setup/seedGisStubs.ts` (divergent — see §3c) | Absent from Prisma chain. In `prisma/spatial/004`, never applied | Versioned spatial chain | **4 copies, and they are not all the same function.** Three agree; `seedGisStubs.ts` has different semantics *and* a different parameter name. Requires `unaccent` |
| `env.sgu_well` | **`ogr2ogr`** — `bulk-import-platform-all.ts` + `importRegistry.ts:275`, `-nln sgu_well -overwrite` | **Upstream SGU file schema.** DDL is inferred at import, authored nowhere | ogr2ogr from SGU source → 33 cols, `MultiPoint,3006`, GiST + BRIN, **no PK** | `provision-spatial-test-db.ts` → 2 cols (`id`, `geom`), `Geometry` not `MultiPoint` | Stub created by `20260512194513`, **DROPped** by `20260513044100`. `prisma/spatial/003` defines it as a **VIEW** over `env.sgu_well_actual`, which does not exist | Versioned spatial chain (structure); import remains data-only | **3 mutually incompatible definitions** (33-col table / dropped / view over a missing table). `-overwrite` silently redefines the table on every import |
| `env.ebh_potentiellt_fororenade_omraden` | **`ogr2ogr`** — `importRegistry.ts:675` (Länsstyrelsen zip) | **Upstream LST file schema** | ogr2ogr → 13 cols, `MultiPoint,3006`, GiST, no PK | `provision-spatial-test-db.ts` → 2 cols | **None, in either chain.** The only one of the five with zero migration representation anywhere | Versioned spatial chain | Prod/test shape divergence only. No competing repo definition — because there is none at all |
| `env.protected_area` | **`ogr2ogr`** — `importRegistry.ts:516` (NVR) | **Upstream NVR file schema** | ogr2ogr → `ogc_fid, geom, nvrid, namn, skyddstyp` | **Two divergent test creators:** `provision-spatial-test-db.ts` → `nvrid` PK, `namn`, `skyddstyp`; `tests/setup/seedGisStubs.ts` → `nvr_id` PK, `name`, `protection_type`, `decision_status`, `wkb_geometry`, `geom` | Stub created by `20260512194513`, **DROPped** by `20260513044100`. `subdivide-complex-polygons.sql` defines a further shape | Versioned spatial chain | **DB-3, and larger than a spelling — 4 competing shapes.** The app assumes `nvr_id, name, protection_type, decision_status`; **none of those four columns exists in production**. See §3c |

### 3c. `tests/setup/seedGisStubs.ts` — a second test creator, and how DB-3 got pre-decided

`tests/setup/database.ts:90` calls `applyGisTestStubs()`, so this file — not only `provision-spatial-test-db.ts` — creates spatial objects for the test suite. Three consequences.

**1. It creates `env.protected_area` in the shape the application queries, which is not production's shape.**

```sql
CREATE TABLE IF NOT EXISTS "env"."protected_area" (
    nvr_id TEXT PRIMARY KEY, name TEXT, protection_type TEXT, decision_status TEXT,
    wkb_geometry geometry(MultiPolygon, 3006), geom geometry(MultiPolygon, 3006)
);
```

Production has `ogc_fid, geom, nvrid, namn, skyddstyp`. The test fixture invents exactly the four columns `publicUiService.ts` and `nvrService.ts` select, so those queries pass in test and would fail against production. **This is the mechanism by which DB-3 was already settled by test convenience** — the outcome DB-3 explicitly forbids. It was not decided; it was made invisible.

**2. `core.normalize_designation` here is a different function, not a copy.**

| | Body | Effect on `"Stockholm AB:1"` |
|---|---|---|
| Production / sync / `004` / `provision-…` | `UPPER(REGEXP_REPLACE(UNACCENT(input), '[^a-zA-Z0-9:]', '', 'g'))` | `STOCKHOLMAB:1` — strips to empty, **keeps `:`** |
| `seedGisStubs.ts` | `trim(regexp_replace(upper(unaccent(input_text)), '[^A-Z0-9]', ' ', 'g'))` | `STOCKHOLM AB 1` — replaces with **spaces**, **drops `:`** |

Designation lookups are therefore validated in test against different normalisation than production performs. The parameter is also renamed `input` → `input_text`; PostgreSQL rejects a `CREATE OR REPLACE` that renames an existing parameter (`cannot change name of input parameter`), so on any database where the other definition already exists this statement errors rather than replacing.

**3. It has no database-name guard, and its fallback target is production.** *(Safety finding — outside the ownership question, reported because it was found here.)*

The file loads `.env.test` with `override: false` and then `dotenv.config()` (`.env`). If `.env.test` is missing, `DATABASE_URL` resolves to `.env` — production `miljobeslut`. It then runs, with no guard on the resolved database name:

```
DROP EXTENSION IF EXISTS postgis CASCADE;   -- drops every geometry column in the database
DROP TABLE IF EXISTS env.registerenhetsomradesytor CASCADE;   -- + ~20 more
```

`.env.test` is gitignored (`.gitignore:30`) and untracked. **On a clean checkout it does not exist**, so running the test suite before copying `.env.test.example` targets production and destroys the ≈11.9 GB inventoried in §2b. `provision-spatial-test-db.ts` guards against exactly this by checking the resolved database name; `seedGisStubs.ts` does not. Unverified whether this has ever fired — reported as an unguarded path, not an incident.

### Item 6 — Prisma's role, per schema

- **`env`, `core`, `topo10`, `hydro`, `lm`, `audit`:** Prisma is **neither owner nor consumer**. It does not model a single one of these tables in `schema.prisma`; the application reaches them through raw SQL. Prisma is a **metadata layer that actively causes harm here** — `migrate dev` sees tables it does not know and emits DROPs, which is precisely what produced `20260513044100` and `20260608085544`.
- **`public`:** Prisma **is** the owner (Prisma models, Prisma-generated migrations). DB-2 lives here.

### Item 8 — dependency of DB-2 and DB-3 on this freeze

**DB-3 — `SPATIAL_PROTECTED_AREA_COLUMN_CONTRACT-01` — depends directly.** Production carries `nvrid, namn, skyddstyp` because ogr2ogr copied the NVR source attribute names. The application queries `pa.nvr_id`, `pa.name`, `pa.protection_type` (`server/services/publicUiService.ts`, `nvrService.ts`, `spatialAuditService.ts`, `hybridGeoService.ts`) — columns that do not exist in production. DB-1's answer decides which side is canonical:

- if the **upstream source file** is canonical → `nvrid/namn/skyddstyp` stands and the application is wrong;
- if an **authored schema contract** is canonical → the import needs a mapping layer and `nvr_id/name/protection_type` stands.

This is not a spelling choice and must not be settled by whichever makes tests pass. **Not chosen here — it is DB-3's decision, and it is blocked on this freeze.**

**DB-2 — `PRISMA_SCHEMA_MIGRATION_DRIFT-01` — depends on the item-6 verdict.** `DocumentChunk.parameters_extracted` and `.embedding` were created out of band — the same pathology as DB-1, in the schema Prisma does own. If the freeze confirms *Prisma owns `public`, the spatial chain owns the rest*, DB-2's fix is to bring both columns back under the Prisma chain. If the freeze puts ownership elsewhere, DB-2's fix changes shape. **Not chosen here.**

> **WIP note:** two untracked migration directories are already sitting in the working tree — `20260817120000_document_chunk_parameters_extracted_and_embedding` (explicitly headed `PRISMA_SCHEMA_MIGRATION_DRIFT-01`, i.e. DB-2) and `20260817140000_legal_corpus_materialization_v1`. Neither is applied to production. With `ACTIVE WIP=1` and DB-1 unfrozen, DB-2 work exists before its blocker is resolved. Flagged, not touched.

---

## 4. Recommendation as submitted (superseded by §0)

> Retained as the record of what was put to the owner. The freeze in §0 adopted this direction and
> went further on three points: `public` is resolved by **baseline reconciliation** (§0.4),
> `env.protected_area` is resolved by **decision C** rather than by choosing one existing shape
> (§0.5), and `TEST_SCHEMA_PARITY-01` is added as a frozen invariant (§0.7). Where the two differ,
> §0 governs.

### 4.1 Original text

**Recommended owner: a separate versioned spatial-schema migration set — the existing `prisma/spatial/` chain, repaired and adopted — not the Prisma migration chain.**

Rationale:

1. **The Prisma chain must be actively excluded, not merely passed over.** The damage here was caused *by* Prisma owning these objects: `prisma migrate dev` compares the live database against `schema.prisma`, sees tables it does not know, and generates DROPs. That is exactly what produced `20260513044100` and `20260608085544`. As long as these tables live in a schema Prisma introspects, any developer running `migrate dev` regenerates a drop migration for 11.9 GB of national geodata. This is a live, recurring hazard, not a historical one.

2. **The mechanism already exists and is checksum-versioned.** `spatial-bootstrap.ts` applies files in lexicographic order and records SHA-256 checksums with re-application detection. It needs correcting, not inventing.

3. **An external provisioning step committed to the repo is strictly weaker** — it has no ledger, so there is no way to ask a database which version of the spatial schema it is at. The bootstrap ledger answers that question.

### Required repairs before the spatial chain can be called the owner

- **Configure `prisma migrate` to leave these schemas alone.** Prisma's multi-schema support takes an explicit schema list; `env`, `core`, `topo10`, `hydro`, `lm`, `audit` must be outside it. Without this, item 1 above recurs. This is the highest-priority item and is independent of everything else.
- **Reconcile `003_sgu_compat_views.sql` with reality.** It defines `env.sgu_well` as a view over a nonexistent table while production has it as a populated table. Left as-is, the chain is not merely incomplete, it is wrong.
- **Write the missing DDL** for the objects in §2b from the captured definitions, as `IF NOT EXISTS` create statements — so applying the chain to production is a verified no-op, and applying it to an empty database rebuilds the structure.
- **Backfill the ledger.** Run the repaired chain against production once so `spatial_migrations` reflects what is actually applied.
- **Decide §2d separately.** Either the missing objects get definitions, or the code paths referencing them are dead and should be removed. That is a distinct unit of work; it should not be folded into this one.

### Explicitly not recommended

Generating a Prisma migration from the current database state via introspection. It would place these tables under Prisma's control, which is the failure mode being fixed.

---

## 5. Open questions — disposition after freeze

1. **`env.sgu_soil_type_25k_100k` has exactly 999,999 rows.** Not a plausible natural count for a
   national soil-type dataset; it is the signature of a capped import. **Still open.** Not resolved
   by the freeze — it is a data-completeness question, not an ownership one. Carry it into whichever
   unit authors the spatial chain definition for that table.
2. **Empty stubs (§2c) — drop or define?** **Resolved in principle** by §0 item 11: they remain
   `NOT_PROVEN` until explicitly admitted to the spatial chain or their consumers are removed. The
   per-object call belongs to the implementing unit.
3. **Is `lm.fastighet` (partitioned) intended?** **Still open.** It has never been created and
   `core.property_unit` appears to serve that role. If the partitioned design is abandoned,
   `prisma/spatial/01_setup_partitioned_properties.sql` should be removed rather than left as an
   unapplied instruction.

---

## 6. Handoff — what this unit hands to whom

This unit is recon + decision. **It writes no migration and changes no schema.**

### 6.1 NEXT — P0 safety unit, ahead of DB-2 and DB-3

**Thread name: "Prevent test GIS seeding from targeting production"**

```text
SEVERITY   CRITICAL SAFETY GUARD
STATUS     KNOWN_BROKEN
RULE       test/destructive DB utilities must positively prove
           they target an approved disposable test database
           before any DROP/CREATE operation
```

Evidence in §3c item 3: `tests/setup/seedGisStubs.ts` falls back to `.env` (production
`miljobeslut`) when the untracked `.env.test` is absent, then runs `DROP EXTENSION postgis CASCADE`
with no database-name guard. This precedes ordinary DB-2/DB-3 implementation because a mistaken
test invocation can destroy production. **This unit hands the finding over; it does not fix it.**

### 6.2 DB-2 — `PRISMA_SCHEMA_MIGRATION_DRIFT-01`

```text
UNBLOCKED conceptually
OWNER      Prisma
STRATEGY   reconcile/baseline public first,
           then restore missing DocumentChunk contract through Prisma authority
DO NOT     use the spatial provisioner as schema authority
```

The two untracked migration directories already in the working tree (§ WIP note) predate the
baseline decision and must be re-assessed against §0.4 before use.

### 6.3 DB-3 — `SPATIAL_PROTECTED_AREA_COLUMN_CONTRACT-01`

```text
UNBLOCKED conceptually
DECISION   C — source-faithful materialization
           + explicit canonical normalized protected-area model
env.protected_area          = canonical model
ogr2ogr source shape        ≠ canonical schema authority
```

DB-3 still owns: the physical name/schema of the source-faithful layer, and the explicit transform.

### 6.4 The 13 previously modified files are NOT approved by this freeze

They implemented **B-convergence** toward today's passthrough schema. The freeze chose **C**. Each
must be re-inventoried hunk by hunk before any of it is used. Do not commit or revert them wholesale.

---

## Appendix — authoritative definitions from production

### `core.property_unit` (4,642,928 rows)

```
id                integer NOT NULL DEFAULT nextval('core.property_unit_id_seq'::regclass)
source_key        text NOT NULL
designation       text NOT NULL
designation_norm  text NOT NULL
municipality_code text
municipality_name text
county_code       text
source_dataset    text NOT NULL
source_updated_at timestamp with time zone
raw_properties    jsonb
geom              geometry(MultiPolygon,3006)

PRIMARY KEY (id)
UNIQUE (source_key)
CREATE INDEX property_unit_designation_norm_idx      ON core.property_unit USING btree (designation_norm)
CREATE INDEX property_unit_designation_norm_trgm_idx ON core.property_unit USING gin (designation_norm gin_trgm_ops)
CREATE INDEX property_unit_geom_gist_idx             ON core.property_unit USING gist (geom)
CREATE INDEX property_unit_municipality_name_idx     ON core.property_unit USING btree (municipality_name)

CREATE TRIGGER property_unit_normalize_trg
  BEFORE INSERT OR UPDATE OF designation ON core.property_unit
  FOR EACH ROW EXECUTE FUNCTION core.trg_property_unit_normalize()
```

Requires the `pg_trgm` extension (for the GIN index) and `unaccent` (for the function below).

### `core.normalize_designation(text)` and `core.trg_property_unit_normalize()`

```sql
CREATE OR REPLACE FUNCTION core.normalize_designation(input text)
 RETURNS text LANGUAGE plpgsql IMMUTABLE
AS $function$
BEGIN
  RETURN UPPER(REGEXP_REPLACE(UNACCENT(input), '[^a-zA-Z0-9:]', '', 'g'));
END;
$function$

CREATE OR REPLACE FUNCTION core.trg_property_unit_normalize()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.designation_norm := core.normalize_designation(NEW.designation);
  RETURN NEW;
END;
$function$
```

### `env.sgu_well` (831,332 rows) — governed layer `water`

```
id integer, obsplatsid varchar(50), brunnsid bigint, n double precision, e double precision,
posvardering_kod varchar(1), posvardering varchar(255), kommunkod varchar(4), kommunnamn varchar(200),
fastighet varchar(40), ort varchar(50), lage_specifikt varchar(60), borrdatum varchar(8),
tecken_vattenmangd varchar(1), kapacitet integer, tecken_niva varchar(1), grundvattenniva real,
nivadatum varchar(20), bottendiam real, totaldjup real, tecken_jorddjup varchar(1), jorddjup real,
rorborrning_till real, stalror_till real, plastror_till real, tatning_kod varchar(1),
tatning varchar(255), anvandning_kod varchar(3), anvandning varchar(255), gradborrning varchar(30),
allman_anmarkning varchar(1000), grundvattenanmarkning varchar(500),
geom geometry(MultiPoint,3006)

CREATE INDEX idx_sgu_well_geom    ON env.sgu_well USING gist (geom)
CREATE INDEX idx_sgu_well_brin_id ON env.sgu_well USING brin (id) WITH (pages_per_range='128')
```

No primary key in production.

### `env.ebh_potentiellt_fororenade_omraden` (85,429 rows) — governed layer `ebh`

```
fid integer, ebh_id bigint, n bigint, e bigint, kommun varchar(30), lan varchar(30),
p_bransch varchar(254), s_bransch varchar(254), fastighet bigint, preciserad varchar(29),
riskklass varchar(254), status varchar(254),
geom geometry(MultiPoint,3006)

CREATE INDEX idx_ebh_potentiellt_fororenade_omraden_geom
  ON env.ebh_potentiellt_fororenade_omraden USING gist (geom)
```

No primary key in production.

### `env.protected_area` (6,002 rows) — governed layer `protected_area`

```
ogc_fid   integer
geom      geometry(MultiPolygon,3006)
nvrid     varchar(254)
namn      varchar(254)
skyddstyp varchar(254)
```

Note the divergence from the test DDL: production keys on `ogc_fid`, not `nvrid`.

### `env.registerenhetsomradesytor` (4,395,642 rows)

```
fid integer, objektidentitet varchar, registerenhetsreferens varchar, objekttyp varchar,
senastandrad timestamptz, lanskod varchar, kommunkod varchar, kommunnamn varchar,
trakt varchar, block varchar, enhet bigint, omradesnummer smallint, samjelittera varchar,
osakertlage boolean, etikett varchar,
geom geometry(MultiPolygon,3006)

CREATE INDEX idx_registerenhetsomradesytor_geom    ON env.registerenhetsomradesytor USING gist (geom)
CREATE INDEX idx_registerenhetsomradesytor_brin_fid ON env.registerenhetsomradesytor USING brin (fid) WITH (pages_per_range='128')
```

All geometry columns across the inventory are SWEREF99 TM (EPSG:3006), consistent with the registry contract.
