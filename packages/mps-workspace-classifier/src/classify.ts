/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — `classify(snapshot, operation) -> disposition`.
 *
 * A PURE FUNCTION. No disk, no network, no Git, no clock, no randomness. The staleness rule below
 * is the one place a clock would be the obvious implementation, and it deliberately is not one: age
 * is computed from two values that are both already in the snapshot (the observation window's end
 * and the reflog timestamp), so the same snapshot classifies identically forever. A classifier that
 * read a clock would produce a different answer for the same evidence tomorrow, and determinism at
 * identityDigest level — which A14's compare-and-swap depends on — would be gone.
 *
 * IT NEVER RECEIVES THE EXPECTATIONS. The frozen facit is read only by the harness. That is not a
 * matter of tidiness: if the classifier could see what it is supposed to answer, a passing
 * comparison would prove nothing at all.
 *
 * SAFETY IS UNCONDITIONAL, UTILITY IS THE COUNTERWEIGHT. `return BLOCKED` satisfies SAFETY for
 * every case and is a failure, because the incentive structure otherwise points entirely at
 * over-blocking — it is the only direction in which the implementer can never be caught being
 * wrong. Every predicate below therefore has to justify itself as a real removal hazard, and the
 * ones that do not block are as deliberate as the ones that do (see the stash rule).
 */
import {
  CANDIDATE_SHAPES,
  resolveConflict,
} from './ConflictTable.js';
import type { CandidateShape, MetadataClaim, WorkspaceView } from './ConflictTable.js';
import {
  CLASSIFIER_VERSION,
  POLICY_VERSION,
} from './types.js';
import type {
  ClassificationResult,
  Disposition,
  OperationScope,
  WorkspaceBlocker,
  WorkspaceFinding,
} from './types.js';

/**
 * The snapshot shape the classifier reads.
 *
 * Declared structurally here rather than imported from the observer package, and the direction of
 * that dependency is the point: the classifier depends on the SHAPE of an observation, never the
 * observer on the shape of a decision. A2 requires the boundary to be mechanically enforced, and an
 * import from observer to classifier is exactly what the eslint rule, the package manifest and the
 * import-graph test all forbid.
 */
export interface ClassifiableObserved<T> {
  readonly state: 'OBSERVED' | 'UNKNOWN' | 'NOT_ATTEMPTED';
  readonly unknownReason?: string;
  readonly notAttemptedReason?: string;
  readonly value?: T;
}

export interface ClassifiableWorkspace {
  readonly caseId: string;
  readonly comparisonKey: string;
  readonly preferredSpelling: string;
  readonly observationState: 'OBSERVED' | 'UNKNOWN' | 'NOT_ATTEMPTED';
  readonly notAttemptedReason?: string;
  readonly gitWorktreeList: {
    readonly listed: boolean;
    readonly locked?: boolean;
    readonly lockedReason?: string;
    readonly prunable?: boolean;
  };
  readonly gitMetadata: {
    readonly registered: boolean;
    readonly gitdirTargetPresent?: boolean;
    readonly lockedMarker?: boolean;
    readonly lockFiles?: readonly string[];
    readonly inProgressMarkers?: readonly string[];
  };
  readonly filesystem: {
    readonly pathPresent: ClassifiableObserved<boolean>;
    readonly entryType?: string;
    readonly dotGitType?: string;
    readonly dotGitAbsent?: boolean;
  };
  readonly toplevel: ClassifiableObserved<string>;
  readonly toplevelMatchesCandidate: ClassifiableObserved<boolean>;
  readonly status: ClassifiableObserved<{
    readonly trackedModificationCount: number;
    readonly untrackedEntryCount: number;
    readonly unmergedCount: number;
  }>;
  readonly ancestry: ClassifiableObserved<{
    readonly headSha?: string;
    readonly headCommitExists?: boolean;
    readonly headIsAncestorOfCanonical?: boolean;
    readonly commitsAheadOfCanonical?: number;
  }>;
  readonly repositoryMembership: ClassifiableObserved<'MEMBER' | 'FOREIGN' | 'UNRESOLVED'>;
  /** Set when `git rev-parse` in the candidate exited 128 (conclusive: not a repository). */
  readonly workspaceGitUnavailable?: boolean;
}

