/**
 * U51-OD-17 -- the vendored exception of the static generation census: ONE exact path + ONE exact content hash,
 * checked against the blob of the subject tree. No prefix, no glob, no general allowlist; any byte change makes the
 * hit blocking again; the same bytes at another path are not covered.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  VENDORED_DYNAMIC_IMPORT_EXCEPTIONS,
  computeStaticCensus,
  vendoredExceptionFor,
} from '../../packages/mps-u51-generation-absence/src/index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VENDORED_PATH = 'public/cesium/Workers/createGeometry.js';
const VENDORED_SHA256 = '2d82f9f488888652a358dc9cb8355049a71ce066508d5fa5d94fdfff9d39481f';

/** The blob of the worktree's own HEAD tree (never the working copy: line endings cannot change it). */
function vendoredBlob(): Buffer {
  const run = spawnSync('git', ['-C', ROOT, 'show', `HEAD:${VENDORED_PATH}`], { maxBuffer: 1 << 26 });
  if (run.status !== 0) throw new Error(`cannot read ${VENDORED_PATH} from HEAD: ${run.stderr?.toString('utf8')}`);
  return run.stdout;
}

const entry = (p: string, bytes: Uint8Array | string) => ({ path: p, bytes: typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes });
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('the exception table (U51-OD-17)', () => {
  it('has exactly one entry: the exact path and the exact hash of the record', () => {
    expect(VENDORED_DYNAMIC_IMPORT_EXCEPTIONS).toHaveLength(1);
    const only = VENDORED_DYNAMIC_IMPORT_EXCEPTIONS[0]!;
    expect(only.path).toBe(VENDORED_PATH);
    expect(only.sha256).toBe(VENDORED_SHA256);
    expect(only.sites).toBe(2);
    expect(only.vendored).toBe(true);
    expect(only.rationale.length).toBeGreaterThan(20);
  });

  it('has no prefix, glob, directory or pattern form', () => {
    for (const e of VENDORED_DYNAMIC_IMPORT_EXCEPTIONS) {
      expect(e.path).not.toMatch(/[*?[\]{}()!^$|\\]/);
      expect(e.path.endsWith('/')).toBe(false);
      expect(e.path).toMatch(/\.[a-z]+$/);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(Object.isFrozen(VENDORED_DYNAMIC_IMPORT_EXCEPTIONS)).toBe(true);
  });

  it('the committed blob is the reviewed one (hash and two sites)', () => {
    const blob = vendoredBlob();
    expect(sha256(blob)).toBe(VENDORED_SHA256);
    const d = computeStaticCensus([entry(VENDORED_PATH, blob)]);
    expect(d.census.nonliteral_dynamic_imports).toBe(0);
    expect(d.exempt_nonliteral_dynamic_import_sites).toHaveLength(2);
  });
});

describe('what the exception covers, and nothing else', () => {
  it('exact path + exact bytes: the two sites are listed as exempt and are not counted', () => {
    const d = computeStaticCensus([entry(VENDORED_PATH, vendoredBlob())]);
    expect(d.census.nonliteral_dynamic_imports).toBe(0);
    expect(d.nonliteral_dynamic_import_sites).toEqual([]);
    expect(d.exempt_nonliteral_dynamic_import_sites.map((s) => s.path)).toEqual([VENDORED_PATH, VENDORED_PATH]);
    expect(d.exempt_nonliteral_dynamic_import_sites.every((s) => s.exempt_by_content_sha256 === VENDORED_SHA256)).toBe(true);
  });

  it('any byte change makes the hits blocking again (appended newline; one flipped byte)', () => {
    const blob = vendoredBlob();
    const appended = Buffer.concat([blob, Buffer.from('\n')]);
    const flipped = Buffer.from(blob);
    flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 0x01;
    for (const changed of [appended, flipped]) {
      expect(sha256(changed)).not.toBe(VENDORED_SHA256);
      const d = computeStaticCensus([entry(VENDORED_PATH, changed)]);
      expect(d.census.nonliteral_dynamic_imports).toBe(2);
      expect(d.exempt_nonliteral_dynamic_import_sites).toEqual([]);
    }
  });

  it('the same bytes at any other path stay blocking', () => {
    const blob = vendoredBlob();
    for (const other of ['public/cesium/Workers/createGeometry.copy.js', 'public/cesium/createGeometry.js', 'server/createGeometry.js', 'Public/cesium/Workers/createGeometry.js', `./${VENDORED_PATH}`]) {
      const d = computeStaticCensus([entry(other, blob)]);
      expect(d.census.nonliteral_dynamic_imports, other).toBe(2);
      expect(d.exempt_nonliteral_dynamic_import_sites, other).toEqual([]);
    }
  });

  it('a sibling file in the same vendored directory is not exempt (no prefix form)', () => {
    const d = computeStaticCensus([entry('public/cesium/Workers/createGeometry.js', vendoredBlob()), entry('public/cesium/Workers/other.js', 'export const load = async (n) => (await import(n)).default;')]);
    expect(d.census.nonliteral_dynamic_imports).toBe(1);
    expect(d.nonliteral_dynamic_import_sites.map((s) => s.path)).toEqual(['public/cesium/Workers/other.js']);
  });

  it('a first-party non-literal import next to the exempt file is still counted (new or unknown = blocking)', () => {
    const d = computeStaticCensus([entry(VENDORED_PATH, vendoredBlob()), entry('server/services/x.ts', 'const m = "./y"; await import(m);')]);
    expect(d.census.nonliteral_dynamic_imports).toBe(1);
    expect(d.exempt_nonliteral_dynamic_import_sites).toHaveLength(2);
  });

  it('vendoredExceptionFor needs path, bytes and the exact site count', () => {
    const blob = vendoredBlob();
    expect(vendoredExceptionFor(VENDORED_PATH, blob, 2)?.sha256).toBe(VENDORED_SHA256);
    expect(vendoredExceptionFor(VENDORED_PATH, blob, 1)).toBeUndefined();
    expect(vendoredExceptionFor(VENDORED_PATH, blob, 3)).toBeUndefined();
    expect(vendoredExceptionFor('other/path.js', blob, 2)).toBeUndefined();
    expect(vendoredExceptionFor(VENDORED_PATH, Buffer.from('x'), 2)).toBeUndefined();
  });
});
