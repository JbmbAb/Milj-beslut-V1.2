/**
 * PATTERN-PROOF-ENGINE-01 V1 -- a tiny checker for the JSON-Schema draft-07 SUBSET that the
 * orchestrator adapter may use (plan constraint 14): exactly the keywords in `PPE_SCHEMA_KEYWORDS`
 * (type, properties, required, items, enum, minItems, additionalProperties, description). No
 * $schema, $id, format, const, pattern, if/then/else, oneOf, ... -- a schema carrying any other
 * keyword is rejected here so that the checked-in schemas can never drift beyond what the adapter's
 * Ajv instance (validateFormats:false) is trusted to enforce.
 *
 * This is NOT a schema library and NOT the semantic authority: ./validators.ts is. It exists so the
 * package can prove, in tests, that every artifact schema and every fixture agree.
 */

export const PPE_SCHEMA_KEYWORDS = [
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'minItems',
  'additionalProperties',
  'description',
] as const;

export type SubsetSchemaKeyword = (typeof PPE_SCHEMA_KEYWORDS)[number];

export type SubsetSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export interface SubsetSchema {
  readonly type?: SubsetSchemaType;
  readonly properties?: Readonly<Record<string, SubsetSchema>>;
  readonly required?: readonly string[];
  readonly items?: SubsetSchema;
  readonly enum?: readonly (string | number | boolean | null)[];
  readonly minItems?: number;
  readonly additionalProperties?: boolean | SubsetSchema;
  readonly description?: string;
}

export interface SubsetSchemaResult {
  ok: boolean;
  errors: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, type: SubsetSchemaType): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
  }
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Every keyword that appears anywhere in `schema` (recursing into properties, items and an
 * object-valued additionalProperties), in encounter order, de-duplicated. Used by the keyword
 * drift test and by the adapter generator's self-check.
 */
export function listSchemaKeywords(schema: unknown): string[] {
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (!isPlainObject(node)) return;
    for (const key of Object.keys(node)) {
      seen.add(key);
      if (key === 'properties' && isPlainObject(node[key])) {
        for (const child of Object.values(node[key] as Record<string, unknown>)) walk(child);
      } else if (key === 'items' || key === 'additionalProperties') {
        walk(node[key]);
      }
    }
  };
  walk(schema);
  return [...seen];
}

/**
 * Structural sanity of the schema itself (the harness "contradiction check"): only allowed keywords,
 * `required` a subset of `properties`, `additionalProperties:false` only when every required key is
 * declared. Returns pointer-prefixed messages; empty means sane.
 */
export function schemaContradictions(schema: unknown, pointer = ''): string[] {
  const errors: string[] = [];
  if (!isPlainObject(schema)) {
    errors.push(`${pointer || '/'}: schema must be a plain object`);
    return errors;
  }
  for (const key of Object.keys(schema)) {
    if (!(PPE_SCHEMA_KEYWORDS as readonly string[]).includes(key)) {
      errors.push(`${pointer || '/'}: unsupported keyword "${key}"`);
    }
  }
  const properties = isPlainObject(schema.properties) ? schema.properties : undefined;
  if (schema.properties !== undefined && properties === undefined) {
    errors.push(`${pointer || '/'}: properties must be an object`);
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== 'string')) {
      errors.push(`${pointer || '/'}: required must be an array of strings`);
    } else {
      for (const name of schema.required as string[]) {
        if (properties === undefined || !(name in properties)) {
          errors.push(`${pointer || '/'}: required key "${name}" is not declared in properties`);
        }
      }
    }
  }
  if (schema.minItems !== undefined && (typeof schema.minItems !== 'number' || schema.minItems < 0)) {
    errors.push(`${pointer || '/'}: minItems must be a non-negative number`);
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    errors.push(`${pointer || '/'}: enum must be a non-empty array`);
  }
  if (properties !== undefined) {
    for (const [name, child] of Object.entries(properties)) {
      errors.push(...schemaContradictions(child, `${pointer}/properties/${escapePointer(name)}`));
    }
  }
  if (schema.items !== undefined) errors.push(...schemaContradictions(schema.items, `${pointer}/items`));
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    errors.push(...schemaContradictions(schema.additionalProperties, `${pointer}/additionalProperties`));
  }
  return errors;
}

function check(schema: SubsetSchema, value: unknown, pointer: string, errors: string[]): void {
  const here = pointer === '' ? '/' : pointer;
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push(`${here}: expected type ${schema.type}, got ${typeOf(value)}`);
    return;
  }
  if (schema.enum !== undefined && !schema.enum.some((candidate) => candidate === value)) {
    errors.push(
      `${here}: value ${JSON.stringify(value)} is not one of ${schema.enum.map(String).join(', ')}`,
    );
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${here}: expected at least ${schema.minItems} item(s), got ${value.length}`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) =>
        check(schema.items as SubsetSchema, item, `${pointer}/${index}`, errors),
      );
    }
    return;
  }
  if (isPlainObject(value)) {
    const properties = schema.properties ?? {};
    for (const name of schema.required ?? []) {
      if (!(name in value) || value[name] === undefined) {
        errors.push(`${here}: missing required property "${name}"`);
      }
    }
    for (const [name, child] of Object.entries(value)) {
      if (child === undefined) continue;
      const childPointer = `${pointer}/${escapePointer(name)}`;
      if (name in properties) {
        check(properties[name], child, childPointer, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${childPointer}: additional property "${name}" is not allowed`);
      } else if (typeof schema.additionalProperties === 'object') {
        check(schema.additionalProperties, child, childPointer, errors);
      }
    }
  }
}

/**
 * Validates `value` against a subset schema. A schema outside the subset (or self-contradictory)
 * fails closed: the result is `ok:false` with the schema problems listed first.
 */
export function validateAgainstSubsetSchema(schema: SubsetSchema, value: unknown): SubsetSchemaResult {
  const errors = schemaContradictions(schema);
  if (errors.length > 0) return { ok: false, errors };
  check(schema, value, '', errors);
  return { ok: errors.length === 0, errors };
}