export interface ClassifiableSnapshot {
  readonly repository: {
    readonly repoRoot: string;
    readonly commonDir: ClassifiableObserved<string>;
    readonly canonicalSha: ClassifiableObserved<string>;
    readonly canonicalShaSource: string;
    readonly canonicalShaStableAcrossWindow: ClassifiableObserved<boolean>;
    readonly canonicalRefUpdatedAtEpochSeconds: ClassifiableObserved<number>;
    readonly stashes: ClassifiableObserved<readonly { readonly stashCommit: string }[]>;
    readonly mutationEvidence: ClassifiableObserved<{
      readonly comparedPairs: number;
      readonly differingPairs: readonly string[];
    }>;
  };
  readonly workspaces: readonly ClassifiableWorkspace[];
  readonly metadata: {
    readonly observationWindow?: { readonly start: string; readonly end: string };
  };
  readonly identityDigest: string;
}

export interface ClassifierPolicy {
  /**
   * How old the LOCAL canonical reference may be before it stops being usable evidence (B9).
   *
   * Applied only when the canonical SHA came from the local tracking ref (R-G-01). When it came
   * from `ls-remote` (R-G-02) the reference was read from the remote during this very observation,
   * so it cannot be stale and the reflog age says nothing about it. Blocking on reflog age in that
   * case would block every workspace on a machine that simply has not run `git fetch` lately, while
   * the evidence actually used was current — over-blocking with no safety gain.
   */
  readonly canonicalReferenceMaxAgeSeconds: number;
  /**
   * The size of the repeated modification cluster the frozen adjudication records. It is a
   * DESCRIPTIVE label only: the corpus carries no diff evidence, so the classifier must not treat
   * this count as benign. It blocks exactly like any other tracked modification, and the count is
   * recorded as a finding so a report can name the cluster.
   */
  readonly normalizationClusterSize: number;
}

export const DEFAULT_POLICY: ClassifierPolicy = Object.freeze({
  canonicalReferenceMaxAgeSeconds: 7 * 24 * 60 * 60,
  normalizationClusterSize: 151,
});

/**
 * Days since the Unix epoch for a proleptic-Gregorian civil date (Howard Hinnant's algorithm).
 *
 * Written out rather than delegated to `Date.UTC` because the classifier must not touch the Date
 * global at all. `Date.UTC` is pure arithmetic and would be harmless here, but a rule that admits
 * "this particular Date call is fine" is a rule that stops being enforceable, and the clock ban is
 * one of the few things standing between a pure classifier and one that answers differently
 * tomorrow. Twelve lines of arithmetic buy an unconditional lint rule.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function isoToEpochSeconds(iso: string): number | undefined {
  // Parsing a fixed-format timestamp that is already IN the snapshot is not reading a clock: the
  // value came from the observation, and the same snapshot yields the same number forever.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(iso);
  if (m === null) return undefined;
  const days = daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3]));
  return days * 86400 + Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6]);
}

/** Project the filesystem observation onto the conflict table's candidate-shape axis. */
function candidateShape(w: ClassifiableWorkspace): CandidateShape {
  const present = w.filesystem.pathPresent;
  if (present.state !== 'OBSERVED') return 'INCONCLUSIVE';
  if (present.value === false) return 'ABSENT';
  if (w.filesystem.entryType !== 'dir') return 'PRESENT_NOT_DIR';
  if (w.filesystem.dotGitAbsent === true) return 'DIR_DOTGIT_ABSENT';
  if (w.filesystem.dotGitType === 'dir') return 'DIR_DOTGIT_DIR';
  if (w.filesystem.dotGitType === 'file' || w.filesystem.dotGitType === 'symlink') {
    return 'DIR_DOTGIT_POINTER';
  }
  return 'INCONCLUSIVE';
}

function metadataClaim(w: ClassifiableWorkspace): MetadataClaim {
  const listed = w.gitWorktreeList.listed;
  const registered = w.gitMetadata.registered;
  if (listed && registered) return 'REGISTERED_CORRELATED';
  if (listed !== registered) return 'REGISTERED_UNCORRELATED';
  return 'METADATA_ABSENT';
}

