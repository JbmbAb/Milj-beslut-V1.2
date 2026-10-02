import {
  PROTECTED_RELATIONS,
  classifyRelation,
  classifySchema,
  parseRelationName,
  type ProtectedRelationClass,
  type ProtectedRelationsDefinition,
  type RelationClassification,
} from "./ProtectedRelations";

/**
 * MIMER-PROTECTED-RELATION-GATE-V1 -- U30F F1 (PRES-05): ONE gate for every destructive operation
 * on a protected relation (the LU live layers, the derived property table and every retained
 * staging relation in lm_staging; see protected-relations.v1.json).
 *
 * Every path that can drop, truncate, delete from, insert into, update, overwrite, append to,
 * rename or redefine such a relation goes through this module:
 *
 *   - Ungoverned paths (legacy importers, maintenance scripts): `assertSqlWriteAllowed` /
 *     `gatedSql`, `assertOgr2ogrWriteAllowed` / `assertOgr2ogrCommandAllowed` and
 *     `assertUngovernedDestructiveWriteAllowed` refuse a protected target with
 *     REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION, and an unparseable target with
 *     REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE (fail-closed). Non-protected targets pass.
 *   - Retired scripts (cannot be made safe without a rewrite): `refuseRetiredDestructiveScript`
 *     refuses before any connection, with the justification recorded in RETIRED_DESTRUCTIVE_SCRIPTS.
 *   - The registered derivation of an LU_DERIVED table: `assertSanctionedDerivedRebuild`.
 *   - Governed paths: the retain-before-replace promote (SpatialDatasetRetention) and the
 *     per-relation decisions for lm_staging (StagingCleanupProtection), re-exported below.
 *
 * There is no override flag, no environment switch and no "force" parameter. Changing what is
 * protected or retired is a reviewed code change (protected-relations.v1.json,
 * RETIRED_DESTRUCTIVE_SCRIPTS), checked by tests/unit/protectedRelationGateInventory.test.ts.
 *
 * Bindings: scripts/data-pipeline/protected_relation_gate.py and scripts/lib/ProtectedRelationGate.ps1
 * read the same JSON definition and implement the same classification.
 */

export const REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION = "REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION" as const;
export const REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE = "REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE" as const;
export const REJECT_RETIRED_DESTRUCTIVE_SCRIPT = "REJECT_RETIRED_DESTRUCTIVE_SCRIPT" as const;
export const REJECT_UNSANCTIONED_DERIVED_REBUILD = "REJECT_UNSANCTIONED_DERIVED_REBUILD" as const;

export type DestructiveOperation =
  | "DROP"
  | "DROP_SCHEMA"
  | "TRUNCATE"
  | "DELETE"
  | "INSERT"
  | "UPDATE"
  | "MERGE"
  | "COPY_FROM"
  | "ALTER"
  | "RENAME"
  | "CREATE_OR_REPLACE"
  | "OGR2OGR_WRITE"
  | "RUN_RETIRED_SCRIPT";

export type ProtectedRelationGateCode =
  | typeof REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION
  | typeof REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE
  | typeof REJECT_RETIRED_DESTRUCTIVE_SCRIPT
  | typeof REJECT_UNSANCTIONED_DERIVED_REBUILD;

export class ProtectedRelationGateError extends Error {
  readonly code: ProtectedRelationGateCode;
  readonly caller: string;
  readonly operation: DestructiveOperation;
  readonly relation: string;
  readonly relation_class: ProtectedRelationClass | null;

  constructor(input: {
    code: ProtectedRelationGateCode;
    caller: string;
    operation: DestructiveOperation;
    relation: string;
    relation_class?: ProtectedRelationClass | null;
    detail: string;
  }) {
    super(`${input.code}: ${input.caller} may not ${input.operation} ${input.relation}: ${input.detail}`);
    this.name = "ProtectedRelationGateError";
    this.code = input.code;
    this.caller = input.caller;
    this.operation = input.operation;
    this.relation = input.relation;
    this.relation_class = input.relation_class ?? null;
  }
}

