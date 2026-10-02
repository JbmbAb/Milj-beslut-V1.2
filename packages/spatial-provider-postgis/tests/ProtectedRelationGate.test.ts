import { describe, expect, it } from "vitest";
import { SPATIAL_LAYER_REGISTRY } from "../src/SpatialLayerRegistry";
import {
  PROTECTED_RELATIONS,
  classifyRelation,
  classifySchema,
  parseProtectedRelationsDefinition,
  parseRelationName,
} from "../src/ProtectedRelations";
import {
  ProtectedRelationGateError,
  REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION,
  REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE,
  REJECT_RETIRED_DESTRUCTIVE_SCRIPT,
  REJECT_UNSANCTIONED_DERIVED_REBUILD,
  assertOgr2ogrCommandAllowed,
  assertOgr2ogrWriteAllowed,
  assertSanctionedDerivedRebuild,
  assertSqlWriteAllowed,
  assertUngovernedDestructiveWriteAllowed,
  extractSqlWriteTargets,
  gatedSql,
  ogr2ogrDatabaseWriteTarget,
  refuseRetiredDestructiveScript,
  tokenizeCommandLine,
} from "../src/ProtectedRelationGate";

/**
 * U30F F1: the protected relation gate, hermetic (no database, no CAS). Every statement below is
 * text only; the gate never executes anything.
 */

const CALLER = "tests/ProtectedRelationGate.test.ts";

function refusal(fn: () => unknown): ProtectedRelationGateError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ProtectedRelationGateError);
    return error as ProtectedRelationGateError;
  }
  throw new Error("expected the gate to refuse");
}

describe("protected-relations.v1.json", () => {
  it("covers every SpatialLayerRegistry table as an LU live layer", () => {
    for (const binding of Object.values(SPATIAL_LAYER_REGISTRY)) {
      const c = classifyRelation(binding.table);
      expect(c, binding.table).toMatchObject({ kind: "PROTECTED", class: "LU_LIVE_LAYER" });
    }
  });

  it("names lm_staging as the retained-staging schema and core.property_unit as derived from the property root", () => {
    expect(PROTECTED_RELATIONS.retained_staging_schemas).toEqual(["lm_staging"]);
    const derived = PROTECTED_RELATIONS.relations.find((r) => r.relation === "core.property_unit");
    expect(derived).toMatchObject({
      class: "LU_DERIVED",
      derived_from: "env.registerenhetsomradesytor",
      sanctioned_rebuild: "scripts/db/sync-property-unit-from-env.ts",
    });
  });

  it.each([
    ["empty relations", { contract: "mimer-protected-relations-v1", retained_staging_schemas: ["lm_staging"], relations: [] }],
    ["wrong contract", { contract: "v0", retained_staging_schemas: ["lm_staging"], relations: [{ relation: "env.a", class: "LU_LIVE_LAYER", basis: "because x" }] }],
    [
      "duplicate",
      {
        contract: "mimer-protected-relations-v1",
        retained_staging_schemas: ["lm_staging"],
        relations: [
          { relation: "env.a", class: "LU_LIVE_LAYER", basis: "because x" },
          { relation: "env.a", class: "LU_LIVE_LAYER", basis: "because x" },
        ],
      },
    ],
    ["unknown class", { contract: "mimer-protected-relations-v1", retained_staging_schemas: ["lm_staging"], relations: [{ relation: "env.a", class: "X", basis: "because x" }] }],
    ["derived without rebuild", { contract: "mimer-protected-relations-v1", retained_staging_schemas: ["lm_staging"], relations: [{ relation: "core.a", class: "LU_DERIVED", basis: "because x" }] }],
    ["table inside the staging schema", { contract: "mimer-protected-relations-v1", retained_staging_schemas: ["lm_staging"], relations: [{ relation: "lm_staging.a", class: "LU_LIVE_LAYER", basis: "because x" }] }],
  ])("a malformed definition is refused, never shrunk (%s)", (_label, doc) => {
    expect(() => parseProtectedRelationsDefinition(doc)).toThrow(/PROTECTED_RELATIONS_DEFINITION_INVALID/);
  });
});

