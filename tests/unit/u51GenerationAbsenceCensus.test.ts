/**
 * U51-GENERATION-ABSENCE-PROOF-01 -- the static census, the tree reader, the entrypoint-derivability check and
 * the runner's exit semantics (contract 2d937d63, 5.3). Synthetic trees only; the real tree is censused by the runner.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LaunchSurfaceObserver,
  PORT_MODULE_PATH,
  REGISTRATION_IDENTIFIER,
  assessEntrypointDerivability,
  computeStaticCensus,
  isDocumentationPath,
  isTestPath,
  iterateTreeEntries,
  nonliteralDynamicImportSites,
  resolveSubject,
} from '../../packages/mps-u51-generation-absence/src/index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = path.join(ROOT, 'scripts', 'ops', 'prove-u51-generation-absence-01.ts');

const file = (p: string, text: string) => ({ path: p, bytes: Buffer.from(text, 'utf8') });
const ID = REGISTRATION_IDENTIFIER;

describe('path classes follow the contract', () => {
  it('test paths: (^|/)(tests?|__tests__|e2e)/ or .test/.spec', () => {
    for (const p of ['tests/unit/a.ts', 'packages/x/tests/a.ts', 'src/__tests__/a.ts', 'e2e/a.ts', 'server/a.test.ts', 'a.spec.mjs', 'x/y.test.tsx']) {
      expect(isTestPath(p), p).toBe(true);
    }
    for (const p of ['server/a.ts', 'server/latest/a.ts', 'scripts/contest.ts', 'src/testing.ts', 'a.test.json']) {
      expect(isTestPath(p), p).toBe(false);
    }
  });
  it('documentation: docs/ and markdown', () => {
    expect(isDocumentationPath('docs/a.json')).toBe(true);
    expect(isDocumentationPath('README.md')).toBe(true);
    expect(isDocumentationPath('server/a.ts')).toBe(false);
  });
});

describe('registration identifier (mutation 1: registration_identifier_files > 0)', () => {
  it('a clean tree counts 0', () => {
    const d = computeStaticCensus([file('server/a.ts', 'export const a = 1;'), file(PORT_MODULE_PATH, `export function ${ID}() {}`)]);
    expect(d.census.registration_identifier_files).toBe(0);
  });

  it.each([
    ['a call', `import { ${ID} } from './port'; ${ID}(x);`],
    ['an alias', `import { ${ID} as r } from './port';`],
    ['a destructuring', `const { ${ID}: r } = port;`],
    ['a property access', `port.${ID}(x);`],
    ['a string', `const name = '${ID}';`],
    ['a re-export', `export { ${ID} } from './port';`],
    ['a comment', `// ${ID} is called elsewhere`],
  ])('counts a non-test file that contains the identifier as %s', (_label, text) => {
    const d = computeStaticCensus([file('server/boot.ts', text)]);
    expect(d.census.registration_identifier_files).toBe(1);
    expect(d.registration_identifier_paths).toEqual(['server/boot.ts']);
  });

  it('counts files, not occurrences', () => {
    const d = computeStaticCensus([file('server/a.ts', `${ID}(); ${ID}();`), file('server/b.ts', `${ID}();`)]);
    expect(d.census.registration_identifier_files).toBe(2);
  });

  it('counts a non-code file too (bytes, not syntax)', () => {
    const d = computeStaticCensus([file('scripts/boot.sh', `echo ${ID}`), file('config/x.json', `{"hook":"${ID}"}`)]);
    expect(d.census.registration_identifier_files).toBe(2);
  });

  it('does not count the port module itself', () => {
    expect(computeStaticCensus([file(PORT_MODULE_PATH, `${ID}()`)]).census.registration_identifier_files).toBe(0);
  });

  it('a registration in a test file is audit only: it neither satisfies nor hides anything', () => {
    const d = computeStaticCensus([file('tests/unit/a.test.ts', `${ID}(fake)`), file('server/a.ts', 'export {}')]);
    expect(d.census.registration_identifier_files).toBe(0);
    expect(d.census.test_registration_files).toBe(1);
    const both = computeStaticCensus([file('tests/unit/a.test.ts', `${ID}(fake)`), file('server/a.ts', `${ID}(real)`)]);
    expect(both.census.registration_identifier_files).toBe(1);
    expect(both.census.test_registration_files).toBe(1);
  });

  it('documentation that names the identifier is reported, not counted', () => {
    const d = computeStaticCensus([file('docs/architecture/x.md', `${ID}`), file('NOTES.md', `${ID}`)]);
    expect(d.census.registration_identifier_files).toBe(0);
    expect(d.documentation_identifier_paths).toEqual(['NOTES.md', 'docs/architecture/x.md']);
  });

  it('this unit does not look like a registration or a composition to its own census', () => {
    const dir = path.join(ROOT, 'packages', 'mps-u51-generation-absence', 'src');
    const entries = readdirSync(dir).map((f) => ({
      path: `packages/mps-u51-generation-absence/src/${f}`,
      bytes: readFileSync(path.join(dir, f)),
    }));
    entries.push({ path: 'scripts/ops/prove-u51-generation-absence-01.ts', bytes: readFileSync(RUNNER) });
    expect(entries.length).toBe(5);
    const d = computeStaticCensus(entries);
    expect(d.census.registration_identifier_files).toBe(0);
    expect(d.composition_marker_paths).toEqual([]);
    expect(assessEntrypointDerivability(d).blocker).toBe('RELEASE_COMPOSITION_ABSENT_FROM_SUBJECT_TREE');
  });
});

describe('non-literal dynamic imports (mutation 2: nonliteral_dynamic_imports > 0)', () => {
  const count = (p: string, text: string) => nonliteralDynamicImportSites(p, text).length;

  it.each([
    ['a string literal', `await import('./a')`],
    ['a double-quoted literal', `await import("./a")`],
    ['a substitution-free template', 'await import(`./a`)'],
    ['a literal after a bundler comment', `await import(/* @vite-ignore */ 'nodemailer')`],
    ['a literal require', `const x = require('x')`],
    ['a static import', `import x from './a'`],
    ['prose that merely says import (e.g.', `// import (e.g. SGU files) is documented here\nexport {}`],
    ['a string that contains import(x)', `const s = "import(x)"`],
  ])('does not count %s', (_label, text) => {
    expect(count('server/a.ts', text)).toBe(0);
  });

  it.each([
    ['a variable import', `const m = 'x'; await import(m)`],
    ['a bundler-comment variable import', `await import(/* @vite-ignore */ moduleName)`],
    ['a template with a substitution', 'await import(`./${name}`)'],
    ['a concatenation', `await import('./' + name)`],
    ['a variable require', `const x = require(name)`],
    ['an argument-less import', `await import()`],
  ])('counts %s', (_label, text) => {
    expect(count('server/a.ts', text)).toBe(1);
  });

  it('a constant-indirection specifier is still non-literal (the rule is syntactic)', () => {
    expect(count('server/a.ts', `const p = './lastkajenService';\nconst { f } = await import(p);`)).toBe(1);
  });

  it('records the line and kind', () => {
    expect(nonliteralDynamicImportSites('server/a.ts', `\n\nawait import(x);\nrequire(y);`)).toEqual([
      { path: 'server/a.ts', line: 3, kind: 'import' },
      { path: 'server/a.ts', line: 4, kind: 'require' },
    ]);
  });

  it('parses JS, MJS and TSX by extension, and ignores test files', () => {
    const d = computeStaticCensus([
      file('public/w.js', 'import(t)'),
      file('scripts/a.mjs', 'import(t)'),
      file('src/App.tsx', 'const C = () => <div>{String(1)}</div>; import(t);'),
      file('tests/unit/a.test.ts', 'import(t)'),
      file('server/data.json', 'import(t)'),
    ]);
    expect(d.census.nonliteral_dynamic_imports).toBe(3);
    expect(d.code_files_parsed).toBe(3);
  });
});