function refuseClassification(caller: string, operation: DestructiveOperation, c: RelationClassification): void {
  if (c.kind === "UNPROTECTED") return;
  if (c.kind === "UNRESOLVABLE") {
    throw new ProtectedRelationGateError({
      code: REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE,
      caller,
      operation,
      relation: c.relation,
      detail: `${c.reason}; a target that cannot be resolved cannot be shown not to be protected`,
    });
  }
  throw new ProtectedRelationGateError({
    code: REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION,
    caller,
    operation,
    relation: c.relation,
    relation_class: c.class,
    detail:
      `${c.class} (${c.reason}). Only the governed paths may change it: the retain-before-replace promote ` +
      "(scripts/import/import-librarian-manifest.ts --mode promote) and, for lm_staging, import-staging/cleanup-staging " +
      "with their per-relation protection decision. There is no override.",
  });
}

/** Ungoverned path, one named relation: refuse if protected (or unresolvable). */
export function assertUngovernedDestructiveWriteAllowed(input: {
  readonly caller: string;
  readonly operation: DestructiveOperation;
  readonly relation: string;
  readonly definition?: ProtectedRelationsDefinition;
}): void {
  const definition = input.definition ?? PROTECTED_RELATIONS;
  const c = input.operation === "DROP_SCHEMA" ? classifySchema(input.relation, definition) : classifyRelation(input.relation, definition);
  refuseClassification(input.caller, input.operation, c);
}

// ---------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------

export interface SqlWriteTarget {
  readonly operation: DestructiveOperation;
  /** A relation, or a schema for DROP_SCHEMA. */
  readonly relation: string;
}

// A statement keyword is never read as the target name ("DROP TABLE IF EXISTS $1" must not
// resolve to a table called IF): unquoted IF/ONLY/TABLE are reserved where they appear here.
const NOT_KEYWORD = String.raw`(?!(?:IF|ONLY|TABLE)\b)`;
const IDENT = String.raw`(?:"(?:[^"]|"")+"|${NOT_KEYWORD}[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT}){0,2}`;
const QITEM = String.raw`(?:ONLY\s+)?${QNAME}(?:\s*\*)?`;
const QLIST = String.raw`${QITEM}(?:\s*,\s*${QITEM})*`;

interface SqlPattern {
  readonly operation: DestructiveOperation;
  /** Counts occurrences of the statement keyword; more keywords than targets = unresolvable. */
  readonly keyword: RegExp | null;
  readonly full: RegExp;
  readonly list?: boolean;
}

const SQL_PATTERNS: readonly SqlPattern[] = [
  { operation: "TRUNCATE", keyword: /\bTRUNCATE\b/gi, full: new RegExp(String.raw`\bTRUNCATE\s+(?:TABLE\s+)?(${QLIST})`, "gi"), list: true },
  {
    operation: "DROP",
    keyword: /\bDROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FOREIGN\s+TABLE)\b/gi,
    full: new RegExp(String.raw`\bDROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FOREIGN\s+TABLE)\s+(?:IF\s+EXISTS\s+)?(${QLIST})`, "gi"),
    list: true,
  },
  {
    operation: "DROP_SCHEMA",
    keyword: /\bDROP\s+SCHEMA\b/gi,
    full: new RegExp(String.raw`\bDROP\s+SCHEMA\s+(?:IF\s+EXISTS\s+)?(${IDENT}(?:\s*,\s*${IDENT})*)`, "gi"),
    list: true,
  },
  { operation: "DELETE", keyword: /\bDELETE\s+FROM\b/gi, full: new RegExp(String.raw`\bDELETE\s+FROM\s+(?:ONLY\s+)?(${QNAME})`, "gi") },
  { operation: "INSERT", keyword: /\bINSERT\s+INTO\b/gi, full: new RegExp(String.raw`\bINSERT\s+INTO\s+(${QNAME})`, "gi") },
  { operation: "MERGE", keyword: /\bMERGE\s+INTO\b/gi, full: new RegExp(String.raw`\bMERGE\s+INTO\s+(?:ONLY\s+)?(${QNAME})`, "gi") },
  // UPDATE is only matched with its SET (never "DO UPDATE SET", "FOR UPDATE", "ON UPDATE").
  {
    operation: "UPDATE",
    keyword: null,
    full: new RegExp(String.raw`(?<!\bDO\s+)\bUPDATE\s+(?:ONLY\s+)?(${QNAME})(?:\s*\*)?\s+(?:(?:AS\s+)?${IDENT}\s+)?SET\b`, "gi"),
  },
  { operation: "COPY_FROM", keyword: null, full: new RegExp(String.raw`\bCOPY\s+(${QNAME})\s*(?:\([^)]*\))?\s+FROM\b`, "gi") },
  {
    operation: "CREATE_OR_REPLACE",
    keyword: /\bCREATE\s+OR\s+REPLACE\s+(?:TEMP(?:ORARY)?\s+)?(?:RECURSIVE\s+)?VIEW\b/gi,
    full: new RegExp(String.raw`\bCREATE\s+OR\s+REPLACE\s+(?:TEMP(?:ORARY)?\s+)?(?:RECURSIVE\s+)?VIEW\s+(${QNAME})`, "gi"),
  },
];

