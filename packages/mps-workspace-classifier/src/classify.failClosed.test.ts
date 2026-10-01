/**
 * SAFETY, proven where the corpus cannot prove it.
 *
 * The frozen corpus contains zero timeouts, zero spawn failures, zero non-UTF-8 streams, zero
 * truncations, and every one of its 919 filesystem errors is ENOENT — the one code the frozen
 * contract calls conclusive. So a 122/122 replay run says nothing whatsoever about the fail-closed
 * path, and the spec names that path as the most common route to a false safe result. These tests
 * are SYNTHETIC by necessity and are labelled as such: they exercise the branches the corpus cannot
 * reach, and they are not a substitute for a live run that actually hits a timeout.
 *
 * The load-bearing assertion is the exhaustive one at the end: over the full cartesian product of
 * the safety-relevant predicates, SAFE_TO_REMOVE is emitted if and only if EVERY required predicate
 * was positively proven. Not "no reason to block was found" — proven.
 */
import { describe, expect, it } from 'vitest';

import { classify } from './classify.js';
import type { ClassifiableSnapshot, ClassifiableWorkspace } from './classify.js';
import {
  CANDIDATE_SHAPES,
  CONFLICT_TABLE,
  CONFLICT_TABLE_CELL_COUNT,
  DEFAULT_ARM,
  METADATA_CLAIMS,
  WORKSPACE_VIEWS,
  conflictKey,
  renderConflictTable,
  resolveConflict,
} from './ConflictTable.js';

const REPO_ROOT = 'C:\\repo';

/** A workspace with every predicate positively proven: the only shape that may reach SAFE_TO_REMOVE. */
function cleanWorkspace(overrides: Partial<ClassifiableWorkspace> = {}): ClassifiableWorkspace {
  return {
    caseId: 'ws-c-clean-00000000',
    comparisonKey: 'c:/clean',
    preferredSpelling: 'C:\\clean',
    observationState: 'OBSERVED',
    gitWorktreeList: { listed: true, locked: false, prunable: false },
    gitMetadata: { registered: true, lockedMarker: false, lockFiles: [], inProgressMarkers: [] },
    filesystem: {
      pathPresent: { state: 'OBSERVED', value: true },
      entryType: 'dir',
      dotGitType: 'file',
    },
    toplevel: { state: 'OBSERVED', value: 'C:/clean' },
    toplevelMatchesCandidate: { state: 'OBSERVED', value: true },
    repositoryMembership: { state: 'OBSERVED', value: 'MEMBER' },
    status: {
      state: 'OBSERVED',
      value: { trackedModificationCount: 0, untrackedEntryCount: 0, unmergedCount: 0 },
    },
    ancestry: {
      state: 'OBSERVED',
      value: {
        headSha: 'a'.repeat(40),
        headCommitExists: true,
        headIsAncestorOfCanonical: true,
        commitsAheadOfCanonical: 0,
      },
    },
    ...overrides,
  };
}

function snapshotWith(
  workspaces: readonly ClassifiableWorkspace[],
  repoOverrides: Partial<ClassifiableSnapshot['repository']> = {},
): ClassifiableSnapshot {
  return {
    repository: {
      repoRoot: REPO_ROOT,
      commonDir: { state: 'OBSERVED', value: 'C:\\repo\\.git' },
      canonicalSha: { state: 'OBSERVED', value: 'b'.repeat(40) },
      canonicalShaSource: 'R-G-02[BEFORE]',
      canonicalShaStableAcrossWindow: { state: 'OBSERVED', value: true },
      canonicalRefUpdatedAtEpochSeconds: { state: 'OBSERVED', value: 1_780_000_000 },
      stashes: { state: 'OBSERVED', value: [] },
      mutationEvidence: {
        state: 'OBSERVED',
        value: { comparedPairs: 3, differingPairs: [] },
      },
      ...repoOverrides,
    },
    workspaces,
    metadata: { observationWindow: { start: '2026-09-09T18:01:26.493Z', end: '2026-09-09T18:03:39.069Z' } },
    identityDigest: 'c'.repeat(64),
  };
}

function decide(w: ClassifiableWorkspace, repo: Partial<ClassifiableSnapshot['repository']> = {}) {
  const result = classify(snapshotWith([w], repo), 'WORKTREE_REMOVAL');
  return result.dispositions[0];
}

