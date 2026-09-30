#!/usr/bin/env node
// AUTOMATED-REBASE-REVERIFY-01 -- steps 1-5 of §1 in
// Claude outputs/merge-queue-automation-2026-09-30/AUTOMATED-REBASE-REVERIFY-DESIGN-2026-09-30.md
// (design COLD_VERIFIED/ACCEPT for §1-4, 2026-09-30; this implementation is its own, separately
// unverified candidate -- see feedback-design-verdict-does-not-inherit-to-implementation memory).
//
// Repaired 2026-09-30 per W1-VERIFY-DB's independent cold review (SOUND_WITH_CHANGES verdict) of
// candidate b7ddef9f, on Jimmy's GO: pagination + bounded retry/backoff/timeout in
// locatePriorApprovedSha, fail-closed on an empty RED/GREEN manifest, merge-conflict vs. other
// git-failure classification, --pr shape validation, and a new pre_merge_tip_sha dispatch field so
// the CI workflow can independently re-derive Phase 1/2 instead of trusting the payload narrative.
//
// On-demand only (§1.1) -- invoked explicitly per PR, never on a schedule. For one specific PR
// that is BEHIND its base but otherwise mergeable, with a prior successful DEV-GOV run recorded
// somewhere on its branch history:
//   1. detects staleness (gh pr view --json mergeStateStatus,mergeable)
//   2. locates the prior-approved candidate SHA (most recent commit on the branch with a green
//      "DEV-GOV-V0 / trusted-execution" commit status)
//   3. Phase 1: verifies the branch's current-tip unit definition is byte-identical to the
//      prior-approved candidate's unit definition -- full identity, zero exceptions (§1.3)
//   4. merges the current base into the branch (git merge --no-edit, matching the PR #203/#204
//      manual precedent -- never rebase, never squash)
//   5. bumps base_sha (the one permitted edit) and runs Phase 2: the resulting file must differ
//      from the Phase-1 snapshot in exactly the base_sha field, nothing else (§1.3)
//   6. locally dry-runs the unit's declared RED/GREEN commands via the real controller
//      (scripts/devgov/devgov.mjs run-red/run-green) as a fast pre-check -- NOT the authoritative,
//      signed proof; that only happens in CI (devgov-v0-rebase-reverify.yml's execute jobs)
//
// It never signs anything, never dispatches devgov-v0-gate.yml, and never touches the
// devgov-attestation environment itself. If every local check passes, it can optionally push the
// merge+base_sha-bump commit and dispatch devgov-v0-rebase-reverify.yml (§4), which performs the
// design's step 6 (RED/GREEN re-run + sign, in CI, environment-gated) and step 7 (stop, post
// evidence comment). Any deviation at any step is STOP_NEW_REVIEW_REQUIRED or a candidate-failure
// stop (§3) -- never a retry, never a force-merge, never a silent fallback.
//
// Lives under scripts/dev-helpers/, not scripts/devgov/ -- the latter is a controller-owned floor
// path (F-10, CONTROLLER_OWNED_FLOOR_PATHS in scripts/devgov/devgov.mjs) that no Dev-Gov unit may
// ever add or modify, same reason devgov-helper.mjs lives there instead of in the controller
// itself. This script calls the real controller (scripts/devgov/devgov.mjs) but is not part of it.
//
// Usage:
//   node scripts/dev-helpers/automated-rebase-reverify.mjs \
//     --pr <number> \
//     --definition <repo-relative unit-definition path> \
//     --worktree <path to a clean local checkout of the PR branch> \
//     [--repo <owner/repo>]            (default: origin's GitHub remote)
//     [--base-worktree <path>]         (default: a temp `git worktree add` at the resolved new
//                                        base SHA, removed on exit)
//     [--push]                         (default: false -- dry-run only, nothing pushed)
//     [--dispatch]                     (default: false -- requires --push; dispatches
//                                        devgov-v0-rebase-reverify.yml via repository_dispatch)
//
// Pure, git/gh-free decision logic lives in the exported functions below so the proof-unit for
// THIS implementation can exercise it directly with synthetic fixtures, without needing a live
// GitHub PR (see governance/devgov/units/automated-rebase-reverify-01-v1.json).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STOP = Object.freeze({
  NOT_STALE: 'STOP_NOT_STALE',
  NOT_MERGEABLE: 'STOP_NOT_MERGEABLE',
  NO_PRIOR_PROOF: 'STOP_NO_PRIOR_PROOF',
  TOO_MANY_COMMITS_TO_WALK: 'STOP_TOO_MANY_COMMITS_TO_WALK',
  NEW_REVIEW_REQUIRED: 'STOP_NEW_REVIEW_REQUIRED',
  MERGE_CONFLICT: 'STOP_MERGE_CONFLICT',
  MERGE_FAILED: 'STOP_MERGE_FAILED',
  EMPTY_PROOF_MANIFEST: 'STOP_EMPTY_PROOF_MANIFEST',
  CANDIDATE_FAILURE: 'STOP_CANDIDATE_FAILURE',
});