describe("relation names resolve the way PostgreSQL resolves them", () => {
  it.each([
    ["env.sgu_well", { schema: "env", table: "sgu_well" }],
    ['"env"."sgu_well"', { schema: "env", table: "sgu_well" }],
    ["ENV.SGU_WELL", { schema: "env", table: "sgu_well" }],
    ['"Env"."SGU_WELL"', { schema: "Env", table: "SGU_WELL" }],
    ["ONLY env.sgu_well", { schema: "env", table: "sgu_well" }],
    ["miljobeslut.env.sgu_well", { schema: "env", table: "sgu_well" }],
    ["sgu_well", { schema: null, table: "sgu_well" }],
    ["  lm_staging . sgu_well_2b4b514f ", { schema: "lm_staging", table: "sgu_well_2b4b514f" }],
  ])("%s", (raw, expected) => {
    expect(parseRelationName(raw)).toEqual(expected);
  });

  it.each(["", "$1", "env.", "a.b.c.d", "env.sgu well"])("%j is not a relation name", (raw) => {
    expect(parseRelationName(raw)).toBeNull();
  });
});

describe("classification", () => {
  it.each([
    ["env.sgu_well", "LU_LIVE_LAYER"],
    ["ENV.SGU_WELL", "LU_LIVE_LAYER"],
    ["env.registerenhetsomradesytor", "LU_LIVE_LAYER"],
    ["env.registerenhetsomradesytor_g12", "LU_LIVE_LAYER"],
    ["env.registerenhetsomradesytor_default", "LU_LIVE_LAYER"],
    ["climate.flood_risk_area", "LU_LIVE_LAYER"],
    ["env.sgu_landslide_feature", "LU_LIVE_LAYER"],
    ["core.property_unit", "LU_DERIVED"],
    ["lm_staging.ebh_potentiellt_fororenade_omraden_02fccffc", "RETAINED_STAGING"],
    ["lm_staging.anything_at_all", "RETAINED_STAGING"],
    ["sgu_well", "LU_LIVE_LAYER"],
    ["sgu_well_2b4b514f", "RETAINED_STAGING"],
  ])("%s is protected (%s)", (name, cls) => {
    expect(classifyRelation(name)).toMatchObject({ kind: "PROTECTED", class: cls });
  });

  it.each([
    "env.sgu_well_actual",
    "env.sgu_well_lager",
    "public.env_registerenhetsomradesytor",
    "env.protected_area_legacy",
    "stage.n2k_spa_raw",
    "topo10.byggnad",
    '"Env"."SGU_WELL"',
    "env.sgu_soil_type",
    "env.water_catchment",
  ])("%s is not protected", (name) => {
    expect(classifyRelation(name)).toMatchObject({ kind: "UNPROTECTED" });
  });

  it("schemas: lm_staging and every schema holding a protected relation are protected", () => {
    for (const s of ["lm_staging", "env", "core", "climate", "hydro"]) expect(classifySchema(s), s).toMatchObject({ kind: "PROTECTED" });
    for (const s of ["stage", "transport", "topo10", "public"]) expect(classifySchema(s), s).toMatchObject({ kind: "UNPROTECTED" });
  });
});

