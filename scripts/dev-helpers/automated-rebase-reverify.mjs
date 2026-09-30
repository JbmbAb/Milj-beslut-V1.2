#!/usr/bin/env node
// AUTOMATED-REBASE-REVERIFY-01 -- steps 1-5 of §1 in
// Claude outputs/merge-queue-automation-2026-09-30/AUTOMATED-REBASE-REVERIFY-DESIGN-2026-09-30.md
// (design COLD_VERIFIED/ACCEPT for §1-4, 2026-09-30; this implementation is its own, separately
// unverified candidate -- see feedback-design-verdict-does-not-inherit-to-implementation memory).
//
// Two W1-VERIFY-DB rounds have reviewed this file (2026-09-30). The repairs from both are recorded
// in docs/architecture/audits/AUTOMATED-REBASE-REVERIFY-01-V1.md section 7; the decision logic they
// touched lives in the exported pure functions below so each fix has an executed proof.
//
// On-demand only (§1.1) -- invoked explicitly per PR, never on a schedule. For one specific PR
// that is BEHIND its base but otherwise mergeable, with a prior successful DEV-GOV run recorded
// somewhere on its branch history:
//   1. detects staleness (GitHub REST pulls/N: mergeable_state + mergeable)
//   2. locates the prior-approved candidate SHA (most recent commit on the branch whose NEWEST
//      "DEV-GOV-V0 / trusted-execution" commit status is success)
//   3. Phase 1: verifies the branch's current-tip unit definition is byte-identical to the
//      prior-approved candidate's unit definition -- full identity, zero exceptions (§1.3)
//   4. merges the current base into the branch (git merge --no-ff --no-edit: never rebase, never
//      squash; --no-ff only pins the commit SHAPE the CI lineage check expects)
//   5. bumps base_sha (the one permitted edit, as a one-line text substitution so no other byte of
//      the file can change) and runs Phase 2: the resulting bytes must equal the Phase-1 snapshot
//      with only that base_sha value substituted (§1.3)
//   6. runs the same lineage check CI will run, then locally dry-runs the unit's declared RED/GREEN
//      commands via the real controller (scripts/devgov/devgov.mjs run-red/run-green) as a fast
//      pre-check -- NOT the authoritative, signed proof; that only happens in CI
//      (devgov-v0-rebase-reverify.yml's execute jobs)
//
// It never signs anything, never dispatches devgov-v0-gate.yml, and never touches the
// devgov-attestation environment itself. If every local check passes, it can optionally push the
// merge+base_sha-bump commit and dispatch devgov-v0-rebase-reverify.yml (§4), which performs the
// design's step 6 (RED/GREEN re-run + sign, in CI, environment-gated) and step 7 (stop, post
// evidence comment). Any deviation at any step is a STOP -- never a retry, never a force-merge,
// never a silent fallback. A STOP that happens AFTER the merge leaves the worktree mutated; the
// STOP result says so and prints the restore command (it is never run automatically).
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
  DRY_RUN_INCONCLUSIVE: 'STOP_DRY_RUN_INCONCLUSIVE',
});

export const DEVGOV_STATUS_CONTEXT = 'DEV-GOV-V0 / trusted-execution';

const MAX_COMMITS_TO_WALK = 200;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_PROOF_TIMEOUT_MS = 120_000; // devgov.mjs's own default when an entry declares no timeout_ms
const PROOF_TIMEOUT_SLACK_MS = 30_000;
const SHA_RE = /^[0-9a-f]{40}$/;

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

const TOP_LEVEL_BASE_SHA_LINE = /^(  "base_sha": ")([0-9a-f]{40})(")/gm;

/**
 * The automation's one permitted edit, done as a single-line text substitution rather than a
 * parse-and-restringify, so no other byte of the file can change (11 of 59 real unit files do not
 * round-trip byte-identically through JSON.stringify -- W1-VERIFY-DB delta finding). Fails closed
 * unless exactly one top-level (2-space-indented) base_sha line exists.
 */
