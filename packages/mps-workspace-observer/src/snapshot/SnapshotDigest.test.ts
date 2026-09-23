/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — identityDigest conformance and the B6 property test.
 *
 * Four things are proved here, and each corresponds to a way the digest can be wrong without any
 * suite noticing:
 *
 *  1. The published vectors reproduce. A digest artifact whose expected values were never re-run
 *     against the code is a claim, and A12 exists because a field list is a claim.
 *  2. Mutating ANY digest-covered field changes the digest (B6, stated as a property). The reverse
 *     is checked at the same time: mutating an EXCLUDED field must NOT change it, because that is
 *     the half that keeps the V2 compare-and-swap satisfiable on an untouched machine.
 *  3. Every leaf the ARTIFACT carries is classified by exactly one inclusion-table row. A field
 *     that is neither included nor excluded is the actual failure mode: it enters the projection
 *     or leaves it by accident, and no reviewer sees a decision being made.
 *  4. Determinism at digest level (Del D 4): key insertion order and workspace discovery order are
 *     not inputs. If they were, two runs against one unchanged machine would disagree.
 *
 * The fixture is local and deliberately not exported. Sharing it with the generator would let a
 * change here and a change there cancel out, leaving the vectors green while the published payload
 * matched nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DOMAINS,
  canonicalBytes,
  framePreimage,
  framedDigest,
  sha256Hex,
} from '../digest/CanonicalDigest.js';
import { DIGEST_INCLUSION_TABLE, computeIdentityDigest, digestPayload } from './SnapshotDigest.js';
import { SNAPSHOT_SCHEMA_ID } from './types.js';
import type {
  RepositoryObservation,
  WorkspaceObservation,
  WorkspaceSnapshotArtifact,
} from './types.js';

const VECTORS_PATH = fileURLToPath(
  new URL('../../contracts/snapshot-digest-test-vectors-v1.json', import.meta.url),
);
const DIGEST_ARTIFACT_PATH = fileURLToPath(
  new URL('../../contracts/snapshot-digest-v1.json', import.meta.url),
);

/* ------------------------------------------------------------------------------------------- */
/* Fixture                                                                                       */
/* ------------------------------------------------------------------------------------------- */

/**
 * One snapshot carrying all three observation states and, deliberately, a VALUE FOR EVERY OPTIONAL
 * FIELD the artifact types declare.
 *
 * The optional fields are the point. A leaf that is absent from the fixture is a leaf the
 * classification test never sees, so an unclassified field would pass unnoticed exactly when it is
 * newly added and nobody has decided about it yet.
 */