const ALTER_KEYWORD = /\bALTER\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FOREIGN\s+TABLE)\b/gi;
const ALTER_FULL = new RegExp(
  String.raw`\bALTER\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FOREIGN\s+TABLE)\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QNAME})(?:\s*\*)?([^;]*)`,
  "gi",
);
const RENAME_TO = new RegExp(String.raw`^\s*RENAME\s+TO\s+(${IDENT})`, "i");

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function splitList(list: string): string[] {
  const items: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of list) {
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      items.push(current);
      current = "";
    } else current += ch;
  }
  items.push(current);
  return items.map((s) => s.trim()).filter((s) => s.length > 0);
}

export interface SqlWriteTargets {
  readonly targets: readonly SqlWriteTarget[];
  /** Statement keywords whose target could not be parsed. */
  readonly unresolved: readonly DestructiveOperation[];
}

/** Every relation (or schema) a SQL text writes destructively. Regex-based, conservative. */
export function extractSqlWriteTargets(sql: string): SqlWriteTargets {
  const text = stripSqlComments(sql);
  const targets: SqlWriteTarget[] = [];
  const unresolved: DestructiveOperation[] = [];
  for (const p of SQL_PATTERNS) {
    let found = 0;
    for (const m of text.matchAll(p.full)) {
      found += 1;
      for (const item of p.list ? splitList(m[1]!) : [m[1]!]) targets.push({ operation: p.operation, relation: item });
    }
    const keywords = p.keyword ? [...text.matchAll(p.keyword)].length : 0;
    if (keywords > found) unresolved.push(p.operation);
  }
  let altered = 0;
  for (const m of text.matchAll(ALTER_FULL)) {
    altered += 1;
    const source = m[1]!;
    const rename = (m[2] ?? "").match(RENAME_TO);
    if (rename) {
      targets.push({ operation: "RENAME", relation: source });
      const parsed = parseRelationName(source);
      const renamed = parseRelationName(rename[1]!);
      if (parsed && renamed) {
        targets.push({ operation: "RENAME", relation: parsed.schema ? `${parsed.schema}.${renamed.table}` : renamed.table });
      } else unresolved.push("RENAME");
    } else {
      targets.push({ operation: "ALTER", relation: source });
    }
  }
  if ([...text.matchAll(ALTER_KEYWORD)].length > altered) unresolved.push("ALTER");
  return { targets, unresolved };
}

/** Ungoverned path, one SQL text: refuse when any write target is protected or unparseable. */
export function assertSqlWriteAllowed(input: {
  readonly caller: string;
  readonly sql: string;
  readonly definition?: ProtectedRelationsDefinition;
}): void {
  const { targets, unresolved } = extractSqlWriteTargets(input.sql);
  if (unresolved.length > 0) {
    throw new ProtectedRelationGateError({
      code: REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE,
      caller: input.caller,
      operation: unresolved[0]!,
      relation: "(unparsed)",
      detail: `the statement's ${unresolved.join(", ")} target could not be parsed: ${input.sql.replace(/\s+/g, " ").trim().slice(0, 160)}`,
    });
  }
  for (const t of targets) {
    assertUngovernedDestructiveWriteAllowed({ caller: input.caller, operation: t.operation, relation: t.relation, definition: input.definition });
  }
}

