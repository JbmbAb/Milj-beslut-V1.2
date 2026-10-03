import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * MIMER-PROTECTED-RELATION-CLASSIFICATION-V1 -- U30F2 M1/M2 (PRES-05): the shared classification
 * specification of the protected relation gate (protected-relation-classification.v1.json).
 *
 * The TypeScript gate and its Python and PowerShell bindings read the SAME file; parity is held by
 * tests/unit/protectedRelationGateBindings.test.ts. Loaded on FIRST USE: this package is imported by
 * the web server and the LU runtime through index.ts, and a module that only imports it does no I/O
 * for it. A missing or malformed specification throws, so every caller that needed it stops
 * (fail-closed); it never shrinks to "nothing is protected".
 */

export const PROTECTED_RELATION_CLASSIFICATION_CONTRACT_V1 = "mimer-protected-relation-classification-v1" as const;
export const PROTECTED_RELATION_CLASSIFICATION_INVALID = "PROTECTED_RELATION_CLASSIFICATION_INVALID" as const;

export interface RetainedRelationNamingScheme {
  readonly scheme: string;
  readonly digest_hex_length: number;
}

export interface ProtectedRelationClassificationSpec {
  readonly contract: typeof PROTECTED_RELATION_CLASSIFICATION_CONTRACT_V1;
  readonly dynamic_placeholder_open: string;
  readonly dynamic_placeholder_close: string;
  readonly relation_naming: {
    readonly current: RetainedRelationNamingScheme;
    readonly legacy: readonly RetainedRelationNamingScheme[];
    readonly max_identifier_bytes: number;
  };
  readonly partition_suffix_pattern: string;
  readonly unqualified_names: { readonly retained_shape_any_prefix: boolean };
  readonly schema_operations: readonly string[];
  readonly sql: {
    readonly trigger_words: readonly string[];
    readonly max_nesting: number;
    readonly reserved_at_name_position: readonly string[];
    readonly relation_object_kinds: readonly (readonly string[])[];
    readonly drop_unresolvable_object_kinds: readonly (readonly string[])[];
    readonly drop_on_object_kinds: readonly string[];
    readonly create_modifiers: readonly string[];
    /** A keyword counts as a statement start at index 0 or after one of these ("(" ")" "DYN" name token kinds). */
    readonly statement_start_after: readonly string[];
    /**
     * U30F2 H1: a dynamic value at a statement's first token, or after one of these, is a statement whose
     * verb the text does not hold (`psql -c "$SQL"`): DYNAMIC_SQL, unresolvable.
     */
    readonly dynamic_statement_after: readonly string[];
    /** ...and after these only in a statement that starts with EXPLAIN (`EXPLAIN ANALYZE $X` runs $X; `ANALYZE $T` names a table). */
    readonly dynamic_statement_after_explain: readonly string[];
    readonly truncate_not_after: readonly string[];
    readonly update_not_after: readonly string[];
    readonly execute_not_after: readonly string[];
    readonly execute_not_before: readonly string[];
    readonly postgis_functions: Readonly<Record<string, string>>;
    readonly dynamic_exec_functions: readonly string[];
    readonly psql_meta_copy: readonly string[];
    readonly psql_meta_unresolvable: readonly string[];
    /** U30F5 (D-7): CASCADE in a statement with one of these verbs reaches dependent objects no name shows -- unless after these (ON DELETE CASCADE). */
    readonly cascade_verbs: readonly string[];
    readonly cascade_not_after: readonly string[];
    /** U30F5 (B8): GRANT/REVOKE ON one of these object kinds names no relation (a sequence, a function, a database ...). */
    readonly privilege_other_object_kinds: readonly string[];
    /** U30F5 (B8): CREATE ROLE options that carry rights or a membership (SUPERUSER, BYPASSRLS, IN ROLE ...). */
    readonly role_options_unresolvable: readonly string[];
    /** U30F5 (D-4): the foreign-table OPTIONS that name its remote relation (default: the local schema and name). */
    readonly foreign_table_remote_options: { readonly schema: string; readonly table: string };
  };
  readonly ogr2ogr: {
    readonly format_flags: readonly string[];
    readonly database_formats: readonly string[];
    readonly sql_dump_formats: readonly string[];
    readonly layer_name_flags: readonly string[];
    readonly layer_creation_flags: readonly string[];
    readonly destination_open_flags: readonly string[];
    readonly sql_flags: readonly string[];
    readonly write_mode_flags: Readonly<Record<string, string>>;
    readonly database_datasource_prefixes: readonly string[];
    readonly schema_options: readonly string[];
    readonly active_schema_options: readonly string[];
  };
  readonly commands: {
    readonly tool_suffixes: readonly string[];
    readonly tools: Readonly<Record<string, string>>;
    readonly shell_wrappers: Readonly<Record<string, readonly string[]>>;
    /** Wrappers whose command is the rest of the line (cmd /c), not the one argument after the flag (sh -c). */
    readonly shell_wrappers_rest_of_line: readonly string[];
    /** U30F5 (D-5): programs that run a DB tool with arguments taken from their input (xargs, parallel, find -exec). */
    readonly argument_substituting_runners: readonly string[];
    readonly psql: { readonly command_flags: readonly string[]; readonly file_flags: readonly string[]; readonly value_flags: readonly string[] };
    readonly ogrinfo: { readonly sql_flags: readonly string[] };
    readonly pg_restore: {
      readonly table_flags: readonly string[];
      readonly schema_flags: readonly string[];
      readonly list_only_flags: readonly string[];
      readonly list_file_flags: readonly string[];
    };
    readonly shp2pgsql: { readonly value_flags: readonly string[] };
    readonly prisma: {
      readonly unresolvable_subcommands: readonly (readonly string[])[];
      readonly file_executing_subcommands: readonly (readonly string[])[];
      readonly file_flags: readonly string[];
      readonly stdin_flags: readonly string[];
    };
  };
}

