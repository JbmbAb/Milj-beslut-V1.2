/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the identityDigest and its inclusion rule (spec A9/A10/B6).
 *
 * THE INCLUSION TEST, which every decision below is measured against:
 *
 *   A field belongs in the digest if and only if a reimplementation with different logic, against
 *   an unchanged world, necessarily produces the same value.
 *
 * The digest answers "has the observed world changed since the disposition was made", so that V2
 * can delete under compare-and-swap. It does NOT answer "has our interpretation changed". Anything
 * that is our reading rather than the world's fact is excluded, even when it is useful — a reading
 * that drifts would make the CAS condition fail on an untouched machine, and the predictable
 * response to a condition that always fails is to loosen it.
 *
 * The three exclusions the spec names explicitly:
 *   graphRelation  our label for a topology, not the topology (A10)
 *   observedAt, durations, versions, transcript references  provenance, not world (A9)
 *   `generation`   omitted entirely: an undefined term makes the digest non-portable (A10)
 *
 * ABSENCE ENCODING. An unobserved value is OMITTED, never null. The pinned primitive emits an
 * omitted field and an explicit null differently ({} and {"headSha":null} have different digests),
 * so a single consistent rule is what keeps two conforming implementations on the same bytes.
 *
 * NOT a CAS content_hash. `content_hash` (BLAKE3, over a signed envelope including provenance and
 * timestamps) would differ on every re-observation of an untouched machine; using it as the CAS
 * condition would guarantee the condition gets loosened. They are never aliased (A13).
 */
import { DOMAINS, framedDigest } from '../digest/CanonicalDigest.js';
import type {
  AncestryFacts,
  RepositoryObservation,
  StatusFacts,
  WorkspaceObservation,
  WorkspaceSnapshotArtifact,
} from './types.js';
import { SNAPSHOT_SCHEMA_ID } from './types.js';

/**
 * The inclusion table, as data rather than as prose, so a reviewer can check it cell by cell and a
 * test can assert that the projection covers exactly these paths.
 *
 * `included: false` rows are the interesting ones: each names a field that EXISTS on the artifact
 * and is deliberately kept out of the digest, with the reason.
 */
export interface InclusionRow {
  readonly field: string;
  readonly included: boolean;
  readonly justification: string;
}

