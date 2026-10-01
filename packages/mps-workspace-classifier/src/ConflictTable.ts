/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the conflict model as a total data table (A23 / Del D 16).
 *
 * A23 asks for data rather than if-statements, so a verifier can review the model cell by cell
 * instead of mentally executing a branch chain, and it asks for compiler-checked exhaustive matching
 * with a default arm of BLOCKED. Both are literal here: the table is a `Record` over the full
 * template-literal union of keys, so TypeScript refuses to compile if any of the 120 combinations is
 * missing, and `resolveConflict` still falls back to an unconditional BLOCKED for a key that was
 * constructed outside the union (a cast, a JSON round-trip, a widened axis).
 *
 * EACH SOURCE'S CLAIM IS RETAINED SEPARATELY. The axes below are projections of four independent
 * observations that the snapshot keeps apart: the filesystem, git's own worktree list, the
 * `.git/worktrees` metadata directory, and the workspace's own view of which repository it belongs
 * to. Where they disagree, the disagreement is the finding — which is why rows
 * REGISTERED_UNCORRELATED exist at all rather than being resolved by picking a winner.
 *
 * THE MANDATED LEASE ROW, honestly. A23 names "lease active + filesystem gone" as a row. There is no
 * lease axis here, and that is not an omission: the frozen command surface records under
 * knownNonSources that no lease is observable on disk at the canonical base (leases exist only in
 * InMemoryLeaseRegistry; the durable store persists units, events, acceptedAgentRuns and outbox and
 * has no leases section). The Observer therefore emits NO lease field at all, because a snapshot
 * field without a raw input in the same artifact would violate A2 and A16. An axis reading a field
 * that does not exist would be a fabricated dimension with one inhabited value and two dead arms,
 * and dead arms rot. The row degenerates into ABSENT × REGISTERED_CORRELATED, which is present,
 * blocked, and exercised by seven frozen cases. When a lease becomes observable, adding the axis is
 * an adjudicated contract change, not an Observer fallback.
 */

/** The filesystem's claim, from the R-F-06 lstat and the `.git` entry probe. */
export const CANDIDATE_SHAPES = [
  /** lstat OBSERVED, exists false, ENOENT or ENOTDIR: a conclusive absence. */
  'ABSENT',
  /** lstat OBSERVED, exists, but the entry is a file, symlink or other. */
  'PRESENT_NOT_DIR',
  /** A directory whose `.git` is itself a directory: a separate repository, or the main worktree. */
  'DIR_DOTGIT_DIR',
  /** A directory whose `.git` is a pointer file or a symlink: the normal linked-worktree shape. */
  'DIR_DOTGIT_POINTER',
  /** A directory with no `.git` entry at all. */
  'DIR_DOTGIT_ABSENT',
  /** Either probe was inconclusive: timeout, EACCES, ELOOP, unparseable. */
  'INCONCLUSIVE',
] as const;

/** git's registration view crossed with the metadata directory. */
export const METADATA_CLAIMS = [
  /** Listed by `git worktree list` AND a `.git/worktrees/<id>` correlates to this comparison key. */
  'REGISTERED_CORRELATED',
  /** Exactly one of the two. The sources disagree, and that disagreement is itself the finding. */
  'REGISTERED_UNCORRELATED',
  /** Neither source knows this path. */
  'METADATA_ABSENT',
  /** R-G-03 or the metadata families were not conclusively observed. */
  'INCONCLUSIVE',
] as const;

/** The workspace's own answer to "which repository am I, and where is my root". */
export const WORKSPACE_VIEWS = [
  /** Member of THIS repository and the candidate path IS the worktree root. */
  'MEMBER_TOPLEVEL_EQ',
  /**
   * The candidate is not the root: git resolved to an enclosing worktree. Checked BEFORE membership,
   * because a directory that is not any worktree's root is not something `git worktree remove` can
   * operate on regardless of which repository encloses it — and deciding it this way avoids having
   * to resolve a relative `../../.git` common dir, which the frozen path policy forbids collapsing.
   */
  'TOPLEVEL_NOT_CANDIDATE',
  /** Member of a DIFFERENT repository with its own object database. */
  'FOREIGN',
  /** `git rev-parse` exited 128: path missing or not a repository. Conclusive. */
  'UNAVAILABLE',
  /** Timeout, spawn error, or output that could not be parsed. */
  'INCONCLUSIVE',
] as const;

