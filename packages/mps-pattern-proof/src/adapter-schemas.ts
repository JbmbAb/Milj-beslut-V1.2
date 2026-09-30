/**
 * PATTERN-PROOF-ENGINE-01 V1 -- schema assembly for the orchestrator adapter (plan section 7 as
 * amended by D14, T4, T13).
 *
 * The Workflow adapter (`workflow/ppe-v1.js`) cannot import anything, so the artifact schemas are
 * inlined into it as a generated, marker-delimited `const PPE_SCHEMAS = {...};` block. This module
 * owns the deterministic serialization of `PPE_ARTIFACT_SCHEMAS` and the marker replacement; the
 * generator script (`scripts/gen-workflow-adapter.ts`) adds prettier formatting and the drift test
 * regenerates through the same functions and byte-compares the block between the markers.
 *
 * Pure: no filesystem, no prettier (a root devDependency that src/ must not depend on).
 */
import { PPE_ARTIFACT_SCHEMAS } from './schemas';

/** The identifier the adapter's hand-written control flow reads its schemas from. */
export const ADAPTER_SCHEMA_CONST_NAME = 'PPE_SCHEMAS';

export const GENERATED_BLOCK_BEGIN_MARKER =
  '// BEGIN GENERATED SCHEMAS (do not edit; run: npx tsx packages/mps-pattern-proof/scripts/gen-workflow-adapter.ts)';
export const GENERATED_BLOCK_END_MARKER = '// END GENERATED SCHEMAS';

/** Recursively sorts object keys (arrays keep their order: `required`/`enum` order is meaningful). */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) out[key] = sortKeysDeep(record[key]);
  return out;
}

/** Deterministic JSON (sorted keys, two-space indent) of every artifact schema keyed by kind. */
export function adapterSchemasJson(): string {
  return JSON.stringify(sortKeysDeep(PPE_ARTIFACT_SCHEMAS), null, 2);
}

/** The UNFORMATTED generated statement; the generator formats it through prettier. */
export function renderAdapterSchemaSource(): string {
  return `const ${ADAPTER_SCHEMA_CONST_NAME} = ${adapterSchemasJson()};\n`;
}

export interface GeneratedBlockBounds {
  /** index of the first character after the BEGIN marker line (its newline included) */
  readonly start: number;
  /** index of the first character of the END marker line */
  readonly end: number;
}

/** Locates the generated block; throws when either marker is missing, duplicated or out of order. */
export function locateGeneratedBlock(source: string): GeneratedBlockBounds {
  const beginLine = `${GENERATED_BLOCK_BEGIN_MARKER}\n`;
  const endLine = `${GENERATED_BLOCK_END_MARKER}\n`;
  const beginAt = source.indexOf(beginLine);
  if (beginAt === -1 || source.indexOf(beginLine, beginAt + 1) !== -1) {
    throw new Error(
      `generated block: BEGIN marker must appear exactly once ("${GENERATED_BLOCK_BEGIN_MARKER}")`,
    );
  }
  const endAt = source.indexOf(endLine);
  if (endAt === -1 || source.indexOf(endLine, endAt + 1) !== -1) {
    throw new Error(`generated block: END marker must appear exactly once ("${GENERATED_BLOCK_END_MARKER}")`);
  }
  const start = beginAt + beginLine.length;
  if (endAt < start) throw new Error('generated block: END marker precedes BEGIN marker');
  return { start, end: endAt };
}

/** The current text between the markers (what the drift test byte-compares). */
export function extractGeneratedBlock(source: string): string {
  const { start, end } = locateGeneratedBlock(source);
  return source.slice(start, end);
}

/** Replaces the text between the markers with `block` (which must end with a newline). */
export function applyGeneratedBlock(source: string, block: string): string {
  if (!block.endsWith('\n')) throw new Error('generated block must end with a newline');
  const { start, end } = locateGeneratedBlock(source);
  return `${source.slice(0, start)}${block}${source.slice(end)}`;
}
