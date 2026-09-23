#!/usr/bin/env node
/**
 * DEV-HELPER (not an authority): cheap checks before an expensive DEV-GOV run.
 *
 *   node scripts/dev-helpers/devgov-helper.mjs lint      <definition.json> [--at SHA] [--ignore ID,ID] [--json]
 *   node scripts/dev-helpers/devgov-helper.mjs preflight <definition.json> [--candidate SHA] [--no-remote]
 *                                                        [--execute --base-worktree PATH] [--ignore ID,ID] [--json]
 *
 *   lint       static advice on the unit definition (no git state needed beyond the repo)
 *   preflight  lint + the controller's own repository/path-lock/provenance checks + remote state +
 *              an approvals estimate; with --execute also a local dry run of every RED/GREEN command
 *              (RED in --base-worktree at base_sha, GREEN here at the candidate)
 *
 * Exit: 0 no ERROR findings, 1 at least one ERROR finding, 2 the helper itself failed.
 * The protected controller, the trusted attest runner and the canonical gate remain the only authority.
 */
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { lintDefinitionFile, runPreflight } from './lib/preflight.mjs';

const BANNER = 'DEV-GOV HELPER -- advisory only. The protected controller and gate are the authority.';

function parse(argv) {
  const opts = { flags: new Set(), values: {}, positional: [] };
  const valued = new Set(['--at', '--ignore', '--candidate', '--base-worktree', '--worktree']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (valued.has(arg)) opts.values[arg] = argv[(i += 1)];
    else if (arg.startsWith('--')) opts.flags.add(arg);
    else opts.positional.push(arg);
  }
  return opts;
}

function render(title, findings, extra = []) {
  const lines = [BANNER, title, ''];
  for (const f of findings) {
    lines.push(`[${f.severity}/${f.kind}] ${f.id}  ${f.where} -- ${f.message}`);
    if (f.hint) lines.push(`        hint: ${f.hint}`);
  }
  for (const r of extra) lines.push(`${r.ok ? 'ok ' : 'BAD'} ${r.kind} ${r.id}: observed ${r.observed} (exit ${r.exit_code}), expected ${r.expected}`);
  const count = (s) => findings.filter((f) => f.severity === s).length;
  lines.push('', `Summary: ${count('ERROR')} error(s), ${count('WARN')} warning(s), ${count('INFO')} info.`);
  return lines.join('\n');
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opts = parse(rest);
  const definition = opts.positional[0];
  if (!['lint', 'preflight'].includes(command) || !definition) {
    console.error(`${BANNER}\nUsage: devgov-helper.mjs <lint|preflight> <definition.json> [options]  (see file header)`);
    return 2;
  }
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: opts.values['--worktree'] ?? process.cwd(), encoding: 'utf8' });
  if (top.status !== 0) throw new Error('not inside a git repository');
  const worktree = top.stdout.trim();
  const definitionPath = relative(worktree, resolve(process.cwd(), definition)).split('\\').join('/');
  const ignore = (opts.values['--ignore'] ?? '').split(',').filter(Boolean);
  const json = opts.flags.has('--json');

  if (command === 'lint') {
    const { def, findings } = lintDefinitionFile({ worktree, definition: definitionPath, atSha: opts.values['--at'], ignore });
    console.log(json ? JSON.stringify({ unit: def.unit, findings }, null, 2) : render(`lint: ${def.unit} (${definitionPath}${opts.values['--at'] ? ` @ ${opts.values['--at'].slice(0, 12)}` : ''})`, findings));
    return findings.some((f) => f.severity === 'ERROR') ? 1 : 0;
  }

  const report = runPreflight({
    worktree,
    definition: definitionPath,
    candidate: opts.values['--candidate'],
    remote: !opts.flags.has('--no-remote'),
    execute: opts.flags.has('--execute'),
    baseWorktree: opts.values['--base-worktree'],
    ignore,
  });
  console.log(json
    ? JSON.stringify(report, null, 2)
    : `${render(`preflight: ${report.unit} @ ${report.candidateSha.slice(0, 12)}`, report.findings, report.results)}\nHelper verdict: ${report.verdict}`);
  return report.findings.some((f) => f.severity === 'ERROR') ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`${BANNER}\nhelper failed: ${error.message}`);
  process.exitCode = 2;
}
