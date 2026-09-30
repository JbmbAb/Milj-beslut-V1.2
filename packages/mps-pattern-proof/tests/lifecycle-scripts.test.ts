import { describe, expect, it } from 'vitest';
import { isPatternProofError } from '../src/errors';
import {
  lifecycleScriptPaths,
  lifecycleScriptStrings,
  nodeScriptPathsOf,
  packageIdentity,
} from '../src/docker/lifecycle-scripts';
import {
  PACKAGE_JSON_WITH_POSTINSTALL,
  PACKAGE_JSON_WITHOUT_POSTINSTALL,
  readRepoFile,
} from './fixtures/dockerfiles';
import {
  PROBED_LIFECYCLE_PATHS,
  PROBED_PACKAGE_IDENTITY,
  PROBED_POSTINSTALL_SCRIPT,
} from './fixtures/probe-signatures';

describe('lifecycle scripts of the real package.json', () => {
  const packageJson: unknown = JSON.parse(readRepoFile('package.json'));

  it('derives L = the two node script paths of the postinstall hook', () => {
    expect(lifecycleScriptPaths(packageJson)).toEqual([...PROBED_LIFECYCLE_PATHS]);
    expect(lifecycleScriptStrings(packageJson)).toEqual([PROBED_POSTINSTALL_SCRIPT]);
  });

  it('derives the banner identity', () => {
    expect(packageIdentity(packageJson)).toEqual(PROBED_PACKAGE_IDENTITY);
    expect(Object.isFrozen(packageIdentity(packageJson))).toBe(true);
  });
});

describe('lifecycle scripts: solution neutrality and tokenization', () => {
  it('a candidate that removes the hook derives an empty L', () => {
    expect(lifecycleScriptPaths(PACKAGE_JSON_WITHOUT_POSTINSTALL)).toEqual([]);
    expect(lifecycleScriptStrings(PACKAGE_JSON_WITHOUT_POSTINSTALL)).toEqual([]);
    expect(lifecycleScriptPaths(PACKAGE_JSON_WITH_POSTINSTALL)).toEqual([...PROBED_LIFECYCLE_PATHS]);
  });

  it('orders preinstall, install, postinstall, prepare and de-duplicates paths', () => {
    const paths = lifecycleScriptPaths({
      name: 'x',
      version: '1.0.0',
      scripts: {
        prepare: 'node scripts/prepare.mjs',
        postinstall: 'node scripts/a.mjs; node scripts/b.cjs',
        preinstall: 'node scripts/a.mjs && echo done',
        install: 'npm run something && node --import tsx scripts/c.ts',
        build: 'node scripts/not-lifecycle.mjs',
      },
    });
    expect(paths).toEqual(['scripts/a.mjs', 'scripts/c.ts', 'scripts/b.cjs', 'scripts/prepare.mjs']);
  });

  it('nodeScriptPathsOf ignores non-node commands and node flags', () => {
    expect(nodeScriptPathsOf('npx prisma generate && node -r dotenv/config x.js')).toEqual(['x.js']);
    expect(nodeScriptPathsOf('node --no-warnings --env-file .env run.mjs')).toEqual(['run.mjs']);
    expect(nodeScriptPathsOf('echo skip; tsx scripts/x.ts')).toEqual([]);
    expect(nodeScriptPathsOf('node')).toEqual([]);
  });

  it('rejects a package.json without name/version or that is not an object', () => {
    for (const bad of [null, 'x', { version: '1' }, { name: 'x' }, { name: '', version: '1' }]) {
      let caught: unknown;
      try {
        packageIdentity(bad);
      } catch (error) {
        caught = error;
      }
      expect(isPatternProofError(caught, 'PPE_SCHEMA_INVALID')).toBe(true);
    }
    expect(() => lifecycleScriptPaths('nope')).toThrow(/PPE_SCHEMA_INVALID/);
    expect(lifecycleScriptPaths({ name: 'x', version: '1' })).toEqual([]);
  });
});
