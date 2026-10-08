import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256CanonicalJson } from '../../../mps-compliance/src/canonical/sha256Canonical.js';
import {
  checkEntrypointComposition,
  deriveEntrypointSetSha256,
  detectSelfStarting,
  fsTreeReader,
  parseDockerfileLaunchers,
  parseEntrypointsFile,
  parseSmokeEntrypoints,
  resolveArgvToEntryFile,
} from '../../src/index';
import { baseFiles, baseTree } from './fixtures';

const rulesOf = (r: ReturnType<typeof checkEntrypointComposition>): string[] => (r.outcome === 'not_executed' ? [...new Set(r.problems.map((p) => p.rule))].sort() : []);

describe('schema u51-entrypoints-1 (closed keys, sorted, no duplicates)', () => {
  const good = JSON.parse(baseFiles()['deploy/onprem/entrypoints.json']!);
  const clone = () => JSON.parse(JSON.stringify(good));
  const reason = 'A written justification that is long enough.';

  it('accepts a well-formed file', () => {
    expect(parseEntrypointsFile(good).ok).toBe(true);
  });

  const bad: Array<[string, (f: any) => void]> = [
    ['an unknown top-level key', (f) => { f.extra = 1; }],
    ['a missing top-level key', (f) => { delete f.not_production; }],
    ['a wrong schema id', (f) => { f.schema = 'u51-entrypoints-2'; }],
    ['an empty entries list', (f) => { f.entries = []; }],
    ['an extra key in an entry', (f) => { f.entries[0].more = true; }],
    ['a missing key in an entry', (f) => { delete f.entries[0].role; }],
    ['an unknown role', (f) => { f.entries[0].role = 'daemon'; }],
    ['an empty argv', (f) => { f.entries[0].argv = []; }],
    ['entries not sorted by id', (f) => { f.entries.reverse(); }],
    ['a duplicate id', (f) => { f.entries[1].id = f.entries[0].id; }],
    ['a path with a leading ./', (f) => { f.entries[0].entry_file = './server/index.ts'; }],
    ['a path with a backslash', (f) => { f.entries[0].entry_file = 'server\\index.ts'; }],
    ['a path with a .. segment', (f) => { f.entries[0].entry_file = 'server/../index.ts'; }],
    ['a file in both lists', (f) => { f.not_production[0].entry_file = f.entries[0].entry_file; }],
    ['not_production not sorted', (f) => { f.not_production = [{ entry_file: 'server/workers/z.ts', reason }, { entry_file: 'server/workers/c.ts', reason }]; }],
    ['a not_production reason that is too short', (f) => { f.not_production[0].reason = 'no'; }],
    ['an extra key in not_production', (f) => { f.not_production[0].x = 1; }],
  ];
  it.each(bad)('rejects %s', (_name, mutate) => {
    const f = clone();
    mutate(f);
    expect(parseEntrypointsFile(f).ok).toBe(false);
  });
});

describe('derived hash', () => {
  const entries = [
    { id: 'web', role: 'web' as const, argv: ['npm', 'start'], entry_file: 'server/index.ts' },
    { id: 'a', role: 'worker' as const, argv: ['node', 'x.ts'], entry_file: 'x.ts' },
  ];
  it('is SHA256 of RFC 8785 over entries sorted by id with only { id, argv, entry_file }', () => {
    const expected = sha256CanonicalJson([
      { id: 'a', argv: ['node', 'x.ts'], entry_file: 'x.ts' },
      { id: 'web', argv: ['npm', 'start'], entry_file: 'server/index.ts' },
    ]);
    expect(deriveEntrypointSetSha256(entries)).toBe(expected);
  });
  it('does not depend on the order given, and changes with argv, id or entry_file but not with role', () => {
    const base = deriveEntrypointSetSha256(entries);
    expect(deriveEntrypointSetSha256([...entries].reverse())).toBe(base);
    expect(deriveEntrypointSetSha256([{ ...entries[0]!, role: 'worker' }, entries[1]!])).toBe(base);
    expect(deriveEntrypointSetSha256([{ ...entries[0]!, argv: ['npm', 'run', 'start'] }, entries[1]!])).not.toBe(base);
    expect(deriveEntrypointSetSha256([{ ...entries[0]!, id: 'web2' }, entries[1]!])).not.toBe(base);
    expect(deriveEntrypointSetSha256([{ ...entries[0]!, entry_file: 'server/other.ts' }, entries[1]!])).not.toBe(base);
  });
});

