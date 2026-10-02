// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-3 N2: `npm run devgov:test` (scripts/devgov/vitest.config.mjs) had
 * neither `envDir: false` nor the guard setup file, so Vite read `.env.local` under NODE_ENV=test
 * (VITE_* keys reached process.env and import.meta.env) -- against the owner's requirement that a
 * test run never loads `.env.local`. packages/alpha-runtime/vitest.config.ts (its `npm test`) had
 * the same gap.
 *
 * This inventory finds EVERY test configuration in the repository and every way a test run is
 * started, and fails on any that lacks the guard:
 *   - every vitest.config.* (imported here): `envDir: false`, and the guard as the FIRST setup file
 *     of the config and of every inline project;
 *   - a vite.config.* is never the config a test run picks (Vitest's own lookup: vitest.config.*
 *     before vite.config.*, nearest directory first) and carries no `test` section;
 *   - every playwright.config.* calls the E2E policy (local plan, external targets, guard install,
 *     Docker discovery);
 *   - every package.json script and every CI workflow command that runs vitest resolves -- with
 *     Vitest's own lookup -- to a guarded config; `playwright test` to a guarded Playwright config;
 *   - any other runner or runner config (jest, mocha, ava, node --test, a vitest workspace file, ...)
 *     is an unreviewed test entry point and fails until it is guarded and added here.
 * The checks themselves are proven on a fake repository in a temp dir (each gap is reported).
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GUARD_SETUP_REL = 'tests/setup/testDatabaseGuard.ts';

/** vitest/dist/chunks/constants: CONFIG_NAMES x CONFIG_EXTENSIONS, in Vitest's lookup order. */
const VITEST_CONFIG_NAMES = ['vitest.config', 'vite.config'].flatMap((name) =>
  ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'].map((ext) => name + ext),
);
const PLAYWRIGHT_CONFIG_NAMES = ['.ts', '.js', '.mts', '.mjs', '.cts', '.cjs'].map(
  (ext) => `playwright.config${ext}`,
);
const PLAYWRIGHT_GUARD_CALLS = [
  'ensureDockerDatabaseEndpointDiscovery',
  'assertExternalE2eTargetsAreRemote',
  'resolveLocalE2eServerPlan',
  'installTestDatabaseConnectionGuard',
];

const IS_VITEST_CONFIG = /^vitest\.config\.[cm]?[jt]s$/;
const IS_VITE_CONFIG = /^vite\.config\.[cm]?[jt]s$/;
const IS_PLAYWRIGHT_CONFIG = /^playwright\.config\.[cm]?[jt]s$/;
/** Runner configs no guard exists for: each one is an unreviewed test entry point. */
const IS_OTHER_RUNNER_CONFIG =
  /^(vitest\.(workspace|projects)\.[a-z]+|jest\.config\.[a-z]+|\.mocharc(\.[a-z]+)?|ava\.config\.[a-z]+|karma\.conf\.[a-z]+|cypress\.config\.[a-z]+|wdio\.conf\.[a-z]+|\.taprc)$/;
const OTHER_RUNNER_COMMAND =
  /(^|[\s/])(jest|mocha|ava|tap|uvu|karma|cypress|wdio)(\s|$)|(^|\s)(node|tsx)(\s+\S+)*\s+--test(\s|$)/;

/** Tracked and untracked-but-not-ignored files; without git (an export), every file but node_modules/.git. */
function repoFiles(root: string): string[] {
  const top = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status === 0 && path.resolve(top.stdout.trim()) === path.resolve(root)) {
    const ls = spawnSync(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (ls.status === 0) {
      return ls.stdout
        .split('\0')
        .filter(Boolean)
        .filter((rel) => fs.existsSync(path.join(root, rel)));
    }
  }
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk('');
  return out;
}

type ConfigLike = {
  envDir?: unknown;
  test?: { setupFiles?: unknown; projects?: unknown };
};

function firstSetupFile(setupFiles: unknown): string | null {
  const list = Array.isArray(setupFiles) ? setupFiles : setupFiles ? [setupFiles] : [];
  return typeof list[0] === 'string' ? list[0] : null;
}