/** `assertSqlWriteAllowed`, returning the SQL unchanged so a call site can wrap its statement. */
export function gatedSql(caller: string, sql: string): string {
  assertSqlWriteAllowed({ caller, sql });
  return sql;
}

// ---------------------------------------------------------------------------------------------
// ogr2ogr
// ---------------------------------------------------------------------------------------------

export type Ogr2ogrWriteMode = "OVERWRITE" | "APPEND" | "UPSERT" | "UPDATE" | "CREATE";

export type Ogr2ogrTarget =
  | { readonly kind: "NOT_DATABASE"; readonly format: string | null }
  | { readonly kind: "DATABASE"; readonly relation: string | null; readonly mode: Ogr2ogrWriteMode };

function valueAfter(args: readonly string[], flags: readonly string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length - 1; i += 1) {
    if (flags.includes(args[i]!.toLowerCase())) values.push(args[i + 1]!);
  }
  return values;
}

/**
 * The PostgreSQL relation an ogr2ogr invocation writes, or NOT_DATABASE for a file output (GPKG,
 * GeoJSON, ...). PostgreSQL output is recognised by `-f/-of PostgreSQL|PG|PostGIS`, or -- without a
 * format -- by a `PG:` datasource. The relation is `-nln`, qualified by `-lco SCHEMA=` or the
 * connection's `active_schema`; without `-nln` it is unresolvable (ogr2ogr would use the source
 * layer name).
 */