describe("SQL write targets", () => {
  it("finds every destructive target, including list forms, renames and redefinitions", () => {
    const { targets, unresolved } = extractSqlWriteTargets(`
      TRUNCATE TABLE env.sgu_well, ONLY "lm_staging"."x_1" RESTART IDENTITY CASCADE;
      DROP TABLE IF EXISTS "lm_staging"."ebh_potentiellt_fororenade_omraden_02fccffc" CASCADE;
      DROP VIEW IF EXISTS core.property_unit CASCADE;
      CREATE OR REPLACE VIEW core.property_unit AS SELECT 1;
      ALTER TABLE env.protected_area RENAME TO protected_area_legacy;
      ALTER TABLE env.registerenhetsomradesytor SET (autovacuum_enabled = false);
      DELETE FROM ONLY core.property_unit WHERE source_dataset = 'x';
      INSERT INTO env.natura2000_area (a) SELECT a FROM stage.n2k ON CONFLICT (a) DO UPDATE SET a = excluded.a;
      UPDATE env.sgu_well w SET depth = 0;
      MERGE INTO env.sgu_well USING s ON true WHEN MATCHED THEN DELETE;
      COPY env.ebh_potentiellt_fororenade_omraden (a) FROM STDIN;
      DROP SCHEMA IF EXISTS stage, lm_staging CASCADE;
    `);
    expect(unresolved).toEqual([]);
    // U30F2 M1: targets are the canonical SQL text of the name PostgreSQL resolves (quotes only where needed).
    expect(targets).toEqual(
      expect.arrayContaining([
        { operation: "TRUNCATE", relation: "env.sgu_well" },
        { operation: "TRUNCATE", relation: "lm_staging.x_1" },
        { operation: "DROP", relation: "lm_staging.ebh_potentiellt_fororenade_omraden_02fccffc" },
        { operation: "DROP", relation: "core.property_unit" },
        { operation: "CREATE_OR_REPLACE", relation: "core.property_unit" },
        { operation: "RENAME", relation: "env.protected_area" },
        { operation: "RENAME", relation: "env.protected_area_legacy" },
        { operation: "ALTER", relation: "env.registerenhetsomradesytor" },
        { operation: "DELETE", relation: "core.property_unit" },
        { operation: "INSERT", relation: "env.natura2000_area" },
        { operation: "UPDATE", relation: "env.sgu_well" },
        { operation: "MERGE", relation: "env.sgu_well" },
        { operation: "COPY_FROM", relation: "env.ebh_potentiellt_fororenade_omraden" },
        { operation: "DROP_SCHEMA", relation: "schema:stage" },
        { operation: "DROP_SCHEMA", relation: "schema:lm_staging" },
      ]),
    );
    expect(targets.filter((t) => t.operation === "UPDATE")).toHaveLength(1);
  });

  it("reads, index and session statements are not writes; comments are not statements", () => {
    for (const sql of [
      "SELECT * FROM env.sgu_well FOR UPDATE",
      "CREATE INDEX IF NOT EXISTS idx ON env.sgu_well USING GIST (geom)",
      "VACUUM ANALYZE env.sgu_well",
      "SET maintenance_work_mem = '4GB'",
      "-- TRUNCATE env.sgu_well\nSELECT 1",
      "/* DROP TABLE env.sgu_well */ SELECT 1",
    ]) {
      expect(extractSqlWriteTargets(sql), sql).toEqual({ targets: [], unresolved: [] });
      expect(() => assertSqlWriteAllowed({ caller: CALLER, sql })).not.toThrow();
    }
  });

  it.each([
    ["TRUNCATE TABLE env.sgu_well CASCADE;", "TRUNCATE"],
    ['DROP TABLE IF EXISTS "lm_staging"."ebh_potentiellt_fororenade_omraden_02fccffc" CASCADE', "DROP"],
    ["DROP VIEW IF EXISTS core.property_unit CASCADE;", "DROP"],
    ["CREATE OR REPLACE VIEW core.property_unit AS SELECT 1", "CREATE_OR_REPLACE"],
    ["ALTER TABLE env.protected_area RENAME TO protected_area_legacy;", "RENAME"],
    ["ALTER TABLE env.scratch RENAME TO sgu_well;", "RENAME"],
    ["INSERT INTO env.sgu_well (geom) VALUES (NULL)", "INSERT"],
    ["DELETE FROM env.sgu_well WHERE id = 1", "DELETE"],
    ["DROP SCHEMA env CASCADE", "DROP_SCHEMA"],
    ["TRUNCATE sgu_well", "TRUNCATE"],
  ])("refuses %s", (sql, operation) => {
    const error = refusal(() => assertSqlWriteAllowed({ caller: CALLER, sql }));
    expect(error.code).toBe(REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION);
    expect(error.operation).toBe(operation);
    expect(error.message).toContain(CALLER);
  });

  it.each([
    "TRUNCATE $1",
    "TRUNCATE TABLE $1",
    "DROP TABLE IF EXISTS ${table}",
    "DROP SCHEMA IF EXISTS $1 CASCADE",
    "DELETE FROM ONLY $1",
    "ALTER TABLE",
  ])("refuses an unparseable target %j (fail-closed)", (sql) => {
    expect(refusal(() => assertSqlWriteAllowed({ caller: CALLER, sql })).code).toBe(REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE);
  });

  it("passes non-protected targets unchanged", () => {
    const sql = "TRUNCATE stage.sgu_landslide_raw; DROP TABLE IF EXISTS stage.n2k_spa_raw CASCADE; INSERT INTO env.sgu_ground_layer (a) VALUES (1)";
    expect(gatedSql(CALLER, sql)).toBe(sql);
  });
});

