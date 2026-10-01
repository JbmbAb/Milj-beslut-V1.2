import { describe, expect, it } from 'vitest';
import { PATTERN_PROOF_ARTIFACT_KINDS } from '../src/identity';
import { PPE_ARTIFACT_SCHEMAS } from '../src/schemas';
import {
  listSchemaKeywords,
  PPE_SCHEMA_KEYWORDS,
  schemaContradictions,
  validateAgainstSubsetSchema,
  type SubsetSchema,
} from '../src/schema-subset';
import { validateArtifact } from '../src/validators';
import { FIXTURE_BUILDERS, validCandidate, validGate, validGraph, validManifest } from './fixtures/artifacts';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walks a schema and yields every object-typed node with its pointer. */
function objectNodes(schema: SubsetSchema, pointer = ''): Array<{ pointer: string; node: SubsetSchema }> {
  const out: Array<{ pointer: string; node: SubsetSchema }> = [];
  if (schema.type === 'object') out.push({ pointer: pointer || '/', node: schema });
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    out.push(...objectNodes(child, `${pointer}/properties/${name}`));
  }
  if (schema.items) out.push(...objectNodes(schema.items, `${pointer}/items`));
  if (isPlainObject(schema.additionalProperties)) {
    out.push(...objectNodes(schema.additionalProperties, `${pointer}/additionalProperties`));
  }
  return out;
}

describe('PPE_ARTIFACT_SCHEMAS: draft-07 subset discipline (plan constraint 14)', () => {
  it('has exactly one schema per artifact kind', () => {
    expect(Object.keys(PPE_ARTIFACT_SCHEMAS).sort()).toEqual([...PATTERN_PROOF_ARTIFACT_KINDS].sort());
  });

  it('PPE_SCHEMA_KEYWORDS is the frozen allowed list', () => {
    expect([...PPE_SCHEMA_KEYWORDS]).toEqual([
      'type',
      'properties',
      'required',
      'items',
      'enum',
      'minItems',
      'additionalProperties',
      'description',
    ]);
  });

  for (const kind of PATTERN_PROOF_ARTIFACT_KINDS) {
    const schema = PPE_ARTIFACT_SCHEMAS[kind];

    it(`${kind}: uses no keyword outside PPE_SCHEMA_KEYWORDS`, () => {
      const used = listSchemaKeywords(schema);
      const foreign = used.filter((keyword) => !(PPE_SCHEMA_KEYWORDS as readonly string[]).includes(keyword));
      expect(foreign).toEqual([]);
      for (const banned of [
        '$schema',
        '$id',
        'format',
        'const',
        'pattern',
        'if',
        'then',
        'else',
        'oneOf',
        'anyOf',
      ]) {
        expect(used).not.toContain(banned);
      }
    });

    it(`${kind}: required is a subset of properties; additionalProperties:false only with every required key declared`, () => {
      expect(schemaContradictions(schema)).toEqual([]);
      for (const { pointer, node } of objectNodes(schema)) {
        const declared = Object.keys(node.properties ?? {});
        for (const name of node.required ?? []) {
          expect(declared, `${pointer} requires undeclared "${name}"`).toContain(name);
        }
        if (node.additionalProperties === false) {
          expect(
            (node.required ?? []).every((name) => declared.includes(name)),
            pointer,
          ).toBe(true);
        }
      }
    });

    it(`${kind}: the schema is JSON-serializable without loss (adapter embeds it as a literal)`, () => {
      expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    });
  }
});

