import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classificationSpec, isRetainedRelationDigestSuffix } from "./ProtectedRelationSpec";

/**
 * MIMER-PROTECTED-RELATIONS-V1 -- U30F F1 (PRES-05): which relations are protected.
 *
 * The definition lives in `protected-relations.v1.json` next to this file, so that the TypeScript
 * gate (ProtectedRelationGate.ts) and its Python and PowerShell bindings read ONE list. This module
 * only loads, validates and classifies; it never touches a database.
 *
 * Classes:
 *   - LU_LIVE_LAYER    a live table an LU assessment binds to (SpatialLayerRegistry + ADMIT-V1 set);
 *                      only the retain-before-replace promote may TRUNCATE it.
 *   - LU_DERIVED       a table re-derived from a protected source by one registered derivation
 *                      (core.property_unit <- env.registerenhetsomradesytor).
 *   - RETAINED_STAGING every relation in a retained-staging schema (lm_staging): the retained
 *                      materialisation of a bound dataset version may live there under any name.
 *
 * Name resolution is conservative: an unqualified name that equals a protected table name, is a
 * partition of one, or has the retained-relation shape `<identifier>_<hex>` (any digest length a
 * naming scheme in protected-relation-classification.v1.json uses) is treated as protected, because
 * the search_path that would resolve it is not known here.
 *
 * U30F2 M1/M2: the rules (partition suffix, retained-relation shapes) come from the shared
 * classification specification (ProtectedRelationSpec.ts) that the Python and PowerShell bindings
 * read as well.
 */

export const PROTECTED_RELATIONS_CONTRACT_V1 = "mimer-protected-relations-v1" as const;
export const PROTECTED_RELATIONS_DEFINITION_INVALID = "PROTECTED_RELATIONS_DEFINITION_INVALID" as const;

export type ProtectedRelationClass = "LU_LIVE_LAYER" | "LU_DERIVED" | "RETAINED_STAGING";

export interface ProtectedRelationEntry {
  readonly relation: string;
  readonly schema: string;
  readonly table: string;
  readonly class: "LU_LIVE_LAYER" | "LU_DERIVED";
  readonly basis: string;
  /** LU_DERIVED only: the protected relation it is derived from. */
  readonly derived_from?: string;
  /** LU_DERIVED only: the one repo-relative module allowed to rebuild it. */
  readonly sanctioned_rebuild?: string;
}

export interface ProtectedRelationsDefinition {
  readonly contract: typeof PROTECTED_RELATIONS_CONTRACT_V1;
  readonly retained_staging_schemas: readonly string[];
  readonly relations: readonly ProtectedRelationEntry[];
}

const PLAIN_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function invalid(message: string): Error {
  return new Error(`${PROTECTED_RELATIONS_DEFINITION_INVALID}: ${message}`);
}

