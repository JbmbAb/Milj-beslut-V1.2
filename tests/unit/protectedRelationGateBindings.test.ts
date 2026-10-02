/**
 * U30F F1: the Python and PowerShell bindings of the protected relation gate read the same
 * definition (protected-relations.v1.json) and must classify exactly like the TypeScript gate.
 * Each binding is run as a child process with only its own file (no importer, no database).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyRelation } from '../../packages/spatial-provider-postgis/src/ProtectedRelations';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PY_GATE = path.join(repoRoot, 'scripts', 'data-pipeline', 'protected_relation_gate.py');
const PS_GATE = path.join(repoRoot, 'scripts', 'lib', 'ProtectedRelationGate.ps1');

const CASES = [
  'env.sgu_well',
  'ENV.SGU_WELL',
  '"Env"."SGU_WELL"',
  'env.sgu_well_actual',
  'env.registerenhetsomradesytor',
  'env.registerenhetsomradesytor_g12',
  'core.property_unit',
  'climate.flood_risk_area',
  'hydro.water_catchment',
  'env.water_catchment',
  'lm_staging.ebh_potentiellt_fororenade_omraden_02fccffc',
  'lm_staging.anything',
  'sgu_well',
  'sgu_well_2b4b514f',
  'public.env_registerenhetsomradesytor',
  'stage.n2k_spa_raw',
  'ONLY env.protected_area',
  'miljobeslut.env.natura2000_area',
  'env.',
  '$1',
];

function tsClassification(name: string) {
  const c = classifyRelation(name);
  return { input: name, kind: c.kind, class: c.kind === 'PROTECTED' ? c.class : null };
}

function has(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;
}
const hasPython = has('python', ['--version']);
const hasPwsh = has('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major']);

describe('protected relation gate bindings (U30F F1)', () => {
  it.skipIf(!hasPython)('Python classifies every case exactly like the TypeScript gate', () => {
    const out = execFileSync('python', ['-B', PY_GATE, '--classify', ...CASES], { encoding: 'utf8' });
    const py = (JSON.parse(out) as Array<{ input: string; kind: string; class?: string }>).map((c) => ({ input: c.input, kind: c.kind, class: c.class ?? null }));
    expect(py).toEqual(CASES.map(tsClassification));
  });

  it.skipIf(!hasPython)('Python refuses a protected target with the gate code', () => {
    const run = spawnSync(
      'python',
      ['-B', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(path.dirname(PY_GATE))}); import protected_relation_gate as g; g.assert_ungoverned_write_allowed('test', 'TRUNCATE', 'env.sgu_well')`],
      { encoding: 'utf8' },
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: test may not TRUNCATE env.sgu_well');
  });

  it.skipIf(!hasPwsh)('PowerShell classifies every case exactly like the TypeScript gate and refuses a protected DROP', () => {
    const list = CASES.map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
    const script =
      `. '${PS_GATE.replace(/'/g, "''")}'; ` +
      `$r = @(${list}) | ForEach-Object { $c = Get-ProtectedRelationClassification $_; [pscustomobject]@{ input = $_; kind = $c.kind; class = $c.class } }; ` +
      `$refused = try { Assert-UngovernedWriteAllowed -Caller 'test' -Operation 'DROP' -Relation 'lm_staging.x'; 'ALLOWED' } catch { $_.Exception.Message }; ` +
      `@{ cases = $r; refused = $refused } | ConvertTo-Json -Depth 4 -Compress`;
    const out = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
    const parsed = JSON.parse(out) as { cases: Array<{ input: string; kind: string; class: string | null }>; refused: string };
    expect(parsed.cases).toEqual(CASES.map(tsClassification));
    expect(parsed.refused).toContain('REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: test may not DROP lm_staging.x');
  });
});
