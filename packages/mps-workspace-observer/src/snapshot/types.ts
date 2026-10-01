/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — WorkspaceSnapshotArtifact.
 *
 * The snapshot is the immutable output of observation and the sole input to classification. Four
 * rules shape every type here, and each of them is a rule about what must be IMPOSSIBLE to express:
 *
 *  A2  Derived fields are allowed only when their raw inputs sit in the same artifact. Every
 *      derived value below names the requestId(s) it came from, and the ledger keeps the raw
 *      response beside it.
 *  A3  One record per discovered workspace, always, in one of three observation states. There is
 *      no way to express "this workspace was uninteresting" — the type has no such shape.
 *  A23 Each source's claim is retained SEPARATELY. Git's worktree list, the .git metadata
 *      directory, the filesystem and the branch binding each get their own field, because when they
 *      disagree the disagreement is itself the finding, and a merged view would erase it.
 *  A24 Exactly one authoritative representation per material fact. There is no `confidence`, no
 *      `severity` and no second copy of a fact in a different vocabulary.
 *
 * Absence encoding, which the digest artifact pins: an unobserved value is OMITTED, never null. A
 * value field appears if and only if its observation reached OBSERVED. The canonical primitive
 * emits an omitted field and an explicit null differently, so this rule is what keeps two
 * implementations of the same observation on the same bytes.
 */
import type { ObservationState, NotAttemptedReason, UnknownReason } from '../observe/ObservationLedger.js';

export const SNAPSHOT_SCHEMA_ID = 'WORKSPACE_SNAPSHOT_V1';
export const SNAPSHOT_SCHEMA_VERSION = '1.0.0';
export const OBSERVER_VERSION = '1.0.0';

/**
 * The state of one observed fact. `state` is always present; the fact's value fields are present
 * only when it is OBSERVED.
 *
 * UNKNOWN and NOT_ATTEMPTED are kept apart all the way into the snapshot. Both fall closed, but
 * they are different facts — one says the world would not answer, the other says we did not ask —
 * and a classifier that could not tell them apart could not report which of the two it hit.
 */
export interface Observed<T> {
  readonly state: ObservationState;
  readonly unknownReason?: UnknownReason;
  readonly notAttemptedReason?: NotAttemptedReason;
  readonly value?: T;
}

/** A19: a predicate is only true when a named command proved it, and the command is recorded. */
export interface PositiveProof {
  readonly predicate: string;
  readonly provenBy: string;
  readonly requestId: string;
  readonly exitCode: number | null;
}

export type CandidateSourceId = 'S1' | 'S2' | 'S3' | 'S4';

export interface SpellingClaim {
  readonly source: CandidateSourceId;
  readonly path: string;
}

/** A20/A23 source 1: git's own registration view, from `git worktree list --porcelain`. */
export interface GitWorktreeListClaim {
  readonly listed: boolean;
  readonly path?: string;
  readonly head?: string;
  readonly branch?: string;
  readonly detached?: boolean;
  readonly locked?: boolean;
  readonly lockedReason?: string;
  readonly prunable?: boolean;
  readonly prunableReason?: string;
  readonly bare?: boolean;
}

/** A20/A23 source 2: the `.git/worktrees/<id>` metadata directory. */
export interface GitMetadataClaim {
  readonly registered: boolean;
  readonly worktreeId?: string;
  /** Trimmed content of the `gitdir` pointer file. */
  readonly gitdirPointer?: string;
  /** Whether lstat on the pointer target succeeded. A dangling pointer is a material fact. */
  readonly gitdirTargetPresent?: boolean;
  readonly gitdirTargetErrorCode?: string;
  readonly registeredHead?: string;
  /** Presence of a `locked` marker file, and its reason when readable. */
  readonly lockedMarker?: boolean;
  readonly lockedMarkerReason?: string;
  /**
   * Raw, sorted entry names of `.git/worktrees/<id>`.
   *
   * The RAW names are what the digest covers. `lockFiles` and `inProgressMarkers` below are our
   * filtered readings of this list, and which names count as lock-shaped is our vocabulary, not
   * git's: two conforming implementations could reasonably draw that boundary differently, so the
   * filtered lists fail the A10 inclusion test while the raw list passes it cleanly.
   */
  readonly metadataEntryNames?: readonly string[];
  /** Derived from metadataEntryNames: index.lock, HEAD.lock, *.lock. Outside the digest. */
  readonly lockFiles?: readonly string[];
  /** Derived: MERGE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD, rebase-merge, rebase-apply, BISECT_*. */
  readonly inProgressMarkers?: readonly string[];
  readonly hasWorktreeConfig?: boolean;
}

