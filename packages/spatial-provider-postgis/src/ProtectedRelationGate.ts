import { existsSync, readFileSync } from "node:fs";
import {
  PROTECTED_RELATIONS,
  classifyRelation,
  classifySchema,
  type ProtectedRelationClass,
  type ProtectedRelationsDefinition,
  type RelationClassification,
} from "./ProtectedRelations";
import { classificationSpec } from "./ProtectedRelationSpec";
import {
  analyzeCommandArgv,
  analyzeCommandLine,
  analyzeOgr2ogrArgs,
  analyzeSql,
  judgeWrites,
  normalizedVerdict,
  splitCommandLine,
  targetText,
  type ClassifierOptions,
  type Ogr2ogrWriteMode,
  type WriteAnalysis,
  type WriteOperation,
  type WriteVerdict,
} from "./ProtectedWriteClassifier";

/**
 * MIMER-PROTECTED-RELATION-GATE-V1 -- U30F F1 (PRES-05): ONE gate for every destructive operation
 * on a protected relation (the LU live layers, the derived property table and every retained
 * staging relation in lm_staging; see protected-relations.v1.json).
 *
 * Every path that can drop, truncate, delete from, insert into, update, overwrite, append to,
 * rename or redefine such a relation goes through this module:
 *
 *   - Ungoverned paths (legacy importers, maintenance scripts): `assertSqlWriteAllowed` /
 *     `gatedSql`, `assertOgr2ogrWriteAllowed` / `assertOgr2ogrCommandAllowed`,
 *     `assertCommandWriteAllowed` (psql, ogrinfo -sql, pg_restore, shp2pgsql, ... and shell
 *     wrappers) and `assertUngovernedDestructiveWriteAllowed` refuse a protected target with
 *     REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION, and a target that is not static with
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
 * U30F2 M1/M2: SQL, ogr2ogr arguments and command lines are classified by ProtectedWriteClassifier
 * (a tokenizer, not keyword patterns) from the shared specification protected-relation-
 * classification.v1.json. The bindings scripts/data-pipeline/protected_relation_gate.py and
 * scripts/lib/ProtectedRelationGate.ps1 read the same two JSON files and implement the same
 * algorithm; tests/unit/protectedRelationGateBindings.test.ts holds all three to identical verdicts.
 */

export const REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION = "REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION" as const;
export const REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE = "REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE" as const;
export const REJECT_RETIRED_DESTRUCTIVE_SCRIPT = "REJECT_RETIRED_DESTRUCTIVE_SCRIPT" as const;
export const REJECT_UNSANCTIONED_DERIVED_REBUILD = "REJECT_UNSANCTIONED_DERIVED_REBUILD" as const;

export type DestructiveOperation = WriteOperation | "RUN_RETIRED_SCRIPT";

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

const GOVERNED_DOORS =
  "Only the governed paths may change it: the retain-before-replace promote " +
  "(scripts/import/import-librarian-manifest.ts --mode promote) and, for lm_staging, import-staging/cleanup-staging " +
  "with their per-relation protection decision. There is no override.";

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
    detail: `${c.class} (${c.reason}). ${GOVERNED_DOORS}`,
  });
}

/** Operations whose target is a schema (protected-relation-classification.v1.json `schema_operations`). */
export function isSchemaOperation(operation: string): boolean {
  return classificationSpec().schema_operations.includes(operation);
}

/** Ungoverned path, one named relation (or schema for a schema operation): refuse if protected or unresolvable. */
export function assertUngovernedDestructiveWriteAllowed(input: {
  readonly caller: string;
  readonly operation: DestructiveOperation;
  readonly relation: string;
  readonly definition?: ProtectedRelationsDefinition;
}): void {
  const definition = input.definition ?? PROTECTED_RELATIONS;
  const c = isSchemaOperation(input.operation) ? classifySchema(input.relation, definition) : classifyRelation(input.relation, definition);
  refuseClassification(input.caller, input.operation, c);
}

/** Refuse a judged analysis: protected first, then anything that could not be resolved. */
function refuseVerdict(caller: string, verdict: WriteVerdict, what: string): void {
  const hit = verdict.protectedWrites[0];
  if (hit) {
    throw new ProtectedRelationGateError({
      code: REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION,
      caller,
      operation: hit.operation,
      relation: hit.relation,
      relation_class: hit.class,
      detail: `${hit.class} (${hit.reason}). ${GOVERNED_DOORS}`,
    });
  }
  const open = verdict.unresolved[0];
  if (open) {
    throw new ProtectedRelationGateError({
      code: REJECT_DESTRUCTIVE_WRITE_TARGET_UNRESOLVABLE,
      caller,
      operation: open.operation,
      relation: "(unresolved)",
      detail: `${open.reason}; ${what}: ${verdict.unresolved.length} write(s) whose target is not static cannot be shown not to be protected`,
    });
  }
}