export function ogr2ogrDatabaseWriteTarget(args: readonly string[]): Ogr2ogrTarget {
  const format = valueAfter(args, ["-f", "-of"])[0] ?? null;
  const pgDatasource = args.find((a) => /^PG:/i.test(a.trim()));
  const isDatabase = format ? /^(postgresql|pg|postgis)$/i.test(format.trim()) : pgDatasource !== undefined;
  if (!isDatabase) return { kind: "NOT_DATABASE", format };

  const lower = args.map((a) => a.toLowerCase());
  const lco = valueAfter(args, ["-lco"]);
  const mode: Ogr2ogrWriteMode =
    lower.includes("-overwrite") || lco.some((v) => /^OVERWRITE=YES$/i.test(v.trim()))
      ? "OVERWRITE"
      : lower.includes("-upsert")
        ? "UPSERT"
        : lower.includes("-append")
          ? "APPEND"
          : lower.includes("-update")
            ? "UPDATE"
            : "CREATE";

  const nln = valueAfter(args, ["-nln"])[0];
  if (!nln) return { kind: "DATABASE", relation: null, mode };
  const parsed = parseRelationName(nln);
  if (!parsed) return { kind: "DATABASE", relation: nln, mode };
  if (parsed.schema !== null) return { kind: "DATABASE", relation: `${parsed.schema}.${parsed.table}`, mode };
  const lcoSchema = lco.map((v) => v.trim().match(/^SCHEMA=(.+)$/i)?.[1]).find((v) => v !== undefined);
  const activeSchema = pgDatasource?.match(/\b(?:active_schema|schemas)\s*=\s*'?([A-Za-z_][A-Za-z0-9_$]*)/i)?.[1];
  const schema = lcoSchema ?? activeSchema;
  return { kind: "DATABASE", relation: schema ? `${schema}.${parsed.table}` : parsed.table, mode };
}

/** Ungoverned ogr2ogr: refuse a PostgreSQL write to a protected (or unresolvable) relation. Returns the args. */
export function assertOgr2ogrWriteAllowed<T extends readonly string[]>(input: {
  readonly caller: string;
  readonly args: T;
  readonly definition?: ProtectedRelationsDefinition;
}): T {
  const target = ogr2ogrDatabaseWriteTarget(input.args);
  if (target.kind === "NOT_DATABASE") return input.args;
  if (target.relation === null) {
    throw new ProtectedRelationGateError({
      code: REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE,
      caller: input.caller,
      operation: "OGR2OGR_WRITE",
      relation: "(no -nln)",
      detail: "a PostgreSQL ogr2ogr write without -nln takes its table name from the source and cannot be checked",
    });
  }
  assertUngovernedDestructiveWriteAllowed({ caller: input.caller, operation: "OGR2OGR_WRITE", relation: target.relation, definition: input.definition });
  return input.args;
}

/** Split a shell command line into arguments (double and single quotes; no expansion). */
export function tokenizeCommandLine(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

/** `assertOgr2ogrWriteAllowed` for a command line string (execSync callers). Returns the command. */
export function assertOgr2ogrCommandAllowed(input: { readonly caller: string; readonly command: string }): string {
  assertOgr2ogrWriteAllowed({ caller: input.caller, args: tokenizeCommandLine(input.command) });
  return input.command;
}

// ---------------------------------------------------------------------------------------------
// Derived tables
// ---------------------------------------------------------------------------------------------

/**
 * The registered derivation of an LU_DERIVED table (protected-relations.v1.json
 * `sanctioned_rebuild`) may rebuild it from its protected source; nothing else may.
 */
export function assertSanctionedDerivedRebuild(input: {
  readonly caller: string;
  readonly relation: string;
  readonly operation: DestructiveOperation;
  readonly definition?: ProtectedRelationsDefinition;
}): void {
  const c = classifyRelation(input.relation, input.definition ?? PROTECTED_RELATIONS);
  if (c.kind === "PROTECTED" && c.class === "LU_DERIVED" && c.entry?.sanctioned_rebuild === input.caller) return;
  throw new ProtectedRelationGateError({
    code: REJECT_UNSANCTIONED_DERIVED_REBUILD,
    caller: input.caller,
    operation: input.operation,
    relation: input.relation,
    relation_class: c.kind === "PROTECTED" ? c.class : null,
    detail:
      c.kind === "PROTECTED" && c.class === "LU_DERIVED"
        ? `only ${c.entry?.sanctioned_rebuild} may rebuild it (from ${c.entry?.derived_from})`
        : "not a registered LU_DERIVED relation",
  });
}

// ---------------------------------------------------------------------------------------------
// Retired scripts
// ---------------------------------------------------------------------------------------------

export interface RetiredDestructiveScript {
  /** Repo-relative path, forward slashes. */
  readonly script: string;
  /** The protected relations the script destroys or redefines. */
  readonly protected_relations: readonly string[];
  /** Why it cannot be made safe without a rewrite. Required; reviewed with the list. */
  readonly justification: string;
  /** What to use instead. */
  readonly replacement: string;
  readonly retired_by: string;
}

/**
 * Scripts that are refused as a whole. This list MAY shrink and SHALL NOT grow silently: each entry
 * needs a justification of at least 40 characters, the script must call
 * `refuseRetiredDestructiveScript` (or carry the SQL refusal header) before any connection, and
 * the inventory test pins the count.
 */
const PROMOTE_INSTEAD =
  "scripts/import/import-librarian-manifest.ts --mode import-staging/promote (ledger batch, retain-before-replace, retention record)";

export const RETIRED_DESTRUCTIVE_SCRIPTS: readonly RetiredDestructiveScript[] = Object.freeze([
  {
    script: "scripts/db/drop-staging-tables.ts",
    protected_relations: ["lm_staging.ebh_potentiellt_fororenade_omraden_02fccffc", "lm_staging.sgu_well_49202690", "lm_staging.*"],
    justification:
      "Drops a hardcoded list of lm_staging relations with CASCADE. The list holds ebh's retained relation 02fccffc (its bound " +
      "SUCCESS version) and possibly a superseded sgu_well version; a static list cannot know which relations hold bound versions.",
    replacement: "import-librarian-manifest.ts --mode cleanup-staging (per-relation protection, re-checked under lock before each DROP)",
    retired_by: "U30F F1",
  },
  {
    script: "scripts/db/adopt-staging-to-prod.ts",
    protected_relations: [
      "env.registerenhetsomradesytor",
      "env.sgu_well",
      "env.ebh_potentiellt_fororenade_omraden",
      "env.sgu_soil_type_25k_100k",
      "env.sgu_landslide_feature",
      "climate.flood_risk_area",
    ],
    justification:
      "TRUNCATE ... CASCADE of LU live layers followed by INSERT from whatever lm_staging table matches a name prefix, with no " +
      "ledger batch, no retention of the outgoing version and no record: the bound version is destroyed and the new one is unbound.",
    replacement: PROMOTE_INSTEAD,
    retired_by: "U30F F1",
  },
  {
    script: "scripts/db/restore-sgu-soil.ts",
    protected_relations: ["env.sgu_soil_type_25k_100k"],
    justification:
      "TRUNCATE ... CASCADE of env.sgu_soil_type_25k_100k (ADMIT-V1 lu.soil_type) from one fixed staging relation, outside the ledger " +
      "and without retaining the outgoing version.",
    replacement: PROMOTE_INSTEAD,
    retired_by: "U30F F1",
  },
  {
    script: "scripts/db/merge-property-parts.ts",
    protected_relations: ["core.property_unit"],
    justification:
      "DROP VIEW core.property_unit CASCADE and CREATE OR REPLACE VIEW core.property_unit over other sources: redefines the LU " +
      "property root that only scripts/db/sync-property-unit-from-env.ts may rebuild.",
    replacement: "scripts/db/sync-property-unit-from-env.ts (the sanctioned derivation, run by the property promote)",
    retired_by: "U30F F1",
  },
  {
    script: "scripts/db/refine-mapping.ts",
    protected_relations: ["core.property_unit"],
    justification:
      "DROP VIEW core.property_unit CASCADE and CREATE OR REPLACE VIEW core.property_unit: redefines the LU property root outside " +
      "its sanctioned derivation.",
    replacement: "scripts/db/sync-property-unit-from-env.ts (the sanctioned derivation, run by the property promote)",
    retired_by: "U30F F1",
  },
  {
    script: "scripts/db/refine-mapping-v2.ts",
    protected_relations: ["core.property_unit"],
    justification:
      "DROP VIEW core.property_unit CASCADE and CREATE OR REPLACE VIEW core.property_unit: redefines the LU property root outside " +
      "its sanctioned derivation.",
    replacement: "scripts/db/sync-property-unit-from-env.ts (the sanctioned derivation, run by the property promote)",
    retired_by: "U30F F1",
  },
  {
    script: "scripts/clean-sgu-pipeline.ts",
    protected_relations: ["env.sgu_landslide_feature"],
    justification:
      "DROP TABLE env.sgu_landslide_feature CASCADE (ADMIT-V1 lu.landslide) and a rebuild from an SQL pipeline outside the ledger; " +
      "the bound version is lost.",
    replacement: PROMOTE_INSTEAD,
    retired_by: "U30F F1",
  },
  {
    script: "scripts/gis-performance-benchmark.ts",
    protected_relations: ["env.sgu_well"],
    justification:
      "TRUNCATE TABLE env.sgu_well CASCADE and INSERT of randomly generated wells: replaces a bound LU layer with synthetic data. " +
      "A benchmark must run against a disposable test database, never the LU layer.",
    replacement: "a benchmark against a disposable test database (TEST-DB-GUARD), not the LU layer",
    retired_by: "U30F F1",
  },
  {
    script: "scripts/verify-jordarter.ts",
    protected_relations: ["env.sgu_soil_type_25k_100k"],
    justification:
      "ogr2ogr -overwrite into env.sgu_soil_type_25k_100k (ADMIT-V1 lu.soil_type) from a local file outside the registry and " +
      "the ledger: drops and recreates the bound layer.",
    replacement: PROMOTE_INSTEAD,
    retired_by: "U30F F1",
  },
  {
    script: "scripts/import/import-n2k-gml.ts",
    protected_relations: ["env.natura2000_area"],
    justification:
      "Merges GML into env.natura2000_area (INSERT ... ON CONFLICT) and creates it if missing, outside the ledger and retention: " +
      "the bound natura2000 version changes without a batch.",
    replacement: PROMOTE_INSTEAD,
    retired_by: "U30F F1",
  },
  {
    script: "scripts/db/subdivide-complex-polygons.sql",
    protected_relations: ["env.protected_area", "env.natura2000_area"],
    justification:
      "Renames env.protected_area and env.natura2000_area to *_legacy and rebuilds them with ST_Subdivide: every row of the bound " +
      "versions changes and the live tables no longer equal any admitted version.",
    replacement: "an owner decision and a governed migration that admits the subdivided data as a new version",
    retired_by: "U30F F1",
  },
  {
    script: "scripts/db/partition-spatial-grid.sql",
    protected_relations: ["env.registerenhetsomradesytor"],
    justification:
      "Renames env.registerenhetsomradesytor to *_legacy and rebuilds it as a partitioned table with different keys: the LU " +
      "property root's bound version is replaced outside the ledger.",
    replacement: "an owner decision and a governed migration that admits the partitioned data as a new version",
    retired_by: "U30F F1",
  },
  {
    script: "scripts/db/migrate-partition-fastigheter.sql",
    protected_relations: ["env.registerenhetsomradesytor"],
    justification:
      "Renames env.registerenhetsomradesytor to *_legacy and rebuilds it partitioned: the LU property root's bound version is " +
      "replaced outside the ledger.",
    replacement: "an owner decision and a governed migration that admits the partitioned data as a new version",
    retired_by: "U30F F1",
  },
]);

function validateRetiredList(list: readonly RetiredDestructiveScript[]): void {
  const seen = new Set<string>();
  for (const e of list) {
    if (!/^[A-Za-z0-9_./-]+$/.test(e.script) || e.script.startsWith("/") || e.script.includes("\\")) {
      throw new Error(`RETIRED_DESTRUCTIVE_SCRIPTS_INVALID: ${e.script} is not a repo-relative posix path`);
    }
    if (seen.has(e.script)) throw new Error(`RETIRED_DESTRUCTIVE_SCRIPTS_INVALID: duplicate ${e.script}`);
    seen.add(e.script);
    if (e.justification.trim().length < 40) throw new Error(`RETIRED_DESTRUCTIVE_SCRIPTS_INVALID: ${e.script} needs a justification`);
    if (e.protected_relations.length === 0) throw new Error(`RETIRED_DESTRUCTIVE_SCRIPTS_INVALID: ${e.script} names no protected relation`);
    if (e.replacement.trim().length === 0 || e.retired_by.trim().length === 0) {
      throw new Error(`RETIRED_DESTRUCTIVE_SCRIPTS_INVALID: ${e.script} needs replacement and retired_by`);
    }
  }
}
validateRetiredList(RETIRED_DESTRUCTIVE_SCRIPTS);

/** Refuse a retired script before it connects to anything. Always throws. */
export function refuseRetiredDestructiveScript(script: string): never {
  const entry = RETIRED_DESTRUCTIVE_SCRIPTS.find((e) => e.script === script);
  throw new ProtectedRelationGateError({
    code: REJECT_RETIRED_DESTRUCTIVE_SCRIPT,
    caller: script,
    operation: "RUN_RETIRED_SCRIPT",
    relation: entry ? entry.protected_relations.join(", ") : "(unregistered script)",
    detail: entry
      ? `retired by ${entry.retired_by}: ${entry.justification} Instead: ${entry.replacement}`
      : "the script calls the retirement refusal but is not in RETIRED_DESTRUCTIVE_SCRIPTS; it stays refused",
  });
}

// ---------------------------------------------------------------------------------------------
// Governed paths (the gate's other doors)
// ---------------------------------------------------------------------------------------------

/** Live LU layers: the retain-before-replace promote is the only TRUNCATE (F3 basis, F4 precondition, F5 ledger identity). */
export {
  retainOutgoingThenReplace,
  recordRetentionAtPromote,
  REJECT_PROMOTE_OUTGOING_VERSION_NOT_RETAINED,
} from "./SpatialDatasetRetention";
/** lm_staging: per-relation protection before every DROP (cleanup-staging) and every overwrite (import-staging). */
export {
  CLEANUP_SKIPPED_PROTECTION_UNVERIFIABLE,
  CLEANUP_SKIPPED_RETAINED_RELATION,
  REJECT_STAGING_IMPORT_WOULD_OVERWRITE_RETAINED_RELATION,
  StagingRelationProtectedError,
  assertStagingImportOverwriteAllowed,
  decideStagingRelationProtection,
  dropStagingRelationGoverned,
  planStagingCleanup,
  quoteStagingRelation,
} from "./StagingCleanupProtection";
export {
  PROTECTED_RELATIONS,
  PROTECTED_RELATIONS_FILE,
  classifyRelation,
  classifySchema,
  parseRelationName,
  type ProtectedRelationClass,
  type RelationClassification,
} from "./ProtectedRelations";