/** A20/A23 source 3: the filesystem itself, from R-F-06. */
export interface FilesystemClaim {
  readonly pathPresent: Observed<boolean>;
  readonly entryType?: 'file' | 'dir' | 'symlink' | 'other';
  readonly errorCode?: string;
  readonly realpath?: string;
  readonly entryCount?: number;
  /** The `.git` entry: a directory means a separate repository or the main worktree. */
  readonly dotGitType?: 'file' | 'dir' | 'symlink' | 'other';
  readonly dotGitAbsent?: boolean;
  /** The `gitdir: <path>` target read from a `.git` pointer FILE. */
  readonly dotGitPointer?: string;
}

/** A20/A23 source 4: the branch-to-worktree binding from `for-each-ref`. */
export interface BranchBindingClaim {
  readonly bound: boolean;
  readonly refname?: string;
  readonly objectname?: string;
  readonly upstream?: string;
  readonly upstreamTrack?: string;
}

/** Working-tree cleanliness, as counts. Names are redacted in the corpus; counts never are. */
export interface StatusFacts {
  readonly trackedModificationCount: number;
  readonly untrackedEntryCount: number;
  readonly unmergedCount: number;
  readonly branchHead?: string;
  readonly branchOid?: string;
  readonly branchUpstream?: string;
  readonly aheadOfUpstream?: number;
  readonly behindUpstream?: number;
  /**
   * Whether the status output had paths elided by the frozen truncation rule. Counts stay exact
   * when this is true, which is why it does not make the observation inconclusive.
   */
  readonly pathsElided?: boolean;
}

/**
 * Ancestry facts, each proven by a named command.
 *
 * `graphRelation` is deliberately NOT here. It is our interpretation of these facts, it fails the
 * A10 inclusion test, and it lives on the snapshot outside the digest.
 */
export interface AncestryFacts {
  readonly headSha?: string;
  readonly headCommitExists?: boolean;
  readonly headIsAncestorOfCanonical?: boolean;
  readonly canonicalIsAncestorOfHead?: boolean;
  readonly mergeBase?: string;
  /** `rev-list --count canonical..head`: commits here that canonical does not contain. */
  readonly commitsAheadOfCanonical?: number;
  /** `rev-list --count head..canonical`. */
  readonly commitsBehindCanonical?: number;
  /** `git cherry`: every unique commit has an equivalent in canonical. */
  readonly allUniqueCommitsPatchEquivalent?: boolean;
  readonly uniqueCommitCount?: number;
}

/**
 * A17: topology and content evidence are separate, and content evidence never silently shadows
 * topology.
 *
 * REGISTERED_RECONCILIATION is NOT a value V1 may emit: no reconciliation registry exists at the
 * frozen base, and the command surface records that as a declared non-source. Absent registered
 * evidence the value is NONE — never assumed equivalence.
 */
export type ContentEvidence = 'NONE' | 'PATCH_ID_MATCH';

/** Our reading of the topology. Excluded from the identity digest by the A10 inclusion test. */
export type GraphRelation = 'EQUAL' | 'ANCESTOR' | 'DESCENDANT' | 'DIVERGED' | 'UNKNOWN';

export interface WorkspaceObservation {
  readonly caseId: string;
  readonly comparisonKey: string;
  readonly preferredSpelling: string;
  readonly spellings: readonly SpellingClaim[];

  /** The overall state of this workspace's observation: OBSERVED only when every required fact is. */
  readonly observationState: ObservationState;
  readonly notAttemptedReason?: NotAttemptedReason;

  readonly gitWorktreeList: GitWorktreeListClaim;
  readonly gitMetadata: GitMetadataClaim;
  readonly filesystem: FilesystemClaim;
  readonly branchBinding: BranchBindingClaim;

  readonly toplevel: Observed<string>;
  readonly toplevelMatchesCandidate: Observed<boolean>;
  /**
   * The workspace's own git view, verbatim: the three paths and the flag R-W-03 printed, plus the
   * exit code it printed them with.
   *
   * These are RAW and they are carried because A2 permits a derived field only when its raw input
   * sits in the same artifact. `repositoryMembership` and `workspaceGitUnavailable` below are
   * derivations over exactly these values, and without them in the artifact the derivations would
   * be assertions a reader could not check.
   */
  readonly workspaceGitDir: Observed<string>;
  readonly workspaceGitCommonDir: Observed<string>;
  readonly insideWorkTree: Observed<boolean>;
  /** Present when R-W-03 ran to completion. 128 is conclusive: not a repository, or path missing. */
  readonly workspaceGitExitCode?: number;
  /**
   * Whether the workspace's own git view names THIS repository or another one.
   *
   * UNRESOLVED is a real third value, not a placeholder: git can answer `--git-common-dir` with a
   * relative path such as `../../.git`, and resolving that needs the '..' collapsing the frozen
   * path policy forbids. Guessing would be worse than saying so, and UNRESOLVED falls closed.
   */
  readonly repositoryMembership: Observed<'MEMBER' | 'FOREIGN' | 'UNRESOLVED'>;
  /** `git rev-parse` in the candidate exited 128: conclusively not a repository, or path missing. */
  readonly workspaceGitUnavailable: boolean;
  readonly symbolicRef: Observed<string>;
  readonly status: Observed<StatusFacts>;
  readonly ancestry: Observed<AncestryFacts>;