/** Strict validation: a malformed definition must stop every caller (fail-closed), never shrink the list. */
export function parseProtectedRelationsDefinition(raw: unknown): ProtectedRelationsDefinition {
  if (!raw || typeof raw !== "object") throw invalid("not an object");
  const doc = raw as Record<string, unknown>;
  if (doc.contract !== PROTECTED_RELATIONS_CONTRACT_V1) throw invalid(`contract must be ${PROTECTED_RELATIONS_CONTRACT_V1}`);
  const schemas = doc.retained_staging_schemas;
  if (!Array.isArray(schemas) || schemas.length === 0 || !schemas.every((s) => typeof s === "string" && PLAIN_IDENTIFIER.test(s))) {
    throw invalid("retained_staging_schemas must be a non-empty list of plain identifiers");
  }
  const relations = doc.relations;
  if (!Array.isArray(relations) || relations.length === 0) throw invalid("relations must be a non-empty list");
  const seen = new Set<string>();
  const entries = relations.map((r, i): ProtectedRelationEntry => {
    if (!r || typeof r !== "object") throw invalid(`relations[${i}] is not an object`);
    const e = r as Record<string, unknown>;
    const relation = e.relation;
    if (typeof relation !== "string") throw invalid(`relations[${i}].relation missing`);
    const [schema, table, extra] = relation.split(".");
    if (extra !== undefined || !schema || !table || !PLAIN_IDENTIFIER.test(schema) || !PLAIN_IDENTIFIER.test(table)) {
      throw invalid(`relations[${i}].relation "${relation}" is not schema.table of plain identifiers`);
    }
    if (seen.has(relation)) throw invalid(`duplicate relation ${relation}`);
    seen.add(relation);
    if (e.class !== "LU_LIVE_LAYER" && e.class !== "LU_DERIVED") throw invalid(`${relation}: unknown class ${String(e.class)}`);
    if (typeof e.basis !== "string" || e.basis.trim().length < 8) throw invalid(`${relation}: basis must say why it is protected`);
    if (e.class === "LU_DERIVED") {
      if (typeof e.derived_from !== "string" || typeof e.sanctioned_rebuild !== "string" || !e.sanctioned_rebuild.includes("/")) {
        throw invalid(`${relation}: LU_DERIVED needs derived_from and a repo-relative sanctioned_rebuild`);
      }
    } else if (e.derived_from !== undefined || e.sanctioned_rebuild !== undefined) {
      throw invalid(`${relation}: only LU_DERIVED may name a sanctioned rebuild`);
    }
    return Object.freeze({
      relation,
      schema,
      table,
      class: e.class,
      basis: e.basis,
      ...(e.class === "LU_DERIVED" ? { derived_from: e.derived_from as string, sanctioned_rebuild: e.sanctioned_rebuild as string } : {}),
    });
  });
  for (const e of entries) {
    if (schemas.includes(e.schema)) throw invalid(`${e.relation} lies in a retained-staging schema; list the schema, not the table`);
  }
  return Object.freeze({
    contract: PROTECTED_RELATIONS_CONTRACT_V1,
    retained_staging_schemas: Object.freeze([...schemas] as string[]),
    relations: Object.freeze(entries),
  });
}

export const PROTECTED_RELATIONS_FILE = join(dirname(fileURLToPath(import.meta.url)), "protected-relations.v1.json");

export const PROTECTED_RELATIONS: ProtectedRelationsDefinition = parseProtectedRelationsDefinition(
  JSON.parse(readFileSync(PROTECTED_RELATIONS_FILE, "utf8")),
);

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

export interface RelationName {
  /** null when the name was not schema-qualified. */
  readonly schema: string | null;
  readonly table: string;
}

const NAME_PART = /\s*(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))\s*/y;

/**
 * Parse a (possibly quoted, possibly schema- or database-qualified) relation name the way
 * PostgreSQL resolves it: unquoted parts fold to lower case, quoted parts keep their case.
 * Returns null when the text is not a relation name (then the caller treats it as unresolvable).
 */
export function parseRelationName(raw: string): RelationName | null {
  const text = raw.trim().replace(/^ONLY\s+/i, "").replace(/\s*\*$/, "");
  const parts: string[] = [];
  let pos = 0;
  for (;;) {
    NAME_PART.lastIndex = pos;
    const m = NAME_PART.exec(text);
    if (!m) return null;
    parts.push(m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2]!.toLowerCase());
    pos = NAME_PART.lastIndex;
    if (pos === text.length) break;
    if (text[pos] !== ".") return null;
    pos += 1;
  }
  if (parts.length === 1) return { schema: null, table: parts[0]! };
  if (parts.length === 2 || parts.length === 3) return { schema: parts[parts.length - 2]!, table: parts[parts.length - 1]! };
  return null;
}

export function formatRelationName(name: RelationName): string {
  return name.schema === null ? name.table : `${name.schema}.${name.table}`;
}

function canonicalPart(part: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(part) ? part : `"${part.replace(/"/g, '""')}"`;
}