describe('fixtures agree with BOTH the hand-rolled validator and the subset schema', () => {
  for (const kind of PATTERN_PROOF_ARTIFACT_KINDS) {
    it(`${kind}: fixture passes both`, () => {
      const fixture = FIXTURE_BUILDERS[kind]();
      expect(() => validateArtifact(kind, fixture)).not.toThrow();
      const result = validateAgainstSubsetSchema(PPE_ARTIFACT_SCHEMAS[kind], fixture);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
      // the validated (frozen) copy is schema-valid as well
      expect(
        validateAgainstSubsetSchema(PPE_ARTIFACT_SCHEMAS[kind], validateArtifact(kind, fixture)).ok,
      ).toBe(true);
    });

    it(`${kind}: an unknown top-level key fails both`, () => {
      const broken = { ...FIXTURE_BUILDERS[kind](), writerRationale: 'trust me' };
      expect(() => validateArtifact(kind, broken)).toThrow(/PPE_UNKNOWN_FIELD/);
      const result = validateAgainstSubsetSchema(PPE_ARTIFACT_SCHEMAS[kind], broken);
      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toMatch(/writerRationale/);
    });
  }

  it('a structurally broken example fails both with pointer-addressed errors', () => {
    const graph = validGraph();
    const broken = { ...graph, edges: [{ ...graph.edges[0], relationType: 'depends-on', evidence: [] }] };
    expect(() => validateArtifact('dependency-graph', broken)).toThrow(/PPE_/);
    const result = validateAgainstSubsetSchema(PPE_ARTIFACT_SCHEMAS['dependency-graph'], broken);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      '/edges/0/relationType: value "depends-on" is not one of imports, calls, binds-to, verifies-against, invokes, requires-present',
    );
    expect(result.errors).toContain('/edges/0/evidence: expected at least 1 item(s), got 0');
  });

  it('missing required, wrong types and additional properties are reported with pointers', () => {
    const candidate = validCandidate();
    const broken = {
      ...candidate,
      baseSha: 42,
      diffRef: { kind: 'git_object' },
      allowedPathsCompliance: { ...candidate.allowedPathsCompliance, extra: true },
    };
    const result = validateAgainstSubsetSchema(PPE_ARTIFACT_SCHEMAS.candidate, broken);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('/baseSha: expected type string, got number');
    expect(result.errors).toContain('/diffRef: missing required property "ref"');
    expect(result.errors).toContain(
      '/allowedPathsCompliance/extra: additional property "extra" is not allowed',
    );
  });

  it('record schemas check values through additionalProperties', () => {
    const manifest = { ...validManifest(), environmentConfig: { NODE_ENV: 1 } };
    const result = validateAgainstSubsetSchema(PPE_ARTIFACT_SCHEMAS['input-manifest'], manifest);
    expect(result.errors).toEqual(['/environmentConfig/NODE_ENV: expected type string, got number']);
  });

  it('semantic invariants are the validator’s job, not the schema’s (documented division of labour)', () => {
    const gate = { ...validGate(), items: [{ item: 'x', classification: 'MECHANICAL' }] };
    expect(validateAgainstSubsetSchema(PPE_ARTIFACT_SCHEMAS['decision-gate'], gate).ok).toBe(true);
    expect(() => validateArtifact('decision-gate', gate)).toThrow(/PPE_DECISION_ITEM_INCOMPLETE/);
  });
});

describe('validateAgainstSubsetSchema fails closed on schemas outside the subset', () => {
  it('rejects a schema carrying a foreign keyword', () => {
    const result = validateAgainstSubsetSchema({ type: 'string', pattern: '^x$' } as SubsetSchema, 'x');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/unsupported keyword "pattern"/);
  });

  it('rejects a self-contradictory schema (required not in properties)', () => {
    const result = validateAgainstSubsetSchema({ type: 'object', properties: {}, required: ['a'] }, { a: 1 });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/required key "a" is not declared/);
  });

  it('handles integer/number/null/boolean/enum primitives', () => {
    expect(validateAgainstSubsetSchema({ type: 'integer' }, 1.5).ok).toBe(false);
    expect(validateAgainstSubsetSchema({ type: 'integer' }, 2).ok).toBe(true);
    expect(validateAgainstSubsetSchema({ type: 'number' }, Number.NaN).ok).toBe(false);
    expect(validateAgainstSubsetSchema({ type: 'null' }, null).ok).toBe(true);
    expect(validateAgainstSubsetSchema({ type: 'boolean' }, 'true').ok).toBe(false);
    expect(validateAgainstSubsetSchema({ enum: ['a', 1, null] }, null).ok).toBe(true);
    expect(validateAgainstSubsetSchema({ enum: ['a', 1, null] }, '1').ok).toBe(false);
  });

  it('escapes JSON-pointer segments', () => {
    const result = validateAgainstSubsetSchema(
      { type: 'object', additionalProperties: { type: 'string' } },
      { 'a/b~c': 1 },
    );
    expect(result.errors).toEqual(['/a~1b~0c: expected type string, got number']);
  });
});