  /** Names of `governance/devgov/units/*.json` this workspace itself claims. Never merged with the
   * canonical registry: the workspace's claim and the registry's claim are different sources. */
  readonly declaredUnitFiles: readonly string[];

  readonly contentEvidence: ContentEvidence;

  /**
   * Derived topology reading. Present in the artifact so a report can show it; excluded from the
   * identity digest, because a reimplementation with different logic could legitimately produce a
   * different label from the same world.
   */
  readonly graphRelation: GraphRelation;

  /** A19: the commands that positively proved the facts above. */
  readonly proofs: readonly PositiveProof[];
}

export interface StashObservation {
  readonly stashCommit: string;
  readonly firstParent?: string;
  readonly selector: string;
  /**
   * A22: attribution narrows evidence and reporting; it NEVER grants cleanup eligibility. A unique
   * parent-to-workspace mapping is recorded as evidence, otherwise the value is UNKNOWN. Ownership
   * is never invented.
   */
  readonly attribution: 'UNKNOWN' | { readonly caseId: string };
}

export interface RepositoryObservation {
  readonly repoRoot: string;
  readonly commonDir: Observed<string>;
  readonly canonicalRef: string;
  readonly canonicalSha: Observed<string>;
  readonly canonicalShaSource: 'R-G-02[BEFORE]' | 'R-G-01[BEFORE]' | 'NONE';
  /**
   * A16: the canonical reference is read before and after the run. When the two differ, origin/main
   * moved mid-observation and the snapshot is suspect.
   */
  readonly canonicalShaStableAcrossWindow: Observed<boolean>;
  /** Epoch seconds of the newest local update to the canonical reference (B9 staleness). */
  readonly canonicalRefUpdatedAtEpochSeconds: Observed<number>;
  readonly stashes: Observed<readonly StashObservation[]>;
  /**
   * Raw, sorted entry names of the common dir. This is the MAIN worktree's own lock and
   * in-progress state, which no {worktreeId}-keyed family can see. Raw names for the same reason
   * as GitMetadataClaim.metadataEntryNames.
   */
  readonly mainWorktreeEntryNames: Observed<readonly string[]>;
  /** Derived readings of the above. Outside the digest. */
  readonly mainWorktreeLockFiles: Observed<readonly string[]>;
  readonly mainWorktreeInProgressMarkers: Observed<readonly string[]>;
  /**
   * The corpus's own non-mutation proof: R-F-01, R-F-02 and R-F-08 are captured BEFORE and AFTER
   * the workspace pass, and any difference in name, type, size or mtime is recorded evidence that
   * the observation itself changed something. It belongs in the acceptance report, never in the
   * identity digest: whether OUR RUN mutated anything is a property of the run, not of the world.
   */
  readonly mutationEvidence: Observed<{
    readonly comparedPairs: number;
    readonly differingPairs: readonly string[];
  }>;
  readonly configuration: Readonly<Record<string, Observed<readonly string[]>>>;
  /** DEV-GOV unit definition paths registered at the canonical base. */
  readonly canonicalUnitFiles: Observed<readonly string[]>;
}

/**
 * Everything A9 keeps OUT of the identity digest: times, durations, versions and transcript
 * references. Re-observing an untouched machine must reproduce the digest, and it cannot if any of
 * these is inside it.
 */
export interface SnapshotMetadata {
  readonly snapshotSchema: string;
  readonly observerVersion: string;
  /** A16: the interval the snapshot describes, not the instant it was taken. */
  readonly observationWindow?: { readonly start: string; readonly end: string };
  /** Per workspace, derived from that case's own request timings. */
  readonly perWorkspaceWindow?: Readonly<
    Record<string, { readonly start: string; readonly end: string }>
  >;
  readonly transcriptRef?: string;
  readonly commandSurfaceDigest: string;
  readonly observationCoverage: Readonly<Record<ObservationState, number>>;
  /** Which candidates received the workspace-local families in this run. */
  readonly observationScope: readonly string[];
}

export interface WorkspaceSnapshotArtifact {
  readonly schemaId: typeof SNAPSHOT_SCHEMA_ID;
  readonly repository: RepositoryObservation;
  readonly workspaces: readonly WorkspaceObservation[];
  readonly metadata: SnapshotMetadata;
  /**
   * SHA-256 over the framed canonical bytes of the digest-eligible projection under the
   * SNAPSHOT_V1 domain. Not a CAS content_hash and never aliased to one (A13).
   */
  readonly identityDigest: string;
}
