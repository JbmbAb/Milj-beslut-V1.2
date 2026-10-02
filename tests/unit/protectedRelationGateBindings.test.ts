/**
 * U30F F1 / U30F2 M1-M2: the Python and PowerShell bindings of the protected relation gate read the same
 * definition (protected-relations.v1.json) and the same classification specification
 * (protected-relation-classification.v1.json), and must classify EXACTLY like the TypeScript gate.
 *
 * One corpus (tests/fixtures/protected-relation-gate/corpus.v1.json: every v30f gate probe, the SQL and
 * command forms of the v30f inventory canaries, the M2 schema operations, and the classification
 * cases) plus a seeded generator of varied new violations (case, quoting, U& escapes, comments, strings
 * holding '--', dynamic SQL in DO bodies and split EXECUTE strings, ogr2ogr flag orders, shell wrappers).
 * TypeScript must meet every expectation; Python (`--corpus`) and PowerShell (`Invoke-ProtectedWriteCorpus`)
 * must return the identical normalized verdict (verdict, protected writes, unresolved operations) for
 * every case. Each binding runs as a child process with only its own file: no importer, no database.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import * as gate from '../../packages/spatial-provider-postgis/src/ProtectedRelationGate';
import { classifyRelation } from '../../packages/spatial-provider-postgis/src/ProtectedRelations';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PY_GATE = path.join(repoRoot, 'scripts', 'data-pipeline', 'protected_relation_gate.py');
const PS_GATE = path.join(repoRoot, 'scripts', 'lib', 'ProtectedRelationGate.ps1');
const CORPUS_FILE = path.join(repoRoot, 'tests', 'fixtures', 'protected-relation-gate', 'corpus.v1.json');

type Verdict = 'ALLOWED' | 'PROTECTED' | 'UNRESOLVABLE';
interface Case {
  id: string;
  kind: 'sql' | 'ogr2ogr' | 'argv' | 'command' | 'relation' | 'schema' | 'operation';
  text?: string;
  args?: string[];
  operation?: string;
  expect: { verdict: Verdict; protected?: string[]; unresolved?: string[] };
}
interface Normalized {
  id?: string;
  verdict: Verdict | 'ERROR';
  protected: string[];
  unresolved: string[];
  error?: string;
}

const CORPUS: Case[] = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));

// ---------------------------------------------------------------------------------------------
// Generator: varied new violations with the verdict known by construction (seeded, reproducible)
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Target = readonly [string | null, string];
const PROTECTED_TARGETS: readonly Target[] = [
  ['env', 'sgu_well'],
  ['core', 'property_unit'],
  ['climate', 'flood_risk_area'],
  ['lm_staging', 'anything_x'],
  ['lm_staging', 'marktacke_07497f79'],
  ['env', 'registerenhetsomradesytor_g3'],
  ['hydro', 'water_catchment'],
  [null, 'sgu_well'],
  [null, 'natura2000_area_a5d665ae'],
];
const UNPROTECTED_TARGETS: readonly Target[] = [
  ['public', 'jobs'],
  ['stage', 'n2k_spa_raw'],
  ['env', 'sgu_well_actual'],
  ['topo10', 'byggnad'],
  [null, 'scratch_table'],
];

function generate(seed: number, count: { sql: number; ogr: number; cmd: number }): Case[] {
  const r = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const chance = (p: number) => r() < p;
  const randomCase = (w: string) => [...w].map((c) => (chance(0.5) ? c.toUpperCase() : c.toLowerCase())).join('');
  const kw = (w: string) => pick([w.toUpperCase(), w.toLowerCase(), randomCase(w)]);
  const ws = () => pick([' ', '  ', '\n', '\t', ' /* x */ ', ' -- y\n']);
  const unicodeEscaped = (part: string) => [...part].map((c) => (chance(0.3) ? `\\${c.charCodeAt(0).toString(16).padStart(4, '0')}` : c)).join('');
  const renderPart = (part: string) => {
    const style = Math.floor(r() * 4);
    if (style === 0) return part;
    if (style === 1) return randomCase(part);
    if (style === 2) return `"${part}"`;
    return `U&"${unicodeEscaped(part)}"`;
  };
  const renderName = (t: Target) => {
    const dot = pick(['.', ' . ', '.']);
    const table = renderPart(t[1]);
    if (t[0] === null) return table;
    const db = chance(0.1) ? `${renderPart('mimer')}${dot}` : '';
    return `${db}${renderPart(t[0])}${dot}${table}`;
  };
  const plainName = (t: Target) => (t[0] === null ? t[1] : `${t[0]}.${t[1]}`);
  const target = (): { t: Target; protected: boolean } =>
    chance(0.6) ? { t: pick(PROTECTED_TARGETS), protected: true } : { t: pick(UNPROTECTED_TARGETS), protected: false };
  const statement = (name: string): string =>
    pick([
      () => `${kw('truncate')}${chance(0.5) ? ` ${kw('table')}` : ''}${chance(0.3) ? ` ${kw('only')}` : ''}${ws()}${name}${chance(0.2) ? ' *' : ''}${pick(['', ' CASCADE', ' RESTART IDENTITY'])}`,
      () => `${kw('delete')}${ws()}${kw('from')} ${name} WHERE id = 1`,
      () => `${kw('insert')} ${kw('into')}${ws()}${name} (a) VALUES (1)`,
      () => `${kw('update')} ${name}${ws()}${kw('set')} a = 1`,
      () => `${kw('drop')} ${kw('table')} ${chance(0.5) ? 'IF EXISTS ' : ''}${name}${chance(0.5) ? ' CASCADE' : ''}`,
      () => `${kw('merge')} ${kw('into')} ${name} t USING s ON true WHEN MATCHED THEN DELETE`,
      () => `${kw('copy')} ${name} (a) ${kw('from')} STDIN`,
      () => `${kw('alter')} ${kw('table')} ${name} SET (autovacuum_enabled = false)`,
    ])();
  const cases: Case[] = [];
  for (let n = 0; n < count.sql; n += 1) {
    const { t, protected: isProtected } = target();
    let sql = statement(renderName(t));
    const wrap = Math.floor(r() * 4);
    if (wrap === 1) sql = `DO $$ BEGIN EXECUTE '${sql.replace(/'/g, "''")}'; END $$`;
    if (wrap === 2) {
      const k = 1 + Math.floor(r() * (sql.length - 1));
      sql = `EXECUTE '${sql.slice(0, k).replace(/'/g, "''")}' || '${sql.slice(k).replace(/'/g, "''")}'`;
    }
    let commented = false;
    if (wrap === 3 && !sql.includes('*/') && !sql.includes('\n')) {
      commented = true;
      sql = chance(0.5) ? `-- ${sql}\nSELECT 1` : `/* ${sql} */ SELECT 1`;
    }
    const prefix = pick(['', 'SELECT 1; ', '-- note\n', '/* c */ ', "INSERT INTO public.log VALUES ('--'); ", "SELECT '/*'; "]);
    const suffix = pick(['', ';', '; SELECT 1', ' -- trailing']);
    cases.push({ id: `gen-sql-${n}`, kind: 'sql', text: `${prefix}${sql}${suffix}`, expect: { verdict: isProtected && !commented ? 'PROTECTED' : 'ALLOWED' } });
  }
  for (let n = 0; n < count.ogr; n += 1) {
    const { t, protected: isProtected } = target();
    const variant = Math.floor(r() * 3);
    if (variant === 2) {
      const stmt = statement(plainName(t));
      cases.push({ id: `gen-ogr-${n}`, kind: 'ogr2ogr', args: ['-f', 'GPKG', 'out.gpkg', 'PG:dbname=x', '-sql', stmt], expect: { verdict: isProtected ? 'PROTECTED' : 'ALLOWED' } });
      continue;
    }
    if (variant === 1) {
      cases.push({ id: `gen-ogr-${n}`, kind: 'ogr2ogr', args: ['-f', pick(['GPKG', 'GeoJSON']), 'out.x', 'in.shp', '-nln', plainName(t), '-overwrite'], expect: { verdict: 'ALLOWED' } });
      continue;
    }
    const pairs: string[][] = [['-f', pick(['PostgreSQL', 'PG', 'postgresql', 'PostGIS'])]];
    const unqualified = t[0] !== null && chance(0.5);
    pairs.push(['-nln', unqualified ? t[1] : t[0] === null ? t[1] : `${pick([t[0], t[0].toUpperCase()])}.${t[1]}`]);
    if (unqualified) pairs.push(['-lco', `${pick(['SCHEMA', 'schema'])}=${t[0]}`]);
    pairs.push([pick(['-overwrite', '-append', '-update', '-upsert'])]);
    for (let k = pairs.length - 1; k > 0; k -= 1) {
      const j = Math.floor(r() * (k + 1));
      [pairs[k], pairs[j]] = [pairs[j]!, pairs[k]!];
    }
    cases.push({ id: `gen-ogr-${n}`, kind: 'ogr2ogr', args: ['PG:dbname=x', 'a.gpkg', ...pairs.flat()], expect: { verdict: isProtected ? 'PROTECTED' : 'ALLOWED' } });
  }
  for (let n = 0; n < count.cmd; n += 1) {
    const { t, protected: isProtected } = target();
    const expect = { verdict: (isProtected ? 'PROTECTED' : 'ALLOWED') as Verdict };
    const stmt = statement(plainName(t)).replace(/\n|\t|--[^\n]*\n|\/\*[^*]*\*\//g, ' ');
    const variant = Math.floor(r() * 5);
    if (variant === 0) cases.push({ id: `gen-cmd-${n}`, kind: 'command', text: `psql -c "${stmt}"`, expect });
    else if (variant === 1) cases.push({ id: `gen-cmd-${n}`, kind: 'command', text: `docker exec -i db psql -U postgres -c "${stmt}"`, expect });
    else if (variant === 2) cases.push({ id: `gen-cmd-${n}`, kind: 'command', text: `${pick(['bash', 'sh'])} -c "psql -c '${stmt}'"`, expect });
    else if (variant === 3) cases.push({ id: `gen-cmd-${n}`, kind: 'command', text: `shp2pgsql ${pick(['-d', '-a', '-c'])} -s 3006 a.shp ${plainName(t)} | psql`, expect });
    else if (t[0] !== null) cases.push({ id: `gen-cmd-${n}`, kind: 'command', text: `pg_restore --clean -n ${t[0]} -t ${t[1]} x.dump`, expect });
    else cases.push({ id: `gen-cmd-${n}`, kind: 'argv', args: ['psql', '-c', stmt], expect });
  }
  return cases;
}