function workspaceView(w: ClassifiableWorkspace): WorkspaceView {
  if (w.workspaceGitUnavailable === true) return 'UNAVAILABLE';
  if (w.toplevelMatchesCandidate.state !== 'OBSERVED') return 'INCONCLUSIVE';
  if (w.toplevelMatchesCandidate.value !== true) return 'TOPLEVEL_NOT_CANDIDATE';
  if (w.repositoryMembership.state !== 'OBSERVED') return 'INCONCLUSIVE';
  if (w.repositoryMembership.value === 'FOREIGN') return 'FOREIGN';
  // UNRESOLVED never becomes MEMBER by default: an unresolvable common dir is an open question,
  // and answering it optimistically is precisely how a false SAFE_TO_REMOVE gets produced.
  if (w.repositoryMembership.value !== 'MEMBER') return 'INCONCLUSIVE';
  return 'MEMBER_TOPLEVEL_EQ';
}

export function classify(
  snapshot: ClassifiableSnapshot,
  operation: OperationScope,
  policy: ClassifierPolicy = DEFAULT_POLICY,
): ClassificationResult {
  const repositoryBlockers = classifyRepository(snapshot, operation, policy);
  const repositoryFindings = repositoryFindingsFor(snapshot, operation);

  const dispositions = snapshot.workspaces.map((w) =>
    classifyWorkspace(w, snapshot, operation, policy, repositoryBlockers, repositoryFindings),
  );

  return {
    operation,
    classifierVersion: CLASSIFIER_VERSION,
    policyVersion: POLICY_VERSION,
    dispositions,
  };
}

