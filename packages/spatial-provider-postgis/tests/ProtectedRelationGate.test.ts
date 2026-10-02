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
    expect(targets).toEqual(
      expect.arrayContaining([
        { operation: "TRUNCATE", relation: "env.sgu_well" },
        { operation: "TRUNCATE", relation: 'ONLY "lm_staging"."x_1"' },
        { operation: "DROP", relation: '"lm_staging"."ebh_potentiellt_fororenade_omraden_02fccffc"' },
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
        { operation: "DROP_SCHEMA", relation: "stage" },
        { operation: "DROP_SCHEMA", relation: "lm_staging" },
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