const MAX_COMMITS_TO_WALK = 200;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEVGOV_INVOCATION_TIMEOUT_MS = 150_000; // comfortably above devgov.mjs's own internal 120_000 default

// ---------------------------------------------------------------------------------------------
// Pure decision logic (§1.3). No I/O. Operates on already-read bytes/JSON so it is directly
// unit-testable and cannot accidentally read the wrong file or the wrong git ref.
// ---------------------------------------------------------------------------------------------

/**
 * Phase 1 (pre-merge, pre-mutation): the branch's current-tip unit-definition bytes must be
 * byte-for-byte identical, in full, with no field exempted -- including base_sha -- to the
 * previously-approved unit-definition bytes (the candidate SHA located by locatePriorApprovedSha).
 * Any difference at all means the branch itself drifted since approval and is
 * STOP_NEW_REVIEW_REQUIRED. This never runs against a post-merge or post-mutation copy.
 */
export function phase1VerifyOriginalIdentity(currentTipBytes, priorApprovedBytes) {
  const identical = Buffer.compare(Buffer.from(currentTipBytes), Buffer.from(priorApprovedBytes)) === 0;
  if (identical) return { ok: true };
  return {
    ok: false,
    stop: STOP.NEW_REVIEW_REQUIRED,
    reason:
      'branch current-tip unit definition is not byte-identical to the prior-approved unit definition ' +
      '(including base_sha, which should not yet differ) -- the branch drifted since approval',
  };
}

function diffTopLevelKeys(beforeObj, afterObj) {
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const changed = [];
  for (const key of keys) {
    const before = JSON.stringify(beforeObj[key]);
    const after = JSON.stringify(afterObj[key]);
    if (before !== after) changed.push(key);
  }
  return changed;
}

/**
 * Phase 2 (post-merge, post-mutation): diff the resulting file (after the automation's own single
 * permitted base_sha edit) against the Phase-1 snapshot (the SAME bytes phase1VerifyOriginalIdentity
 * was given as currentTipBytes) -- never against the original approval a second time. The changed
 * key set must be exactly {"base_sha"}, nothing else. Catches both the merge unexpectedly touching
 * this file and a bug in the edit step itself. This is a self-check on the automation's own edit,
 * not a re-litigation of prior approval.
 */
export function phase2VerifyOwnEdit(phase1SnapshotBytes, postEditBytes, expectedNewBaseSha) {
  let before;
  let after;
  try {
    before = JSON.parse(Buffer.from(phase1SnapshotBytes).toString('utf8'));
    after = JSON.parse(Buffer.from(postEditBytes).toString('utf8'));
  } catch (error) {
    return {
      ok: false,
      stop: STOP.NEW_REVIEW_REQUIRED,
      reason: `unit definition is not valid JSON after the base_sha edit: ${error.message}`,
    };
  }
  const changedKeys = diffTopLevelKeys(before, after);
  if (changedKeys.length !== 1 || changedKeys[0] !== 'base_sha') {
    return {
      ok: false,
      stop: STOP.NEW_REVIEW_REQUIRED,
      reason: `unexpected diff against the Phase-1 snapshot -- changed keys: ${JSON.stringify(changedKeys)} (expected exactly ["base_sha"])`,
    };
  }
  if (after.base_sha !== expectedNewBaseSha) {
    return {
      ok: false,
      stop: STOP.NEW_REVIEW_REQUIRED,
      reason: `base_sha was changed to ${JSON.stringify(after.base_sha)}, expected ${JSON.stringify(expectedNewBaseSha)}`,
    };
  }
  return { ok: true };
}

/**
 * §1 scope gate: only a PR that is BEHIND its base but still mergeable, per
 * `gh pr view --json mergeStateStatus,mergeable`, is in scope. Anything else is not this design's
 * problem to solve (e.g. CONFLICTING needs a real human rebase, not this automation).
 */