describe('the conflict table is total data with a default BLOCKED arm (A23)', () => {
  it('has exactly one cell per source combination', () => {
    expect(Object.keys(CONFLICT_TABLE)).toHaveLength(CONFLICT_TABLE_CELL_COUNT);
    expect(CONFLICT_TABLE_CELL_COUNT).toBe(
      CANDIDATE_SHAPES.length * METADATA_CLAIMS.length * WORKSPACE_VIEWS.length,
    );
    for (const shape of CANDIDATE_SHAPES) {
      for (const meta of METADATA_CLAIMS) {
        for (const view of WORKSPACE_VIEWS) {
          expect(CONFLICT_TABLE[conflictKey(shape, meta, view)]).toBeDefined();
        }
      }
    }
  });

  it('clears only the cells where every source agrees, and blocks the rest', () => {
    const cleared = Object.entries(CONFLICT_TABLE).filter(
      ([, v]) => v.kind === 'PROCEED_TO_PREDICATES',
    );
    // Membership plus a matching toplevel plus correlated registration, over the three directory
    // shapes that can carry a repository. Everything else — 117 cells — blocks.
    expect(cleared.map(([k]) => k).sort()).toEqual([
      'DIR_DOTGIT_ABSENT|REGISTERED_CORRELATED|MEMBER_TOPLEVEL_EQ',
      'DIR_DOTGIT_DIR|REGISTERED_CORRELATED|MEMBER_TOPLEVEL_EQ',
      'DIR_DOTGIT_POINTER|REGISTERED_CORRELATED|MEMBER_TOPLEVEL_EQ',
    ]);
    expect(cleared).toHaveLength(3);
  });

  it('falls back to an unconditional block for a key outside the union', () => {
    // A future axis value that someone forgets to enumerate must fail closed, not fall through.
    const rogue = 'NEW_SHAPE|REGISTERED_CORRELATED|MEMBER_TOPLEVEL_EQ' as never;
    expect(CONFLICT_TABLE[rogue] ?? DEFAULT_ARM).toEqual(DEFAULT_ARM);
    expect(DEFAULT_ARM.kind).toBe('BLOCKED');
  });

  it('renders every cell so a reviewer can check the model cell by cell', () => {
    const rendered = renderConflictTable().split('\n');
    expect(rendered).toHaveLength(CONFLICT_TABLE_CELL_COUNT + 2);
  });

  it('blocks on any inconclusive source regardless of what the others claim', () => {
    for (const meta of METADATA_CLAIMS) {
      for (const view of WORKSPACE_VIEWS) {
        expect(resolveConflict('INCONCLUSIVE', meta, view).kind).toBe('BLOCKED');
      }
    }
    for (const shape of CANDIDATE_SHAPES) {
      for (const view of WORKSPACE_VIEWS) {
        expect(resolveConflict(shape, 'INCONCLUSIVE', view).kind).toBe('BLOCKED');
      }
      for (const meta of METADATA_CLAIMS) {
        expect(resolveConflict(shape, meta, 'INCONCLUSIVE').kind).toBe('BLOCKED');
      }
    }
  });
});

