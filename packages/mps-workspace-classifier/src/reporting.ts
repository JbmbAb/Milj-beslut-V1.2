/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the REPORT layer's operational weighting (A20).
 *
 * This is the file that exists so that `severity` never appears in an artifact.
 *
 * The spec rejects a severity field on a blocker, and the reason is not squeamishness about extra
 * fields: in the workspace domain how serious a blocker is depends on which operation is proposed.
 * `STASH_UNATTRIBUTED` is decisive for REPOSITORY_REMOVAL and irrelevant for WORKTREE_REMOVAL,
 * because `git worktree remove` does not touch refs/stash. A scalar severity on the record cannot
 * express that, so it would be wrong-by-construction the moment a second scope exists — and V2 adds
 * one.
 *
 * So weighting is DERIVED, here, as a function of (blockerCode, operation), under policyVersion,
 * and the classifier never sees it. That separation is the point: a classifier that could read the
 * weighting could be tuned against it, which is how a threshold quietly drifts until a false
 * SAFE_TO_REMOVE becomes reachable.
 */
import type { BlockerCode, OperationScope } from './types.js';

export type EffectiveSeverity = 'DECISIVE' | 'MATERIAL' | 'INFORMATIONAL';

/**
 * Weighting for presentation and triage ONLY. It changes no decision: within its scope, every
 * blocker blocks, and there is no degree.
 */
export function effectiveSeverity(code: BlockerCode, operation: OperationScope): EffectiveSeverity {
  switch (code) {
    case 'OBSERVATION_INCONCLUSIVE':
    case 'OBSERVATION_NOT_ATTEMPTED':
    case 'CANONICAL_REFERENCE_UNAVAILABLE':
    case 'CANONICAL_REFERENCE_STALE':
    case 'CANONICAL_REFERENCE_MOVED_DURING_OBSERVATION':
      // Fixable by looking again, so decisive for the decision and low priority for a human.
      return 'MATERIAL';

    case 'UNTRACKED_ENTRIES_PRESENT':
    case 'TRACKED_MODIFICATIONS_PRESENT':
    case 'UNIQUE_COMMITS_PRESENT':
    case 'OPERATION_IN_PROGRESS':
    case 'REPOSITORY_MUTATED_DURING_OBSERVATION':
    case 'MAIN_WORKTREE':
    case 'FOREIGN_REPOSITORY':
      // Unrecoverable loss if overridden. These are the ones a human must actually look at.
      return 'DECISIVE';

    case 'STASH_UNATTRIBUTED':
      // The whole reason this function is a function of two arguments.
      return operation === 'WORKTREE_REMOVAL' ? 'INFORMATIONAL' : 'DECISIVE';

    case 'WORKSPACE_PATH_ABSENT':
    case 'WORKSPACE_PATH_NOT_A_DIRECTORY':
    case 'DANGLING_GITDIR_POINTER':
    case 'UNREGISTERED_FILESYSTEM_ONLY':
    case 'TOPLEVEL_NOT_CANDIDATE':
    case 'SOURCE_DISAGREEMENT_REGISTRATION':
    case 'WORKTREE_LOCKED':
    case 'LOCK_FILES_PRESENT':
    case 'HEAD_COMMIT_MISSING':
      return 'MATERIAL';

    case 'UNCLASSIFIED_SOURCE_COMBINATION':
      // The default arm fired, which means the model has a gap. Nothing is more urgent than that.
      return 'DECISIVE';

    default: {
      // Compiler-checked exhaustiveness: a new blocker code cannot be added without deciding its
      // weighting, and an unhandled one is DECISIVE rather than quietly informational.
      const never: never = code;
      void never;
      return 'DECISIVE';
    }
  }
}