const GENERATED = generate(20261002, { sql: 240, ogr: 60, cmd: 60 });
const ALL = [...CORPUS, ...GENERATED];

function tsVerdict(c: Case): Normalized {
  const classify = (gate as { classifyProtectedWrite?: (input: unknown) => Normalized }).classifyProtectedWrite;
  if (!classify) throw new Error('classifyProtectedWrite is missing from the TypeScript gate');
  const input =
    c.kind === 'ogr2ogr' || c.kind === 'argv'
      ? { kind: c.kind, args: c.args }
      : c.kind === 'operation'
        ? { kind: c.kind, operation: c.operation, text: c.text }
        : { kind: c.kind, text: c.text };
  return classify(input);
}

let corpusDir: string | null = null;
function corpusFile(): string {
  if (!corpusDir) {
    corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wu30f2-corpus-'));
    fs.writeFileSync(path.join(corpusDir, 'cases.json'), JSON.stringify(ALL.map(({ expect: _e, ...rest }) => rest)), 'utf8');
  }
  return path.join(corpusDir, 'cases.json');
}
afterAll(() => {
  if (corpusDir) fs.rmSync(corpusDir, { recursive: true, force: true });
});

function has(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;
}
const hasPython = has('python', ['--version']);
const hasPwsh = has('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major']);