/** What is missing in one vitest config (empty = guarded). Relative setup paths: from the config's dir. */
async function vitestConfigGaps(root: string, rel: string): Promise<string[]> {
  const file = path.join(root, rel);
  const dir = path.dirname(file);
  const guard = path.resolve(root, GUARD_SETUP_REL);
  let config: ConfigLike;
  try {
    const loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { default?: unknown };
    const value =
      typeof loaded.default === 'function'
        ? await loaded.default({ mode: 'test', command: 'serve' })
        : loaded.default;
    config = (value ?? {}) as ConfigLike;
  } catch (error) {
    return [`${rel}: cannot be loaded (${String((error as Error).message).slice(0, 160)})`];
  }
  const gaps: string[] = [];
  const guardedFirst = (label: string, setupFiles: unknown) => {
    const first = firstSetupFile(setupFiles);
    if (!first || path.resolve(dir, first) !== guard) {
      gaps.push(`${rel}${label}: the first setup file is ${JSON.stringify(first)}, not ${GUARD_SETUP_REL}`);
    }
  };
  if (config.envDir !== false) gaps.push(`${rel}: envDir is ${JSON.stringify(config.envDir)}, not false`);
  const projects = config.test?.projects;
  if (Array.isArray(projects) && projects.length > 0) {
    if (config.test?.setupFiles !== undefined) guardedFirst(' (root)', config.test.setupFiles);
    projects.forEach((project: unknown, index) => {
      if (!project || typeof project !== 'object') {
        gaps.push(
          `${rel}: project #${index} is a reference (${JSON.stringify(project)}), not an inline project`,
        );
        return;
      }
      const p = project as ConfigLike & { test?: { name?: unknown } };
      const label = ` project ${JSON.stringify(p.test?.name ?? index)}`;
      if (p.envDir !== false) gaps.push(`${rel}${label}: envDir is not false`);
      guardedFirst(label, p.test?.setupFiles);
    });
  } else {
    guardedFirst('', config.test?.setupFiles);
  }
  return gaps;
}

function playwrightConfigGaps(root: string, rel: string): string[] {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  return PLAYWRIGHT_GUARD_CALLS.filter((call) => !new RegExp(`\\b${call}\\(`).test(text)).map(
    (call) => `${rel}: does not call ${call}()`,
  );
}

/** Vitest's own config lookup: nearest directory first, vitest.config.* before vite.config.*. */
function vitestConfigFor(root: string, startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    for (const name of VITEST_CONFIG_NAMES) {
      if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function flagValue(tokens: string[], long: string, short: string | null): string | null {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === long || (short && tokens[i] === short)) return tokens[i + 1] ?? null;
    if (tokens[i].startsWith(`${long}=`)) return tokens[i].slice(long.length + 1);
  }
  return null;
}

type Entry = { where: string; command: string; dir: string; workflow: boolean };

/** Every command that starts a test run: package.json scripts and CI workflow `run:` lines. */
function testEntryPoints(root: string, files: string[]): Entry[] {
  const entries: Entry[] = [];
  for (const rel of files.filter((f) => path.basename(f) === 'package.json')) {
    let pkg: { scripts?: Record<string, string> };
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    } catch {
      continue;
    }
    for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
      for (const command of String(script).split(/&&|\|\||;|\|/)) {
        entries.push({
          where: `${rel} scripts.${name}`,
          command: command.trim().replace(/\s+/g, ' '),
          dir: path.dirname(path.join(root, rel)),
          workflow: false,
        });
      }
    }
  }
  for (const rel of files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\\\r?\n\s*/g, ' ');
    text.split(/\r?\n/).forEach((line, index) => {
      for (const command of line.replace(/^\s*(-\s*)?(run:\s*)?/, '').split(/&&|\|\||;/)) {
        entries.push({
          where: `${rel}:${index + 1}`,
          command: command.trim().replace(/\s+/g, ' '),
          dir: root,
          workflow: true,
        });
      }
    });
  }
  return entries;
}

type Inventory = {
  vitestConfigs: string[];
  playwrightConfigs: string[];
  gaps: string[];
};