function invalid(message: string): Error {
  return new Error(`${PROTECTED_RELATION_CLASSIFICATION_INVALID}: ${message}`);
}

function stringList(v: unknown, what: string, allowEmpty = false): string[] {
  if (!Array.isArray(v) || (!allowEmpty && v.length === 0) || !v.every((s) => typeof s === "string" && s.length > 0)) {
    throw invalid(`${what} must be a ${allowEmpty ? "" : "non-empty "}list of strings`);
  }
  return v as string[];
}

function scheme(v: unknown, what: string): RetainedRelationNamingScheme {
  const s = v as Record<string, unknown> | null;
  if (!s || typeof s.scheme !== "string" || !/^[A-Z0-9_]+$/.test(s.scheme)) throw invalid(`${what}.scheme`);
  const n = s.digest_hex_length;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 8 || n > 64) throw invalid(`${what}.digest_hex_length must be an integer 8..64`);
  return { scheme: s.scheme, digest_hex_length: n };
}

/** Strict validation of the parts every binding relies on; the rest is read as data. */
export function parseProtectedRelationClassificationSpec(raw: unknown): ProtectedRelationClassificationSpec {
  const doc = raw as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object") throw invalid("not an object");
  if (doc.contract !== PROTECTED_RELATION_CLASSIFICATION_CONTRACT_V1) throw invalid(`contract must be ${PROTECTED_RELATION_CLASSIFICATION_CONTRACT_V1}`);
  if (typeof doc.dynamic_placeholder_open !== "string" || typeof doc.dynamic_placeholder_close !== "string") throw invalid("dynamic placeholder");
  const naming = doc.relation_naming as Record<string, unknown> | undefined;
  if (!naming) throw invalid("relation_naming");
  const current = scheme(naming.current, "relation_naming.current");
  if (!Array.isArray(naming.legacy)) throw invalid("relation_naming.legacy must be a list");
  const legacy = naming.legacy.map((l, i) => scheme(l, `relation_naming.legacy[${i}]`));
  const lengths = new Set([current.digest_hex_length, ...legacy.map((l) => l.digest_hex_length)]);
  if (lengths.size !== 1 + legacy.length) throw invalid("relation_naming schemes must have distinct digest lengths");
  if (naming.max_identifier_bytes !== 63) throw invalid("relation_naming.max_identifier_bytes must be 63 (PostgreSQL NAMEDATALEN - 1)");
  if (typeof doc.partition_suffix_pattern !== "string") throw invalid("partition_suffix_pattern");
  const sql = doc.sql as Record<string, unknown> | undefined;
  if (!sql) throw invalid("sql");
  stringList(sql.trigger_words, "sql.trigger_words");
  stringList(sql.reserved_at_name_position, "sql.reserved_at_name_position");
  stringList(sql.dynamic_statement_after, "sql.dynamic_statement_after");
  stringList(sql.dynamic_statement_after_explain, "sql.dynamic_statement_after_explain");
  if (typeof sql.max_nesting !== "number" || sql.max_nesting < 1) throw invalid("sql.max_nesting");
  // U30F5: the D-3/D-4/D-5/D-7/B8 vocabularies are required -- a missing list would read as "nothing to refuse"
  for (const k of ["cascade_verbs", "cascade_not_after", "privilege_other_object_kinds", "role_options_unresolvable"]) stringList(sql[k], `sql.${k}`);
  const remote = sql.foreign_table_remote_options as Record<string, unknown> | undefined;
  if (!remote || typeof remote.schema !== "string" || typeof remote.table !== "string") throw invalid("sql.foreign_table_remote_options");
  const ogr = doc.ogr2ogr as Record<string, unknown> | undefined;
  if (!ogr) throw invalid("ogr2ogr");
  stringList(ogr.database_formats, "ogr2ogr.database_formats");
  stringList(ogr.layer_name_flags, "ogr2ogr.layer_name_flags");
  const commands = doc.commands as Record<string, unknown> | undefined;
  if (!commands || !commands.tools || typeof commands.tools !== "object") throw invalid("commands.tools");
  stringList(commands.argument_substituting_runners, "commands.argument_substituting_runners");
  stringList(doc.schema_operations, "schema_operations");
  return Object.freeze({ ...(doc as object), relation_naming: Object.freeze({ current, legacy: Object.freeze(legacy), max_identifier_bytes: 63 }) }) as ProtectedRelationClassificationSpec;
}

