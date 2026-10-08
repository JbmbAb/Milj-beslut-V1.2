/**
 * C3 -- zero-google evidence (contract 6.4), fixed order:
 *   1. present / hash / strict payload   2. same tree   3. a guard exists in the tree
 *   4. the guard is the accepted one (path, blob, executed == committed, command)
 *   5. scan configuration   6. execution (clean, exit 0, exactly the required tests, all passed, no dependency hit)
 *
 * PASS means only "the accepted guard configuration found nothing in its surface" (6.5); it is never ZERO GOOGLE CLOSED.
 */
import { FAILURE, GUARD_PATH } from '../vocabulary';
import { hashJcs, tryHashJcs } from '../canonical';
import { compareBytewise, jsonEqual } from '../json';
import { validateZeroGoogleEvidence, type ZeroGooglePresent } from '../evidenceSchemas';
import { unwrapPayload, type StageContext } from './context';

const PROFILE_RANK: Readonly<Record<string, number>> = { GUARD_ONLY: 0, GUARD_PLUS_DEPENDENCY_MANIFESTS: 1 };

export function checkZeroGoogle(ctx: StageContext): string | undefined {
  const { manifest, policy, observations } = ctx;

  const found = unwrapPayload(observations, 'zero_google');
  if (found.kind === 'absent') return FAILURE.zero_google_evidence_missing;
  if (found.kind === 'malformed') return FAILURE.evidence_schema_invalid;
  const payload = found.payload;
  const hash = tryHashJcs(payload);
  if (hash === undefined) return FAILURE.evidence_schema_invalid;
  if (hash !== manifest.zero_google.evidence_sha256) return FAILURE.manifest_hash_mismatch;
  if (!validateZeroGoogleEvidence(payload)) return FAILURE.evidence_schema_invalid;

  if (payload.subject.commit_sha !== manifest.candidate.commit_sha || payload.subject.tree_sha !== manifest.candidate.tree_sha) {
    return FAILURE.zero_google_tree_mismatch;
  }
  if (payload.guard_state !== 'PRESENT') return FAILURE.zero_google_guard_not_accepted;
  const ev: ZeroGooglePresent = payload;

  // 4. the guard
  if (ev.guard.path !== GUARD_PATH) return FAILURE.zero_google_guard_not_accepted;
  if (ev.guard.blob_sha1_in_tree !== ev.guard.blob_sha1_executed) return FAILURE.zero_google_guard_not_accepted;
  const entry = policy.accepted_guards.find((g) => g.blob_sha1 === ev.guard.blob_sha1_in_tree);
  if (entry === undefined) return FAILURE.zero_google_guard_not_accepted;
  if (ev.execution.command_sha256 !== entry.command_sha256) return FAILURE.zero_google_guard_not_accepted;

  // 5. the scan
  const scan = ev.scan;
  const rank = PROFILE_RANK[scan.profile];
  const required = PROFILE_RANK[policy.required_scan_profile];
  if (rank === undefined || required === undefined || rank < required) return FAILURE.zero_google_scan_mismatch;
  if (!jsonEqual(scan.roots, entry.scan_roots)) return FAILURE.zero_google_scan_mismatch;
  if (scan.allow_patterns_sha256 !== hashJcs(entry.allow_patterns)) return FAILURE.zero_google_scan_mismatch;
  if (!jsonEqual(scan.executed_rules, entry.rules)) return FAILURE.zero_google_scan_mismatch;
  if (scan.candidate_files.claimed_digest_sha256 !== scan.candidate_files.derived_digest_sha256) return FAILURE.zero_google_scan_mismatch;
  if (scan.scanned_files.claimed_digest_sha256 !== scan.scanned_files.derived_digest_sha256) return FAILURE.zero_google_scan_mismatch;
  const dependencies = ev.dependency_scan;
  if (dependencies !== undefined) {
    if (!jsonEqual(dependencies.manifests.map((m) => m.path), policy.dependency_scan.manifests)) return FAILURE.zero_google_scan_mismatch;
    if (dependencies.forbidden_patterns_sha256 !== hashJcs(policy.dependency_scan.forbidden_package_patterns)) return FAILURE.zero_google_scan_mismatch;
    if (dependencies.claimed_digest_sha256 !== dependencies.derived_digest_sha256) return FAILURE.zero_google_scan_mismatch;
  }

  // 6. the execution: the right tests, exactly, all passed
  const run = ev.execution;
  if (run.worktree_clean !== true || run.exit_code !== 0) return FAILURE.zero_google_not_pass;
  const identityOf = (t: { file: string; full_name: string }): string[] => [t.file, t.full_name];
  const order = (a: string[], b: string[]): number => compareBytewise(a[0]!, b[0]!) || compareBytewise(a[1]!, b[1]!);
  const executed = run.executed_tests.map(identityOf).sort(order);
  const required_tests = entry.required_tests.map(identityOf).sort(order);
  if (!jsonEqual(executed, required_tests)) return FAILURE.zero_google_not_pass;
  if (!run.executed_tests.every((t) => t.status === 'passed')) return FAILURE.zero_google_not_pass;
  if (dependencies !== undefined && dependencies.hits_count !== 0) return FAILURE.zero_google_not_pass;
  return undefined;
}