async function inventory(root: string): Promise<Inventory> {
  const files = repoFiles(root);
  const gaps: string[] = [];
  const vitestConfigs = files.filter((f) => IS_VITEST_CONFIG.test(path.basename(f))).sort();
  const playwrightConfigs = files.filter((f) => IS_PLAYWRIGHT_CONFIG.test(path.basename(f))).sort();
  for (const rel of vitestConfigs) gaps.push(...(await vitestConfigGaps(root, rel)));
  for (const rel of playwrightConfigs) gaps.push(...playwrightConfigGaps(root, rel));
  for (const rel of files.filter((f) => IS_VITE_CONFIG.test(path.basename(f)))) {
    const dir = path.dirname(path.join(root, rel));
    const picked = vitestConfigFor(root, dir);
    if (picked && path.resolve(picked) === path.resolve(root, rel)) {
      gaps.push(
        `${rel}: a test run in ${path.relative(root, dir) || '.'} would use this Vite config (no vitest.config.* next to it)`,
      );
    }
    if (/^\s*test\s*:/m.test(fs.readFileSync(path.join(root, rel), 'utf8'))) {
      gaps.push(`${rel}: has a test section; tests belong in a guarded vitest.config.*`);
    }
  }
  for (const rel of files.filter((f) => IS_OTHER_RUNNER_CONFIG.test(path.basename(f)))) {
    gaps.push(`${rel}: an unreviewed test runner config (no guard exists for it)`);
  }
  for (const entry of testEntryPoints(root, files)) {
    const tokens = entry.command.split(/\s+/).filter(Boolean);
    const vitestAt = tokens.findIndex(
      (t) => t === 'vitest' || /node_modules[\\/]vitest[\\/]vitest\.mjs$/.test(t),
    );
    if (vitestAt >= 0) {
      const args = tokens.slice(vitestAt + 1);
      const configArg = flagValue(args, '--config', '-c');
      const rootArg = flagValue(args, '--root', '-r');
      const runRoot = rootArg ? path.resolve(entry.dir, rootArg) : entry.dir;
      const picked = configArg ? path.resolve(entry.dir, configArg) : vitestConfigFor(root, runRoot);
      const pickedRel = picked ? path.relative(root, picked).split(path.sep).join('/') : null;
      if (!pickedRel || pickedRel.startsWith('..') || !fs.existsSync(picked as string)) {
        gaps.push(`${entry.where}: "${entry.command}" uses no test config of this repository`);
      } else if (!IS_VITEST_CONFIG.test(path.basename(pickedRel))) {
        gaps.push(`${entry.where}: "${entry.command}" uses ${pickedRel}, which is not a vitest.config.*`);
      } else if (!vitestConfigs.includes(pickedRel)) {
        gaps.push(...(await vitestConfigGaps(root, pickedRel)));
      }
    }
    const playwrightAt = tokens.findIndex((t, i) => t === 'playwright' && tokens[i + 1] === 'test');
    if (playwrightAt >= 0) {
      const configArg = flagValue(tokens.slice(playwrightAt + 2), '--config', '-c');
      const picked = configArg
        ? path.resolve(entry.dir, configArg)
        : PLAYWRIGHT_CONFIG_NAMES.map((n) => path.join(entry.dir, n)).find((p) => fs.existsSync(p));
      const pickedRel = picked ? path.relative(root, picked).split(path.sep).join('/') : null;
      if (!pickedRel || !playwrightConfigs.includes(pickedRel)) {
        gaps.push(`${entry.where}: "${entry.command}" runs Playwright without a guarded playwright.config.*`);
      }
    }
    // Workflow lines are YAML (names, comments): only a line that is a command is a runner call.
    const isCommand = !entry.workflow || /^(npx|npm|node|tsx|yarn|pnpm)\s/.test(entry.command);
    if (isCommand && OTHER_RUNNER_COMMAND.test(entry.command)) {
      gaps.push(`${entry.where}: "${entry.command}" starts an unreviewed test runner`);
    }
  }
  return { vitestConfigs, playwrightConfigs, gaps: [...new Set(gaps)] };
}

describe('TEST-DB-GUARD: every test configuration and test entry point of this repository is guarded', () => {
  it('finds the known configs (the inventory is not vacuous) and no gap', async () => {
    const result = await inventory(REPO_ROOT);
    expect(result.vitestConfigs).toEqual(
      expect.arrayContaining([
        'vitest.config.ts',
        'scripts/devgov/vitest.config.mjs',
        'packages/alpha-runtime/vitest.config.ts',
      ]),
    );
    expect(result.playwrightConfigs).toEqual(expect.arrayContaining(['playwright.config.ts']));
    expect(result.gaps).toEqual([]);
  }, 60_000);
});

// ---- the checks themselves, on a fake repository (no git: the file walk) ----------------------

let fakeRoot: string;