export function classifyStaleness({ mergeStateStatus, mergeable }) {
  if (mergeStateStatus !== 'BEHIND') {
    return { inScope: false, stop: STOP.NOT_STALE, reason: `mergeStateStatus is ${mergeStateStatus}, not BEHIND` };
  }
  if (mergeable !== 'MERGEABLE') {
    return { inScope: false, stop: STOP.NOT_MERGEABLE, reason: `mergeable is ${mergeable}, not MERGEABLE` };
  }
  return { inScope: true };
}

/**
 * W1-VERIFY-DB finding (2026-09-30): the local RED/GREEN dry-run's pass check is vacuously true on
 * an empty manifest ([].every(...) === true), so a unit definition with no declared RED/GREEN
 * entries would silently report PASS with zero checks executed. Fail closed instead: this tool's
 * whole purpose is proof-preserving, so "no proof was run" must never look like "proof passed".
 */
export function assertNonEmptyManifest(definition) {
  const redCount = (definition.required_red || []).length;
  const greenCount = (definition.required_green || []).length;
  if (redCount === 0 || greenCount === 0) {
    return {
      ok: false,
      stop: STOP.EMPTY_PROOF_MANIFEST,
      reason: `unit definition declares ${redCount} required_red and ${greenCount} required_green entries -- refusing to report a local dry-run PASS with zero checks actually executed`,
    };
  }
  return { ok: true };
}

/**
 * W1-VERIFY-DB finding (2026-09-30): any nonzero `git merge` exit was uniformly reported as
 * STOP_MERGE_CONFLICT, even for an unrelated failure (locked ref, I/O error, unusual repo state).
 * Distinguish a real conflict (git's own unambiguous markers) from anything else.
 */
export function classifyMergeFailure(stderr) {
  const text = String(stderr || '');
  if (/CONFLICT|Automatic merge failed/i.test(text)) {
    return {
      stop: STOP.MERGE_CONFLICT,
      reason: 'git merge --no-edit produced conflicts; merge aborted, nothing pushed',
    };
  }
  return {
    stop: STOP.MERGE_FAILED,
    reason: `git merge --no-edit failed for a reason other than a content conflict; merge aborted, nothing pushed -- stderr: ${text.slice(0, 500)}`,
  };
}