describe('launcher parsing', () => {
  it('reads CMD and ENTRYPOINT, joins continuations, ignores comments, RUN and HEALTHCHECK CMD', () => {
    const text = ['# CMD ["a"]', 'RUN echo CMD x', 'HEALTHCHECK CMD curl -f http://x', 'CMD ["npm", \\', '  "start"]', 'ENTRYPOINT node a.js'].join('\n');
    const r = parseDockerfileLaunchers(text);
    expect(r.ok && r.value.map((l) => [l.instruction, l.argv])).toEqual([['CMD', ['npm', 'start']], ['ENTRYPOINT', ['node', 'a.js']]]);
  });
  it('refuses an exec form that is not JSON and a shell form with shell syntax', () => {
    expect(parseDockerfileLaunchers('CMD ["a", b]').ok).toBe(false);
    expect(parseDockerfileLaunchers('CMD node a.js && node b.js').ok).toBe(false);
  });
  it('reads the smoke ENTRYPOINTS array and refuses anything but string literals', () => {
    expect(parseSmokeEntrypoints("const ENTRYPOINTS = [\n 'a.ts', // c\n \"b.ts\",\n];")).toEqual({ ok: true, value: ['a.ts', 'b.ts'] });
    expect(parseSmokeEntrypoints("const ENTRYPOINTS = ['a.ts', f()];").ok).toBe(false);
    expect(parseSmokeEntrypoints('const X = [];').ok).toBe(false);
    expect(parseSmokeEntrypoints('const ENTRYPOINTS = [];').ok).toBe(false);
  });
  it('resolves argv to the file it runs, through package scripts, and refuses what it cannot resolve', () => {
    const scripts = { start: 'node --import tsx server/index.ts', multi: 'node a.ts && node b.ts', env: 'FOO=1 node a.ts', deep: 'npm run start', unknown: 'python a.py' };
    expect(resolveArgvToEntryFile(['npm', 'start'], scripts)).toEqual({ ok: true, value: 'server/index.ts' });
    expect(resolveArgvToEntryFile(['npm', 'run', 'deep'], scripts)).toEqual({ ok: true, value: 'server/index.ts' });
    expect(resolveArgvToEntryFile(['npx', 'tsx', './w.ts'], scripts)).toEqual({ ok: true, value: 'w.ts' });
    expect(resolveArgvToEntryFile(['node', '--import', 'tsx', 'w.ts'], scripts)).toEqual({ ok: true, value: 'w.ts' });
    for (const argv of [['npm', 'run', 'multi'], ['npm', 'run', 'env'], ['npm', 'run', 'nope'], ['npm', 'test'], ['npm', 'run', 'unknown'], ['python', 'a.py'], ['node', 'a.ts', 'b.ts'], ['node']]) {
      expect(resolveArgvToEntryFile(argv, scripts).ok, argv.join(' ')).toBe(false);
    }
  });
});

describe('self-starting detector (textual, column 0)', () => {
  it.each([
    ['a call statement', 'main();\n'],
    ['a chained call', 'main()\n  .then(() => 1);\n'],
    ['an awaited call', 'await run();\n'],
    ['a member call', "process.on('SIGINT', f);\n"],
    ['an IIFE', '(async () => { work(); })();\n'],
    ['a start-initialised declaration', 'const handle = startInProcessWorkers();\n'],
    ['a main-module test', "if (import.meta.url === process.argv[1]) {\n}\n"],
    ['a top-level dynamic import', "await import('./x');\n"],
  ])('flags %s', (_n, text) => {
    expect(detectSelfStarting(text).selfStarting).toBe(true);
  });
  it.each([
    ['functions and types only', "import { a } from './a';\nexport function f(): void { a(); }\nexport type T = number;\n"],
    ['calls only inside functions and blocks', "export function f() {\n  main();\n}\nconst x = 1;\n"],
    ['comments', '// main();\n/* run(); */\n * start();\n'],
  ])('does not flag %s', (_n, text) => {
    expect(detectSelfStarting(text).selfStarting).toBe(false);
  });
});