export const DIGEST_INCLUSION_TABLE: readonly InclusionRow[] = Object.freeze([
  {
    field: 'schemaId',
    included: true,
    justification: 'Domain constant; identical for every conforming implementation.',
  },
  {
    field: 'repository.repoRoot',
    included: true,
    justification: 'The observed root, spelled as given. The Observer never rewrites it.',
  },
  {
    field: 'repository.commonDir',
    included: true,
    justification: 'git rev-parse --git-common-dir output, resolved by the frozen path rule.',
  },
  {
    field: 'repository.canonicalSha',
    included: true,
    justification: 'World fact; the selection rule is frozen, so any implementation selects the same SHA.',
  },
  {
    field: 'repository.canonicalShaSource',
    included: true,
    justification:
      'Which frozen rule clause supplied the SHA. Determined by the same frozen rule, and a change of source is a change in what the reference actually is.',
  },
  {
    field: 'repository.canonicalShaStableAcrossWindow',
    included: true,
    justification:
      'BEFORE and AFTER reads of the same ref. A16 makes an unstable reference a property of the observation window that any implementation reading twice would find.',
  },
  {
    field: 'repository.canonicalRefUpdatedAtEpochSeconds',
    included: true,
    justification:
      'The reflog timestamp of the local tracking ref: a property of the world, not of this run. B9 staleness depends on it, and it changes exactly when the ref is updated.',
  },
  {
    field: 'repository.stashes[].stashCommit / firstParent',
    included: true,
    justification: 'Raw reflog fields. A new stash must invalidate a disposition (A22).',
  },
  {
    field: 'repository.stashes[].selector',
    included: false,
    justification:
      'stash@{n} is positional, and array order is already digest-covered. Including it would make a push or pop re-key dispositions twice over for one change the entries list already records.',
  },
  {
    field: 'repository.stashes[].attribution',
    included: false,
    justification:
      'Our parent-to-workspace mapping, not the repository’s. A different correlation rule could attribute differently against an unchanged world.',
  },
  {
    field: 'repository.mainWorktreeEntryNames',
    included: true,
    justification:
      'Raw directory entry names of the common dir, sorted. Carries the main worktree’s lock and in-progress state without depending on our idea of which names are "lock-shaped".',
  },
  {
    field: 'repository.configuration',
    included: true,
    justification:
      'The frozen config keys and their values, as git reported them. Changing core.ignorecase changes what a path comparison means.',
  },
  {
    field: 'repository.canonicalUnitFiles',
    included: false,
    justification:
      'A pure function of the included canonicalSha — ls-tree at a fixed commit cannot change while the commit does not. Registry-adjacent reporting evidence; no WORKTREE_REMOVAL predicate reads it.',
  },
  {
    field: 'repository.mutationEvidence',
    included: false,
    justification:
      'Whether OUR OBSERVATION mutated anything is a property of the run, not of the observed world. It is a blocker and a report line, not an identity input.',
  },
  {
    field: 'workspaces[].caseId / comparisonKey',
    included: true,
    justification:
      'Source-invariant identity: caseId is SHA-256 over the comparison key, and the comparison key is a frozen pure function of a path spelling. Adding or removing a discovery source cannot change either.',
  },
  {
    field: 'workspaces[].preferredSpelling / spellings',
    included: false,
    justification:
      'Both depend on WHICH DISCOVERY SOURCES FIRED, not on the world. The frozen corpus proves it: one candidate carries C:\\lu-clean-final from S3 and C:/lu-clean-final from S1, S2 and S4, and dropping a source would change the preferred spelling while the directory stayed identical. They resolve to the same comparison key, which IS included, so nothing about which directory is meant is lost.',
  },
  {
    field: 'workspaces[].observationState',
    included: true,
    justification:
      'Whether the world answered. The mapping from outcome and exit code to state is fixed by the surface’s frozen interpretations, so it is not a free choice; and a workspace that stopped answering MUST invalidate a disposition.',
  },
  {
    field: 'workspaces[].unknownReason',
    included: true,
    justification:
      'TIMEOUT, SPAWN_ERROR, non-zero exit and inconclusive filesystem errors are caused by the world, and a change between them is a change in what the machine did.',
  },
  {
    field: 'workspaces[].notAttemptedReason',
    included: false,
    justification:
      'A fact about THIS RUN’s scope, not about the world. The same unchanged machine observed under a different scope would produce a different value, so it fails the inclusion test.',
  },
  {
    field: 'workspaces[].gitWorktreeList.*',
    included: true,
    justification: 'git worktree list --porcelain fields, verbatim.',
  },
  {
    field: 'workspaces[].gitMetadata.registered / gitdirPointer / gitdirTargetPresent / registeredHead / metadataEntryNames',
    included: true,
    justification:
      'Raw metadata-directory facts. Entry NAMES rather than our lock/in-progress classification, so the digest does not depend on which names we currently consider lock-shaped.',
  },
  {
    field: 'workspaces[].gitMetadata.lockFiles / inProgressMarkers',
    included: false,
    justification:
      'Derived subsets of metadataEntryNames under our own pattern list. The raw names are included instead (A24: one authoritative representation).',
  },
  {
    field: 'workspaces[].filesystem.pathPresent / entryType / errorCode / realpath / dotGitType / dotGitAbsent / dotGitPointer',
    included: true,
    justification: 'lstat, realpath and the .git entry kind and pointer: what the OS answered.',
  },
  {
    field: 'workspaces[].filesystem.entryCount',
    included: false,
    justification:
      'Passes A10 but fails A9’s safety-relevance gate. It counts build output and ignored files, no removal predicate reads it, and it changes on every compile — so including it would guarantee the V2 compare-and-swap never succeeds on an active tree, which is precisely the pressure that gets a CAS condition loosened. The content signals that DO carry removal safety are trackedModificationCount and untrackedEntryCount, both included.',
  },
  {
    field: 'workspaces[].branchBinding.*',
    included: true,
    justification: 'for-each-ref fields, verbatim.',
  },
  {
    field: 'workspaces[].toplevel',
    included: true,
    justification: 'git rev-parse --show-toplevel output, verbatim.',
  },
  {
    field: 'workspaces[].workspaceGitDir / workspaceGitCommonDir / insideWorkTree / workspaceGitExitCode',
    included: true,
    justification:
      'The raw R-W-03 answers and the exit code they came with. Carried and covered because A2 permits a derived field only when its raw input is in the same artifact, and repositoryMembership and workspaceGitUnavailable are derivations over exactly these.',
  },
  {
    field: 'workspaces[].repositoryMembership / workspaceGitUnavailable',
    included: false,
    justification:
      'Derivations over the four raw values above, all of which are included. Excluding them keeps the digest neutral about HOW we resolve a relative common dir — a choice a reimplementation could reasonably make differently against an identical world.',
  },
  {
    field: 'workspaces[].toplevelMatchesCandidate',
    included: false,
    justification:
      'Derived from toplevel and preferredSpelling by the frozen comparison rule. Including it would be a second representation of one material fact (A24).',
  },
  {
    field: 'workspaces[].symbolicRef',
    included: true,
    justification: 'git symbolic-ref -q HEAD output, verbatim.',
  },
  {
    field: 'workspaces[].status.trackedModificationCount / untrackedEntryCount / unmergedCount / branch fields',
    included: true,
    justification:
      'Counts and branch headers from porcelain v2. The redaction policy never alters a count, so the frozen bytes and a live read agree.',
  },
  {
    field: 'workspaces[].status.pathsElided',
    included: false,
    justification:
      'A property of the capture’s truncation threshold, not of the workspace. Counts stay exact when it is true, so nothing is lost.',
  },
  {
    field: 'workspaces[].ancestry.*',
    included: true,
    justification:
      'headSha, object existence, both ancestry directions, mergeBase and the two commit counts. Git computes each of them; a changed answer means the object graph actually moved. mergeBase is kept for exactly that reason (A10).',
  },
  {
    field: 'workspaces[].declaredUnitFiles',
    included: false,
    justification:
      'Registry-adjacent reporting evidence that no removal predicate reads. A change to these files inside a workspace already shows up in trackedModificationCount or untrackedEntryCount, which are included, so exclusion loses no change-detection power.',
  },
  {
    field: 'workspaces[].contentEvidence',
    included: false,
    justification:
      'Derived from ancestry.allUniqueCommitsPatchEquivalent. A24: the raw fact is already included.',
  },
  {
    field: 'workspaces[].graphRelation',
    included: false,
    justification:
      'Our mapping of the world, not the world (A10, named explicitly by the spec). A reimplementation could label the same topology differently.',
  },
  {
    field: 'workspaces[].proofs',
    included: false,
    justification:
      'Presentation of the commands that proved facts already covered. The strings are our formatting.',
  },
  {
    field: 'metadata.*',
    included: false,
    justification:
      'observedAt, durations, versions, coverage counts, scope and transcript references. A9 keeps them out so that re-observing an untouched machine reproduces the digest.',
  },
  {
    field: 'generation',
    included: false,
    justification:
      'Omitted entirely rather than excluded: the term has no normative, reproducible definition, and an undefined term makes the digest non-portable (A10).',
  },
]);