// ---------------------------------------------------------------------------------------------
// I/O helpers (git/gh). Thin and literal -- bounded timeouts, bounded retries on the one
// identified transient-failure-prone call, fail closed on anything unexpected.
// ---------------------------------------------------------------------------------------------

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withRetry(fn, { attempts = 3, baseDelayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) sleepSync(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: DEFAULT_TIMEOUT_MS, ...opts });
  if (result.error) throw result.error;
  if (result.signal && result.status === null) {
    throw new Error(`${cmd} ${args.join(' ')} was killed by signal ${result.signal} (likely timed out)`);
  }
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}\n${result.stderr}`);
  }
  return result.stdout;
}

function runAllowFail(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: DEFAULT_TIMEOUT_MS, ...opts });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function git(worktree, args) {
  return run('git', ['-C', worktree, ...args]).trim();
}

function resolveRepoSlug(worktree, explicitRepo) {
  if (explicitRepo) return explicitRepo;
  const url = git(worktree, ['remote', 'get-url', 'origin']);
  const match = url.match(/[:/]([^/:]+\/[^/.]+?)(?:\.git)?$/);
  if (!match) throw new Error(`could not derive owner/repo from origin remote URL: ${url}`);
  return match[1];
}

function ghApiJson(args) {
  const stdout = run('gh', ['api', ...args]);
  return JSON.parse(stdout);
}

/**
 * W1-VERIFY-DB finding (2026-09-30): the combined-status endpoint (/commits/{sha}/status) was
 * verified live to return only its first page of statuses, with no pagination handling in this
 * script. Use the array-shaped, genuinely paginatable list endpoint instead
 * (/commits/{sha}/statuses), with --paginate and an explicit per_page, and defensively parse
 * either output shape gh's --paginate might produce for an array response.
 */
function listCommitStatuses(repo, sha) {
  // --method GET is required and NOT the default here: gh api switches to POST by default the
  // moment any -f/-F flag is present, which would hit this endpoint's CREATE-a-status handler
  // instead of LIST -- verified live (2026-09-30): omitting --method GET produced a 422
  // "State is not included in the list" error from the create-status validator.
  const stdout = run('gh', [
    'api',
    '--method',
    'GET',
    '--paginate',
    '-f',
    'per_page=100',
    `repos/${repo}/commits/${sha}/statuses`,
  ]);
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const parsed = JSON.parse(line);
        return Array.isArray(parsed) ? parsed : [parsed];
      });
  }
}

function readFileAtRef(worktree, ref, path) {
  return Buffer.from(run('git', ['-C', worktree, 'show', `${ref}:${path}`], { encoding: null }));
}

/**
 * Step 2: detect staleness via the same check this project's sessions already run by hand.
 */
function detectStaleness(repo, prNumber) {
  const view = ghApiJson([`repos/${repo}/pulls/${prNumber}`]);
  return {
    mergeStateStatus: view.mergeable_state ? String(view.mergeable_state).toUpperCase() : undefined,
    mergeable: view.mergeable === true ? 'MERGEABLE' : view.mergeable === false ? 'CONFLICTING' : 'UNKNOWN',
    headRefOid: view.head.sha,
    headRefName: view.head.ref,
    baseRefName: view.base.ref,
  };
}

/**
 * Step 2 (continued): "locates the prior-approved DEV-GOV run for the current tip" -- walk the
 * branch's own history from its current tip backwards (never onto main, never past the merge-base
 * with the OLD base, since this design explicitly never chooses which historical proof is
 * "equivalent" across an unrelated line of history) and return the first commit whose GitHub
 * commit status includes a SUCCESS "DEV-GOV-V0 / trusted-execution" context. If the tip itself is
 * green, that's returned immediately (no extra commits landed since approval). Bounded to
 * MAX_COMMITS_TO_WALK commits and retries each transient-failure-prone gh api call with backoff.
 */
function locatePriorApprovedSha(worktree, repo, headSha, oldBaseSha) {
  const mergeBase = git(worktree, ['merge-base', headSha, oldBaseSha]);
  const revList = git(worktree, ['rev-list', `${mergeBase}..${headSha}`]).split('\n').filter(Boolean);
  const candidates = [headSha, ...revList.filter((sha) => sha !== headSha)];
  if (candidates.length > MAX_COMMITS_TO_WALK) {
    const error = new Error(
      `${candidates.length} commits between the old base_sha and the branch tip, over the ${MAX_COMMITS_TO_WALK}-commit walk cap -- refusing to make that many sequential gh api calls`,
    );
    error.code = 'TOO_MANY_COMMITS_TO_WALK';
    throw error;
  }
  for (const sha of candidates) {
    const statuses = withRetry(() => listCommitStatuses(repo, sha));
    const hit = statuses.find(
      (entry) => entry.context === 'DEV-GOV-V0 / trusted-execution' && entry.state === 'success',
    );
    if (hit) return sha;
  }
  return null;
}

function tmpWorktreeAt(sourceWorktree, ref) {
  const dir = mkdtempSync(join(tmpdir(), 'devgov-rebase-reverify-base-'));
  git(sourceWorktree, ['worktree', 'add', '--detach', dir, ref]);
  return dir;
}

function removeTmpWorktree(sourceWorktree, dir) {
  runAllowFail('git', ['-C', sourceWorktree, 'worktree', 'remove', '--force', dir]);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup only
  }
}

function runManifestEntries(definitionPath, candidateSha, definitionWorktree, executionWorktree, entries, verb) {
  const results = [];
  for (const entry of entries) {
    const stdout = run(
      'node',
      [
        'scripts/devgov/devgov.mjs',
        verb,
        '--definition',
        definitionPath,
        '--candidate-sha',
        candidateSha,
        '--worktree',
        definitionWorktree,
        '--execution-worktree',
        executionWorktree,
        '--id',
        entry.id,
      ],
      { timeout: DEVGOV_INVOCATION_TIMEOUT_MS },
    );
    results.push({ id: entry.id, ...JSON.parse(stdout) });
  }
  return results;
}

// ---------------------------------------------------------------------------------------------
// CLI entrypoint -- orchestrates the I/O helpers around the pure decision functions above, in
// the exact order §1/§4 require.
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { push: false, dispatch: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pr') out.pr = argv[++i];
    else if (arg === '--definition') out.definition = argv[++i];
    else if (arg === '--worktree') out.worktree = argv[++i];
    else if (arg === '--repo') out.repo = argv[++i];
    else if (arg === '--base-worktree') out.baseWorktree = argv[++i];
    else if (arg === '--push') out.push = true;
    else if (arg === '--dispatch') out.dispatch = true;
  }
  if (!out.pr || !out.definition || !out.worktree) {
    throw new Error(
      'usage: node scripts/dev-helpers/automated-rebase-reverify.mjs --pr <number> --definition <path> --worktree <path> [--repo <owner/repo>] [--base-worktree <path>] [--push] [--dispatch]',
    );
  }
  if (!/^[1-9][0-9]*$/.test(out.pr)) {
    throw new Error(`--pr must be a positive integer, got ${JSON.stringify(out.pr)}`);
  }
  if (out.dispatch && !out.push) {
    throw new Error('--dispatch requires --push (cannot dispatch CI against a candidate that was never pushed)');
  }
  return out;
}

function stopResult(stop, reason, extra = {}) {
  return { result: 'STOP', stop, reason, ...extra };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const worktree = resolvePath(opts.worktree);
  const repo = resolveRepoSlug(worktree, opts.repo);

  // Step 2: detect staleness.
  const view = detectStaleness(repo, opts.pr);
  const scope = classifyStaleness(view);
  if (!scope.inScope) {
    console.log(JSON.stringify(stopResult(scope.stop, scope.reason, { pr: opts.pr }), null, 2));
    process.exit(1);
  }

  if (git(worktree, ['rev-parse', 'HEAD']) !== view.headRefOid) {
    throw new Error(
      `--worktree HEAD (${git(worktree, ['rev-parse', 'HEAD'])}) does not match PR head (${view.headRefOid}) -- check out the PR branch fresh before invoking this script`,
    );
  }
  if (git(worktree, ['status', '--porcelain']) !== '') {
    throw new Error('--worktree has uncommitted changes -- refuse to run against a dirty checkout');
  }

  const currentTipBytes = readFileAtRef(worktree, view.headRefOid, opts.definition);
  const currentDefinition = JSON.parse(currentTipBytes.toString('utf8'));
  const oldBaseSha = currentDefinition.base_sha;

  // Step 2 (continued): locate the prior-approved candidate SHA.
  let priorApprovedSha;
  try {
    priorApprovedSha = locatePriorApprovedSha(worktree, repo, view.headRefOid, oldBaseSha);
  } catch (error) {
    if (error.code === 'TOO_MANY_COMMITS_TO_WALK') {
      console.log(JSON.stringify(stopResult(STOP.TOO_MANY_COMMITS_TO_WALK, error.message, { pr: opts.pr }), null, 2));
      process.exit(1);
    }
    throw error;
  }
  if (!priorApprovedSha) {
    console.log(
      JSON.stringify(
        stopResult(STOP.NO_PRIOR_PROOF, 'no commit on this branch (back to the old base_sha) carries a green DEV-GOV-V0 / trusted-execution status', {
          pr: opts.pr,
        }),
        null,
        2,
      ),
    );
    process.exit(1);
  }

  // Step 3 / Phase 1.
  const priorApprovedBytes = readFileAtRef(worktree, priorApprovedSha, opts.definition);
  const phase1 = phase1VerifyOriginalIdentity(currentTipBytes, priorApprovedBytes);
  if (!phase1.ok) {
    console.log(JSON.stringify(stopResult(phase1.stop, phase1.reason, { pr: opts.pr, priorApprovedSha }), null, 2));
    process.exit(1);
  }

  // Step 4: merge current base into the branch. git merge, never rebase, never squash -- matches
  // the PR #203/#204 manual precedent (commit ef1109e5).
  git(worktree, ['fetch', 'origin', view.baseRefName]);
  const newBaseSha = git(worktree, ['rev-parse', `origin/${view.baseRefName}`]);
  const mergeResult = runAllowFail('git', ['-C', worktree, 'merge', '--no-edit', `origin/${view.baseRefName}`]);
  if (mergeResult.status !== 0) {
    runAllowFail('git', ['-C', worktree, 'merge', '--abort']);
    // git merge writes its CONFLICT / "Automatic merge failed" lines to STDOUT, not stderr
    // (verified live 2026-09-30) -- classify on both streams or every real conflict is misfiled.
    const classification = classifyMergeFailure(`${mergeResult.stdout}\n${mergeResult.stderr}`);
    console.log(
      JSON.stringify(stopResult(classification.stop, classification.reason, { pr: opts.pr, newBaseSha }), null, 2),
    );
    process.exit(1);
  }

  // Step 5: bump base_sha (the one permitted edit), then Phase 2.
  const postMergeDefinition = JSON.parse(readFileAtRef(worktree, 'HEAD', opts.definition).toString('utf8'));
  postMergeDefinition.base_sha = newBaseSha;
  writeFileSync(join(worktree, opts.definition), `${JSON.stringify(postMergeDefinition, null, 2)}\n`);
  const postEditBytes = readFileSync(join(worktree, opts.definition));
  const phase2 = phase2VerifyOwnEdit(currentTipBytes, postEditBytes, newBaseSha);
  if (!phase2.ok) {
    console.log(JSON.stringify(stopResult(phase2.stop, phase2.reason, { pr: opts.pr, newBaseSha }), null, 2));
    process.exit(1);
  }

  const manifestCheck = assertNonEmptyManifest(postMergeDefinition);
  if (!manifestCheck.ok) {
    console.log(
      JSON.stringify(stopResult(manifestCheck.stop, manifestCheck.reason, { pr: opts.pr, newBaseSha }), null, 2),
    );
    process.exit(1);
  }

  git(worktree, ['add', opts.definition]);
  git(worktree, [
    'commit',
    '-m',
    `chore(rebase-reverify): base-bump to ${view.baseRefName}@${newBaseSha.slice(0, 8)}, no logic change\n\nAUTOMATED-REBASE-REVERIFY-01, Phase 1 + Phase 2 both verified locally before this commit.`,
  ]);
  const newCandidateSha = git(worktree, ['rev-parse', 'HEAD']);

  // Step 5 (continued): local RED/GREEN dry-run -- pre-check only, not the authoritative signed
  // proof (that happens in CI via devgov-v0-rebase-reverify.yml once dispatched).
  const baseWorktree = opts.baseWorktree ? resolvePath(opts.baseWorktree) : tmpWorktreeAt(worktree, newBaseSha);
  let redResults = [];
  let greenResults = [];
  try {
    redResults = runManifestEntries(
      opts.definition,
      newCandidateSha,
      worktree,
      baseWorktree,
      postMergeDefinition.required_red || [],
      'run-red',
    );
    greenResults = runManifestEntries(
      opts.definition,
      newCandidateSha,
      worktree,
      worktree,
      postMergeDefinition.required_green || [],
      'run-green',
    );
  } finally {
    if (!opts.baseWorktree) removeTmpWorktree(worktree, baseWorktree);
  }

  const redAllExpectedFail = redResults.every((r) => {
    const spec = (postMergeDefinition.required_red || []).find((s) => s.id === r.id);
    return r.evidence?.classification === (spec?.expected_classification || 'FAIL');
  });
  const greenAllPassed = greenResults.every((r) => r.evidence?.classification === 'PASS');
  if (!redAllExpectedFail || !greenAllPassed) {
    console.log(
      JSON.stringify(
        stopResult(
          STOP.CANDIDATE_FAILURE,
          'local RED/GREEN dry-run deviated after the rebase -- real candidate failure, not friction. Left un-pushed; surface for a new cold-review round.',
          { pr: opts.pr, newCandidateSha, redResults, greenResults },
        ),
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const summary = {
    result: 'READY',
    pr: opts.pr,
    repo,
    oldCandidateSha: priorApprovedSha,
    oldBaseSha,
    newBaseSha,
    newCandidateSha,
    unitDefinitionPath: opts.definition,
    localRedGreenDryRun: 'PASS',
    pushed: false,
    dispatched: false,
  };

  if (opts.push) {
    git(worktree, ['push', 'origin', `HEAD:${view.headRefName}`]);
    summary.pushed = true;
  }

  if (opts.dispatch) {
    run('gh', [
      'api',
      '--method',
      'POST',
      `repos/${repo}/dispatches`,
      '-f',
      'event_type=devgov-v0-rebase-reverify',
      '-F',
      `client_payload[candidate_sha]=${newCandidateSha}`,
      '-F',
      `client_payload[unit_definition_path]=${opts.definition}`,
      '-F',
      `client_payload[pr_number]=${opts.pr}`,
      '-F',
      `client_payload[old_candidate_sha]=${priorApprovedSha}`,
      '-F',
      `client_payload[old_base_sha]=${oldBaseSha}`,
      '-F',
      `client_payload[pre_merge_tip_sha]=${view.headRefOid}`,
    ]);
    summary.dispatched = true;
  }

  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ result: 'ERROR', message: error.message }, null, 2));
    process.exit(2);
  });
}