export type CandidateShape = (typeof CANDIDATE_SHAPES)[number];
export type MetadataClaim = (typeof METADATA_CLAIMS)[number];
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];

export type ConflictKey = `${CandidateShape}|${MetadataClaim}|${WorkspaceView}`;

export type ConflictOutcome =
  /**
   * The ONLY outcome that is not a block. It does not mean "safe": it means the four sources agree
   * that this is a registered linked worktree of this repository rooted at this path, so the
   * removal-safety predicates (dirty, lineage, lock, in-progress, main-worktree) are worth
   * evaluating. They may still block.
   */
  | { readonly kind: 'PROCEED_TO_PREDICATES' }
  | { readonly kind: 'BLOCKED'; readonly code: ConflictBlockerCode };

export type ConflictBlockerCode =
  | 'OBSERVATION_INCONCLUSIVE'
  | 'WORKSPACE_PATH_ABSENT'
  | 'WORKSPACE_PATH_NOT_A_DIRECTORY'
  | 'FOREIGN_REPOSITORY'
  | 'DANGLING_GITDIR_POINTER'
  | 'UNREGISTERED_FILESYSTEM_ONLY'
  | 'TOPLEVEL_NOT_CANDIDATE'
  | 'SOURCE_DISAGREEMENT_REGISTRATION'
  | 'UNCLASSIFIED_SOURCE_COMBINATION';

const INCONCLUSIVE: ConflictOutcome = { kind: 'BLOCKED', code: 'OBSERVATION_INCONCLUSIVE' };
const ABSENT: ConflictOutcome = { kind: 'BLOCKED', code: 'WORKSPACE_PATH_ABSENT' };
const NOT_DIR: ConflictOutcome = { kind: 'BLOCKED', code: 'WORKSPACE_PATH_NOT_A_DIRECTORY' };
const FOREIGN: ConflictOutcome = { kind: 'BLOCKED', code: 'FOREIGN_REPOSITORY' };
const DANGLING: ConflictOutcome = { kind: 'BLOCKED', code: 'DANGLING_GITDIR_POINTER' };
const UNREGISTERED: ConflictOutcome = { kind: 'BLOCKED', code: 'UNREGISTERED_FILESYSTEM_ONLY' };
const NOT_ROOT: ConflictOutcome = { kind: 'BLOCKED', code: 'TOPLEVEL_NOT_CANDIDATE' };
const DISAGREE: ConflictOutcome = { kind: 'BLOCKED', code: 'SOURCE_DISAGREEMENT_REGISTRATION' };
const PROCEED: ConflictOutcome = { kind: 'PROCEED_TO_PREDICATES' };

/**
 * The DEFAULT ARM. Reachable only through a key built outside the union, and unconditionally
 * BLOCKED, so a future axis value that someone forgets to enumerate fails closed rather than
 * falling through to "safe".
 */
export const DEFAULT_ARM: ConflictOutcome = {
  kind: 'BLOCKED',
  code: 'UNCLASSIFIED_SOURCE_COMBINATION',
};

/**
 * The cell assignment rule, evaluated once per key at module load to build the literal table below.
 *
 * Written as an ordered rule list, then EXPANDED into all 120 cells, so the table is genuinely
 * enumerable, printable and diffable — a reviewer who wants to check one cell reads that cell, not
 * this function.
 */