function makeSnapshot(): WorkspaceSnapshotArtifact {
  const observedCaseId = 'ws-c-wt-alpha-11111111';
  const unknownCaseId = 'ws-c-wt-beta-22222222';
  const notAttemptedCaseId = 'ws-c-wt-gamma-33333333';

  const repository: RepositoryObservation = {
    repoRoot: 'C:\\miljobeslut',
    commonDir: { state: 'OBSERVED', value: 'C:/miljobeslut/.git' },
    canonicalRef: 'refs/remotes/origin/main',
    canonicalSha: { state: 'OBSERVED', value: '0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85' },
    canonicalShaSource: 'R-G-02[BEFORE]',
    canonicalShaStableAcrossWindow: { state: 'OBSERVED', value: true },
    canonicalRefUpdatedAtEpochSeconds: { state: 'OBSERVED', value: 1757462400 },
    stashes: {
      state: 'OBSERVED',
      value: [
        {
          stashCommit: '1111111111111111111111111111111111111111',
          firstParent: '2222222222222222222222222222222222222222',
          selector: 'stash@{0}',
          attribution: 'UNKNOWN',
        },
        {
          stashCommit: '3333333333333333333333333333333333333333',
          firstParent: '4444444444444444444444444444444444444444',
          selector: 'stash@{1}',
          attribution: { caseId: observedCaseId },
        },
      ],
    },
    mainWorktreeEntryNames: {
      state: 'OBSERVED',
      value: ['HEAD', 'MERGE_HEAD', 'config', 'index', 'index.lock', 'worktrees'],
    },
    mainWorktreeLockFiles: { state: 'OBSERVED', value: ['index.lock'] },
    mainWorktreeInProgressMarkers: { state: 'OBSERVED', value: ['MERGE_HEAD'] },
    mutationEvidence: {
      state: 'OBSERVED',
      value: { comparedPairs: 3, differingPairs: ['R-F-01 C:/miljobeslut/.git/index'] },
    },
    configuration: {
      'core.ignorecase': { state: 'OBSERVED', value: ['true'] },
      'core.symlinks': { state: 'OBSERVED', value: ['false'] },
      // A key that was asked for and did not answer: the wrapper's state is digest-covered even
      // when no value exists, because "git would not tell us" is a fact about the machine.
      'extensions.worktreeConfig': { state: 'UNKNOWN', unknownReason: 'NON_ZERO_EXIT' },
    },
    canonicalUnitFiles: {
      state: 'OBSERVED',
      value: ['governance/devgov/units/workspace-lifecycle-controller-v1.json'],
    },
  };

  const observed: WorkspaceObservation = {
    caseId: observedCaseId,
    comparisonKey: 'c:/wt-alpha',
    preferredSpelling: 'C:\\wt-alpha',
    spellings: [
      { source: 'S1', path: 'C:\\wt-alpha' },
      { source: 'S3', path: 'C:/wt-alpha' },
    ],
    observationState: 'OBSERVED',
    gitWorktreeList: {
      listed: true,
      path: 'C:/wt-alpha',
      head: '5555555555555555555555555555555555555555',
      branch: 'refs/heads/feat/alpha',
      detached: false,
      locked: true,
      lockedReason: 'held by implementer',
      prunable: false,
      prunableReason: 'gitdir file points to non-existent location',
      bare: false,
    },
    gitMetadata: {
      registered: true,
      worktreeId: 'wt-alpha',
      gitdirPointer: 'C:/wt-alpha/.git',
      gitdirTargetPresent: true,
      gitdirTargetErrorCode: 'ENOENT',
      registeredHead: '5555555555555555555555555555555555555555',
      lockedMarker: true,
      lockedMarkerReason: 'held by implementer',
      metadataEntryNames: ['HEAD', 'MERGE_HEAD', 'commondir', 'gitdir', 'index', 'index.lock'],
      lockFiles: ['index.lock'],
      inProgressMarkers: ['MERGE_HEAD'],
      hasWorktreeConfig: false,
    },
    filesystem: {
      pathPresent: { state: 'OBSERVED', value: true },
      entryType: 'dir',
      errorCode: 'EBUSY',
      realpath: 'C:\\wt-alpha',
      entryCount: 412,
      dotGitType: 'file',
      dotGitAbsent: false,
      dotGitPointer: 'C:/miljobeslut/.git/worktrees/wt-alpha',
    },
    branchBinding: {
      bound: true,
      refname: 'refs/heads/feat/alpha',
      objectname: '5555555555555555555555555555555555555555',
      upstream: 'refs/remotes/origin/feat/alpha',
      upstreamTrack: '[ahead 2]',
    },
    toplevel: { state: 'OBSERVED', value: 'C:/wt-alpha' },
    toplevelMatchesCandidate: { state: 'OBSERVED', value: true },
    workspaceGitDir: { state: 'OBSERVED', value: 'C:/repo/.git/worktrees/wt-a' },
    workspaceGitCommonDir: { state: 'OBSERVED', value: 'C:/repo/.git' },
    insideWorkTree: { state: 'OBSERVED', value: true },
    workspaceGitExitCode: 0,
    repositoryMembership: { state: 'OBSERVED', value: 'MEMBER' },
    workspaceGitUnavailable: false,
    symbolicRef: { state: 'OBSERVED', value: 'refs/heads/feat/alpha' },
    status: {
      state: 'OBSERVED',
      value: {
        trackedModificationCount: 3,
        untrackedEntryCount: 1,
        unmergedCount: 0,
        branchHead: 'feat/alpha',
        branchOid: '5555555555555555555555555555555555555555',
        branchUpstream: 'origin/feat/alpha',
        aheadOfUpstream: 2,
        behindUpstream: 0,
        pathsElided: true,
      },
    },
    ancestry: {
      state: 'OBSERVED',
      value: {
        headSha: '5555555555555555555555555555555555555555',
        headCommitExists: true,
        headIsAncestorOfCanonical: false,
        canonicalIsAncestorOfHead: true,
        mergeBase: '0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85',
        commitsAheadOfCanonical: 2,
        commitsBehindCanonical: 0,
        allUniqueCommitsPatchEquivalent: false,
        uniqueCommitCount: 2,
      },
    },
    declaredUnitFiles: ['governance/devgov/units/workspace-lifecycle-controller-v1.json'],
    contentEvidence: 'NONE',
    graphRelation: 'DESCENDANT',
    proofs: [
      {
        predicate: 'headCommitExists',
        provenBy: 'git cat-file -e',
        requestId: 'R-W-07',
        exitCode: 0,
      },
    ],
  };

  const unknown: WorkspaceObservation = {
    caseId: unknownCaseId,
    comparisonKey: 'c:/wt-beta',
    preferredSpelling: 'C:\\wt-beta',
    spellings: [{ source: 'S1', path: 'C:\\wt-beta' }],
    observationState: 'UNKNOWN',
    gitWorktreeList: { listed: false },
    gitMetadata: { registered: false },
    filesystem: {
      pathPresent: { state: 'UNKNOWN', unknownReason: 'FILESYSTEM_ERROR_INCONCLUSIVE' },
      errorCode: 'EBUSY',
    },
    branchBinding: { bound: false },
    toplevel: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    toplevelMatchesCandidate: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    workspaceGitDir: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    workspaceGitCommonDir: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    insideWorkTree: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    repositoryMembership: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    workspaceGitUnavailable: true,
    // A nested non-attempt: the family was skipped for this case even though the case itself was
    // attempted. notAttemptedReason must stay outside the digest wherever it appears.
    symbolicRef: { state: 'NOT_ATTEMPTED', notAttemptedReason: 'CANONICAL_SHA_UNAVAILABLE' },
    status: { state: 'UNKNOWN', unknownReason: 'TIMEOUT' },
    ancestry: { state: 'UNKNOWN', unknownReason: 'OUTPUT_UNPARSEABLE' },
    declaredUnitFiles: [],
    contentEvidence: 'NONE',
    graphRelation: 'UNKNOWN',
    proofs: [],
  };

  const notAttempted: WorkspaceObservation = {
    caseId: notAttemptedCaseId,
    comparisonKey: 'c:/wt-gamma',
    preferredSpelling: 'C:\\wt-gamma',
    spellings: [{ source: 'S4', path: 'C:\\wt-gamma' }],
    observationState: 'NOT_ATTEMPTED',
    notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE',
    gitWorktreeList: { listed: false },
    gitMetadata: { registered: false },
    filesystem: {
      pathPresent: { state: 'NOT_ATTEMPTED', notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE' },
    },
    branchBinding: { bound: false },
    toplevel: { state: 'NOT_ATTEMPTED', notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE' },
    toplevelMatchesCandidate: {
      state: 'NOT_ATTEMPTED',
      notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE',
    },
    workspaceGitDir: { state: 'NOT_ATTEMPTED', notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE' },
    workspaceGitCommonDir: {
      state: 'NOT_ATTEMPTED',
      notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE',
    },
    insideWorkTree: { state: 'NOT_ATTEMPTED', notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE' },
    repositoryMembership: {
      state: 'NOT_ATTEMPTED',
      notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE',
    },
    workspaceGitUnavailable: false,
    symbolicRef: { state: 'NOT_ATTEMPTED', notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE' },
    status: { state: 'NOT_ATTEMPTED', notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE' },
    ancestry: { state: 'NOT_ATTEMPTED', notAttemptedReason: 'OUT_OF_OBSERVATION_SCOPE' },
    declaredUnitFiles: [],
    contentEvidence: 'NONE',
    graphRelation: 'UNKNOWN',
    proofs: [],
  };

  const base = { repository, workspaces: [observed, unknown, notAttempted] };
  return {
    schemaId: SNAPSHOT_SCHEMA_ID,
    ...base,
    metadata: {
      snapshotSchema: SNAPSHOT_SCHEMA_ID,
      observerVersion: '1.0.0',
      observationWindow: { start: '2026-09-10T08:00:00Z', end: '2026-09-10T08:04:00Z' },
      perWorkspaceWindow: {
        [observedCaseId]: { start: '2026-09-10T08:00:01Z', end: '2026-09-10T08:00:09Z' },
      },
      transcriptRef: 'transcripts/2026-09-10T08-00-00Z.jsonl',
      commandSurfaceDigest: 'd1213675fcf2b945ea74a189eac7ede88ebf4474402b591e5730728698b6f642',
      observationCoverage: { OBSERVED: 1, UNKNOWN: 1, NOT_ATTEMPTED: 1 },
      observationScope: [observedCaseId, unknownCaseId],
    },
    identityDigest: computeIdentityDigest(base).digest,
  };
}

/* ------------------------------------------------------------------------------------------- */
/* Traversal                                                                                     */
/* ------------------------------------------------------------------------------------------- */

type Segment = { readonly key: string } | { readonly index: number };
type Leaf = { readonly path: readonly Segment[]; readonly display: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Every terminal position of a value tree.
 *
 * An empty array and an empty object are leaves in their own right: "read and found empty" is a
 * distinct observation from "never read", and the digest must be able to tell them apart, so the
 * mutation test has to reach them too.
 */
function leavesOf(value: unknown, path: readonly Segment[] = []): Leaf[] {
  const display = path
    .map((s) => ('key' in s ? `.${s.key}` : '[]'))
    .join('')
    .replace(/^\./, '');
  if (Array.isArray(value)) {
    if (value.length === 0) return [{ path, display }];
    return value.flatMap((v, index) => leavesOf(v, [...path, { index }]));
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (keys.length === 0) return [{ path, display }];
    return keys.flatMap((key) => leavesOf(value[key], [...path, { key }]));
  }
  return [{ path, display }];
}

/** A deep copy with exactly one leaf replaced by a value that is canonically different. */
function mutatedAt<T>(root: T, path: readonly Segment[]): T {
  const clone = structuredClone(root) as unknown;
  let cursor: Record<string, unknown> | unknown[] = clone as Record<string, unknown>;
  for (const segment of path.slice(0, -1)) {
    cursor = ('key' in segment
      ? (cursor as Record<string, unknown>)[segment.key]
      : (cursor as unknown[])[segment.index]) as Record<string, unknown> | unknown[];
  }
  const last = path[path.length - 1];
  const key = 'key' in last ? last.key : last.index;
  const current = (cursor as Record<string | number, unknown>)[key];
  let next: unknown;
  if (typeof current === 'string') next = `${current}~MUTATED`;
  else if (typeof current === 'number') {
    // Stay inside the safe-integer domain: stepping past it would be rejected by P2 and the test
    // would report a validator failure where it means to report a digest failure.
    next = current === Number.MAX_SAFE_INTEGER ? current - 1 : current + 1;
  } else if (typeof current === 'boolean') next = !current;
  else if (Array.isArray(current)) next = ['MUTATED'];
  else if (current === null) next = 'MUTATED';
  else next = { mutated: true };
  (cursor as Record<string | number, unknown>)[key] = next;
  return clone as T;
}

/* ------------------------------------------------------------------------------------------- */
/* Inclusion-table bindings                                                                      */
/* ------------------------------------------------------------------------------------------- */

/**
 * Which artifact paths each inclusion-table row governs.
 *
 * The rows name fields in the spec's prose vocabulary ('workspaces[].status.… / branch fields'),
 * while the artifact nests observed values under an Observed<T> wrapper ('…status.value.branchHead').
 * This table is the mapping between the two, kept as data so a reviewer can check it cell by cell.
 *
 * A row with an empty path list is a row that governs no artifact leaf, and each one says why.
 * The test below asserts that this table names EXACTLY the rows of DIGEST_INCLUSION_TABLE, so a
 * new row cannot be added to the code without a decision being recorded here.
 *
 * Matching is longest-prefix on segment boundaries, so 'workspaces[].gitMetadata.metadataEntryNames'
 * wins over nothing and 'workspaces[].filesystem.entryCount' is not swallowed by a broader row.
 */
interface RowBinding {
  readonly field: string;
  readonly artifactPaths: readonly string[];
  readonly note?: string;
}

const ROW_BINDINGS: readonly RowBinding[] = Object.freeze([
  {
    field: 'schemaId',
    artifactPaths: [],
    note:
      'The projection emits the SNAPSHOT_SCHEMA_ID constant, not snapshot.schemaId, so the payload field is present and covered while the artifact leaf is not mutation-sensitive. It is listed in UNCLASSIFIED_ARTIFACT_LEAVES for that reason.',
  },
  { field: 'repository.repoRoot', artifactPaths: ['repository.repoRoot'] },
  { field: 'repository.commonDir', artifactPaths: ['repository.commonDir'] },
  { field: 'repository.canonicalSha', artifactPaths: ['repository.canonicalSha'] },
  { field: 'repository.canonicalShaSource', artifactPaths: ['repository.canonicalShaSource'] },
  {
    field: 'repository.canonicalShaStableAcrossWindow',
    artifactPaths: ['repository.canonicalShaStableAcrossWindow'],
  },
  {
    field: 'repository.canonicalRefUpdatedAtEpochSeconds',
    artifactPaths: ['repository.canonicalRefUpdatedAtEpochSeconds'],
  },
  {
    field: 'repository.stashes[].stashCommit / firstParent',
    artifactPaths: [
      'repository.stashes.state',
      'repository.stashes.value[].stashCommit',
      'repository.stashes.value[].firstParent',
    ],
  },
  {
    field: 'repository.stashes[].selector',
    artifactPaths: ['repository.stashes.value[].selector'],
  },
  {
    field: 'repository.stashes[].attribution',
    artifactPaths: ['repository.stashes.value[].attribution'],
  },
  { field: 'repository.mainWorktreeEntryNames', artifactPaths: ['repository.mainWorktreeEntryNames'] },
  { field: 'repository.configuration', artifactPaths: ['repository.configuration'] },
  { field: 'repository.canonicalUnitFiles', artifactPaths: ['repository.canonicalUnitFiles'] },
  { field: 'repository.mutationEvidence', artifactPaths: ['repository.mutationEvidence'] },
  {
    field: 'workspaces[].caseId / comparisonKey',
    artifactPaths: ['workspaces[].caseId', 'workspaces[].comparisonKey'],
  },
  {
    field: 'workspaces[].preferredSpelling / spellings',
    artifactPaths: ['workspaces[].preferredSpelling', 'workspaces[].spellings'],
  },
  { field: 'workspaces[].observationState', artifactPaths: ['workspaces[].observationState'] },
  {
    field: 'workspaces[].unknownReason',
    artifactPaths: [],
    note:
      'WorkspaceObservation carries no unknownReason of its own; the digest-covered unknownReason values are the per-observation ones inside each Observed<T>, and each is governed by that observation\u2019s own row.',
  },
  {
    field: 'workspaces[].notAttemptedReason',
    artifactPaths: ['workspaces[].notAttemptedReason'],
    note:
      'Also governs every nested Observed<T>.notAttemptedReason, by the rule below: the justification (a fact about this run\u2019s scope, not about the world) is the same fact wherever it appears, and projectObserved drops all of them.',
  },
  { field: 'workspaces[].gitWorktreeList.*', artifactPaths: ['workspaces[].gitWorktreeList'] },
  {
    field:
      'workspaces[].gitMetadata.registered / gitdirPointer / gitdirTargetPresent / registeredHead / metadataEntryNames',
    artifactPaths: [
      'workspaces[].gitMetadata.registered',
      'workspaces[].gitMetadata.gitdirPointer',
      'workspaces[].gitMetadata.gitdirTargetPresent',
      'workspaces[].gitMetadata.registeredHead',
      'workspaces[].gitMetadata.metadataEntryNames',
    ],
  },
  {
    field: 'workspaces[].gitMetadata.lockFiles / inProgressMarkers',
    artifactPaths: [
      'workspaces[].gitMetadata.lockFiles',
      'workspaces[].gitMetadata.inProgressMarkers',
    ],
  },
  {
    field:
      'workspaces[].filesystem.pathPresent / entryType / errorCode / realpath / dotGitType / dotGitAbsent / dotGitPointer',
    artifactPaths: [
      'workspaces[].filesystem.pathPresent',
      'workspaces[].filesystem.entryType',
      'workspaces[].filesystem.errorCode',
      'workspaces[].filesystem.realpath',
      'workspaces[].filesystem.dotGitType',
      'workspaces[].filesystem.dotGitAbsent',
      'workspaces[].filesystem.dotGitPointer',
    ],
  },
  { field: 'workspaces[].filesystem.entryCount', artifactPaths: ['workspaces[].filesystem.entryCount'] },
  { field: 'workspaces[].branchBinding.*', artifactPaths: ['workspaces[].branchBinding'] },
  { field: 'workspaces[].toplevel', artifactPaths: ['workspaces[].toplevel'] },
  {
    field: 'workspaces[].toplevelMatchesCandidate',
    artifactPaths: ['workspaces[].toplevelMatchesCandidate'],
  },
  {
    field:
      'workspaces[].workspaceGitDir / workspaceGitCommonDir / insideWorkTree / workspaceGitExitCode',
    artifactPaths: [
      'workspaces[].workspaceGitDir',
      'workspaces[].workspaceGitCommonDir',
      'workspaces[].insideWorkTree',
      'workspaces[].workspaceGitExitCode',
    ],
  },
  {
    field: 'workspaces[].repositoryMembership / workspaceGitUnavailable',
    artifactPaths: [
      'workspaces[].repositoryMembership',
      'workspaces[].workspaceGitUnavailable',
    ],
  },
  { field: 'workspaces[].symbolicRef', artifactPaths: ['workspaces[].symbolicRef'] },
  {
    field:
      'workspaces[].status.trackedModificationCount / untrackedEntryCount / unmergedCount / branch fields',
    artifactPaths: [
      'workspaces[].status.state',
      'workspaces[].status.unknownReason',
      'workspaces[].status.value.trackedModificationCount',
      'workspaces[].status.value.untrackedEntryCount',
      'workspaces[].status.value.unmergedCount',
      'workspaces[].status.value.branchHead',
      'workspaces[].status.value.branchOid',
      'workspaces[].status.value.branchUpstream',
      'workspaces[].status.value.aheadOfUpstream',
      'workspaces[].status.value.behindUpstream',
    ],
  },
  {
    field: 'workspaces[].status.pathsElided',
    artifactPaths: ['workspaces[].status.value.pathsElided'],
  },
  { field: 'workspaces[].ancestry.*', artifactPaths: ['workspaces[].ancestry'] },
  { field: 'workspaces[].declaredUnitFiles', artifactPaths: ['workspaces[].declaredUnitFiles'] },
  { field: 'workspaces[].contentEvidence', artifactPaths: ['workspaces[].contentEvidence'] },
  { field: 'workspaces[].graphRelation', artifactPaths: ['workspaces[].graphRelation'] },
  { field: 'workspaces[].proofs', artifactPaths: ['workspaces[].proofs'] },
  { field: 'metadata.*', artifactPaths: ['metadata'] },
  {
    field: 'generation',
    artifactPaths: [],
    note:
      'The term is struck, so no artifact leaf may bind to it. The test that every artifact leaf is classified is what keeps that true.',
  },
]);

/** Every nested Observed<T>.notAttemptedReason answers to the workspace-level row. */
const NOT_ATTEMPTED_ROW = 'workspaces[].notAttemptedReason';

/**
 * Artifact leaves that NO inclusion-table row names, with the behaviour each actually has.
 *
 * This is a ledger of table gaps at the candidate base, not a licence: the test asserts the ledger
 * is EXACTLY the set of unmatched leaves, so adding a field without a row fails, and adding the
 * missing row without deleting the ledger entry fails too. Every entry still has its digest
 * behaviour asserted, so no leaf goes unproved — only unnamed.
 */
interface LedgerEntry {
  readonly path: string;
  readonly covered: boolean;
  readonly why: string;
}

const UNCLASSIFIED_ARTIFACT_LEAVES: readonly LedgerEntry[] = Object.freeze([
  {
    path: 'schemaId',
    covered: false,
    why: 'digestPayload emits the SNAPSHOT_SCHEMA_ID constant instead of reading this field, so the payload carries it and the artifact leaf cannot move it.',
  },
  {
    path: 'repository.canonicalRef',
    covered: true,
    why: 'Emitted by projectRepository and digest-covered, but no table row names it. Which ref is canonical decides what every ancestry answer means, so the coverage is right and the row is missing.',
  },
  {
    path: 'repository.mainWorktreeLockFiles.state',
    covered: false,
    why: 'A derived reading of mainWorktreeEntryNames, excluded for the same reason as gitMetadata.lockFiles, but with no row of its own.',
  },
  {
    path: 'repository.mainWorktreeLockFiles.value[]',
    covered: false,
    why: 'Same as mainWorktreeLockFiles.state.',
  },
  {
    path: 'repository.mainWorktreeInProgressMarkers.state',
    covered: false,
    why: 'Same as mainWorktreeLockFiles.state.',
  },
  {
    path: 'repository.mainWorktreeInProgressMarkers.value[]',
    covered: false,
    why: 'Same as mainWorktreeLockFiles.state.',
  },
  {
    path: 'workspaces[].gitMetadata.worktreeId',
    covered: true,
    why: 'Emitted by projectWorkspace and digest-covered; the gitMetadata row names five fields and not this one.',
  },
  {
    path: 'workspaces[].gitMetadata.gitdirTargetErrorCode',
    covered: true,
    why: 'Same as worktreeId: covered by the projection, unnamed by the table.',
  },
  {
    path: 'workspaces[].gitMetadata.lockedMarker',
    covered: true,
    why: 'Same as worktreeId.',
  },
  {
    path: 'workspaces[].gitMetadata.lockedMarkerReason',
    covered: true,
    why: 'Same as worktreeId.',
  },
  {
    path: 'workspaces[].gitMetadata.hasWorktreeConfig',
    covered: true,
    why: 'Same as worktreeId.',
  },
  {
    path: 'identityDigest',
    covered: false,
    why: 'The digest cannot cover itself. Listed so that "unclassified" never silently includes the one field for which that is the correct answer.',
  },
]);

function boundedPrefix(path: string, pattern: string): boolean {
  return path === pattern || path.startsWith(`${pattern}.`) || path.startsWith(`${pattern}[`);
}

/** The row governing an artifact leaf, or undefined when the table names none. */
function rowFor(path: string): RowBinding | undefined {
  if (path.endsWith('.notAttemptedReason')) {
    return ROW_BINDINGS.find((r) => r.field === NOT_ATTEMPTED_ROW);
  }
  let best: RowBinding | undefined;
  let bestLength = -1;
  for (const binding of ROW_BINDINGS) {
    for (const pattern of binding.artifactPaths) {
      if (boundedPrefix(path, pattern) && pattern.length > bestLength) {
        best = binding;
        bestLength = pattern.length;
      }
    }
  }
  return best;
}

const INCLUDED_BY_FIELD = new Map(DIGEST_INCLUSION_TABLE.map((r) => [r.field, r.included]));

/* ------------------------------------------------------------------------------------------- */
/* Tests                                                                                         */
/* ------------------------------------------------------------------------------------------- */

interface Vector {
  readonly id: string;
  readonly class: 'conformance' | 'informative';
  readonly description: string;
  readonly schemaId: string;
  readonly payload: unknown;
  readonly expectedCanonicalUtf8: string;
  readonly expectedCanonicalByteLength: number;
  readonly expectedPreimageHex: string;
  readonly expectedDigest: string;
}

interface VectorFile {
  readonly schemaId: string;
  readonly status: string;
  readonly invariants: Readonly<Record<string, boolean>>;
  readonly vectors: readonly Vector[];
}

const vectorFile = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as VectorFile;

describe('published digest vectors', () => {
  it('is the frozen vector artifact and carries every A12 vector class', () => {
    expect(vectorFile.schemaId).toBe('WORKSPACE_SNAPSHOT_DIGEST_TEST_VECTORS_V1');
    expect(vectorFile.status).toBe('FROZEN');
    expect(vectorFile.vectors.map((v) => v.id)).toEqual([
      'SD01',
      'SD02',
      'SD03',
      'SD04',
      'SD05',
      'SD06',
      'SD07',
      'SD08',
      'SD09',
      'SD10',
      'SD11',
      'SD12',
      'SD13',
    ]);
  });

  it.each(vectorFile.vectors.filter((v) => v.class === 'conformance'))(
    '$id reproduces: $description',
    (vector) => {
      const bytes = canonicalBytes(vector.payload);
      expect(Buffer.from(bytes).toString('utf8')).toBe(vector.expectedCanonicalUtf8);
      expect(bytes.length).toBe(vector.expectedCanonicalByteLength);
      expect(framePreimage(vector.schemaId, bytes).toString('hex')).toBe(vector.expectedPreimageHex);
      expect(framedDigest(vector.schemaId, vector.payload).digest).toBe(vector.expectedDigest);
    },
  );

  it('holds every published invariant', () => {
    const digestOf = (id: string): string => {
      const vector = vectorFile.vectors.find((v) => v.id === id);
      if (vector === undefined) throw new Error(`no vector ${id}`);
      return framedDigest(vector.schemaId, vector.payload).digest;
    };
    // Recomputed rather than read back from the file: an invariants block that only quoted itself
    // would stay true after the vectors were edited to make it true.
    expect(digestOf('SD01')).not.toBe(digestOf('SD02'));
    expect(digestOf('SD01')).not.toBe(digestOf('SD03'));
    expect(digestOf('SD04')).not.toBe(digestOf('SD05'));
    expect(digestOf('SD01')).not.toBe(digestOf('SD09'));
    expect(digestOf('SD01')).not.toBe(digestOf('SD10'));
    expect(digestOf('SD11')).not.toBe(digestOf('SD12'));
    expect(digestOf('SD11')).not.toBe(digestOf('SD13'));
    expect(Object.values(vectorFile.invariants).every((v) => v)).toBe(true);
  });

  it('proves the same directory in two cases keeps one caseId and two digests', () => {
    // The A12 case-sensitivity class, spelled out: the observed spelling is digest-covered and is
    // NOT case-folded, while identity is keyed on the comparison key, which is. Collapsing the two
    // would either re-key expectations on a spelling change or hide a real path change.
    const sd04 = vectorFile.vectors.find((v) => v.id === 'SD04')!;
    const sd05 = vectorFile.vectors.find((v) => v.id === 'SD05')!;
    const a = sd04.payload as { caseId: string; comparisonKey: string; repoRoot: string };
    const b = sd05.payload as { caseId: string; comparisonKey: string; repoRoot: string };
    expect(a.caseId).toBe(b.caseId);
    expect(a.comparisonKey).toBe(b.comparisonKey);
    expect(a.repoRoot).not.toBe(b.repoRoot);
    expect(sd04.expectedDigest).not.toBe(sd05.expectedDigest);
  });
});

describe('published digest artifact', () => {
  const artifact = JSON.parse(readFileSync(DIGEST_ARTIFACT_PATH, 'utf8')) as {
    schemaId: string;
    version: string;
    status: string;
    digestDomain: string;
    payloadSchemaId: string;
    inclusionTable: {
      rowCount: number;
      rows: readonly { field: string; included: boolean; justification: string }[];
    };
    absenceEncoding: { workedExample: { differ: boolean } };
    excludedUndefinedTerms: readonly { term: string }[];
    testVectors: { sha256: string };
  };

  it('is the versioned frozen artifact the spec asks for', () => {
    expect(artifact.schemaId).toBe('WORKSPACE_SNAPSHOT_DIGEST_V1');
    expect(artifact.version).toBe('1.0.0');
    expect(artifact.status).toBe('FROZEN');
    expect(artifact.digestDomain).toBe(DOMAINS.SNAPSHOT_V1);
    expect(artifact.payloadSchemaId).toBe(SNAPSHOT_SCHEMA_ID);
    expect(artifact.absenceEncoding.workedExample.differ).toBe(true);
    expect(artifact.excludedUndefinedTerms.map((t) => t.term)).toEqual(['generation']);
  });

  it('publishes the inclusion table the code uses, row for row', () => {
    // Without this the artifact and DIGEST_INCLUSION_TABLE drift the first time a row is edited on
    // one side only, and both halves still look plausible on their own.
    expect(artifact.inclusionTable.rowCount).toBe(DIGEST_INCLUSION_TABLE.length);
    expect(artifact.inclusionTable.rows).toEqual(
      DIGEST_INCLUSION_TABLE.map((r) => ({
        field: r.field,
        included: r.included,
        justification: r.justification,
      })),
    );
  });

  it('binds the vector file by digest', () => {
    // Recomputed from the bytes on disk, so re-running the generator without republishing the
    // contract is a failure rather than a silently stale binding.
    expect(artifact.testVectors.sha256).toBe(sha256Hex(readFileSync(VECTORS_PATH)));
  });
});

describe('B6 property: every digest-covered field moves the digest', () => {
  const snapshot = makeSnapshot();
  const payload = digestPayload(snapshot);
  const baseline = framedDigest(DOMAINS.SNAPSHOT_V1, payload).digest;

  it('has a payload worth testing', () => {
    expect(leavesOf(payload).length).toBeGreaterThan(80);
  });

  it('changes the digest when any leaf of the projection changes', () => {
    const unchanged: string[] = [];
    for (const leaf of leavesOf(payload)) {
      const mutated = mutatedAt(payload, leaf.path);
      if (framedDigest(DOMAINS.SNAPSHOT_V1, mutated).digest === baseline) {
        unchanged.push(leaf.display);
      }
    }
    expect(unchanged).toEqual([]);
  });
});

describe('inclusion table covers the artifact', () => {
  const snapshot = makeSnapshot();
  const baseline = computeIdentityDigest(snapshot).digest;
  const artifactLeaves = leavesOf(snapshot);

  /** Distinct classification targets: 'workspaces[0].caseId' and 'workspaces[1].caseId' are one. */
  const distinct = [...new Set(artifactLeaves.map((l) => l.display))].sort();

  it('names every table row exactly once in the artifact-path bindings', () => {
    expect(ROW_BINDINGS.map((b) => b.field).sort()).toEqual(
      DIGEST_INCLUSION_TABLE.map((r) => r.field).sort(),
    );
  });

  it('classifies every artifact leaf, or lists it in the gap ledger', () => {
    const unmatched = distinct.filter((path) => rowFor(path) === undefined);
    expect(unmatched).toEqual(UNCLASSIFIED_ARTIFACT_LEAVES.map((e) => e.path).sort());
  });

  it('gives every artifact leaf the digest behaviour its row claims', () => {
    const ledger = new Map(UNCLASSIFIED_ARTIFACT_LEAVES.map((e) => [e.path, e.covered]));
    const wrong: string[] = [];
    for (const leaf of artifactLeaves) {
      const changed = computeIdentityDigest(mutatedAt(snapshot, leaf.path)).digest !== baseline;
      const row = rowFor(leaf.display);
      const expected =
        row === undefined ? ledger.get(leaf.display) : INCLUDED_BY_FIELD.get(row.field);
      if (expected === undefined) {
        wrong.push(`${leaf.display}: no classification`);
      } else if (expected !== changed) {
        wrong.push(
          `${leaf.display}: table says ${expected ? 'included' : 'excluded'}, mutation ${changed ? 'changed' : 'did not change'} the digest`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('mirror property: the named exclusions do not move the digest', () => {
  const snapshot = makeSnapshot();
  const baseline = computeIdentityDigest(snapshot).digest;

  /**
   * The seven exclusions the spec and the table call out by name.
   *
   * This test is the one that keeps the V2 compare-and-swap satisfiable: if any of these entered
   * the digest, re-observing an untouched machine would produce a new identityDigest, V2 could
   * never delete anything, and the condition would be loosened to compensate.
   */
  const NAMED_EXCLUSIONS: readonly { readonly what: string; readonly mutate: (s: WorkspaceSnapshotArtifact) => WorkspaceSnapshotArtifact }[] = [
    {
      what: 'graphRelation',
      mutate: (s) => mutateWorkspace(s, 0, (w) => ({ ...w, graphRelation: 'DIVERGED' })),
    },
    {
      what: 'metadata',
      mutate: (s) => ({
        ...s,
        metadata: {
          ...s.metadata,
          observerVersion: '9.9.9',
          transcriptRef: 'transcripts/other.jsonl',
          observationWindow: { start: '2099-01-01T00:00:00Z', end: '2099-01-01T00:01:00Z' },
        },
      }),
    },
    {
      what: 'preferredSpelling',
      mutate: (s) =>
        mutateWorkspace(s, 0, (w) => ({ ...w, preferredSpelling: 'c:/WT-ALPHA', spellings: [] })),
    },
    {
      what: 'filesystem.entryCount',
      mutate: (s) =>
        mutateWorkspace(s, 0, (w) => ({
          ...w,
          filesystem: { ...w.filesystem, entryCount: 999999 },
        })),
    },
    {
      what: 'notAttemptedReason',
      mutate: (s) =>
        mutateWorkspace(s, 2, (w) => ({ ...w, notAttemptedReason: 'FILESYSTEM_POOL_EXHAUSTED' })),
    },
    {
      what: 'contentEvidence',
      mutate: (s) => mutateWorkspace(s, 0, (w) => ({ ...w, contentEvidence: 'PATCH_ID_MATCH' })),
    },
    {
      what: 'proofs',
      mutate: (s) => mutateWorkspace(s, 0, (w) => ({ ...w, proofs: [] })),
    },
  ];

  it.each(NAMED_EXCLUSIONS)('$what stays outside the digest', ({ mutate }) => {
    expect(computeIdentityDigest(mutate(snapshot)).digest).toBe(baseline);
  });
});

function mutateWorkspace(
  snapshot: WorkspaceSnapshotArtifact,
  index: number,
  fn: (w: WorkspaceObservation) => WorkspaceObservation,
): WorkspaceSnapshotArtifact {
  const workspaces = snapshot.workspaces.map((w, i) => (i === index ? fn(w) : w));
  return { ...snapshot, workspaces };
}

describe('determinism', () => {
  const snapshot = makeSnapshot();
  const baseline = computeIdentityDigest(snapshot).digest;

  /** Deterministic PRNG: a flaky shuffle would make a real ordering bug look intermittent. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  function shuffleKeys(value: unknown, rnd: () => number): unknown {
    if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, rnd));
    if (isRecord(value)) {
      const entries = Object.entries(value);
      for (let i = entries.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rnd() * (i + 1));
        [entries[i], entries[j]] = [entries[j], entries[i]];
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of entries) out[k] = shuffleKeys(v, rnd);
      return out;
    }
    return value;
  }

  it('reproduces the same digest across 100 rebuilds with shuffled key order', () => {
    const digests = new Set<string>();
    for (let seed = 1; seed <= 100; seed += 1) {
      const rnd = lcg(seed);
      const rebuilt = shuffleKeys(structuredClone(snapshot), rnd) as WorkspaceSnapshotArtifact;
      digests.add(computeIdentityDigest(rebuilt).digest);
    }
    expect([...digests]).toEqual([baseline]);
  });

  it('does not depend on the order workspaces were discovered in', () => {
    // Discovery order is a property of the run: sources fire in whatever order the scope gave.
    const reversed = { ...snapshot, workspaces: [...snapshot.workspaces].reverse() };
    expect(computeIdentityDigest(reversed).digest).toBe(baseline);
  });

  it('encodes absence by omission, so no null reaches the payload', () => {
    const nulls = leavesOf(digestPayload(snapshot)).filter((leaf) => {
      let cursor: unknown = digestPayload(snapshot);
      for (const segment of leaf.path) {
        cursor =
          'key' in segment
            ? (cursor as Record<string, unknown>)[segment.key]
            : (cursor as unknown[])[segment.index];
      }
      return cursor === null;
    });
    expect(nulls.map((n) => n.display)).toEqual([]);
  });
});
