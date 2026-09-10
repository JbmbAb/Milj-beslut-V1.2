/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — package-local integrity, as a Definition of Done item.
 *
 * This file exists because candidate 32d9a170 was rejected for something the root typecheck could
 * not see. The root project runs with `strict` OFF; every package project here sets `strict: true`.
 * So `npx tsc --noEmit` at the repository root reported no errors in these packages while
 * `packages/mps-workspace-observer` did not compile on its own (an `Observed<undefined>` assigned
 * to `Observed<string>`) and `packages/mps-workspace-harness` could not resolve its own sibling
 * imports at all (33 errors, mostly TS2307). Both packages were shipped as candidates anyway.
 *
 * "Reported no errors in these packages" rather than "was green": the root project carries 87
 * pre-existing errors elsewhere in the repository and has never passed. That is a second reason a
 * root run cannot stand in for this one — it cannot even be read as a pass/fail signal.
 *
 * The standing rule the rejection earned, now enforced rather than written down:
 *
 *   ROOT TYPECHECK PASS is not sufficient. For every new package:
 *     - package-local typecheck PASS
 *     - package-local import resolution PASS
 *     - root typecheck PASS
 *
 * The last test in this file is the one that keeps the other three honest: it proves the mechanism
 * actually fails on a defect of the shape that got through, so a future refactor cannot leave these
 * assertions passing vacuously.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** The three packages this unit introduced. Each must stand as an architectural unit on its own. */
const PACKAGES = ['mps-workspace-observer', 'mps-workspace-classifier', 'mps-workspace-harness'] as const;

const PACKAGES_ROOT = join(__dirname, '..', '..');
const REPO_ROOT = join(PACKAGES_ROOT, '..');

/**
 * The compiler, resolved by path rather than through `npx`.
 *
 * The first version of this file shelled out to `npx tsc` with the cwd set to a scratch directory
 * outside the repository. npx could not resolve TypeScript from there, so BOTH legs of the
 * mechanism proof failed to spawn, both were read as "the compiler rejected it", and the proof
 * passed for a reason that had nothing to do with what it claimed to show. A test written to stop
 * vacuous checks was itself vacuous. Resolving the binary explicitly removes the PATH and cwd
 * dependency entirely.
 */
const TSC = join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

/** Returns true when the compiler REJECTED the project or file, false when it accepted it. */
function tscRejects(args: readonly string[], cwd: string): boolean {
  try {
    execFileSync(process.execPath, [TSC, ...args], { cwd, stdio: 'pipe' });
    return false;
  } catch {
    return true;
  }
}

function packageRoot(name: string): string {
  return join(PACKAGES_ROOT, name);
}

/**
 * tsconfig.json is JSONC. Parsed with TypeScript's own reader rather than a comment-stripping
 * regex, because the thing being asserted is what the COMPILER sees, and a hand-rolled parser that
 * disagrees with it would make the whole file prove the wrong thing.
 */
function readTsconfig(name: string): Record<string, unknown> {
  const path = join(packageRoot(name), 'tsconfig.json');
  const text = readFileSync(path, 'utf8');
  const parsed = ts.parseConfigFileTextToJson(path, text);
  expect(parsed.error, `${name}/tsconfig.json is not parseable`).toBeUndefined();
  return parsed.config as Record<string, unknown>;
}

function readPackageJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(packageRoot(name), 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

function compilerOptions(name: string): Record<string, unknown> {
  return (readTsconfig(name).compilerOptions ?? {}) as Record<string, unknown>;
}

/** Every source file of a package, tests included: they compile too, or the package does not. */
function sourceFiles(name: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts')) out.push(full);
    }
  };
  walk(join(packageRoot(name), 'src'));
  return out;
}

const IMPORT_SPECIFIER = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g;

function importedSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const found = new Set<string>();
  for (const m of text.matchAll(IMPORT_SPECIFIER)) found.add(m[1]);
  return [...found];
}

describe('package-local typecheck (the check root typecheck cannot make)', () => {
  for (const name of PACKAGES) {
    it(`${name} compiles on its own with tsc --noEmit -p tsconfig.json`, () => {
      // Run in the package root, exactly as an independent consumer of the package would.
      expect(existsSync(TSC), 'the compiler must be resolvable, or this suite proves nothing').toBe(
        true,
      );
      expect(tscRejects(['--noEmit', '-p', 'tsconfig.json'], packageRoot(name))).toBe(false);
    }, 300000);
  }

  it('every package project is stricter than the root, not merely different from it', () => {
    for (const name of PACKAGES) {
      const config = readTsconfig(name);
      const options = compilerOptions(name);
      // Extending the root would silently inherit `strict: false` and reduce this whole file to
      // theatre. The absence of `extends` is load-bearing.
      expect(config.extends, `${name} must not inherit the root project's leniency`).toBeUndefined();
      expect(options.strict, `${name} must typecheck under strict`).toBe(true);
      expect(options.noEmit, `${name} declares no build, so it must declare noEmit`).toBe(true);
    }
  });
});