export function bumpBaseShaInText(text, newBaseSha) {
  if (!SHA_RE.test(String(newBaseSha))) {
    return { ok: false, stop: STOP.NEW_REVIEW_REQUIRED, reason: 'new base_sha is not a 40-hex SHA' };
  }
  const count = [...String(text).matchAll(TOP_LEVEL_BASE_SHA_LINE)].length;
  if (count !== 1) {
    return {
      ok: false,
      stop: STOP.NEW_REVIEW_REQUIRED,
      reason: `expected exactly one top-level "base_sha" line (2-space indent), found ${count}`,
    };
  }
  return { ok: true, text: String(text).replace(TOP_LEVEL_BASE_SHA_LINE, `$1${newBaseSha}$3`) };
}

/**
 * Phase 2 (post-merge, post-mutation): diff the resulting file (after the automation's own single
 * permitted base_sha edit) against the Phase-1 snapshot (the SAME bytes phase1VerifyOriginalIdentity
 * was given as currentTipBytes) -- never against the original approval a second time. Three
 * independent conditions must all hold: the parsed changed-key set is exactly {"base_sha"}; the new
 * value is the expected one; and the post-edit BYTES equal the snapshot with only that one value
 * substituted (so a pure reformat, or a merge that re-serialised the file, is also caught).
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
  const expectedBump = bumpBaseShaInText(Buffer.from(phase1SnapshotBytes).toString('utf8'), expectedNewBaseSha);
  if (!expectedBump.ok) return expectedBump;
  if (Buffer.compare(Buffer.from(expectedBump.text, 'utf8'), Buffer.from(postEditBytes)) !== 0) {
    return {
      ok: false,
      stop: STOP.NEW_REVIEW_REQUIRED,
      reason: 'post-edit bytes differ from the Phase-1 snapshot by more than the single base_sha value (reformat or re-serialisation)',
    };
  }
  return { ok: true };
}

/**
 * §1 scope gate: only a PR that is BEHIND its base but still mergeable is in scope. Anything else
 * is not this design's problem to solve (e.g. CONFLICTING needs a real human rebase).
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
 * The local dry-run's pass check must never be vacuously true on an empty manifest
 * ([].every(...) === true): "no proof was run" must not look like "proof passed".
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
 * Distinguish a real merge conflict (git's own unambiguous markers: a line starting "CONFLICT (" or
 * the "Automatic merge failed" line -- both written to STDOUT, not stderr) from any other git
 * failure. Anchored so a dirty-tree refusal that merely names a file containing the word "conflict"
 * is not misfiled as a content conflict.
 */