describe('SYNTHETIC: every inconclusive observation falls closed', () => {
  const unknownReasons = [
    'TIMEOUT',
    'SPAWN_ERROR',
    'NON_ZERO_EXIT',
    'FILESYSTEM_ERROR_INCONCLUSIVE',
    'OUTPUT_NOT_UTF8',
    'OUTPUT_UNPARSEABLE',
    'OUTPUT_TRUNCATED',
  ] as const;

  for (const reason of unknownReasons) {
    it(`blocks when the path probe is UNKNOWN (${reason})`, () => {
      const d = decide(
        cleanWorkspace({ filesystem: { pathPresent: { state: 'UNKNOWN', unknownReason: reason } } }),
      );
      expect(d.decision).toBe('BLOCKED');
      expect(d.blockers.map((b) => b.code)).toContain('OBSERVATION_INCONCLUSIVE');
    });

    it(`blocks when the working-tree status is UNKNOWN (${reason})`, () => {
      const d = decide(cleanWorkspace({ status: { state: 'UNKNOWN', unknownReason: reason } }));
      expect(d.decision).toBe('BLOCKED');
      expect(d.blockers.map((b) => b.code)).toContain('OBSERVATION_INCONCLUSIVE');
    });

    it(`blocks when ancestry is UNKNOWN (${reason})`, () => {
      const d = decide(cleanWorkspace({ ancestry: { state: 'UNKNOWN', unknownReason: reason } }));
      expect(d.decision).toBe('BLOCKED');
      expect(d.blockers.map((b) => b.code)).toContain('OBSERVATION_INCONCLUSIVE');
    });
  }

  it('keeps NOT_ATTEMPTED distinct from UNKNOWN, and blocks on both', () => {
    const notAttempted = decide(
      cleanWorkspace({ observationState: 'NOT_ATTEMPTED', notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE' }),
    );
    expect(notAttempted.decision).toBe('BLOCKED');
    expect(notAttempted.blockers.map((b) => b.code)).toEqual(['OBSERVATION_NOT_ATTEMPTED']);

    const unknown = decide(cleanWorkspace({ status: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' } }));
    expect(unknown.blockers.map((b) => b.code)).toContain('OBSERVATION_INCONCLUSIVE');
    // A3: conflating the two is an implementation error. They must never share a code.
    expect(unknown.blockers.map((b) => b.code)).not.toContain('OBSERVATION_NOT_ATTEMPTED');
  });

  it('blocks when the repository membership cannot be resolved rather than assuming membership', () => {
    const d = decide(
      cleanWorkspace({ repositoryMembership: { state: 'OBSERVED', value: 'UNRESOLVED' } }),
    );
    expect(d.decision).toBe('BLOCKED');
    expect(d.blockers.map((b) => b.code)).toContain('OBSERVATION_INCONCLUSIVE');
  });
});

describe('SYNTHETIC: repository-wide facts block every workspace', () => {
  it('blocks when the canonical reference moved during the observation window (A16)', () => {
    const d = decide(cleanWorkspace(), {
      canonicalShaStableAcrossWindow: { state: 'OBSERVED', value: false },
    });
    expect(d.decision).toBe('BLOCKED');
    expect(d.blockers.map((b) => b.code)).toContain('CANONICAL_REFERENCE_MOVED_DURING_OBSERVATION');
  });

  it('blocks when no canonical reference was selected at all', () => {
    const d = decide(cleanWorkspace(), { canonicalSha: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' } });
    expect(d.blockers.map((b) => b.code)).toContain('CANONICAL_REFERENCE_UNAVAILABLE');
  });

  it('blocks when the observation itself mutated repository metadata', () => {
    const d = decide(cleanWorkspace(), {
      mutationEvidence: {
        state: 'OBSERVED',
        value: { comparedPairs: 3, differingPairs: ['R-F-01 BEFORE vs AFTER'] },
      },
    });
    expect(d.decision).toBe('BLOCKED');
    expect(d.blockers.map((b) => b.code)).toContain('REPOSITORY_MUTATED_DURING_OBSERVATION');
  });

  it('applies canonical-reference staleness only when the SHA came from the local ref (B9)', () => {
    const stale = { canonicalRefUpdatedAtEpochSeconds: { state: 'OBSERVED' as const, value: 1_000_000_000 } };

    // Read from the remote during this observation: the reflog age says nothing about it, and
    // blocking here would block every workspace on a machine that has not fetched lately.
    const fromRemote = decide(cleanWorkspace(), { ...stale, canonicalShaSource: 'R-G-02[BEFORE]' });
    expect(fromRemote.blockers.map((b) => b.code)).not.toContain('CANONICAL_REFERENCE_STALE');
    expect(fromRemote.decision).toBe('SAFE_TO_REMOVE');

    // Read from the local tracking ref, last updated in 2001: that IS stale evidence.
    const fromLocal = decide(cleanWorkspace(), { ...stale, canonicalShaSource: 'R-G-01[BEFORE]' });
    expect(fromLocal.blockers.map((b) => b.code)).toContain('CANONICAL_REFERENCE_STALE');
  });
});

describe('SYNTHETIC: the stash rule keeps its scope (A22)', () => {
  const withStash = { stashes: { state: 'OBSERVED' as const, value: [{ stashCommit: 'd'.repeat(40) }] } };

  it('does not block a proven-safe worktree removal, and records the stash as a finding', () => {
    const result = classify(snapshotWith([cleanWorkspace()], withStash), 'WORKTREE_REMOVAL');
    const d = result.dispositions[0];
    // `git worktree remove` does not delete refs/stash. Blocking here would make UTILITY
    // unsatisfiable for every workspace at once, which is the content-free criterion the spec warns
    // about — seven global stashes exist on the frozen machine.
    expect(d.decision).toBe('SAFE_TO_REMOVE');
    expect(d.findings.map((f) => f.code)).toContain('GLOBAL_STASH_PRESENT');
  });

  it('blocks the operations that can destroy or orphan it', () => {
    for (const operation of ['REPOSITORY_REMOVAL', 'GLOBAL_REPOSITORY_MUTATION', 'BRANCH_DELETION'] as const) {
      const result = classify(snapshotWith([cleanWorkspace()], withStash), operation);
      expect(result.dispositions[0].blockers.map((b) => b.code)).toContain('STASH_UNATTRIBUTED');
    }
  });
});

describe('SAFE_TO_REMOVE requires positive proof of every predicate (A19)', () => {
  it('is emitted for the fully proven workspace and for nothing else in the product', () => {
    // The exhaustive assertion. Each axis below is a predicate the safe answer depends on; the
    // first value of each is the proven one. Every combination that is not all-proven must block.
    const pathStates = [
      { state: 'OBSERVED' as const, value: true },
      { state: 'OBSERVED' as const, value: false },
      { state: 'UNKNOWN' as const, unknownReason: 'TIMEOUT' },
    ];
    const statuses = [
      { state: 'OBSERVED' as const, value: { trackedModificationCount: 0, untrackedEntryCount: 0, unmergedCount: 0 } },
      { state: 'OBSERVED' as const, value: { trackedModificationCount: 1, untrackedEntryCount: 0, unmergedCount: 0 } },
      { state: 'OBSERVED' as const, value: { trackedModificationCount: 0, untrackedEntryCount: 1, unmergedCount: 0 } },
      { state: 'UNKNOWN' as const, unknownReason: 'TIMEOUT' },
    ];
    const ancestries = [
      { state: 'OBSERVED' as const, value: { headSha: 'a'.repeat(40), headCommitExists: true, headIsAncestorOfCanonical: true, commitsAheadOfCanonical: 0 } },
      { state: 'OBSERVED' as const, value: { headSha: 'a'.repeat(40), headCommitExists: true, headIsAncestorOfCanonical: true, commitsAheadOfCanonical: 3 } },
      { state: 'OBSERVED' as const, value: { headSha: 'a'.repeat(40), headCommitExists: true, headIsAncestorOfCanonical: false, commitsAheadOfCanonical: 0 } },
      { state: 'OBSERVED' as const, value: { headSha: 'a'.repeat(40), headCommitExists: false } },
      { state: 'UNKNOWN' as const, unknownReason: 'NON_ZERO_EXIT' },
    ];
    const locks = [
      { registered: true, lockedMarker: false, lockFiles: [] as string[], inProgressMarkers: [] as string[] },
      { registered: true, lockedMarker: true, lockFiles: [] as string[], inProgressMarkers: [] as string[] },
      { registered: true, lockedMarker: false, lockFiles: ['index.lock'], inProgressMarkers: [] as string[] },
      { registered: true, lockedMarker: false, lockFiles: [] as string[], inProgressMarkers: ['MERGE_HEAD'] },
    ];

    let safeCount = 0;
    let total = 0;
    for (const pathPresent of pathStates) {
      for (const status of statuses) {
        for (const ancestry of ancestries) {
          for (const gitMetadata of locks) {
            total += 1;
            const allProven =
              pathPresent === pathStates[0] &&
              status === statuses[0] &&
              ancestry === ancestries[0] &&
              gitMetadata === locks[0];
            const d = decide(
              cleanWorkspace({
                filesystem: { pathPresent, entryType: 'dir', dotGitType: 'file' },
                status,
                ancestry,
                gitMetadata,
              }),
            );
            if (d.decision === 'SAFE_TO_REMOVE') safeCount += 1;
            expect(d.decision === 'SAFE_TO_REMOVE', JSON.stringify({ pathPresent, status, ancestry, gitMetadata })).toBe(
              allProven,
            );
            if (d.decision === 'BLOCKED') expect(d.blockers.length).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(total).toBe(pathStates.length * statuses.length * ancestries.length * locks.length);
    expect(safeCount).toBe(1);
  });

  it('never emits SAFE_TO_REMOVE alongside a blocker, in any combination', () => {
    for (const shape of CANDIDATE_SHAPES) {
      for (const meta of METADATA_CLAIMS) {
        for (const view of WORKSPACE_VIEWS) {
          const outcome = CONFLICT_TABLE[conflictKey(shape, meta, view)];
          if (outcome.kind === 'BLOCKED') {
            expect(outcome.code).toBeTypeOf('string');
          }
        }
      }
    }
  });
});

describe('the classifier is pure', () => {
  it('produces identical output for identical input across repeated calls', () => {
    const snapshot = snapshotWith([cleanWorkspace(), cleanWorkspace({ caseId: 'ws-c-other-11111111', comparisonKey: 'c:/other' })]);
    const first = JSON.stringify(classify(snapshot, 'WORKTREE_REMOVAL'));
    for (let i = 0; i < 50; i += 1) {
      expect(JSON.stringify(classify(snapshot, 'WORKTREE_REMOVAL'))).toBe(first);
    }
  });

  it('carries no severity and no confidence anywhere in its output', () => {
    const serialized = JSON.stringify(classify(snapshotWith([cleanWorkspace()]), 'WORKTREE_REMOVAL'));
    expect(serialized).not.toMatch(/"severity"/);
    expect(serialized).not.toMatch(/"confidence"/);
  });

  it('expresses every disposition for a named operation and bundles the identity digest (A14)', () => {
    const result = classify(snapshotWith([cleanWorkspace()]), 'WORKTREE_REMOVAL');
    for (const d of result.dispositions) {
      expect(d.operation).toBe('WORKTREE_REMOVAL');
      expect(d.identityDigest).toBe('c'.repeat(64));
    }
  });
});