type Json = string | number | boolean | Json[] | { [k: string]: Json };

/** Drop undefined members so absence is encoded by omission, never by an explicit null. */
function compact(obj: Record<string, Json | undefined>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function projectStatus(s: StatusFacts): Record<string, Json> {
  return compact({
    trackedModificationCount: s.trackedModificationCount,
    untrackedEntryCount: s.untrackedEntryCount,
    unmergedCount: s.unmergedCount,
    branchHead: s.branchHead,
    branchOid: s.branchOid,
    branchUpstream: s.branchUpstream,
    aheadOfUpstream: s.aheadOfUpstream,
    behindUpstream: s.behindUpstream,
  });
}

function projectAncestry(a: AncestryFacts): Record<string, Json> {
  return compact({
    headSha: a.headSha,
    headCommitExists: a.headCommitExists,
    headIsAncestorOfCanonical: a.headIsAncestorOfCanonical,
    canonicalIsAncestorOfHead: a.canonicalIsAncestorOfHead,
    mergeBase: a.mergeBase,
    commitsAheadOfCanonical: a.commitsAheadOfCanonical,
    commitsBehindCanonical: a.commitsBehindCanonical,
    allUniqueCommitsPatchEquivalent: a.allUniqueCommitsPatchEquivalent,
    uniqueCommitCount: a.uniqueCommitCount,
  });
}

function projectObserved<T>(
  o: { state: string; unknownReason?: string; value?: T },
  projectValue: (v: T) => Json,
): Record<string, Json> {
  return compact({
    state: o.state,
    unknownReason: o.unknownReason,
    value: o.value === undefined ? undefined : projectValue(o.value),
  });
}

function projectWorkspace(w: WorkspaceObservation): Record<string, Json> {
  return compact({
    caseId: w.caseId,
    comparisonKey: w.comparisonKey,
    observationState: w.observationState,
    gitWorktreeList: compact({
      listed: w.gitWorktreeList.listed,
      path: w.gitWorktreeList.path,
      head: w.gitWorktreeList.head,
      branch: w.gitWorktreeList.branch,
      detached: w.gitWorktreeList.detached,
      locked: w.gitWorktreeList.locked,
      lockedReason: w.gitWorktreeList.lockedReason,
      prunable: w.gitWorktreeList.prunable,
      prunableReason: w.gitWorktreeList.prunableReason,
      bare: w.gitWorktreeList.bare,
    }),
    gitMetadata: compact({
      registered: w.gitMetadata.registered,
      worktreeId: w.gitMetadata.worktreeId,
      gitdirPointer: w.gitMetadata.gitdirPointer,
      gitdirTargetPresent: w.gitMetadata.gitdirTargetPresent,
      gitdirTargetErrorCode: w.gitMetadata.gitdirTargetErrorCode,
      registeredHead: w.gitMetadata.registeredHead,
      lockedMarker: w.gitMetadata.lockedMarker,
      lockedMarkerReason: w.gitMetadata.lockedMarkerReason,
      metadataEntryNames:
        w.gitMetadata.metadataEntryNames === undefined
          ? undefined
          : [...w.gitMetadata.metadataEntryNames],
      hasWorktreeConfig: w.gitMetadata.hasWorktreeConfig,
    }),
    filesystem: compact({
      pathPresent: projectObserved(w.filesystem.pathPresent, (v) => v),
      entryType: w.filesystem.entryType,
      errorCode: w.filesystem.errorCode,
      realpath: w.filesystem.realpath,
      dotGitType: w.filesystem.dotGitType,
      dotGitAbsent: w.filesystem.dotGitAbsent,
      dotGitPointer: w.filesystem.dotGitPointer,
    }),
    branchBinding: compact({
      bound: w.branchBinding.bound,
      refname: w.branchBinding.refname,
      objectname: w.branchBinding.objectname,
      upstream: w.branchBinding.upstream,
      upstreamTrack: w.branchBinding.upstreamTrack,
    }),
    toplevel: projectObserved(w.toplevel, (v) => v),
    workspaceGitDir: projectObserved(w.workspaceGitDir, (v) => v),
    workspaceGitCommonDir: projectObserved(w.workspaceGitCommonDir, (v) => v),
    insideWorkTree: projectObserved(w.insideWorkTree, (v) => v),
    workspaceGitExitCode: w.workspaceGitExitCode,
    symbolicRef: projectObserved(w.symbolicRef, (v) => v),
    status: projectObserved(w.status, projectStatus),
    ancestry: projectObserved(w.ancestry, projectAncestry),
  });
}

function projectRepository(r: RepositoryObservation): Record<string, Json> {
  const configuration: Record<string, Json> = {};
  for (const key of Object.keys(r.configuration).sort()) {
    configuration[key] = projectObserved(r.configuration[key], (v) => [...v]);
  }
  return compact({
    repoRoot: r.repoRoot,
    canonicalRef: r.canonicalRef,
    commonDir: projectObserved(r.commonDir, (v) => v),
    canonicalSha: projectObserved(r.canonicalSha, (v) => v),
    canonicalShaSource: r.canonicalShaSource,
    canonicalShaStableAcrossWindow: projectObserved(r.canonicalShaStableAcrossWindow, (v) => v),
    canonicalRefUpdatedAtEpochSeconds: projectObserved(
      r.canonicalRefUpdatedAtEpochSeconds,
      (v) => v,
    ),
    stashes: projectObserved(r.stashes, (list) =>
      list.map((s) => compact({ stashCommit: s.stashCommit, firstParent: s.firstParent })),
    ),
    mainWorktreeEntryNames: projectObserved(r.mainWorktreeEntryNames, (v) => [...v]),
    configuration,
  });
}

/**
 * The digest-eligible projection of a snapshot.
 *
 * Built by explicit construction rather than by deleting fields from the artifact. A denylist that
 * someone forgets to extend silently widens the digest; an allowlist that someone forgets to extend
 * silently narrows it, but the inclusion table and its test make that visible.
 */
export function digestPayload(
  snapshot: Pick<WorkspaceSnapshotArtifact, 'repository' | 'workspaces'>,
): Record<string, Json> {
  return {
    schemaId: SNAPSHOT_SCHEMA_ID,
    repository: projectRepository(snapshot.repository),
    // Case order, so two runs that discovered the same world in a different order agree.
    workspaces: [...snapshot.workspaces]
      .sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0))
      .map(projectWorkspace),
  };
}

/** identityDigest = SHA-256 of the SNAPSHOT_V1-framed canonical bytes of the projection. */
export function computeIdentityDigest(
  snapshot: Pick<WorkspaceSnapshotArtifact, 'repository' | 'workspaces'>,
): { readonly bytes: Uint8Array; readonly digest: string } {
  return framedDigest(DOMAINS.SNAPSHOT_V1, digestPayload(snapshot));
}