export function classifyMergeFailure(output) {
  const text = String(output || '');
  if (/^CONFLICT \(/m.test(text) || /Automatic merge failed/.test(text)) {
    return {
      stop: STOP.MERGE_CONFLICT,
      reason: 'git merge --no-ff --no-edit produced conflicts; nothing pushed',
    };
  }
  return {
    stop: STOP.MERGE_FAILED,
    reason: `git merge --no-ff --no-edit failed for a reason other than a content conflict; nothing pushed -- output: ${text.slice(0, 500)}`,
  };
}

function statusNewer(a, b) {
  const ta = Date.parse(a.created_at ?? '') || 0;
  const tb = Date.parse(b.created_at ?? '') || 0;
  if (ta !== tb) return ta > tb;
  return Number(a.id ?? 0) > Number(b.id ?? 0);
}

/**
 * State of the NEWEST DEV-GOV-V0 / trusted-execution status in a commit-status list, or null if the
 * commit has none. The list endpoint returns every historical status (live example: success,
 * pending, failure, pending), so what matters is the newest one, never the mere existence of a
 * success. Statuses for other contexts (e.g. a sibling DEV-GOV-V0 / invariant-packs) are ignored.
 */
export function newestDevGovState(statuses) {
  const mine = (Array.isArray(statuses) ? statuses : []).filter((s) => s && s.context === DEVGOV_STATUS_CONTEXT);
  if (mine.length === 0) return null;
  return mine.reduce((best, s) => (statusNewer(s, best) ? s : best)).state;
}

export function hasCurrentGreenDevGovStatus(statuses) {
  return newestDevGovState(statuses) === 'success';
}

/**
 * owner/repo from a git remote URL. The repo name may itself contain dots (this project's is
 * "Milj-beslut-V1.2"); only a trailing ".git" is stripped. Returns null for anything unrecognised
 * (e.g. a local path), in which case the caller must require --repo.
 */
export function parseRepoSlug(url) {
  const m = String(url)
    .trim()
    .match(/^(?:https?:\/\/[^/\s]+\/|ssh:\/\/[^/\s]+\/|[^@\s/]+@[^:\s/]+:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * The controller exits 2 for a correctly observed FAIL (EXIT_CODE.FAIL), 3/4/5 for blocked/denied/
 * internal -- all with a JSON envelope on stdout. A RED that correctly fails therefore exits
 * non-zero; treating any non-zero exit as a crash (as the first repair did) made every unit's local
 * dry-run abort on its first RED. Read the classification from the envelope instead; only a missing
 * or malformed envelope is a harness error.
 */
export function parseControllerRun(result, id) {
  if (result.error) throw new Error(`controller invocation for ${id} did not run: ${result.error.message}`);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `controller output for ${id} is not JSON (exit ${result.status}): ${String(result.stderr || '').slice(0, 500)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.evidence || typeof parsed.evidence.classification !== 'string') {
    throw new Error(`controller output for ${id} has no evidence.classification (exit ${result.status})`);
  }
  return { id, exitCode: result.status, ...parsed };
}

/**
 * Judge the local RED/GREEN dry-run against the unit's own declared expectations. Every declared
 * entry must have a result; RED must show its expected_classification (default FAIL), GREEN must
 * PASS; an empty list on either side is a failure, not a pass.
 */
export function evaluateDryRun(definition, redResults, greenResults) {
  const empty = assertNonEmptyManifest(definition);
  if (!empty.ok) return empty;
  const mismatches = [];
  const inconclusive = [];
  const check = (specs, results, expectedFor, kind) => {
    const byId = new Map((results || []).map((r) => [r.id, r]));
    for (const spec of specs) {
      const r = byId.get(spec.id);
      if (!r) {
        mismatches.push(`${kind} ${spec.id}: no result`);
        continue;
      }
      const expected = expectedFor(spec);
      const actual = r.evidence?.classification;
      if (actual === expected) continue;
      const line = `${kind} ${spec.id}: expected ${expected}, observed ${actual}`;
      // BLOCKED_ENVIRONMENT / DENIED_GOVERNANCE mean the check could not run (missing tool, wrong
      // --base-worktree HEAD, ...): an environment/invocation problem, not a verdict on the candidate.
      if (actual === 'BLOCKED_ENVIRONMENT' || actual === 'DENIED_GOVERNANCE') inconclusive.push(line);
      else mismatches.push(line);
    }
  };
  check(definition.required_red, redResults, (s) => s.expected_classification || 'FAIL', 'RED');
  check(definition.required_green, greenResults, () => 'PASS', 'GREEN');
  if (mismatches.length > 0) {
    return {
      ok: false,
      stop: STOP.CANDIDATE_FAILURE,
      reason: `local RED/GREEN dry-run deviated after the rebase -- a real candidate failure, not friction: ${[...mismatches, ...inconclusive].join('; ')}`,
      mismatches: [...mismatches, ...inconclusive],
    };
  }
  if (inconclusive.length > 0) {
    return {
      ok: false,
      stop: STOP.DRY_RUN_INCONCLUSIVE,
      reason: `local RED/GREEN dry-run could not run (blocked/denied) -- an environment or invocation problem, not a verdict on the candidate: ${inconclusive.join('; ')}`,
      mismatches: inconclusive,
    };
  }
  return { ok: true };
}

/**
 * Independent re-derivation of everything the dispatch payload asserts, from real git objects.
 * Used twice with the same code: locally by main() as a preflight, and in CI by the workflow's
 * reverify-phases job (loaded from the protected controller checkout -- the candidate is only ever
 * data, read through candidate.out/ok). Fail-closed: any exception or unexpected shape is a
 * rejection.
 *
 *   candidate.out(args) -> git stdout (string|Buffer) for `git -C <candidate repo> <args>`
 *   candidate.ok(args)  -> boolean, git exit status 0
 *   controller.ok(args) -> boolean, same for the protected main-history repo
 *   statuses            -> commit statuses of payload.oldCandidateSha (fetched by the caller)
 *   payload.controllerRef -> the ref in the controller repo that must contain the new base
 *
 * It verifies: safe plain-file unit path; regular-file mode at all three refs (a symlink would
 * let plan:/sign: read different content than was verified); old approval is ancestor-or-self of
 * the pre-merge tip, has the SAME TREE as it, AND its newest DEV-GOV status is success; Phase 1;
 * payload old_base_sha equals the pre-merge file's own base_sha; Phase 2 (incl. byte-level); the
 * candidate is exactly [merge commit of (pre-merge tip, new base) whose tree is the clean merge] +
 * [one commit touching only the unit file]; the new base is a strict descendant of the old base and
 * lies in the controller's main history (checked with controller.ok, a separate repo in CI).
 */
export function reverifyLineage({ payload, candidate, controller, statuses }) {
  const fail = (reason) => ({ ok: false, stop: STOP.NEW_REVIEW_REQUIRED, reason });
  try {
    const { candidateSha, oldCandidateSha, preMergeTipSha, oldBaseSha, unitPath, controllerRef } = payload;
    for (const [name, value] of Object.entries({ candidateSha, oldCandidateSha, preMergeTipSha, oldBaseSha })) {
      if (!SHA_RE.test(String(value))) return fail(`${name} is not a 40-hex SHA`);
    }
    const segments = String(unitPath).split('/');
    if (
      !/^[A-Za-z0-9._/-]+$/.test(String(unitPath)) ||
      String(unitPath).startsWith('/') ||
      segments.some((s) => s === '' || s === '.' || s === '..')
    ) {
      return fail('unit definition path is not a plain repo-relative path');
    }

    for (const ref of [preMergeTipSha, oldCandidateSha, candidateSha]) {
      const line = String(candidate.out(['ls-tree', ref, '--', unitPath])).trim();
      if (!/^100644 blob [0-9a-f]{40}\t/.test(line)) {
        return fail(`unit definition at ${ref} is not a regular file (ls-tree: ${JSON.stringify(line)})`);
      }
    }

    if (!candidate.ok(['merge-base', '--is-ancestor', oldCandidateSha, preMergeTipSha])) {
      return fail('old_candidate_sha is not an ancestor of the pre-merge tip');
    }
    // The approval must cover the tip's ENTIRE content, not just the unit file: design §1 is "a prior
    // successful run recorded for its current tip". Comparing only the unit definition let code
    // committed after the approval ride along under "proof-preserving".
    const treeOf = (ref) => String(candidate.out(['rev-parse', `${ref}^{tree}`])).trim();
    if (!SHA_RE.test(treeOf(oldCandidateSha)) || treeOf(oldCandidateSha) !== treeOf(preMergeTipSha)) {
      return fail('the approved commit\'s tree differs from the pre-merge tip\'s tree -- content changed after approval');
    }
    if (!hasCurrentGreenDevGovStatus(statuses)) {
      return fail(`old_candidate_sha has no current green "${DEVGOV_STATUS_CONTEXT}" status -- it was never approved`);
    }

    const show = (ref) => Buffer.from(candidate.out(['show', `${ref}:${unitPath}`]));
    const currentTipBytes = show(preMergeTipSha);
    const priorApprovedBytes = show(oldCandidateSha);
    const postEditBytes = show(candidateSha);

    const phase1 = phase1VerifyOriginalIdentity(currentTipBytes, priorApprovedBytes);
    if (!phase1.ok) return phase1;

    const preBase = JSON.parse(currentTipBytes.toString('utf8')).base_sha;
    if (preBase !== oldBaseSha) return fail('payload old_base_sha does not equal the pre-merge unit definition\'s own base_sha');
    const newBase = JSON.parse(postEditBytes.toString('utf8')).base_sha;
    if (!SHA_RE.test(String(newBase))) return fail('new base_sha is not a 40-hex SHA');

    const phase2 = phase2VerifyOwnEdit(currentTipBytes, postEditBytes, newBase);
    if (!phase2.ok) return phase2;

    const parentsOf = (sha) => String(candidate.out(['rev-list', '--parents', '-n', '1', sha])).trim().split(/\s+/).slice(1);
    const candidateParents = parentsOf(candidateSha);
    if (candidateParents.length !== 1) return fail('candidate must be a single-parent bump commit on top of the merge commit');
    const mergeCommit = candidateParents[0];
    const mergeParents = parentsOf(mergeCommit);
    if (mergeParents.length !== 2 || mergeParents[0] !== preMergeTipSha || mergeParents[1] !== newBase) {
      return fail('the commit under the bump must be a merge of exactly [pre-merge tip, new base_sha]');
    }
    // The merge commit's TREE must be exactly the clean merge of its two parents. Without this an
    // "evil merge" (an extra workflow file, a tampered main file, all of main discarded) passes every
    // other check while the comment still says "mechanical stale-base refresh only". merge-tree exits
    // non-zero on conflicts, which candidate.out turns into a rejection via the catch below.
    const cleanMergeTree = String(candidate.out(['merge-tree', '--write-tree', preMergeTipSha, newBase])).split('\n')[0].trim();
    if (!SHA_RE.test(cleanMergeTree) || cleanMergeTree !== treeOf(mergeCommit)) {
      return fail('the merge commit\'s tree is not the clean merge of [pre-merge tip, new base_sha] (evil merge)');
    }
    const changed = String(candidate.out(['diff', '--name-only', mergeCommit, candidateSha])).trim().split('\n').filter(Boolean);
    if (changed.length !== 1 || changed[0] !== unitPath) {
      return fail(`the bump commit must change only ${unitPath}, changed: ${JSON.stringify(changed)}`);
    }

    if (newBase === oldBaseSha) return fail('new base_sha equals the old base_sha -- not a base bump');
    if (!controller.ok(['merge-base', '--is-ancestor', oldBaseSha, newBase])) {
      return fail('new base_sha is not a strict descendant of the old base_sha');
    }
    if (!controller.ok(['merge-base', '--is-ancestor', newBase, controllerRef])) {
      return fail('new base_sha is not in the protected controller main history');
    }
    return { ok: true, phase1: 'PASS', phase2: 'PASS', lineage: 'PASS' };
  } catch (error) {
    return fail(`lineage re-verification raised: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// I/O helpers (git/gh). Thin and literal -- bounded timeouts, bounded retries on the one
// identified transient-failure-prone call, fail closed on anything unexpected. NOTE: on Windows a
// timeout kills the direct child only; git may leave grandchildren behind (observed in review).
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

// Never throws. A spawn error (e.g. ETIMEDOUT) is surfaced both as .error and appended to stderr so
// a timed-out command is not silently indistinguishable from an ordinary failure.
function runAllowFail(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: DEFAULT_TIMEOUT_MS, ...opts });
  const errorText = result.error ? `\n[spawn error: ${result.error.message}]` : '';
  return { status: result.status, stdout: result.stdout || '', stderr: `${result.stderr || ''}${errorText}`, error: result.error };
}

function git(worktree, args) {
  return run('git', ['-C', worktree, ...args]).trim();
}

function resolveRepoSlug(worktree, explicitRepo) {
  if (explicitRepo) return explicitRepo;
  const url = git(worktree, ['remote', 'get-url', 'origin']);
  const slug = parseRepoSlug(url);
  if (!slug) throw new Error(`could not derive owner/repo from origin remote URL: ${url} (pass --repo)`);
  return slug;
}

function ghApiJson(args) {
  const stdout = run('gh', ['api', ...args]);
  return JSON.parse(stdout);
}

/**
 * The array-shaped, genuinely paginatable list endpoint (/commits/{sha}/statuses), not the combined
 * /status endpoint (verified live to return only its first page). --method GET is required and NOT
 * the default: gh api switches to POST the moment any -f/-F flag is present, which would hit the
 * CREATE-a-status handler (verified live: 422 "State is not included in the list"). --jq '.[]'
 * makes gh emit one compact JSON object per line across all pages, which is stable across gh
 * versions (older gh concatenated per-page arrays, newer merges them).
 */
function listCommitStatuses(repo, sha) {
  const stdout = run('gh', [
    'api',
    '--method',
    'GET',
    '--paginate',
    '--jq',
    '.[]',
    '-f',
    'per_page=100',
    `repos/${repo}/commits/${sha}/statuses`,
  ]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readFileAtRef(worktree, ref, path) {
  return Buffer.from(run('git', ['-C', worktree, 'show', `${ref}:${path}`], { encoding: null }));
}

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
 * Step 2 (continued): the approval must be for the tip's CONTENT (design §1: "a prior successful run
 * recorded for its current tip"). Walk the branch's own history from the tip backwards (never onto
 * main, never past the merge-base with the OLD base) but consider ONLY commits whose tree equals the
 * tip's tree (the tip itself, or an earlier commit with identical content). The first such commit
 * that has any DEV-GOV-V0 / trusted-execution status decides: approved iff its NEWEST status is
 * success -- so a newer failure on identical content is not overridden by an older success, and an
 * older green commit with DIFFERENT content can never approve the tip. The tip is checked first, so
 * a green tip is found on a branch of any length; only the walk beyond it is capped at
 * MAX_COMMITS_TO_WALK status lookups. Each lookup retries with backoff.
 */
function locatePriorApprovedSha(worktree, repo, headSha, oldBaseSha) {
  const newestState = (sha) => newestDevGovState(withRetry(() => listCommitStatuses(repo, sha)));
  const tipState = newestState(headSha);
  if (tipState !== null) return tipState === 'success' ? headSha : null;
  const tipTree = git(worktree, ['rev-parse', `${headSha}^{tree}`]);
  const mergeBase = git(worktree, ['merge-base', headSha, oldBaseSha]);
  const sameContent = git(worktree, ['log', '--format=%H %T', `${mergeBase}..${headSha}`])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '))
    .filter(([sha, tree]) => sha !== headSha && tree === tipTree)
    .map(([sha]) => sha);
  if (sameContent.length > MAX_COMMITS_TO_WALK) {
    const error = new Error(
      `${sameContent.length} earlier commits with the tip's exact content and no status on the tip, over the ${MAX_COMMITS_TO_WALK}-lookup walk cap -- refusing to make that many sequential gh api calls`,
    );
    error.code = 'TOO_MANY_COMMITS_TO_WALK';
    throw error;
  }
  for (const sha of sameContent) {
    const state = newestState(sha);
    if (state !== null) return state === 'success' ? sha : null;
  }
  return null;
}

function tmpWorktreeAt(sourceWorktree, ref) {
  const dir = mkdtempSync(join(tmpdir(), 'devgov-rebase-reverify-base-'));
  try {
    git(sourceWorktree, ['worktree', 'add', '--detach', dir, ref]);
  } catch (error) {
    removeTmpWorktree(sourceWorktree, dir);
    throw error;
  }
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
    // Honour the entry's own timeout_ms (28 of 59 real units declare one above the old fixed 150s
    // wrapper) plus slack, so the outer wrapper can never kill a legitimately long proof.
    const proofTimeout = Number.isInteger(entry.timeout_ms) ? entry.timeout_ms : DEFAULT_PROOF_TIMEOUT_MS;
    const result = runAllowFail(
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
      { cwd: definitionWorktree, timeout: proofTimeout + PROOF_TIMEOUT_SLACK_MS },
    );
    results.push(parseControllerRun(result, entry.id));
  }
  return results;
}

// ---------------------------------------------------------------------------------------------
// CLI entrypoint -- orchestrates the I/O helpers around the pure decision functions above, in
// the exact order §1/§4 require.
// ---------------------------------------------------------------------------------------------

const VALUE_FLAGS = { '--pr': 'pr', '--definition': 'definition', '--worktree': 'worktree', '--repo': 'repo', '--base-worktree': 'baseWorktree' };

/**
 * Strict: an unknown flag, or a value flag without a value, is an error -- a typo such as `--pussh`
 * must not silently turn a run into a different run (it used to be ignored).
 */
export function parseArgs(argv) {
  const out = { push: false, dispatch: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (Object.hasOwn(VALUE_FLAGS, arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      out[VALUE_FLAGS[arg]] = value;
      i += 1;
    } else if (arg === '--push') out.push = true;
    else if (arg === '--dispatch') out.dispatch = true;
    else throw new Error(`unknown argument ${JSON.stringify(arg)}`);
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

// Set just before the first mutation of the worktree; printed by the top-level error handler so a
// thrown error (a rejected push, a controller emitting non-JSON, ...) also says how to undo it.
let restoreHint = null;

function stopResult(stop, reason, extra = {}) {
  return { result: 'STOP', stop, reason, ...extra };
}

function emitStop(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const worktree = resolvePath(opts.worktree);
  const repo = resolveRepoSlug(worktree, opts.repo);

  // Step 2: detect staleness.
  const view = detectStaleness(repo, opts.pr);
  const scope = classifyStaleness(view);
  if (!scope.inScope) emitStop(stopResult(scope.stop, scope.reason, { pr: opts.pr }));

  if (git(worktree, ['rev-parse', 'HEAD']) !== view.headRefOid) {
    throw new Error(
      `--worktree HEAD (${git(worktree, ['rev-parse', 'HEAD'])}) does not match PR head (${view.headRefOid}) -- check out the PR branch fresh before invoking this script`,
    );
  }
  if (git(worktree, ['status', '--porcelain']) !== '') {
    throw new Error('--worktree has uncommitted changes -- refuse to run against a dirty checkout');
  }
  // Everything after the merge leaves the worktree mutated; say so, and say how to undo it.
  const afterMerge = (stop, reason, extra = {}) =>
    stopResult(stop, reason, {
      worktreeMutated: true,
      restoreCommand: `git -C "${worktree}" reset --hard ${view.headRefOid}`,
      ...extra,
    });

  const currentTipBytes = readFileAtRef(worktree, view.headRefOid, opts.definition);
  const currentDefinition = JSON.parse(currentTipBytes.toString('utf8'));
  const oldBaseSha = currentDefinition.base_sha;

  // Fail closed on an empty RED/GREEN manifest BEFORE touching the worktree, so this STOP leaves
  // nothing behind.
  const manifestCheck = assertNonEmptyManifest(currentDefinition);
  if (!manifestCheck.ok) emitStop(stopResult(manifestCheck.stop, manifestCheck.reason, { pr: opts.pr }));

  // Likewise discover an unsupported base_sha layout (e.g. 4-space PowerShell-style JSON, which 2 of
  // 59 real units use) BEFORE the merge instead of after it. The probe value is never written.
  const layoutCheck = bumpBaseShaInText(currentTipBytes.toString('utf8'), 'a'.repeat(40));
  if (!layoutCheck.ok) emitStop(stopResult(layoutCheck.stop, layoutCheck.reason, { pr: opts.pr }));

  // Step 2 (continued): locate the prior-approved candidate SHA.
  let priorApprovedSha;
  try {
    priorApprovedSha = locatePriorApprovedSha(worktree, repo, view.headRefOid, oldBaseSha);
  } catch (error) {
    if (error.code === 'TOO_MANY_COMMITS_TO_WALK') {
      emitStop(stopResult(STOP.TOO_MANY_COMMITS_TO_WALK, error.message, { pr: opts.pr }));
    }
    throw error;
  }
  if (!priorApprovedSha) {
    emitStop(
      stopResult(
        STOP.NO_PRIOR_PROOF,
        `no commit on this branch (back to the old base_sha) has a current green ${DEVGOV_STATUS_CONTEXT} status`,
        { pr: opts.pr },
      ),
    );
  }

  // Step 3 / Phase 1.
  const priorApprovedBytes = readFileAtRef(worktree, priorApprovedSha, opts.definition);
  const phase1 = phase1VerifyOriginalIdentity(currentTipBytes, priorApprovedBytes);
  if (!phase1.ok) emitStop(stopResult(phase1.stop, phase1.reason, { pr: opts.pr, priorApprovedSha }));

  // Step 4: merge current base into the branch. git merge, never rebase, never squash -- matches
  // the PR #203/#204 manual precedent (commit ef1109e5). --no-ff pins the commit shape the CI
  // lineage check requires, even in the fast-forward case. git writes its CONFLICT lines to STDOUT.
  // The refspec is explicit so this does not depend on a default fetch refspec (a --single-branch
  // clone has none for the base branch).
  const restoreCommand = `git -C "${worktree}" reset --hard ${view.headRefOid}`;
  git(worktree, ['fetch', 'origin', `+refs/heads/${view.baseRefName}:refs/remotes/origin/${view.baseRefName}`]);
  const newBaseSha = git(worktree, ['rev-parse', `origin/${view.baseRefName}`]);
  restoreHint = restoreCommand; // anything that throws from here on may have left the worktree mutated
  const mergeResult = runAllowFail('git', ['-C', worktree, 'merge', '--no-ff', '--no-edit', `origin/${view.baseRefName}`]);
  if (mergeResult.status !== 0) {
    // Only abort if a merge is actually in progress (a merge killed by the timeout, or one refused
    // up front, has no MERGE_HEAD), then report the REAL state of the worktree instead of assuming.
    const inMerge = runAllowFail('git', ['-C', worktree, 'rev-parse', '-q', '--verify', 'MERGE_HEAD']).status === 0;
    if (inMerge) runAllowFail('git', ['-C', worktree, 'merge', '--abort']);
    const pristine =
      runAllowFail('git', ['-C', worktree, 'rev-parse', 'HEAD']).stdout.trim() === view.headRefOid &&
      runAllowFail('git', ['-C', worktree, 'status', '--porcelain']).stdout.trim() === '';
    if (pristine) restoreHint = null;
    const classification = classifyMergeFailure(`${mergeResult.stdout}\n${mergeResult.stderr}`);
    emitStop(
      stopResult(classification.stop, classification.reason, {
        pr: opts.pr,
        newBaseSha,
        mergeWasInProgress: inMerge,
        ...(pristine ? { worktreeMutated: false } : { worktreeMutated: true, restoreCommand }),
      }),
    );
  }

  // Step 5: bump base_sha (the one permitted edit), then Phase 2.
  const postMergeText = readFileAtRef(worktree, 'HEAD', opts.definition).toString('utf8');
  const bump = bumpBaseShaInText(postMergeText, newBaseSha);
  if (!bump.ok) emitStop(afterMerge(bump.stop, bump.reason, { pr: opts.pr, newBaseSha }));
  writeFileSync(join(worktree, opts.definition), bump.text);
  const postEditBytes = readFileSync(join(worktree, opts.definition));
  const phase2 = phase2VerifyOwnEdit(currentTipBytes, postEditBytes, newBaseSha);
  if (!phase2.ok) emitStop(afterMerge(phase2.stop, phase2.reason, { pr: opts.pr, newBaseSha }));

  git(worktree, ['add', opts.definition]);
  git(worktree, [
    'commit',
    '-m',
    `chore(rebase-reverify): base-bump to ${view.baseRefName}@${newBaseSha.slice(0, 8)}, no logic change\n\nAUTOMATED-REBASE-REVERIFY-01, Phase 1 + Phase 2 both verified locally before this commit.`,
  ]);
  const newCandidateSha = git(worktree, ['rev-parse', 'HEAD']);

  // The same lineage re-verification CI will run, run locally first so a shape problem is caught
  // before anything is pushed.
  const gitCandidate = {
    out: (args) => run('git', ['-C', worktree, ...args], { encoding: null }),
    ok: (args) => runAllowFail('git', ['-C', worktree, ...args]).status === 0,
  };
  const lineage = reverifyLineage({
    payload: {
      candidateSha: newCandidateSha,
      oldCandidateSha: priorApprovedSha,
      preMergeTipSha: view.headRefOid,
      oldBaseSha,
      unitPath: opts.definition,
      controllerRef: `origin/${view.baseRefName}`,
    },
    candidate: gitCandidate,
    controller: { ok: gitCandidate.ok },
    statuses: withRetry(() => listCommitStatuses(repo, priorApprovedSha)),
  });
  if (!lineage.ok) emitStop(afterMerge(lineage.stop, lineage.reason, { pr: opts.pr, newCandidateSha }));

  // Step 5 (continued): local RED/GREEN dry-run -- pre-check only, not the authoritative signed
  // proof (that happens in CI via devgov-v0-rebase-reverify.yml once dispatched).
  const postMergeDefinition = JSON.parse(postEditBytes.toString('utf8'));
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

  const verdict = evaluateDryRun(postMergeDefinition, redResults, greenResults);
  if (!verdict.ok) {
    emitStop(
      afterMerge(verdict.stop, `${verdict.reason}. Left un-pushed; surface for a new cold-review round.`, {
        pr: opts.pr,
        newCandidateSha,
        redResults,
        greenResults,
      }),
    );
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
    localLineageCheck: 'PASS',
    localRedGreenDryRun: 'PASS',
    pushed: false,
    dispatched: false,
  };

  if (opts.push) {
    git(worktree, ['push', 'origin', `HEAD:${view.headRefName}`]);
    summary.pushed = true;
  }

  if (opts.dispatch) {
    try {
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
    } catch (error) {
      throw new Error(
        `the push SUCCEEDED (candidate ${newCandidateSha} is on origin branch ${view.headRefName}) but the dispatch failed: ${error.message}`,
      );
    }
    summary.dispatched = true;
  }

  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const mutation = restoreHint ? { worktreeMayBeMutated: true, restoreCommand: restoreHint } : {};
    console.error(JSON.stringify({ result: 'ERROR', message: error.message, ...mutation }, null, 2));
    process.exit(2);
  });
}