beforeAll(() => {
  fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wtdg3-inventory-'));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(fakeRoot, rel)), { recursive: true });
    fs.writeFileSync(path.join(fakeRoot, rel), text, 'utf8');
  };
  const guardAbs = JSON.stringify(path.join(fakeRoot, GUARD_SETUP_REL));
  write(GUARD_SETUP_REL, '// fake guard\n');
  write(
    'vitest.config.mjs',
    `export default { envDir: false, test: { setupFiles: ['${GUARD_SETUP_REL}'] } };\n`,
  );
  write('good/vitest.config.mjs', `export default { envDir: false, test: { setupFiles: [${guardAbs}] } };\n`);
  write('noenvdir/vitest.config.mjs', `export default { test: { setupFiles: [${guardAbs}] } };\n`);
  write('nosetup/vitest.config.mjs', `export default { envDir: false, test: { include: ['x.test.ts'] } };\n`);
  write(
    'lateguard/vitest.config.mjs',
    `export default { envDir: false, test: { setupFiles: ['other.ts', ${guardAbs}] } };\n`,
  );
  write(
    'projects/vitest.config.mjs',
    `export default { envDir: false, test: { projects: [{ envDir: false, test: { name: 'a', setupFiles: [${guardAbs}] } }, { test: { name: 'b', setupFiles: [] } }, 'packages/*'] } };\n`,
  );
  write('viteonly/vite.config.ts', 'export default {};\n');
  write('viteonly/package.json', JSON.stringify({ scripts: { test: 'vitest run' } }));
  write('vitetest/vite.config.ts', 'export default {\n  test: { include: [] },\n};\n');
  write(
    'vitetest/vitest.config.mjs',
    `export default { envDir: false, test: { setupFiles: [${guardAbs}] } };\n`,
  );
  write(
    'pw/playwright.config.ts',
    "import { defineConfig } from '@playwright/test';\nexport default defineConfig({});\n",
  );
  write('jest.config.js', 'module.exports = {};\n');
  write(
    'package.json',
    JSON.stringify({
      scripts: {
        ok: 'vitest run --config vitest.config.mjs',
        bad: 'vitest run --config nosetup/vitest.config.mjs',
        e2e: 'npm run x && playwright test --config pw/playwright.config.ts',
        e2eNone: 'playwright test',
        jest: 'jest --ci',
        nodeTest: 'node --test tests',
      },
    }),
  );
  write(
    '.github/workflows/ci.yml',
    'jobs:\n  t:\n    steps:\n      - run: |\n          npx vitest run \\\n            --config missing/vitest.config.mjs a.test.ts\n      - run: npx mocha spec\n',
  );
});

afterAll(() => {
  fs.rmSync(fakeRoot, { recursive: true, force: true });
});

describe('the inventory reports every unguarded test configuration and entry point (fake repository)', () => {
  it('flags each gap and nothing that is guarded', async () => {
    const { gaps } = await inventory(fakeRoot);
    const text = gaps.join('\n');
    expect(text).toMatch(/^noenvdir\/vitest\.config\.mjs: envDir is undefined, not false$/m);
    expect(text).toMatch(/^nosetup\/vitest\.config\.mjs: the first setup file is null/m);
    expect(text).toMatch(/^lateguard\/vitest\.config\.mjs: the first setup file is "other\.ts"/m);
    expect(text).toMatch(/^projects\/vitest\.config\.mjs project "b": envDir is not false$/m);
    expect(text).toMatch(/^projects\/vitest\.config\.mjs project "b": the first setup file is null/m);
    expect(text).toMatch(/^projects\/vitest\.config\.mjs: project #2 is a reference/m);
    expect(text).toMatch(/^viteonly\/vite\.config\.ts: a test run in viteonly would use this Vite config/m);
    expect(text).toMatch(
      /^viteonly\/package\.json scripts\.test: "vitest run" uses viteonly\/vite\.config\.ts, which is not a vitest\.config/m,
    );
    expect(text).toMatch(/^vitetest\/vite\.config\.ts: has a test section/m);
    expect(text).toMatch(
      /^pw\/playwright\.config\.ts: does not call ensureDockerDatabaseEndpointDiscovery\(\)/m,
    );
    expect(text).toMatch(/^jest\.config\.js: an unreviewed test runner config/m);
    expect(text).toMatch(
      /^package\.json scripts\.e2eNone: "playwright test" runs Playwright without a guarded/m,
    );
    expect(text).toMatch(/^package\.json scripts\.jest: "jest --ci" starts an unreviewed test runner$/m);
    expect(text).toMatch(
      /^package\.json scripts\.nodeTest: "node --test tests" starts an unreviewed test runner$/m,
    );
    expect(text).toMatch(
      /^\.github\/workflows\/ci\.yml:\d+: "npx vitest run --config missing\/vitest\.config\.mjs a\.test\.ts" uses no test config/m,
    );
    expect(text).toMatch(
      /^\.github\/workflows\/ci\.yml:\d+: "npx mocha spec" starts an unreviewed test runner$/m,
    );
    // Guarded configs and commands produce no gap of their own.
    expect(text).not.toMatch(
      /^good\/|^vitest\.config\.mjs:|^vitetest\/vitest\.config\.mjs:|scripts\.ok:|scripts\.bad:/m,
    );
    expect(gaps.filter((g) => g.startsWith('nosetup/'))).toHaveLength(1);
  });
});