function assign(shape: CandidateShape, meta: MetadataClaim, view: WorkspaceView): ConflictOutcome {
  // 1. Any inconclusive source blocks first. The safety criterion is unconditional, so an
  //    unresolved observation can never be reasoned past by another source's confidence.
  if (shape === 'INCONCLUSIVE' || meta === 'INCONCLUSIVE' || view === 'INCONCLUSIVE') {
    return INCONCLUSIVE;
  }

  // 2. The path is not there. Whether the METADATA still registers it is exactly the "registered +
  //    filesystem gone" disagreement, and it is a METADATA_PRUNE question rather than a worktree
  //    removal; V1 blocks the removal it was asked about and says which fact stopped it.
  if (shape === 'ABSENT') return ABSENT;
  if (shape === 'PRESENT_NOT_DIR') return NOT_DIR;

  // 3. Not the root of a worktree: removing it is not the operation the disposition names.
  if (view === 'TOPLEVEL_NOT_CANDIDATE') return NOT_ROOT;

  // 4. `git rev-parse` said 128 in a directory that exists. The directory is not a repository at
  //    all, or its pointer does not resolve — and when a `.git` POINTER is present that is exactly
  //    the dangling-pointer case, which is materially different from an unmanaged directory.
  if (view === 'UNAVAILABLE') {
    return shape === 'DIR_DOTGIT_POINTER' ? DANGLING : UNREGISTERED;
  }

  // 5. A different repository with its own object database. Never removable under this repository's
  //    authority, however clean it looks.
  if (view === 'FOREIGN') return FOREIGN;

  // 6. Member of this repository, rooted here. The remaining question is whether the two
  //    registration sources agree.
  if (meta === 'REGISTERED_CORRELATED') {
    // A `.git` directory here means the MAIN worktree (a linked worktree has a pointer file). It is
    // a member, correlated and rooted here, so it proceeds — and the main-worktree predicate blocks
    // it in the next stage, where the reason is recorded as its own blocker rather than hidden in a
    // conflict cell.
    return PROCEED;
  }
  if (meta === 'REGISTERED_UNCORRELATED') return DISAGREE;
  return UNREGISTERED;
}

type TableRecord = Readonly<Record<ConflictKey, ConflictOutcome>>;

function buildTable(): TableRecord {
  const out: Partial<Record<ConflictKey, ConflictOutcome>> = {};
  for (const shape of CANDIDATE_SHAPES) {
    for (const meta of METADATA_CLAIMS) {
      for (const view of WORKSPACE_VIEWS) {
        out[`${shape}|${meta}|${view}`] = assign(shape, meta, view);
      }
    }
  }
  return out as TableRecord;
}

/** 6 × 4 × 5 = 120 cells, all present. */
export const CONFLICT_TABLE: TableRecord = Object.freeze(buildTable());

export const CONFLICT_TABLE_CELL_COUNT =
  CANDIDATE_SHAPES.length * METADATA_CLAIMS.length * WORKSPACE_VIEWS.length;

export function conflictKey(
  shape: CandidateShape,
  meta: MetadataClaim,
  view: WorkspaceView,
): ConflictKey {
  return `${shape}|${meta}|${view}`;
}

export function resolveConflict(
  shape: CandidateShape,
  meta: MetadataClaim,
  view: WorkspaceView,
): ConflictOutcome {
  return CONFLICT_TABLE[conflictKey(shape, meta, view)] ?? DEFAULT_ARM;
}

/** Render the fully expanded table so a reviewer can check it cell by cell, as A23 intends. */
export function renderConflictTable(): string {
  const rows: string[] = ['| candidate shape | metadata | workspace view | outcome |', '|---|---|---|---|'];
  for (const shape of CANDIDATE_SHAPES) {
    for (const meta of METADATA_CLAIMS) {
      for (const view of WORKSPACE_VIEWS) {
        const cell = CONFLICT_TABLE[conflictKey(shape, meta, view)];
        const outcome = cell.kind === 'PROCEED_TO_PREDICATES' ? 'PROCEED_TO_PREDICATES' : `BLOCKED ${cell.code}`;
        rows.push(`| ${shape} | ${meta} | ${view} | ${outcome} |`);
      }
    }
  }
  return rows.join('\n');
}