describe("ogr2ogr", () => {
  const pg = "PG:dbname='miljobeslut' host='127.0.0.1' user='u' password='p' port='1'";

  it.each([
    [["-f", "PostgreSQL", pg, "a.gpkg", "-nln", "lm_staging.ebh_potentiellt_fororenade_omraden_02fccffc", "-overwrite"], "lm_staging.ebh_potentiellt_fororenade_omraden_02fccffc", "OVERWRITE"],
    [["-f", "PostgreSQL", pg, "a.gpkg", "-nln", "env.sgu_well", "-append"], "env.sgu_well", "APPEND"],
    [["-f", "PostgreSQL", pg, "a.gpkg", "-nln", "sgu_well", "-lco", "SCHEMA=env", "-lco", "OVERWRITE=YES"], "env.sgu_well", "OVERWRITE"],
    [["-f", "PostgreSQL", `${pg} active_schema=env`, "a.gpkg", "-nln", "sgu_landslide_feature"], "env.sgu_landslide_feature", "CREATE"],
    [[pg, "a.gpkg", "-nln", "climate.flood_risk_area", "-update"], "climate.flood_risk_area", "UPDATE"],
  ])("a PostgreSQL write to a protected relation is refused (%#)", (args, relation, mode) => {
    expect(ogr2ogrDatabaseWriteTarget(args)).toEqual({ kind: "DATABASE", relation, mode });
    const error = refusal(() => assertOgr2ogrWriteAllowed({ caller: CALLER, args }));
    expect(error.code).toBe(REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION);
    expect(error.operation).toBe("OGR2OGR_WRITE");
  });

  it("file outputs are not database writes, even when the source is PostgreSQL", () => {
    expect(ogr2ogrDatabaseWriteTarget(["-f", "GPKG", "out.gpkg", "in.shp", "-overwrite", "-nln", "sgu_well"])).toEqual({ kind: "NOT_DATABASE", format: "GPKG" });
    expect(ogr2ogrDatabaseWriteTarget(["-f", "GPKG", "out.gpkg", pg, "env.sgu_well"])).toMatchObject({ kind: "NOT_DATABASE" });
    const args = ["-f", "GPKG", "out.gpkg", "in.shp", "-overwrite"];
    expect(assertOgr2ogrWriteAllowed({ caller: CALLER, args })).toBe(args);
  });

  it("a PostgreSQL write without -nln is unresolvable and refused", () => {
    expect(refusal(() => assertOgr2ogrWriteAllowed({ caller: CALLER, args: ["-f", "PostgreSQL", pg, "a.gpkg", "-overwrite"] })).code).toBe(
      REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE,
    );
  });

  it("non-protected PostgreSQL targets pass", () => {
    for (const nln of ["public.env_registerenhetsomradesytor", "stage.n2k_spa_raw", "env.sgu_ground_layer", "topo10.byggnad"]) {
      expect(() => assertOgr2ogrWriteAllowed({ caller: CALLER, args: ["-f", "PostgreSQL", pg, "a.gpkg", "-nln", nln, "-overwrite"] }), nln).not.toThrow();
    }
  });

  it("command lines are tokenised with their quotes (execSync callers)", () => {
    const command = `"C:\\Program Files\\GDAL\\ogr2ogr.exe" -f "PostgreSQL" "PG:dbname='m' host='h'" "D:/a b.gpkg" -nln env.sgu_landslide_feature -append -gt 65536`;
    expect(tokenizeCommandLine(command)).toEqual([
      "C:\\Program Files\\GDAL\\ogr2ogr.exe",
      "-f",
      "PostgreSQL",
      "PG:dbname='m' host='h'",
      "D:/a b.gpkg",
      "-nln",
      "env.sgu_landslide_feature",
      "-append",
      "-gt",
      "65536",
    ]);
    expect(refusal(() => assertOgr2ogrCommandAllowed({ caller: CALLER, command })).code).toBe(REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION);
    const ok = command.replace("env.sgu_landslide_feature", "env.sgu_ground_layer");
    expect(assertOgr2ogrCommandAllowed({ caller: CALLER, command: ok })).toBe(ok);
  });
});