describe('the census reads the commit, not the working tree', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'u51-census-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };

  it('a dirty working file and an untracked file do not change the census of the commit', () => {
    git(dir, 'init', '-q');
    mkdirSync(path.join(dir, 'server'), { recursive: true });
    writeFileSync(path.join(dir, 'server/a.ts'), 'export const a = 1;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'clean');
    const subject = resolveSubject(dir, 'HEAD');
    expect(subject.commit_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(subject.tree_sha).toBe(git(dir, 'rev-parse', 'HEAD^{tree}'));

    writeFileSync(path.join(dir, 'server/a.ts'), `${ID}(x); import(y);\n`);
    writeFileSync(path.join(dir, 'server/untracked.ts'), `${ID}(x);\n`);
    const entries = [...iterateTreeEntries(dir, subject.tree_sha)];
    expect(entries.map((e) => e.path)).toEqual(['server/a.ts']);
    const d = computeStaticCensus(entries);
    expect(d.census).toEqual({ registration_identifier_files: 0, nonliteral_dynamic_imports: 0, test_registration_files: 0 });
  });
});

describe('entrypoint derivability', () => {
  it('without a release composition the set is NOT_DERIVABLE and no set is returned', () => {
    const d = computeStaticCensus([file('Dockerfile', 'FROM x AS web\nCMD ["npm","start"]'), file('server/index.ts', 'export {}')]);
    const a = assessEntrypointDerivability(d);
    expect(a.status).toBe('NOT_DERIVABLE');
    expect(a.blocker).toBe('RELEASE_COMPOSITION_ABSENT_FROM_SUBJECT_TREE');
    expect(Object.keys(a)).not.toContain('entrypoints');
  });

  it('composition content is noticed but still not derived here', () => {
    const d = computeStaticCensus([file('scripts/release/w.mjs', 'const composition_manifest_sha256 = 1;')]);
    const a = assessEntrypointDerivability(d);
    expect(a.blocker).toBe('COMPOSITION_DERIVATION_NOT_IMPLEMENTED');
    expect(a.status).toBe('NOT_DERIVABLE');
  });

  it('composition mentions in documentation and tests do not count as a composition', () => {
    const d = computeStaticCensus([file('docs/a.md', 'composition_manifest'), file('tests/unit/a.test.ts', 'composition_manifest')]);
    expect(assessEntrypointDerivability(d).blocker).toBe('RELEASE_COMPOSITION_ABSENT_FROM_SUBJECT_TREE');
  });

  it('observed launch surfaces are context and say so', () => {
    const o = new LaunchSurfaceObserver();
    o.add(file('Dockerfile', 'FROM node AS base\nFROM base AS web\nCMD ["npm", "start"]\nFROM base AS w1\nCMD ["npx","tsx","server/workers/x.ts"]'));
    o.add(file('package.json', JSON.stringify({ scripts: { start: 'node s.js', build: 'vite', 'worker:a': 'node w.js' } })));
    const r = o.result();
    expect(r.authoritative).toBe(false);
    expect(r.dockerfile_stages).toEqual(['base', 'web', 'w1']);
    expect(r.package_scripts).toEqual({ start: 'node s.js', 'worker:a': 'node w.js' });
  });
});

describe('the runner never reports PASS', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'u51-runner-'));
  const evidence = mkdtempSync(path.join(tmpdir(), 'u51-evidence-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evidence, { recursive: true, force: true });
  });

  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', RUNNER, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });

  it('a clean tree is still NOT_EXECUTED (exit 2): no entrypoint set, no boot probe, no evidence', () => {
    git('init', '-q');
    mkdirSync(path.join(dir, 'server'), { recursive: true });
    writeFileSync(path.join(dir, 'server/a.ts'), 'export const a = 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'clean');
    const r = run('--repo', dir, '--commit', 'HEAD', '--out', path.join(evidence, 'clean.json'));
    expect(r.status).toBe(2);
    const report = JSON.parse(r.stdout);
    expect(report.result).toBe('NOT_EXECUTED');
    expect(report.static_census).toEqual({ registration_identifier_files: 0, nonliteral_dynamic_imports: 0, test_registration_files: 0 });
    expect(report.entrypoint_set.blocker).toBe('RELEASE_COMPOSITION_ABSENT_FROM_SUBJECT_TREE');
    expect(report.boot_probe.status).toBe('NOT_EXECUTED');
    expect(report.generation_evidence).toBe('NOT_PRODUCED');
    expect(report.manifest_posture).toBe('NOT_WRITTEN');
  });

  it('a discovered registration is FAIL (exit 1), never silently switched to BOUND', () => {
    writeFileSync(path.join(dir, 'server/boot.ts'), `${ID}(runtime);\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'registration');
    const r = run('--repo', dir, '--commit', 'HEAD');
    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.result).toBe('FAIL');
    expect(report.blockers).toContain('RUNTIME_REGISTRATION_DISCOVERED');
    expect(report.census_audit.registration_identifier_paths).toEqual(['server/boot.ts']);
  });

  it('refuses an --out inside the subject repository', () => {
    const r = run('--repo', dir, '--commit', 'HEAD', '--out', path.join(dir, 'evidence.json'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('refusing --out inside the subject repository');
  });

  it('non-literal dynamic imports are reported as an open owner decision, not hidden', () => {
    writeFileSync(path.join(dir, 'server/boot.ts'), 'export {};\n');
    writeFileSync(path.join(dir, 'server/dyn.ts'), 'export const f = (m: string) => import(m);\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'dynamic');
    const r = run('--repo', dir, '--commit', 'HEAD');
    expect(r.status).toBe(2);
    const report = JSON.parse(r.stdout);
    expect(report.census_requirements.nonliteral_dynamic_imports_equals_0).toBe(false);
    expect(report.blockers).toContain('NONLITERAL_DYNAMIC_IMPORTS_PRESENT_OD17_OPEN');
  });
});