/** The name as SQL text that parses back to exactly this name (plain parts bare, others quoted). */
export function canonicalRelationText(name: RelationName): string {
  return name.schema === null ? canonicalPart(name.table) : `${canonicalPart(name.schema)}.${canonicalPart(name.table)}`;
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

export type RelationClassification =
  | {
      readonly kind: "PROTECTED";
      readonly relation: string;
      readonly class: ProtectedRelationClass;
      readonly entry: ProtectedRelationEntry | null;
      readonly reason: string;
    }
  | { readonly kind: "UNPROTECTED"; readonly relation: string }
  | { readonly kind: "UNRESOLVABLE"; readonly relation: string; readonly reason: string };

function partitionOf(entry: ProtectedRelationEntry, table: string): boolean {
  return table.startsWith(`${entry.table}_`) && new RegExp(classificationSpec().partition_suffix_pattern).test(table.slice(entry.table.length + 1));
}

function retainedShapeOf(entry: ProtectedRelationEntry, table: string): boolean {
  return table.startsWith(`${entry.table}_`) && isRetainedRelationDigestSuffix(table.slice(entry.table.length + 1));
}

/** `<plain identifier>_<hex of a naming-scheme length>`: the shape of every retained relation name. */
export function hasRetainedRelationShape(table: string): boolean {
  const m = /^([a-z_][a-z0-9_]*)_([0-9a-f]+)$/.exec(table);
  return m !== null && isRetainedRelationDigestSuffix(m[2]!);
}

export function classifyRelation(
  name: string | RelationName,
  definition: ProtectedRelationsDefinition = PROTECTED_RELATIONS,
): RelationClassification {
  const parsed = typeof name === "string" ? parseRelationName(name) : name;
  const display = typeof name === "string" ? name.trim() : formatRelationName(name);
  if (!parsed) return { kind: "UNRESOLVABLE", relation: display, reason: "not a relation name" };
  const relation = formatRelationName(parsed);

  if (parsed.schema !== null) {
    if (definition.retained_staging_schemas.includes(parsed.schema)) {
      return { kind: "PROTECTED", relation, class: "RETAINED_STAGING", entry: null, reason: `relation in retained-staging schema ${parsed.schema}` };
    }
    for (const entry of definition.relations) {
      if (entry.schema !== parsed.schema) continue;
      if (entry.table === parsed.table) return { kind: "PROTECTED", relation, class: entry.class, entry, reason: entry.basis };
      if (partitionOf(entry, parsed.table)) {
        return { kind: "PROTECTED", relation, class: entry.class, entry, reason: `partition of ${entry.relation} (${entry.basis})` };
      }
    }
    return { kind: "UNPROTECTED", relation };
  }

  for (const entry of definition.relations) {
    if (entry.table === parsed.table || partitionOf(entry, parsed.table)) {
      return {
        kind: "PROTECTED",
        relation,
        class: entry.class,
        entry,
        reason: `unqualified name may resolve to ${entry.relation} through the search_path (${entry.basis})`,
      };
    }
    if (retainedShapeOf(entry, parsed.table)) {
      return {
        kind: "PROTECTED",
        relation,
        class: "RETAINED_STAGING",
        entry: null,
        reason: `unqualified name has the retained-relation shape of ${entry.relation} (<table>_<hex>)`,
      };
    }
  }
  if (classificationSpec().unqualified_names.retained_shape_any_prefix && hasRetainedRelationShape(parsed.table)) {
    return {
      kind: "PROTECTED",
      relation,
      class: "RETAINED_STAGING",
      entry: null,
      reason: `unqualified name has the retained-relation shape <identifier>_<hex> and may resolve to ${definition.retained_staging_schemas.join("/")} through the search_path`,
    };
  }
  return { kind: "UNPROTECTED", relation };
}

/** A schema is protected when it is a retained-staging schema or holds any protected relation. */
export function classifySchema(
  schema: string,
  definition: ProtectedRelationsDefinition = PROTECTED_RELATIONS,
): RelationClassification {
  const parsed = parseRelationName(schema);
  if (!parsed || parsed.schema !== null) return { kind: "UNRESOLVABLE", relation: schema, reason: "not a schema name" };
  const name = parsed.table;
  if (definition.retained_staging_schemas.includes(name)) {
    return { kind: "PROTECTED", relation: `${name}.*`, class: "RETAINED_STAGING", entry: null, reason: `retained-staging schema ${name}` };
  }
  const held = definition.relations.find((e) => e.schema === name);
  if (held) {
    return { kind: "PROTECTED", relation: `${name}.*`, class: held.class, entry: held, reason: `schema holds protected relation ${held.relation}` };
  }
  return { kind: "UNPROTECTED", relation: `${name}.*` };
}