/** Repository-wide facts block every workspace, because they undermine every workspace's evidence. */
function classifyRepository(
  snapshot: ClassifiableSnapshot,
  operation: OperationScope,
  policy: ClassifierPolicy,
): readonly WorkspaceBlocker[] {
  const blockers: WorkspaceBlocker[] = [];
  const repo = snapshot.repository;

  if (repo.canonicalSha.state !== 'OBSERVED') {
    blockers.push({
      code: 'CANONICAL_REFERENCE_UNAVAILABLE',
      evidenceRef: 'R-G-01[BEFORE], R-G-02[BEFORE]',
      resolvableBy: 'REOBSERVATION',
      blockerScope: operation,
      detail:
        'No canonical SHA was selected, so no ancestry fact in this snapshot has a reference to be measured against.',
    });
  }

  // A16: origin/main was read before and after. If it moved, every ancestry answer in between was
  // measured against a reference that no longer holds.
  if (repo.canonicalShaStableAcrossWindow.state !== 'OBSERVED') {
    blockers.push({
      code: 'CANONICAL_REFERENCE_MOVED_DURING_OBSERVATION',
      evidenceRef: 'R-G-01[BEFORE], R-G-01[AFTER]',
      resolvableBy: 'REOBSERVATION',
      blockerScope: operation,
      detail: 'Whether the canonical reference stayed still during the observation window is unknown.',
    });
  } else if (repo.canonicalShaStableAcrossWindow.value === false) {
    blockers.push({
      code: 'CANONICAL_REFERENCE_MOVED_DURING_OBSERVATION',
      evidenceRef: 'R-G-01[BEFORE], R-G-01[AFTER]',
      resolvableBy: 'REOBSERVATION',
      blockerScope: operation,
      detail: 'origin/main moved between the before and after reads; the snapshot is suspect (A16).',
    });
  }

  // B9 staleness, and only where it is actually evidence — see ClassifierPolicy.
  if (repo.canonicalShaSource === 'R-G-01[BEFORE]') {
    const windowEnd = snapshot.metadata.observationWindow?.end;
    const updatedAt = repo.canonicalRefUpdatedAtEpochSeconds;
    if (updatedAt.state !== 'OBSERVED' || windowEnd === undefined) {
      blockers.push({
        code: 'CANONICAL_REFERENCE_STALE',
        evidenceRef: 'R-F-10',
        resolvableBy: 'REOBSERVATION',
        blockerScope: operation,
        detail:
          'The canonical SHA came from the local tracking ref and its age could not be established.',
      });
    } else {
      const endEpoch = isoToEpochSeconds(windowEnd);
      if (endEpoch === undefined) {
        blockers.push({
          code: 'CANONICAL_REFERENCE_STALE',
          evidenceRef: 'R-F-10',
          resolvableBy: 'REOBSERVATION',
          blockerScope: operation,
          detail: 'The observation window end could not be read, so reference age is unknown.',
        });
      } else if (endEpoch - (updatedAt.value ?? 0) > policy.canonicalReferenceMaxAgeSeconds) {
        blockers.push({
          code: 'CANONICAL_REFERENCE_STALE',
          evidenceRef: 'R-F-10',
          resolvableBy: 'REOBSERVATION',
          blockerScope: operation,
          detail: `The local canonical reference was last updated more than ${policy.canonicalReferenceMaxAgeSeconds} seconds before the observation window ended.`,
        });
      }
    }
  }

  // The corpus's own non-mutation proof, applied to this run.
  const mutation = repo.mutationEvidence;
  if (mutation.state === 'OBSERVED' && (mutation.value?.differingPairs.length ?? 0) > 0) {
    blockers.push({
      code: 'REPOSITORY_MUTATED_DURING_OBSERVATION',
      evidenceRef: 'R-F-01, R-F-02, R-F-08 BEFORE/AFTER',
      resolvableBy: 'HUMAN',
      blockerScope: operation,
      detail: `Repository metadata changed during the observation: ${(mutation.value?.differingPairs ?? []).join(', ')}`,
    });
  }

  /**
   * A22, and this is the rule that decides whether UTILITY means anything at all.
   *
   * Stash state is repository-global and is always preserved as evidence. The existence of an
   * unattributable stash does NOT prove that removing a clean worktree destroys it: `git worktree
   * remove` does not touch refs/stash. So an unattributed stash blocks the operations that can
   * destroy or orphan it, and does not block an independently proven-safe WORKTREE_REMOVAL. Seven
   * global stashes exist on the frozen machine; blocking removal on them would make UTILITY
   * unsatisfiable for every workspace at once, which is the "content-free criterion" the spec names.
   */
  const stashCount = snapshot.repository.stashes.value?.length ?? 0;
  if (
    stashCount > 0 &&
    (operation === 'REPOSITORY_REMOVAL' ||
      operation === 'GLOBAL_REPOSITORY_MUTATION' ||
      operation === 'BRANCH_DELETION')
  ) {
    blockers.push({
      code: 'STASH_UNATTRIBUTED',
      evidenceRef: 'R-G-04',
      resolvableBy: 'HUMAN',
      blockerScope: operation,
      detail: `${stashCount} repository-global stash entries exist and this operation can destroy or orphan them.`,
    });
  }

  return blockers;
}

function repositoryFindingsFor(
  snapshot: ClassifiableSnapshot,
  operation: OperationScope,
): readonly WorkspaceFinding[] {
  const findings: WorkspaceFinding[] = [];
  const stashCount = snapshot.repository.stashes.value?.length ?? 0;
  if (stashCount > 0 && operation === 'WORKTREE_REMOVAL') {
    findings.push({
      code: 'GLOBAL_STASH_PRESENT',
      evidenceRef: 'R-G-04',
      detail: `${stashCount} repository-global stash entries exist. git worktree remove does not delete refs/stash, so they are preserved by this operation (A22).`,
    });
  }
  return findings;
}