describe("derived rebuild and retired scripts", () => {
  it("only the registered derivation may rebuild core.property_unit", () => {
    expect(() =>
      assertSanctionedDerivedRebuild({ caller: "scripts/db/sync-property-unit-from-env.ts", relation: "core.property_unit", operation: "TRUNCATE" }),
    ).not.toThrow();
    expect(refusal(() => assertSanctionedDerivedRebuild({ caller: "scripts/db/refine-mapping.ts", relation: "core.property_unit", operation: "DROP" })).code).toBe(
      REJECT_UNSANCTIONED_DERIVED_REBUILD,
    );
    expect(
      refusal(() => assertSanctionedDerivedRebuild({ caller: "scripts/db/sync-property-unit-from-env.ts", relation: "env.sgu_well", operation: "TRUNCATE" })).code,
    ).toBe(REJECT_UNSANCTIONED_DERIVED_REBUILD);
  });

  it("a script calling the retirement refusal is refused even when it is not registered", () => {
    expect(refusal(() => refuseRetiredDestructiveScript("scripts/not-registered.ts")).code).toBe(REJECT_RETIRED_DESTRUCTIVE_SCRIPT);
  });
});

/**
 * U30F2 M1: every runtime probe of the independent verification (v30f-gate.test.ts, 48 cases), now
 * with the owner's expectation: a probe that got past the gate (ALLOWED) must be REFUSED, except the
 * ones that are genuinely not protected (a rename that stays in public, the quoted schema "Env", a
 * GPKG output). Only APIs that existed before the fix are used, so this block is the RED evidence.
 */