/** The SQL file a psql -f / prisma db execute --file would run, read for classification (never executed). */
function readSqlFileForGate(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

const GATE_OPTIONS: ClassifierOptions = { readSqlFile: readSqlFileForGate };

// ---------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------

export interface SqlWriteTarget {
  readonly operation: DestructiveOperation;
  /** A relation, or `schema:<name>` for a schema-level operation (canonical SQL text). */
  readonly relation: string;
}

export interface SqlWriteTargets {
  readonly targets: readonly SqlWriteTarget[];
  /** Operations whose target is not a static name (dynamic, parameter, unparseable). */
  readonly unresolved: readonly DestructiveOperation[];
}

/** Every relation (or schema) a SQL text writes destructively (ProtectedWriteClassifier.analyzeSql). */
export function extractSqlWriteTargets(sql: string): SqlWriteTargets {
  const a = analyzeSql(sql);
  return { targets: a.targets.map((t) => ({ operation: t.operation, relation: targetText(t) })), unresolved: a.unresolved.map((u) => u.operation) };
}

/** Ungoverned path, one SQL text: refuse when any write target is protected or not static. */
export function assertSqlWriteAllowed(input: {
  readonly caller: string;
  readonly sql: string;
  readonly definition?: ProtectedRelationsDefinition;
}): void {
  refuseVerdict(input.caller, judgeWrites(analyzeSql(input.sql), input.definition), `SQL ${input.sql.replace(/\s+/g, " ").trim().slice(0, 160)}`);
}

/** `assertSqlWriteAllowed`, returning the SQL unchanged so a call site can wrap its statement. */
export function gatedSql(caller: string, sql: string): string {
  assertSqlWriteAllowed({ caller, sql });
  return sql;
}

// ---------------------------------------------------------------------------------------------
// ogr2ogr and other commands
// ---------------------------------------------------------------------------------------------

export type { Ogr2ogrWriteMode };

export type Ogr2ogrTarget =
  | { readonly kind: "NOT_DATABASE"; readonly format: string | null }
  | { readonly kind: "DATABASE"; readonly relation: string | null; readonly mode: Ogr2ogrWriteMode };

/**
 * The PostgreSQL relation an ogr2ogr invocation writes (the first schema-qualified target), or
 * NOT_DATABASE for a file output. Kept for callers that log the target; the gate itself judges every
 * target (`analyzeOgr2ogrArgs`): every -nln, every -lco SCHEMA= / active_schema, PGDump, -sql.
 */
export function ogr2ogrDatabaseWriteTarget(args: readonly string[]): Ogr2ogrTarget {
  const a = analyzeOgr2ogrArgs(args);
  if (!a.database) {
    const lowerFlags = classificationSpec().ogr2ogr.format_flags;
    const at = args.findIndex((x) => lowerFlags.includes(x.trim().toLowerCase()));
    return { kind: "NOT_DATABASE", format: at >= 0 && at + 1 < args.length ? args[at + 1]! : null };
  }
  const writes = a.targets.filter((t) => t.operation === "OGR2OGR_WRITE");
  const pick = writes.find((t) => t.name.schema !== null) ?? writes[0];
  return { kind: "DATABASE", relation: pick ? targetText(pick) : null, mode: a.mode };
}

/** Ungoverned ogr2ogr: refuse a PostgreSQL write (or -sql) to a protected or unresolvable relation. Returns the args. */
export function assertOgr2ogrWriteAllowed<T extends readonly string[]>(input: {
  readonly caller: string;
  readonly args: T;
  readonly definition?: ProtectedRelationsDefinition;
}): T {
  refuseVerdict(input.caller, judgeWrites(analyzeOgr2ogrArgs(input.args), input.definition), `ogr2ogr ${input.args.join(" ").slice(0, 160)}`);
  return input.args;
}

/** Split a command line into the arguments of its first command (quotes removed; no expansion). */
export function tokenizeCommandLine(command: string): string[] {
  return splitCommandLine(command)[0]?.[0]?.argv ?? [];
}

/** `assertCommandWriteAllowed` for an ogr2ogr command line string (execSync callers). Returns the command. */
export function assertOgr2ogrCommandAllowed(input: { readonly caller: string; readonly command: string }): string {
  return assertCommandWriteAllowed({ caller: input.caller, command: input.command });
}

/**
 * Ungoverned process: refuse a command line or argument vector that writes a protected relation or
 * a relation it does not name statically -- ogr2ogr, ogrinfo -sql, psql -c/-f/stdin, pg_restore,
 * pg_dump | psql, shp2pgsql/raster2pgsql, GDAL tools on PG:, prisma db push/migrate reset, and shell
 * wrappers (bash -c, cmd /c, pwsh -Command) around them. Returns its input.
 */
export function assertCommandWriteAllowed(input: { readonly caller: string; readonly command: string; readonly definition?: ProtectedRelationsDefinition }): string;
export function assertCommandWriteAllowed<T extends readonly string[]>(input: { readonly caller: string; readonly argv: T; readonly definition?: ProtectedRelationsDefinition }): T;
export function assertCommandWriteAllowed(input: {
  readonly caller: string;
  readonly command?: string;
  readonly argv?: readonly string[];
  readonly definition?: ProtectedRelationsDefinition;
}): string | readonly string[] {
  const analysis: WriteAnalysis =
    input.argv !== undefined ? analyzeCommandArgv(input.argv, GATE_OPTIONS) : analyzeCommandLine(input.command ?? "", GATE_OPTIONS);
  const shown = input.argv !== undefined ? input.argv.join(" ") : (input.command ?? "");
  refuseVerdict(input.caller, judgeWrites(analysis, input.definition), `command ${shown.slice(0, 160)}`);
  return input.argv !== undefined ? input.argv : (input.command ?? "");
}

// ---------------------------------------------------------------------------------------------
// One entry for the bindings' parity corpus
// ---------------------------------------------------------------------------------------------

export type GateClassificationInput =
  | { readonly kind: "sql"; readonly text: string }
  | { readonly kind: "ogr2ogr"; readonly args: readonly string[] }
  | { readonly kind: "argv"; readonly args: readonly string[] }
  | { readonly kind: "command"; readonly text: string }
  | { readonly kind: "relation"; readonly text: string }
  | { readonly kind: "schema"; readonly text: string }
  | { readonly kind: "operation"; readonly operation: string; readonly text: string };

/**
 * The normalized verdict for one input, exactly as the Python (`--corpus`) and PowerShell
 * (`Invoke-ProtectedWriteCorpus`) bindings compute it. Files are never read here (psql -f is unresolved).
 */
export function classifyProtectedWrite(
  input: GateClassificationInput,
  definition: ProtectedRelationsDefinition = PROTECTED_RELATIONS,
): { verdict: "ALLOWED" | "PROTECTED" | "UNRESOLVABLE"; protected: string[]; unresolved: string[] } {
  switch (input.kind) {
    case "sql":
      return normalizedVerdict(judgeWrites(analyzeSql(input.text), definition));
    case "ogr2ogr":
      return normalizedVerdict(judgeWrites(analyzeOgr2ogrArgs(input.args), definition));
    case "argv":
      return normalizedVerdict(judgeWrites(analyzeCommandArgv(input.args), definition));
    case "command":
      return normalizedVerdict(judgeWrites(analyzeCommandLine(input.text), definition));
    case "relation":
    case "schema":
    case "operation": {
      const schemaLevel = input.kind === "schema" || (input.kind === "operation" && isSchemaOperation(input.operation));
      const c = schemaLevel ? classifySchema(input.text, definition) : classifyRelation(input.text, definition);
      const op = input.kind === "operation" ? input.operation : input.kind.toUpperCase();
      if (c.kind === "PROTECTED") return { verdict: "PROTECTED", protected: [`${op} ${c.relation}`], unresolved: [] };
      if (c.kind === "UNRESOLVABLE") return { verdict: "UNRESOLVABLE", protected: [], unresolved: [op] };
      return { verdict: "ALLOWED", protected: [], unresolved: [] };
    }
  }
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

export function validateRetiredDestructiveScripts(list: readonly RetiredDestructiveScript[]): void {
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
validateRetiredDestructiveScripts(RETIRED_DESTRUCTIVE_SCRIPTS);

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
  assertFirstImportAdmitted,
  REJECT_FIRST_IMPORT_NOT_ADMITTED,
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