function classifyWorkspace(
  w: ClassifiableWorkspace,
  snapshot: ClassifiableSnapshot,
  operation: OperationScope,
  policy: ClassifierPolicy,
  repositoryBlockers: readonly WorkspaceBlocker[],
  repositoryFindings: readonly WorkspaceFinding[],
): Disposition {
  const blockers: WorkspaceBlocker[] = [...repositoryBlockers];
  const findings: WorkspaceFinding[] = [...repositoryFindings];
  const evidence: string[] = [];

  if (w.observationState === 'NOT_ATTEMPTED') {
    blockers.push({
      code: 'OBSERVATION_NOT_ATTEMPTED',
      evidenceRef: `case ${w.caseId}`,
      resolvableBy: 'REOBSERVATION',
      blockerScope: operation,
      detail: `The workspace-local observations were never made (${w.notAttemptedReason ?? 'unspecified'}).`,
    });
    return {
      caseId: w.caseId,
      decision: 'BLOCKED',
      operation,
      identityDigest: snapshot.identityDigest,
      blockers,
      findings,
      evidence,
    };
  }

  const shape = candidateShape(w);
  const meta = metadataClaim(w);
  const view = workspaceView(w);

  /**
   * The main worktree is decided BEFORE the conflict table, and it has to be.
   *
   * It is listed by `git worktree list` and it has no `.git/worktrees/<id>` metadata directory,
   * because only LINKED worktrees have one. Fed to the registration axis that reads exactly those
   * two sources, that looks identical to a genuine source disagreement — and the table would block
   * it for a reason that is simply false about it. The verdict would be right and the explanation
   * wrong, which is the kind of correctness that stops being correct as soon as the model grows.
   *
   * Deciding it here also matches the adjudication precedence: path missing, then main worktree,
   * then everything else.
   */
  const isMainWorktree =
    shape !== 'ABSENT' &&
    shape !== 'PRESENT_NOT_DIR' &&
    shape !== 'INCONCLUSIVE' &&
    w.comparisonKey === comparisonKeyOf(snapshot.repository.repoRoot);

  const outcome = isMainWorktree
    ? ({ kind: 'PROCEED_TO_PREDICATES' } as const)
    : resolveConflict(shape, meta, view);
  evidence.push(
    isMainWorktree
      ? 'main-worktree identity: candidate comparison key equals the repository root'
      : `conflict-table ${shape}|${meta}|${view}`,
  );

  if (outcome.kind === 'BLOCKED') {
    blockers.push({
      code: outcome.code,
      evidenceRef: 'R-F-06, R-G-03, R-F-01..R-F-04, R-W-03',
      resolvableBy:
        outcome.code === 'OBSERVATION_INCONCLUSIVE' ? 'REOBSERVATION' : 'HUMAN',
      blockerScope: operation,
      detail: `Source claims ${shape} | ${meta} | ${view}.`,
    });
  } else {
    if (isMainWorktree) {
      blockers.push({
        code: 'MAIN_WORKTREE',
        evidenceRef: 'R-G-07, R-W-03',
        resolvableBy: 'HUMAN',
        blockerScope: operation,
        detail:
          'This is the repository main worktree. `git worktree remove` cannot operate on it, and removing the directory would take the object database with it.',
      });
    }

    if (w.gitWorktreeList.locked === true || w.gitMetadata.lockedMarker === true) {
      blockers.push({
        code: 'WORKTREE_LOCKED',
        evidenceRef: 'R-G-03, R-F-03 locked',
        resolvableBy: 'HUMAN',
        blockerScope: operation,
        detail: `The worktree is locked${w.gitWorktreeList.lockedReason !== undefined ? `: ${w.gitWorktreeList.lockedReason}` : ''}.`,
      });
    }
    const lockFiles = w.gitMetadata.lockFiles ?? [];
    if (lockFiles.length > 0) {
      blockers.push({
        code: 'LOCK_FILES_PRESENT',
        evidenceRef: 'R-F-02',
        resolvableBy: 'REOBSERVATION',
        blockerScope: operation,
        detail: `Lock files present in the worktree metadata: ${lockFiles.join(', ')}.`,
      });
    }
    const inProgress = w.gitMetadata.inProgressMarkers ?? [];
    if (inProgress.length > 0) {
      blockers.push({
        code: 'OPERATION_IN_PROGRESS',
        evidenceRef: 'R-F-02, R-F-03',
        resolvableBy: 'HUMAN',
        blockerScope: operation,
        detail: `An operation is unfinished: ${inProgress.join(', ')}. Removing the worktree would lose its recovery context.`,
      });
    }

    if (w.status.state !== 'OBSERVED') {
      blockers.push({
        code: 'OBSERVATION_INCONCLUSIVE',
        evidenceRef: 'R-W-04',
        resolvableBy: 'REOBSERVATION',
        blockerScope: operation,
        detail: `Working-tree state is ${w.status.state}${w.status.unknownReason !== undefined ? ` (${w.status.unknownReason})` : ''}.`,
      });
    } else {
      const s = w.status.value;
      evidence.push('R-W-04 git status --porcelain=v2 exit 0');
      const tracked = s?.trackedModificationCount ?? 0;
      const untracked = s?.untrackedEntryCount ?? 0;
      if (tracked > 0) {
        blockers.push({
          code: 'TRACKED_MODIFICATIONS_PRESENT',
          evidenceRef: 'R-W-04',
          resolvableBy: 'HUMAN',
          blockerScope: operation,
          detail: `${tracked} tracked entries are modified.`,
        });
        if (tracked === policy.normalizationClusterSize) {
          // Descriptive only. The corpus contains no diff request, so the substance of this cluster
          // is unproven here; it must not be treated as benign, and it is not.
          findings.push({
            code: 'REPEATED_MODIFICATION_CLUSTER',
            evidenceRef: 'R-W-04',
            detail: `The modification count equals the repeated ${policy.normalizationClusterSize}-file cluster. The command surface contains no diff family, so the cluster's substance is unproven and this is a label, not a reason to allow removal.`,
          });
        }
      }
      if (untracked > 0) {
        blockers.push({
          code: 'UNTRACKED_ENTRIES_PRESENT',
          evidenceRef: 'R-W-04',
          resolvableBy: 'HUMAN',
          blockerScope: operation,
          detail: `${untracked} untracked entries are present. Untracked content is by definition absent from the object database, so removal is unrecoverable.`,
        });
      }
    }

    if (w.ancestry.state !== 'OBSERVED') {
      blockers.push({
        code: 'OBSERVATION_INCONCLUSIVE',
        evidenceRef: 'R-W-01, R-G-11',
        resolvableBy: 'REOBSERVATION',
        blockerScope: operation,
        detail: `Ancestry is ${w.ancestry.state}${w.ancestry.unknownReason !== undefined ? ` (${w.ancestry.unknownReason})` : ''}.`,
      });
    } else {
      const a = w.ancestry.value;
      if (a?.headCommitExists !== true) {
        blockers.push({
          code: 'HEAD_COMMIT_MISSING',
          evidenceRef: 'R-G-11',
          resolvableBy: 'HUMAN',
          blockerScope: operation,
          detail: 'The HEAD commit object does not exist in this repository.',
        });
      } else {
        evidence.push('R-G-11 git cat-file -e <head>^{commit} exit 0');
        // A19: the safe answer needs POSITIVE proof, so both halves are required and neither is
        // inferred from the other. `--is-ancestor` proves containment; the count proves there is
        // nothing here that the canonical base lacks.
        const isAncestor = a.headIsAncestorOfCanonical;
        const ahead = a.commitsAheadOfCanonical;
        if (isAncestor !== true || ahead === undefined || ahead > 0) {
          blockers.push({
            code: 'UNIQUE_COMMITS_PRESENT',
            evidenceRef: 'R-G-12, R-G-15',
            resolvableBy: 'HUMAN',
            blockerScope: operation,
            detail:
              isAncestor === true
                ? `HEAD is an ancestor of the canonical base but ${String(ahead)} commits are unique to it.`
                : 'HEAD is not an ancestor of the canonical base, so it carries commits the canonical base does not contain.',
          });
        } else {
          evidence.push('R-G-12 git merge-base --is-ancestor <head> <canonical> exit 0');
          evidence.push('R-G-15 git rev-list --count <canonical>..<head> = 0');
        }
      }
    }
  }

  return {
    caseId: w.caseId,
    decision: blockers.length === 0 ? 'SAFE_TO_REMOVE' : 'BLOCKED',
    operation,
    identityDigest: snapshot.identityDigest,
    blockers,
    findings,
    evidence,
  };
}

/**
 * The frozen comparison key, reimplemented here rather than imported.
 *
 * Importing it from the observer package would be a dependency edge in the forbidden direction and
 * would defeat the mechanical boundary. The rule is four lines of frozen, normative text, and a test
 * asserts both implementations agree on the corpus, so the duplication is checked rather than hoped.
 */
function comparisonKeyOf(path: string): string {
  let key = path.replace(/\\/g, '/');
  while (key.length > 3 && key.endsWith('/')) key = key.slice(0, -1);
  return key.toLowerCase();
}

export { CANDIDATE_SHAPES };
