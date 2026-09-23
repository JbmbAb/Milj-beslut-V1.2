/**
 * DEV-HELPER (not an authority). Predicts whether a unit will get through the protected pipeline
 * BEFORE the expensive part (push, trusted dispatch, environment approvals).
 *
 * It re-uses the controller's own exported functions for everything the controller already decides
 * (repository state, path lock, definition provenance, command classification) and adds only what the
 * controller does not tell you early: lint findings, "will git even commit this file", remote state,
 * an approvals estimate, and an optional local dry run of the declared commands.
 *
 * If this helper and the protected controller ever disagree, the controller is right.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as controller from '../../devgov/devgov.mjs';
import { fsReader, gitReader } from './importClosure.mjs';
import { kindOf, lintUnitDefinition, SEVERITY } from './unitLint.mjs';

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const out = (r) => (r.status === 0 ? r.stdout.trim() : '');
const add = (list, id, severity, where, message, hint = '') => list.push({ id, severity, kind: kindOf(id), where, message, hint });

/** Lint a definition file that lives in `worktree` (or in a git tree at `atSha`). */
export function lintDefinitionFile({ worktree, definition, atSha, ignore = [] }) {
  const head = atSha ? gitReader(worktree, atSha) : fsReader(worktree);
  const text = atSha ? head.read(definition) : readFileSync(join(worktree, definition), 'utf8');
  if (text === null) throw new Error(`cannot read ${definition}${atSha ? ` at ${atSha}` : ''}`);
  const def = JSON.parse(text);
  const baseTree = gitReader(worktree, def.base_sha);
  const findings = lintUnitDefinition(def, {
    definitionPath: definition,
    head,
    base: baseTree.available() ? baseTree : null,
  });
  return { def, findings: findings.filter((f) => !ignore.includes(f.id)) };
}

export function runPreflight({ worktree, definition, candidate, remote = true, execute = false, baseWorktree, ignore = [] }) {
  const candidateSha = candidate ?? out(git(['rev-parse', 'HEAD'], worktree));
  const { def, findings } = lintDefinitionFile({ worktree, definition, ignore });
  const results = [];

  // Controller-owned checks (authority): repository state + path lock, then definition provenance.
  const context = { worktree, candidateSha };
  try {
    const verdict = controller.evaluateRepositoryState(def, controller.readRepositoryState(def, context), context);
    for (const error of verdict.errors ?? []) add(findings, 'CTL-REPO', SEVERITY.ERROR, 'controller', error);
  } catch (error) {
    add(findings, 'CTL-REPO', SEVERITY.ERROR, 'controller', `could not evaluate repository state: ${error.message}`);
  }
  const provenance = controller.verifyUnitDefinitionProvenance(join(worktree, definition), context);
  for (const error of provenance.errors ?? []) add(findings, 'CTL-DEF', SEVERITY.ERROR, 'controller', error);

  // Helper-only addition: will git commit this file at all? (unit definitions match a *.json ignore rule)
  const tracked = git(['ls-files', '--error-unmatch', '--', definition], worktree).status === 0;
  if (!tracked && git(['check-ignore', '-q', '--no-index', '--', definition], worktree).status === 0) {
    add(findings, 'PRE-IGNORE', SEVERITY.ERROR, definition, 'the definition is untracked AND matched by .gitignore; a plain "git add" will silently skip it', 'git add -f <definition>');
  }

  // Remote state (informational until push): verify-sha denies when the remote branch is absent or differs.
  if (remote) {
    const name = def.remote?.name ?? 'origin';
    const branch = def.remote?.branch ?? def.branch;
    const r = git(['ls-remote', '--heads', name, branch], worktree);
    if (r.status !== 0) add(findings, 'PRE-REMOTE', SEVERITY.INFO, name, 'could not query the remote (offline or no access); skipped');
    else if (!r.stdout.trim()) add(findings, 'PRE-REMOTE', SEVERITY.INFO, `${name}/${branch}`, 'branch is not pushed yet; the controller "verify-sha" will deny until it is (absent_policy: deny_absent)');
    else if (r.stdout.split(/\s+/)[0] !== candidateSha) add(findings, 'PRE-REMOTE', SEVERITY.WARN, `${name}/${branch}`, `remote head ${r.stdout.split(/\s+/)[0].slice(0, 12)} differs from the candidate ${candidateSha.slice(0, 12)}; "verify-sha" would deny`);
    else add(findings, 'PRE-REMOTE', SEVERITY.INFO, `${name}/${branch}`, 'remote head equals the candidate');

    const main = git(['ls-remote', name, 'refs/heads/main'], worktree);
    const mainSha = main.status === 0 ? main.stdout.split(/\s+/)[0] : '';
    if (mainSha && mainSha !== def.base_sha) {
      add(findings, 'PRE-BASE', SEVERITY.INFO, 'base_sha', `main is at ${mainSha.slice(0, 12)}, not the unit base ${def.base_sha.slice(0, 12)}; with strict branch protection the PR branch must be brought up to date before merge`);
    }
  }

  add(findings, 'PRE-APPROVALS', SEVERITY.INFO, 'devgov-attestation',
    'a trusted run has been observed to wait for the protected reviewer up to three times (RED signing, GREEN signing, the gate run); the producer cannot approve');

  // Optional local dry run with the controller's own command runner. Needs prepared worktrees.
  if (execute) {
    const runs = [
      ['RED', def.required_red ?? [], baseWorktree],
      ['GREEN', def.required_green ?? [], worktree],
    ];
    for (const [kind, list, wt] of runs) {
      for (const spec of list) {
        if (!wt) {
          add(findings, 'EXE-SKIP', SEVERITY.INFO, `${kind} ${spec.id}`, 'skipped: no --base-worktree given for RED');
          continue;
        }
        try {
          const evidence = controller.runManifestCommand(def, spec, kind, { worktree: wt, candidateSha });
          const expected = kind === 'RED' ? spec.expected_classification ?? 'FAIL' : 'PASS';
          const ok = evidence.classification === expected;
          results.push({ kind, id: spec.id, expected, observed: evidence.classification, exit_code: evidence.exit_code ?? evidence.exitCode ?? null, ok });
          if (!ok) {
            const localOnly = process.platform === 'win32' && ['npx', 'npm'].includes(spec.command) && evidence.classification === 'BLOCKED_ENVIRONMENT';
            add(findings, 'EXE-MISMATCH', localOnly ? SEVERITY.WARN : SEVERITY.ERROR, `${kind} ${spec.id}`,
              `observed ${evidence.classification}, expected ${expected}${evidence.environment_error ? ` (${evidence.environment_error})` : ''}${localOnly ? ' -- a Windows limitation of spawning npx without a shell, not necessarily a defect' : ''}`);
          }
        } catch (error) {
          add(findings, 'EXE-ERROR', SEVERITY.ERROR, `${kind} ${spec.id}`, `could not run: ${error.message}`);
        }
      }
    }
  }

  const errors = findings.filter((f) => f.severity === SEVERITY.ERROR);
  const verdict = errors.some((f) => f.kind === 'gate')
    ? 'LIKELY_TO_FAIL'
    : errors.length > 0
      ? 'RUNS_BUT_PROOF_VALIDITY_AT_RISK'
      : execute && results.length > 0 && results.every((r) => r.ok)
        ? 'LIKELY_TO_PASS_DRY_RUN_OK'
        : 'NO_ERRORS_FOUND_STATIC';
  return { candidateSha, unit: def.unit, findings: findings.filter((f) => !ignore.includes(f.id)), results, verdict };
}