function byId(results: Normalized[]): Map<string, Normalized> {
  return new Map(results.map((x) => [x.id!, { verdict: x.verdict, protected: [...x.protected], unresolved: [...x.unresolved], ...(x.error ? { error: x.error } : {}) }]));
}

describe('the TypeScript gate meets every corpus and generated expectation (U30F2 M1)', () => {
  it('fixed corpus: every v30f gate probe, inventory canary form and classification case', () => {
    const misses: string[] = [];
    for (const c of CORPUS) {
      const got = tsVerdict(c);
      if (got.verdict !== c.expect.verdict) misses.push(`${c.id}: expected ${c.expect.verdict}, got ${got.verdict} ${JSON.stringify(got)}`);
      if (c.expect.protected && JSON.stringify(got.protected) !== JSON.stringify(c.expect.protected)) misses.push(`${c.id}: protected ${JSON.stringify(got.protected)}`);
      if (c.expect.unresolved && JSON.stringify(got.unresolved) !== JSON.stringify(c.expect.unresolved)) misses.push(`${c.id}: unresolved ${JSON.stringify(got.unresolved)}`);
    }
    expect(misses).toEqual([]);
    expect(CORPUS.length).toBeGreaterThanOrEqual(150);
  });

  it('generated variations: 360 new violations and controls, every verdict as constructed', () => {
    const misses = GENERATED.filter((c) => tsVerdict(c).verdict !== c.expect.verdict).map((c) => `${c.id} ${JSON.stringify(c.text ?? c.args)} -> ${JSON.stringify(tsVerdict(c))}`);
    expect(misses).toEqual([]);
    expect(GENERATED.filter((c) => c.expect.verdict === 'PROTECTED').length).toBeGreaterThan(150);
  });
});