describe('composition consistency: any mismatch is not_executed, never a partial set', () => {
  it('a consistent tree gives the derived hash and the launching sources', () => {
    const r = checkEntrypointComposition(baseTree());
    expect(r.outcome).toBe('consistent');
    if (r.outcome !== 'consistent') return;
    expect(r.derived_sha256).toBe(deriveEntrypointSetSha256(r.file.entries));
    expect(r.launched_by.map((l) => l.id)).toEqual(['web', 'worker-a']);
    expect(r.launched_by.every((l) => l.sources.length > 0)).toBe(true);
  });

  it('missing or broken entrypoints.json', () => {
    expect(rulesOf(checkEntrypointComposition(baseTree({ 'deploy/onprem/entrypoints.json': null })))).toEqual(['schema']);
    expect(rulesOf(checkEntrypointComposition(baseTree({ 'deploy/onprem/entrypoints.json': '{' })))).toEqual(['schema']);
  });

  it('rule cmd-resolves: a Dockerfile CMD that runs an unlisted file, an unresolvable CMD, a missing script', () => {
    const extra = baseFiles().Dockerfile + '\nFROM base AS c\nCMD ["npx", "tsx", "server/workers/c-worker.ts"]';
    expect(rulesOf(checkEntrypointComposition(baseTree({ Dockerfile: extra })))).toContain('cmd-resolves');
    expect(rulesOf(checkEntrypointComposition(baseTree({ Dockerfile: baseFiles().Dockerfile + '\nCMD node a.js && node b.js' })))).toContain('cmd-resolves');
    expect(rulesOf(checkEntrypointComposition(baseTree({ Dockerfile: baseFiles().Dockerfile + '\nCMD ["npm", "run", "nope"]' })))).toContain('cmd-resolves');
    expect(rulesOf(checkEntrypointComposition(baseTree({ Dockerfile: null })))).toContain('cmd-resolves');
  });

  it('rule entry-launched: an entry that no bound source starts', () => {
    const files = baseFiles();
    const withoutLaunchers = baseTree({
      'package.json': JSON.stringify({ scripts: { start: 'node --import tsx server/index.ts' } }),
      'deploy/onprem/image-smoke/smoke.mjs': "const ENTRYPOINTS = ['server/index.ts'];",
    });
    const r = checkEntrypointComposition(withoutLaunchers);
    expect(rulesOf(r)).toEqual(['entry-launched']);
    expect(files['package.json']).toContain('worker:a');
    expect(rulesOf(checkEntrypointComposition(baseTree({ 'deploy/onprem/image-smoke/smoke.mjs': null })))).toContain('entry-launched');
  });

  it("rule argv-resolves: an entry whose own argv runs another file", () => {
    const f = JSON.parse(baseFiles()['deploy/onprem/entrypoints.json']!);
    f.entries[1].argv = ['node', '--import', 'tsx', 'server/workers/b-worker.ts'];
    expect(rulesOf(checkEntrypointComposition(baseTree({ 'deploy/onprem/entrypoints.json': JSON.stringify(f) })))).toEqual(['argv-resolves']);
  });

  it('rule self-starting-listed: a new self-starting worker nobody listed; a self-starting "library"; a stale library table', () => {
    expect(rulesOf(checkEntrypointComposition(baseTree({ 'server/workers/new-worker.ts': 'start();\n' })))).toEqual(['self-starting-listed']);
    // a helper that only exports functions is not a process file and needs no listing
    expect(checkEntrypointComposition(baseTree({ 'server/workers/helper.ts': 'export function h() {}\n' })).outcome).toBe('consistent');
    expect(rulesOf(checkEntrypointComposition(baseTree({ 'server/workers/registry.ts': 'start();\n' })))).toEqual(['self-starting-listed']);
    expect(rulesOf(checkEntrypointComposition(baseTree({ 'server/workers/registry.ts': null })))).toContain('self-starting-listed');
    // a self-starting server/index.ts is covered by the entries list; removing the web entry from the lists is caught
    const f = JSON.parse(baseFiles()['deploy/onprem/entrypoints.json']!);
    f.entries = [f.entries[1]];
    expect(rulesOf(checkEntrypointComposition(baseTree({ 'deploy/onprem/entrypoints.json': JSON.stringify(f) })))).toContain('self-starting-listed');
  });

  it('rule lists-disjoint-and-exist: a listed file that does not exist, a library listed as an entry', () => {
    expect(rulesOf(checkEntrypointComposition(baseTree({ 'server/workers/b-worker.ts': null })))).toContain('lists-disjoint-and-exist');
    const f = JSON.parse(baseFiles()['deploy/onprem/entrypoints.json']!);
    f.not_production.push({ entry_file: 'server/workers/bootstrap.ts', reason: 'A library must never be listed as a process in this fixture.' });
    expect(rulesOf(checkEntrypointComposition(baseTree({ 'deploy/onprem/entrypoints.json': JSON.stringify(f) })))).toContain('lists-disjoint-and-exist');
  });
});

describe('the committed composition of THIS repository checkout', () => {
  const r = checkEntrypointComposition(fsTreeReader(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')));

  it('is consistent with the Dockerfile, package.json, the smoke and the worker files', () => {
    expect(r.outcome === 'consistent' ? [] : r.problems).toEqual([]);
    expect(r.outcome).toBe('consistent');
  });
  it('lists exactly the owner-decided five roots and five non-roots (U51-D-PROFILE-1)', () => {
    if (r.outcome !== 'consistent') throw new Error('not consistent');
    expect(r.file.entries.map((e) => e.entry_file)).toEqual([
      'server/workers/lu-execution-identity-v3-worker.ts',
      'server/workers/lu-geometry-supersession-worker.ts',
      'server/workers/lu-project-context-bootstrap-worker.ts',
      'server/workers/lu-viewer-capability-worker.ts',
      'server/index.ts',
    ]);
    expect(r.file.not_production.map((n) => n.entry_file)).toEqual([
      'server/workers/domstol-rss-worker.ts',
      'server/workers/gdpr-maintenance-worker.ts',
      'server/workers/municipality-polling-worker.ts',
      'server/workers/run-all.ts',
      'server/workers/search-indexer-worker.ts',
    ]);
  });
  it('pins the derived entrypoint-set hash: a deployment change is an entrypoints change', () => {
    if (r.outcome !== 'consistent') throw new Error('not consistent');
    expect(r.derived_sha256).toBe('aef754f6b211a40e30b0d0a2f5b806c994f78493aa119669e342dba9a35d07ca');
  });
});