describe("U30F2 M1: the verifier's runtime probes", () => {
  const outcome = (fn: () => unknown): "ALLOWED" | "REFUSED" => {
    try {
      fn();
      return "ALLOWED";
    } catch {
      return "REFUSED";
    }
  };
  const sqlOutcome = (sql: string) => outcome(() => assertSqlWriteAllowed({ caller: CALLER, sql }));
  const ogrOutcome = (args: string[]) => outcome(() => assertOgr2ogrWriteAllowed({ caller: CALLER, args }));

  it.each([
    ["TRUNCATE env.sgu_well", "REFUSED"],
    ['truncate table only "env"."sgu_well" restart identity', "REFUSED"],
    ["TRUNCATE ENV.SGU_WELL", "REFUSED"],
    ["DELETE FROM core.property_unit WHERE id > 0", "REFUSED"],
    ["WITH d AS (DELETE FROM env.natura2000_area RETURNING 1) SELECT 1", "REFUSED"],
    ["INSERT INTO env.protected_area SELECT * FROM x", "REFUSED"],
    ["UPDATE env.sgu_well AS w\n  SET geom = NULL", "REFUSED"],
    ["MERGE INTO env.sgu_well t USING s ON true WHEN MATCHED THEN DELETE", "REFUSED"],
    ["COPY env.sgu_well (a) FROM STDIN", "REFUSED"],
    ["DROP TABLE IF EXISTS lm_staging.anything_at_all CASCADE", "REFUSED"],
    ["DROP SCHEMA IF EXISTS lm_staging CASCADE", "REFUSED"],
    ["DROP SCHEMA env CASCADE", "REFUSED"],
    ["ALTER TABLE env.sgu_well SET SCHEMA archive", "REFUSED"],
    ["ALTER TABLE public.x RENAME TO y; ALTER TABLE env.sgu_well RENAME TO sgu_well_old", "REFUSED"],
    ["CREATE OR REPLACE VIEW core.property_unit AS SELECT 1", "REFUSED"],
    ["DO $$ BEGIN EXECUTE 'TRUNCATE env.sgu_well'; END $$", "REFUSED"],
    ["EXECUTE format('TRUNCATE %I.%I', 'env', 'sgu_well')", "REFUSED"],
    ["DROP TABLE env.sgu_well_g12", "REFUSED"],
    ["TRUNCATE sgu_well", "REFUSED"],
    ["DROP TABLE natura2000_area_a5d665ae", "REFUSED"],
    // were ALLOWED before U30F2:
    ["ALTER SCHEMA lm_staging RENAME TO v30f_x", "REFUSED"],
    ["ALTER SCHEMA env RENAME TO env_old", "REFUSED"],
    ["DROP OWNED BY miljobeslut CASCADE", "REFUSED"],
    ["SELECT DropGeometryTable('env', 'sgu_well')", "REFUSED"],
    ["INSERT INTO public.t VALUES ('--'); TRUNCATE env.sgu_well", "REFUSED"],
    ["INSERT INTO public.t VALUES ('/*'); TRUNCATE env.sgu_well; SELECT '*/'", "REFUSED"],
    ["EXECUTE format('TRUNC' || 'ATE %I.%I', 'env', 'sgu_well')", "REFUSED"],
    ['DROP TABLE U&"env".sgu_well', "REFUSED"],
    ["SET search_path = lm_staging; DROP TABLE marktacke_07497f79", "REFUSED"],
    ["CREATE RULE v30f AS ON INSERT TO env.sgu_well DO INSTEAD NOTHING", "REFUSED"],
    ["CREATE TRIGGER v30f BEFORE INSERT ON env.sgu_well FOR EACH ROW EXECUTE FUNCTION f()", "REFUSED"],
    // genuinely not protected (the renamed table stays in public):
    ["ALTER TABLE public.tmp RENAME TO sgu_well", "ALLOWED"],
  ])("SQL %j -> %s", (sql, expected) => {
    expect(sqlOutcome(sql)).toBe(expected);
  });

  const base = ["-f", "PostgreSQL", "PG:dbname=x", "a.gpkg"];
  it.each([
    ["protected -nln, overwrite", [...base, "-nln", "env.sgu_well", "-overwrite"], "REFUSED"],
    ["unqualified -nln + -lco SCHEMA=env", [...base, "-nln", "sgu_well", "-lco", "SCHEMA=env", "-append"], "REFUSED"],
    ["PG: without -f + active_schema", ["PG:dbname=x active_schema=lm_staging", "a.gpkg", "-nln", "foo_12345678", "-append"], "REFUSED"],
    ["no -nln", [...base, "-append"], "REFUSED"],
    ["-nln with $VAR", [...base, "-nln", "$TABLE", "-overwrite"], "REFUSED"],
    ["GPKG output", ["-f", "GPKG", "out.gpkg", "a.shp", "-nln", "sgu_well", "-overwrite"], "ALLOWED"],
    // were ALLOWED before U30F2:
    ["-f PGDump writes SQL that psql later runs", ["-f", "PGDump", "out.sql", "a.gpkg", "-nln", "env.sgu_well", "-lco", "DROP_TABLE=IF_EXISTS"], "REFUSED"],
    ["two -nln: GDAL uses the last", [...base, "-nln", "public.x", "-nln", "env.sgu_well", "-overwrite"], "REFUSED"],
    ["-sql DELETE executed on a PG source, file output", ["-f", "GPKG", "out.gpkg", "PG:dbname=x", "-sql", "DELETE FROM env.sgu_well"], "REFUSED"],
    ["-lco SCHEMA given twice", [...base, "-nln", "sgu_well_actual", "-lco", "SCHEMA=public", "-lco", "SCHEMA=lm_staging", "-overwrite"], "REFUSED"],
  ])("ogr2ogr %s -> %s", (_label, args, expected) => {
    expect(ogrOutcome(args as string[])).toBe(expected);
  });

  it.each([
    ["DROP_SCHEMA", "climate", "REFUSED"],
    ["DROP_SCHEMA", "hydro", "REFUSED"],
    ["DROP_SCHEMA", "Env", "REFUSED"],
    ["DROP_SCHEMA", '"Env"', "ALLOWED"],
    ["DROP", '"env"."sgu_well"', "REFUSED"],
    ["DROP", "mimer.env.sgu_well", "REFUSED"],
    ["RENAME_SCHEMA", "lm_staging", "REFUSED"],
  ])("named %s %s -> %s", (operation, relation, expected) => {
    expect(outcome(() => assertUngovernedDestructiveWriteAllowed({ caller: CALLER, operation: operation as never, relation }))).toBe(expected);
  });

  it("command lines: psql, ogrinfo -sql, shp2pgsql, pg_restore and shell wrappers go through the same gate", async () => {
    const g = (await import("../src/ProtectedRelationGate")) as Record<string, unknown>;
    const assertCommand = g.assertCommandWriteAllowed as ((input: { caller: string; command: string }) => string) | undefined;
    expect(typeof assertCommand).toBe("function");
    for (const command of [
      'psql -c "TRUNCATE env.sgu_well"',
      'ogrinfo PG:dbname=x -sql "DROP TABLE env.sgu_well"',
      'shp2pgsql -d -s 3006 a.shp env.sgu_well | psql "$DATABASE_URL"',
      "pg_restore --clean --if-exists -n env -t sgu_well dump.backup",
      `bash -c "psql -c 'TRUNCATE env.sgu_well'"`,
      "psql -f does-not-exist-wu30f2.sql",
    ]) {
      expect(outcome(() => assertCommand!({ caller: CALLER, command })), command).toBe("REFUSED");
    }
    expect(assertCommand!({ caller: CALLER, command: 'psql -c "SELECT 1"' })).toBe('psql -c "SELECT 1"');
  });
});