export const PROTECTED_RELATION_CLASSIFICATION_FILE = join(dirname(fileURLToPath(import.meta.url)), "protected-relation-classification.v1.json");

let loaded: ProtectedRelationClassificationSpec | null = null;

/** The committed specification, read and validated on first use (fail-closed). */
export function classificationSpec(): ProtectedRelationClassificationSpec {
  loaded ??= parseProtectedRelationClassificationSpec(JSON.parse(readFileSync(PROTECTED_RELATION_CLASSIFICATION_FILE, "utf8")));
  return loaded;
}

// ---------------------------------------------------------------------------------------------
// Dynamic placeholder: a value the source text does not determine (a variable, an interpolation)
// ---------------------------------------------------------------------------------------------

/** `⟦DYN⟧` or `⟦DYN:hint⟧`: stands for text that is only known at run time. */
export function dynamicPlaceholder(hint?: string): string {
  const s = classificationSpec();
  const clean = (hint ?? "").replace(/[^A-Za-z0-9_.-]/g, "");
  return `${s.dynamic_placeholder_open}${clean ? `:${clean}` : ""}${s.dynamic_placeholder_close}`;
}

export function containsDynamic(text: string): boolean {
  return text.includes(classificationSpec().dynamic_placeholder_open);
}

/** The hint of a value that is ENTIRELY one placeholder, else null. */
export function dynamicHint(text: string): string | null {
  const s = classificationSpec();
  const t = text.trim();
  if (!t.startsWith(s.dynamic_placeholder_open) || !t.endsWith(s.dynamic_placeholder_close)) return null;
  const inner = t.slice(s.dynamic_placeholder_open.length, t.length - s.dynamic_placeholder_close.length);
  if (inner.includes(s.dynamic_placeholder_open)) return null;
  return inner.startsWith(":") ? inner.slice(1) : "";
}

// ---------------------------------------------------------------------------------------------
// Retained relation naming
// ---------------------------------------------------------------------------------------------

/** Every digest length a retained relation name may carry (current first, then legacy). */
export function retainedRelationDigestLengths(): number[] {
  const n = classificationSpec().relation_naming;
  return [n.current.digest_hex_length, ...n.legacy.map((l) => l.digest_hex_length)];
}

export function currentRetainedRelationNaming(): RetainedRelationNamingScheme {
  return classificationSpec().relation_naming.current;
}

export function legacyRetainedRelationNamings(): readonly RetainedRelationNamingScheme[] {
  return classificationSpec().relation_naming.legacy;
}

/** True when `suffix` is a lower-case hex digest prefix of a length some naming scheme uses. */
export function isRetainedRelationDigestSuffix(suffix: string): boolean {
  return /^[0-9a-f]+$/.test(suffix) && retainedRelationDigestLengths().includes(suffix.length);
}

/** Every naming scheme, the current one first: the order in which a version's relation is looked up. */
export function retainedRelationNamings(): readonly RetainedRelationNamingScheme[] {
  return [currentRetainedRelationNaming(), ...legacyRetainedRelationNamings()];
}

/**
 * U30F2 M3: `<table>_<first N hex of the version's full content_bundle_sha256>` under `scheme`
 * (default: the current scheme, used for every NEW relation). Pure; the caller checks the 63-byte
 * PostgreSQL limit (a longer name is refused, never truncated or suffixed).
 */
export function retainedRelationTableName(table: string, sha256: string, scheme: RetainedRelationNamingScheme = currentRetainedRelationNaming()): string {
  return `${table}_${sha256.slice(0, scheme.digest_hex_length)}`;
}

/** The scheme under which `relationTable` is the retained relation of (`table`, full `sha256`), or null. */
export function retainedRelationNamingOf(table: string, sha256: string, relationTable: string): RetainedRelationNamingScheme | null {
  return retainedRelationNamings().find((s) => retainedRelationTableName(table, sha256, s) === relationTable) ?? null;
}

/** The maximum identifier length in bytes (PostgreSQL NAMEDATALEN - 1). */
export function maxIdentifierBytes(): number {
  return classificationSpec().relation_naming.max_identifier_bytes;
}
