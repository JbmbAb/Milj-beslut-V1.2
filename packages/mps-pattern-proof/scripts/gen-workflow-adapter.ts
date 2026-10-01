/**
 * PATTERN-PROOF-ENGINE-01 V1 -- regenerates the schema block of workflow/ppe-v1.js (plan section 7,
 * T13). The block between the BEGIN/END markers is `const PPE_SCHEMAS = {...};` = PPE_ARTIFACT_SCHEMAS
 * serialized deterministically (sorted keys) and formatted through prettier with the repo's
 * .prettierrc.json (parser babel). The hand-written control flow around the block is never touched.
 *
 *   npx tsx packages/mps-pattern-proof/scripts/gen-workflow-adapter.ts   -> rewrites in place, prints changed|unchanged
 *
 * tests/workflow-adapter.test.ts regenerates through `renderGeneratedSchemaBlock()` and asserts
 * byte-equality with the checked-in block.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import {
  applyGeneratedBlock,
  extractGeneratedBlock,
  renderAdapterSchemaSource,
} from '../src/adapter-schemas';

export { applyGeneratedBlock, extractGeneratedBlock } from '../src/adapter-schemas';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..');

export const ADAPTER_FILE = path.join(PACKAGE_ROOT, 'workflow', 'ppe-v1.js');

/** The repo's prettier configuration (singleQuote, semi, trailingComma all, printWidth 110). */
export function repoPrettierOptions(): Record<string, unknown> {
  const text = fs.readFileSync(path.join(REPO_ROOT, '.prettierrc.json'), 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('.prettierrc.json must hold an object');
  }
  return parsed as Record<string, unknown>;
}

/** The formatted generated block (without the marker lines), ending with a newline. */
export async function renderGeneratedSchemaBlock(): Promise<string> {
  const formatted = await prettier.format(renderAdapterSchemaSource(), {
    ...repoPrettierOptions(),
    parser: 'babel',
  });
  return formatted.endsWith('\n') ? formatted : `${formatted}\n`;
}

export interface RegenerateResult {
  readonly changed: boolean;
  readonly file: string;
}

/** Rewrites the adapter's generated block in place; returns whether the file content changed. */
export async function regenerateAdapterFile(file: string = ADAPTER_FILE): Promise<RegenerateResult> {
  const source = fs.readFileSync(file, 'utf8');
  const block = await renderGeneratedSchemaBlock();
  const changed = extractGeneratedBlock(source) !== block;
  if (changed) fs.writeFileSync(file, applyGeneratedBlock(source, block));
  return { changed, file };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  regenerateAdapterFile()
    .then((result) => {
      process.stdout.write(
        `${result.changed ? 'changed' : 'unchanged'} ${path.relative(REPO_ROOT, result.file)}\n`,
      );
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `gen-workflow-adapter: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 2;
    });
}