describe("U30F3 M-1: a protected relation is never emptied in two steps through the gate", () => {
  // U30F2-VERIFICATION M-1 (reproduced in PGlite): every step of these sequences was ALLOWED and env.sgu_well
  // ended empty. The step that creates the write path is now refused, so the second step never has one.
  it("partition path: ATTACH PARTITION of a protected table under an unprotected parent is refused (then TRUNCATE/DROP of the parent never reaches it)", () => {
    expect(gatedSql(CALLER, "CREATE TABLE public.p (id int, brunnsid varchar(32)) PARTITION BY RANGE (id)")).toContain("PARTITION BY");
    const attach = refusal(() => assertSqlWriteAllowed({ caller: CALLER, sql: "ALTER TABLE public.p ATTACH PARTITION env.sgu_well DEFAULT" }));
    expect(attach.code).toBe(REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION);
    expect([attach.operation, attach.relation]).toEqual(["ALTER", "env.sgu_well"]);
    for (const sql of [
      'alter table only public.p attach partition "env"."sgu_well" for values from (1) to (10)',
      "ALTER TABLE public.p DETACH PARTITION core.property_unit",
      "ALTER TABLE public.c INHERIT env.sgu_well",
      "ALTER TABLE public.c NO INHERIT env.sgu_well",
    ]) {
      expect(refusal(() => assertSqlWriteAllowed({ caller: CALLER, sql })).code, sql).toBe(REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION);
    }
    expect(refusal(() => assertSqlWriteAllowed({ caller: CALLER, sql: "ALTER TABLE public.p ATTACH PARTITION ⟦DYN:child⟧ DEFAULT" })).code).toBe(
      REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE,
    );
  });

  it("view path: a view (or an ON SELECT rule) over a protected relation is a write path to it and is refused", () => {
    const view = refusal(() => assertSqlWriteAllowed({ caller: CALLER, sql: "CREATE VIEW public.v AS SELECT * FROM env.sgu_well" }));
    expect(view.code).toBe(REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION);
    expect([view.operation, view.relation]).toEqual(["WRITE_PATH", "env.sgu_well"]);
    for (const sql of [
      "CREATE OR REPLACE VIEW public.v AS SELECT a.id FROM public.a a JOIN core.property_unit b ON b.id = a.id",
      "create temp view v as select * from public.a, lm_staging.flood_risk_area_994bf11c",
      "CREATE VIEW public.v AS SELECT * FROM (SELECT * FROM env.natura2000_area) s",
      'CREATE RULE "_RETURN" AS ON SELECT TO public.t DO INSTEAD SELECT * FROM env.sgu_well',
      "CREATE VIEW public.v AS SELECT * FROM env.sgu_well; WITH d AS (DELETE FROM public.v RETURNING 1) SELECT count(*) FROM d",
    ]) {
      expect(refusal(() => assertSqlWriteAllowed({ caller: CALLER, sql })).code, sql).toBe(REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION);
    }
  });

  it("controls: a materialized view (a copy), a view over unprotected tables and an unprotected partition pass", () => {
    for (const sql of [
      "CREATE MATERIALIZED VIEW public.mv AS SELECT * FROM env.sgu_well",
      "CREATE VIEW public.v AS SELECT j.id, st_area(j.geom) AS sgu_well FROM public.jobs j",
      "ALTER TABLE public.p ATTACH PARTITION public.p_2026 FOR VALUES FROM (1) TO (2)",
      "CREATE RULE r AS ON INSERT TO public.x DO ALSO INSERT INTO public.log SELECT * FROM env.sgu_well",
    ]) {
      expect(gatedSql(CALLER, sql), sql).toBe(sql);
    }
  });

  it("KNOWN LIMIT (pinned): a write to a view or parent created OUTSIDE the gate cannot be seen from its text -- the database-level protection (owner decision 8) is the layer that holds there", () => {
    // public.v / public.p are only names here; whether they reach env.sgu_well is catalog state the gate never reads
    expect(gatedSql(CALLER, "DELETE FROM public.v")).toBe("DELETE FROM public.v");
    expect(gatedSql(CALLER, "TRUNCATE public.p")).toBe("TRUNCATE public.p");
  });
});

describe("no override", () => {
  it("no extra flag and no environment variable lets a protected write through", () => {
    const saved = { ...process.env };
    try {
      for (const key of ["FORCE", "OVERRIDE", "MIMER_GATE_OVERRIDE", "ALLOW_DESTRUCTIVE", "SKIP_PROTECTED_RELATION_GATE"]) process.env[key] = "1";
      const input = { caller: CALLER, operation: "TRUNCATE" as const, relation: "env.sgu_well", force: true, override: true };
      expect(refusal(() => assertUngovernedDestructiveWriteAllowed(input)).code).toBe(REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION);
    } finally {
      process.env = saved;
    }
  });
});