describe('protected relation gate bindings (U30F F1, U30F2 M1/M2)', () => {
  it.skipIf(!hasPython)('Python returns the identical normalized verdict for every corpus and generated case', () => {
    const out = execFileSync('python', ['-B', PY_GATE, '--corpus', corpusFile()], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const py = byId(JSON.parse(out) as Normalized[]);
    const diffs = ALL.filter((c) => JSON.stringify(py.get(c.id)) !== JSON.stringify(tsVerdict(c))).map((c) => `${c.id}: ts=${JSON.stringify(tsVerdict(c))} py=${JSON.stringify(py.get(c.id))}`);
    expect(diffs).toEqual([]);
    expect(py.size).toBe(ALL.length);
  }, 300_000);

  it.skipIf(!hasPwsh)('PowerShell returns the identical normalized verdict for every corpus and generated case', () => {
    const script = `. '${PS_GATE.replace(/'/g, "''")}'; Invoke-ProtectedWriteCorpus -Path '${corpusFile().replace(/'/g, "''")}'`;
    const out = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const ps = byId(JSON.parse(out) as Normalized[]);
    const diffs = ALL.filter((c) => JSON.stringify(ps.get(c.id)) !== JSON.stringify(tsVerdict(c))).map((c) => `${c.id}: ts=${JSON.stringify(tsVerdict(c))} ps=${JSON.stringify(ps.get(c.id))}`);
    expect(diffs).toEqual([]);
    expect(ps.size).toBe(ALL.length);
  }, 600_000);

  it.skipIf(!hasPython)('M2: the Python binding refuses DROP_SCHEMA of env, lm_staging and core (schema classification)', () => {
    for (const schema of ['env', 'lm_staging', 'core']) {
      const run = spawnSync(
        'python',
        ['-B', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(path.dirname(PY_GATE))}); import protected_relation_gate as g; g.assert_ungoverned_write_allowed('test', 'DROP_SCHEMA', '${schema}')`],
        { encoding: 'utf8' },
      );
      expect(run.status, schema).not.toBe(0);
      expect(run.stderr, schema).toContain(`REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: test may not DROP_SCHEMA ${schema}.*`);
    }
  });

  it.skipIf(!hasPython)('Python refuses a protected target with the gate code, and gated_sql refuses upper-case and split SQL', () => {
    const run = (code: string) =>
      spawnSync('python', ['-B', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(path.dirname(PY_GATE))}); import protected_relation_gate as g; ${code}`], { encoding: 'utf8' });
    const relation = run(`g.assert_ungoverned_write_allowed('test', 'TRUNCATE', 'env.sgu_well')`);
    expect(relation.status).not.toBe(0);
    expect(relation.stderr).toContain('REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: test may not TRUNCATE env.sgu_well');
    const upper = run(`g.gated_sql('test', 'TRUNCATE ENV.SGU_WELL')`);
    expect(upper.stderr).toContain('REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: test may not TRUNCATE env.sgu_well');
    const ok = run(`print(g.gated_sql('test', 'TRUNCATE stage.x'))`);
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim()).toBe('TRUNCATE stage.x');
    const ogr = run(`g.assert_ogr2ogr_write_allowed('test', ['-f', 'PGDump', 'o.sql', 'a.gpkg', '-nln', 'env.sgu_well'])`);
    expect(ogr.stderr).toContain('REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION');
  });

  it.skipIf(!hasPwsh)('PowerShell refuses a protected DROP, a protected schema, gated SQL and an ogr2ogr line', () => {
    const script =
      `. '${PS_GATE.replace(/'/g, "''")}'; ` +
      `$r = @(); foreach ($b in @(` +
      `{ Assert-UngovernedWriteAllowed -Caller 'test' -Operation 'DROP' -Relation 'lm_staging.x' },` +
      `{ Assert-UngovernedWriteAllowed -Caller 'test' -Operation 'DROP_SCHEMA' -Relation 'env' },` +
      `{ Get-GatedSql -Caller 'test' -Sql 'ALTER SCHEMA env RENAME TO e2' },` +
      `{ Assert-CommandWriteAllowed -Caller 'test' -Command '& ogr2ogr -f PostgreSQL PG:x a.gpkg -nln env.sgu_well -overwrite' },` +
      `{ Get-GatedSql -Caller 'test' -Sql 'TRUNCATE stage.x' })) { $r += try { $out = & $b; "ALLOWED:$out" } catch { $_.Exception.Message } }; ` +
      `$r | ConvertTo-Json -Compress`;
    const out = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })) as string[];
    expect(out[0]).toContain('REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: test may not DROP lm_staging.x');
    expect(out[1]).toContain('REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: test may not DROP_SCHEMA env.*');
    expect(out[2]).toContain('REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: test may not RENAME_SCHEMA schema:env');
    expect(out[3]).toContain('REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: test may not OGR2OGR_WRITE env.sgu_well');
    expect(out[4]).toBe('ALLOWED:TRUNCATE stage.x');
  }, 120_000);

  it('the corpus relation cases equal the TypeScript classification of the definition (sanity)', () => {
    for (const c of CORPUS.filter((x) => x.kind === 'relation')) {
      const k = classifyRelation(c.text!).kind;
      expect(k === 'PROTECTED' ? 'PROTECTED' : k === 'UNRESOLVABLE' ? 'UNRESOLVABLE' : 'ALLOWED', c.id).toBe(c.expect.verdict);
    }
  });
});