describe('package-local import resolution', () => {
  it('maps every cross-package specifier the sources actually use', () => {
    const unresolvable: string[] = [];
    for (const name of PACKAGES) {
      const paths = (compilerOptions(name).paths ?? {}) as Record<string, string[]>;
      for (const file of sourceFiles(name)) {
        for (const specifier of importedSpecifiers(file)) {
          if (!specifier.startsWith('@miljobeslut/')) continue;
          if (paths[specifier] === undefined) {
            unresolvable.push(`${name}: ${specifier} used by ${file} has no tsconfig path`);
          }
        }
      }
    }
    expect(unresolvable).toEqual([]);
  });

  it('resolves every mapped path to a file that exists', () => {
    const missing: string[] = [];
    for (const name of PACKAGES) {
      const paths = (compilerOptions(name).paths ?? {}) as Record<string, string[]>;
      for (const [specifier, targets] of Object.entries(paths)) {
        for (const target of targets) {
          if (!existsSync(join(packageRoot(name), target))) {
            missing.push(`${name}: ${specifier} -> ${target} does not exist`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('maps exactly the dependencies the manifest declares, and nothing else', () => {
    // Set equality in both directions. A path without a dependency is resolution the manifest does
    // not admit; a dependency without a path is a package that cannot compile alone. Either way
    // the tsconfig and the manifest would be telling a reviewer two different things.
    for (const name of PACKAGES) {
      const paths = Object.keys((compilerOptions(name).paths ?? {}) as Record<string, unknown>);
      const deps = Object.keys((readPackageJson(name).dependencies ?? {}) as Record<string, unknown>);
      expect(paths.sort(), `${name}: tsconfig paths must mirror package.json dependencies`).toEqual(
        deps.sort(),
      );
    }
  });

  it('never widens the observer past the boundary, in either the manifest or the tsconfig', () => {
    // The A2/B1 boundary restated where a resolution fix would most plausibly break it: making the
    // harness compile is a legitimate need, and the tempting shortcut is to add the same paths
    // everywhere.
    const forbidden = ['@miljobeslut/mps-workspace-classifier', '@miljobeslut/mps-workspace-harness'];
    const observerPaths = Object.keys(
      (compilerOptions('mps-workspace-observer').paths ?? {}) as Record<string, unknown>,
    );
    const observerDeps = Object.keys(
      (readPackageJson('mps-workspace-observer').dependencies ?? {}) as Record<string, unknown>,
    );
    for (const f of forbidden) {
      expect(observerPaths, `observer tsconfig must not resolve ${f}`).not.toContain(f);
      expect(observerDeps, `observer manifest must not depend on ${f}`).not.toContain(f);
    }
    // The classifier is pure: it resolves nothing cross-package at all.
    expect(
      Object.keys((compilerOptions('mps-workspace-classifier').paths ?? {}) as Record<string, unknown>),
    ).toEqual([]);
  });
});

describe('MECHANISM PROOF: the package-local check catches what root typecheck missed', () => {
  it('fails on an Observed<undefined> assigned to Observed<string> under strict, and passes without it', () => {
    // The exact defect class that shipped in candidate 32d9a170: a generic inferred as `undefined`
    // flowing into a slot typed for a value. Reproduced in isolation so this suite proves the
    // MECHANISM, not just today's clean tree.
    const dir = mkdtempSync(join(tmpdir(), 'wlc-package-typecheck-proof-'));
    try {
      const file = join(dir, 'broken.ts');
      writeFileSync(
        file,
        [
          'interface Observed<T> { readonly state: string; readonly value?: T }',
          'function from<T>(make: () => T | undefined): Observed<T> {',
          '  const v = make();',
          '  return v === undefined ? { state: "UNKNOWN" } : { state: "OBSERVED", value: v };',
          '}',
          'export const commonDir: Observed<string> = from(() => undefined);',
          '',
        ].join('\n'),
        'utf8',
      );

      const run = (strict: boolean): boolean =>
        tscRejects(
          [
            '--noEmit',
            '--strict',
            strict ? 'true' : 'false',
            '--target',
            'ES2022',
            '--module',
            'esnext',
            '--moduleResolution',
            'bundler',
            'broken.ts',
          ],
          dir,
        );

      // Strict rejects it — which is why the package project catches it.
      expect(run(true), 'strict tsc must reject the defect').toBe(true);
      // Non-strict accepts it — which is why the root project did not. Asserting BOTH directions is
      // what makes this a proof rather than a coincidence: if the compiler could not run at all,
      // this second assertion fails.
      expect(run(false), 'non-strict tsc must accept it, reproducing the root blind spot').toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300000);

  it('fails on an unresolvable cross-package specifier, the harness defect class', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlc-package-resolution-proof-'));
    try {
      const file = join(dir, 'broken.ts');
      writeFileSync(
        file,
        'import { Absent } from "@miljobeslut/mps-workspace-observer";\nexport const x: Absent = 1 as never;\n',
        'utf8',
      );
      expect(
        tscRejects(
          ['--noEmit', '--strict', 'true', '--module', 'esnext', '--moduleResolution', 'bundler', 'broken.ts'],
          dir,
        ),
        'tsc must reject an unresolvable cross-package import',
      ).toBe(true);

      // And the same compiler invocation accepts a file with no unresolvable import, so the
      // rejection above is attributable to the import rather than to a broken invocation.
      writeFileSync(join(dir, 'fine.ts'), 'export const x: number = 1;\n', 'utf8');
      expect(
        tscRejects(
          ['--noEmit', '--strict', 'true', '--module', 'esnext', '--moduleResolution', 'bundler', 'fine.ts'],
          dir,
        ),
        'the control file must compile, or the rejection above proves nothing',
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300000);
});
