/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — correlation: observation ledger to snapshot artifact.
 *
 * Correlation is where A23 is either honoured or quietly lost. Four independent sources describe a
 * workspace — git's own `worktree list`, the `.git/worktrees` metadata directory, the filesystem,
 * and the branch-to-worktree binding — and the tempting move is to merge them into one "is this a
 * worktree" boolean. That merge is exactly what must not happen: when the sources disagree, the
 * DISAGREEMENT is the finding, and a merged view has already thrown it away. So each source keeps
 * its own claim field here, and the classifier reads them as separate axes of a total data table.
 *
 * Everything derived below is derived from raw responses that are in the same artifact (A2). The
 * boundary this module must not cross is policy LOADING: it may compute `toplevelMatchesCandidate`
 * from two recorded strings, and it may not decide what that means for removal.
 */
import {
  asCount,
  asSha,
  parseLocalHeads,
  parseStatusPorcelainV2,
  parseWorkspaceRevParse,
  parseWorktreeList,
} from './parsers.js';
import { decodeUtf8 } from './ObservationLedger.js';
import type { LedgerEntry, ObservationLedger, UnknownReason } from './ObservationLedger.js';
import {
  comparisonKey,
  isAbsolutePath,
  joinPath,
  parentOfGitDir,
} from '../surface/PathPolicy.js';
import type { Candidate, SequencerResult } from './RequestSequencer.js';
import {
  OBSERVER_VERSION,
  SNAPSHOT_SCHEMA_ID,
  SNAPSHOT_SCHEMA_VERSION,
} from '../snapshot/types.js';
import type {
  AncestryFacts,
  BranchBindingClaim,
  ContentEvidence,
  FilesystemClaim,
  GitMetadataClaim,
  GitWorktreeListClaim,
  GraphRelation,
  Observed,
  PositiveProof,
  RepositoryObservation,
  StashObservation,
  StatusFacts,
  WorkspaceObservation,
  WorkspaceSnapshotArtifact,
} from '../snapshot/types.js';
import { computeIdentityDigest } from '../snapshot/SnapshotDigest.js';

/**
 * Entry names in `.git/worktrees/<id>` (or the common dir) that indicate a held lock.
 *
 * This vocabulary is OURS, which is why the raw entry names go into the digest and these filtered
 * readings do not: another implementation could reasonably draw the boundary elsewhere, and the
 * identity digest must not depend on where we drew it.
 */
const LOCK_ENTRY_PATTERN = /(^|\.)lock$|^index\.lock$|^HEAD\.lock$/;

/** Markers of an operation that is half-finished. Removing such a worktree loses recovery context. */
const IN_PROGRESS_ENTRIES = new Set([
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'REBASE_HEAD',
  'BISECT_START',
  'BISECT_LOG',
  'AUTO_MERGE',
  'rebase-merge',
  'rebase-apply',
  'sequencer',
]);

function observedFrom<T>(entry: LedgerEntry | undefined, value: () => T | undefined): Observed<T> {
  if (entry === undefined) {
    return { state: 'NOT_ATTEMPTED', notAttemptedReason: 'INSTANTIATION_PREDICATE_UNSATISFIED' };
  }
  if (entry.state === 'NOT_ATTEMPTED') {
    return { state: 'NOT_ATTEMPTED', notAttemptedReason: entry.notAttemptedReason };
  }
  if (entry.state === 'UNKNOWN') {
    return { state: 'UNKNOWN', unknownReason: entry.unknownReason };
  }
  const v = value();
  if (v === undefined) return { state: 'UNKNOWN', unknownReason: 'OUTPUT_UNPARSEABLE' };
  return { state: 'OBSERVED', value: v };
}

function processText(entry: LedgerEntry | undefined): string | undefined {
  if (entry?.process === undefined) return undefined;
  const decoded = decodeUtf8(entry.process.stdout);
  return 'text' in decoded ? decoded.text : undefined;
}

function fileText(entry: LedgerEntry | undefined): string | undefined {
  if (entry?.filesystem === undefined) return undefined;
  const decoded = decodeUtf8(entry.filesystem.content);
  return 'text' in decoded ? decoded.text : undefined;
}

/**
 * `git cherry <canonical> <head>`: one line per commit in head that canonical does not contain.
 * A leading '-' means an equivalent patch IS already upstream; '+' means it is genuinely unique.
 */
function parseCherry(text: string): { total: number; allEquivalent: boolean } {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l !== '');
  return {
    total: lines.length,
    allEquivalent: lines.length > 0 && lines.every((l) => l.startsWith('- ')),
  };
}

/**
 * A17: topology, read from the two ancestry directions rather than guessed from commit counts.
 * UNKNOWN whenever either direction is missing — never an assumed relation.
 */
function deriveGraphRelation(a: AncestryFacts | undefined): GraphRelation {
  if (a === undefined) return 'UNKNOWN';
  const fwd = a.headIsAncestorOfCanonical;
  const rev = a.canonicalIsAncestorOfHead;
  if (fwd === undefined || rev === undefined) return 'UNKNOWN';
  if (fwd && rev) return 'EQUAL';
  if (fwd) return 'ANCESTOR';
  if (rev) return 'DESCENDANT';
  return 'DIVERGED';
}

export interface CorrelateOptions {
  readonly sequencer: SequencerResult;
  readonly commandSurfaceDigest: string;
  readonly globalObservationWindow?: { readonly start: string; readonly end: string };
  readonly transcriptRef?: string;
}

export function correlate(options: CorrelateOptions): WorkspaceSnapshotArtifact {
  const { sequencer, commandSurfaceDigest } = options;
  const ledger = sequencer.ledger;

  const worktreeBlocks = (() => {
    const text = processText(ledger.one('R-G-03', ''));
    return text === undefined ? [] : parseWorktreeList(text);
  })();
  const localHeads = (() => {
    const text = processText(ledger.one('R-G-05', ''));
    return text === undefined ? [] : parseLocalHeads(text);
  })();

  // worktreeId -> the workspace path its gitdir pointer names. The correlation basis is
  // parentOf(pointer), the same rule discovery source S2 uses, so a workspace and its metadata
  // directory are matched by the identical key that produced the candidate in the first place.
  const metadataByKey = new Map<string, string>();
  for (const id of sequencer.worktreeIds) {
    const pointer = fileText(ledger.one('R-F-03', `wt:${id}:gitdir`))?.trim();
    if (pointer === undefined) continue;
    const parent = parentOfGitDir(pointer);
    if (parent === undefined) continue;
    metadataByKey.set(comparisonKey(parent), id);
  }

  const repository = correlateRepository(sequencer, ledger);

  const workspaces = sequencer.candidates.map((c) =>
    correlateWorkspace(c, {
      ledger,
      worktreeBlocks,
      localHeads,
      metadataByKey,
      canonicalSha: sequencer.canonicalSha,
      repoCommonDirKey:
        sequencer.commonDir === null ? undefined : comparisonKey(sequencer.commonDir),
      inScope: sequencer.observedCandidates.includes(c.caseId),
    }),
  );

  const perWorkspaceWindow: Record<string, { start: string; end: string }> = {};
  for (const c of sequencer.candidates) {
    const window = windowOf(ledger, c.caseId);
    if (window !== undefined) perWorkspaceWindow[c.caseId] = window;
  }

  const partial = { repository, workspaces };
  const { digest } = computeIdentityDigest(partial);

  return {
    schemaId: SNAPSHOT_SCHEMA_ID,
    repository,
    workspaces,
    metadata: {
      snapshotSchema: SNAPSHOT_SCHEMA_VERSION,
      observerVersion: OBSERVER_VERSION,
      observationWindow: options.globalObservationWindow,
      perWorkspaceWindow,
      transcriptRef: options.transcriptRef,
      commandSurfaceDigest,
      observationCoverage: ledger.summary(),
      observationScope: [...sequencer.observedCandidates],
    },
    identityDigest: digest,
  };
}

/** A16: the per-workspace window is the span of that case's own request timings, not a clock read. */
function windowOf(
  ledger: ObservationLedger,
  caseId: string,
): { start: string; end: string } | undefined {
  let start: string | undefined;
  let end: string | undefined;
  for (const e of ledger.all()) {
    if (e.timing === undefined) continue;
    if (e.instanceKey !== caseId && !e.instanceKey.startsWith(`${caseId}:`)) continue;
    if (start === undefined || e.timing.startedAt < start) start = e.timing.startedAt;
    if (end === undefined || e.timing.endedAt > end) end = e.timing.endedAt;
  }
  return start !== undefined && end !== undefined ? { start, end } : undefined;
}

function correlateRepository(
  sequencer: SequencerResult,
  ledger: ObservationLedger,
): RepositoryObservation {
  const configuration: Record<string, Observed<readonly string[]>> = {};
  for (const entry of ledger.byRequestId('R-G-10')) {
    configuration[entry.instanceKey] = observedFrom(entry, () => {
      const text = processText(entry);
      if (text === undefined) return undefined;
      return text
        .split('\n')
        .map((l) => l.replace(/\r$/, ''))
        .filter((l) => l !== '');
    });
  }

  const commonDirEntry = ledger.one('R-G-07', '');
  const commonDir: Observed<string> =
    sequencer.commonDir === null
      ? observedFrom(commonDirEntry, () => undefined)
      : { state: 'OBSERVED', value: sequencer.commonDir };

  const canonicalShaEntry = ledger.get('R-G-02', 'BEFORE')[0] ?? ledger.get('R-G-01', 'BEFORE')[0];
  const canonicalSha: Observed<string> =
    sequencer.canonicalSha === null
      ? observedFrom(canonicalShaEntry, () => undefined)
      : { state: 'OBSERVED', value: sequencer.canonicalSha };

  // A16: origin/main is read before and after. Different answers mean the reference moved during
  // the observation and every ancestry fact in this snapshot is suspect.
  const stable: Observed<boolean> =
    sequencer.canonicalSha === null || sequencer.canonicalShaAfter === null
      ? { state: 'UNKNOWN', unknownReason: 'OUTPUT_UNPARSEABLE' }
      : { state: 'OBSERVED', value: sequencer.canonicalSha === sequencer.canonicalShaAfter };

  const stashEntry = ledger.one('R-G-04', '');
  const stashes: Observed<readonly StashObservation[]> = observedFrom(stashEntry, () => {
    const text = processText(stashEntry);
    if (text === undefined) {
      // exit 128 means refs/stash is absent, which the surface calls conclusive: no stash.
      if (stashEntry?.process?.exitCode === 128) return [];
      return undefined;
    }
    return text
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l !== '')
      .map((line) => {
        const f = line.split('\t');
        const parents = f[1] === undefined || f[1] === '' ? [] : f[1].split(' ');
        const first = asSha(parents[0]);
        return {
          stashCommit: f[0],
          firstParent: first ?? undefined,
          selector: f[2] ?? '',
          // A22: attribution is filled in by the classifier's evidence pass, never invented here.
          attribution: 'UNKNOWN' as const,
        };
      });
  });

  const commonEntries = ledger.get('R-F-08', 'BEFORE')[0];
  const mainWorktreeEntryNames: Observed<readonly string[]> = observedFrom(commonEntries, () =>
    (commonEntries?.filesystem?.entries ?? []).map((e) => e.name).sort(),
  );
  const mainNames = mainWorktreeEntryNames.value ?? [];

  const canonicalUnitFiles: Observed<readonly string[]> = observedFrom(
    ledger.one('R-G-08', ''),
    () => {
      const text = processText(ledger.one('R-G-08', ''));
      if (text === undefined) return undefined;
      return text
        .split('\n')
        .map((l) => l.replace(/\r$/, ''))
        .filter((l) => l !== '');
    },
  );

  return {
    repoRoot: sequencer.repoRoot,
    commonDir,
    canonicalRef: 'refs/remotes/origin/main',
    canonicalSha,
    canonicalShaSource: sequencer.canonicalShaSource,
    canonicalShaStableAcrossWindow: stable,
    canonicalRefUpdatedAtEpochSeconds:
      sequencer.canonicalRefReflogEpochSeconds === null
        ? { state: 'UNKNOWN', unknownReason: 'OUTPUT_UNPARSEABLE' }
        : { state: 'OBSERVED', value: sequencer.canonicalRefReflogEpochSeconds },
    stashes,
    mainWorktreeEntryNames,
    mainWorktreeLockFiles: {
      state: mainWorktreeEntryNames.state,
      value:
        mainWorktreeEntryNames.state === 'OBSERVED'
          ? mainNames.filter((n) => LOCK_ENTRY_PATTERN.test(n))
          : undefined,
    },
    mainWorktreeInProgressMarkers: {
      state: mainWorktreeEntryNames.state,
      value:
        mainWorktreeEntryNames.state === 'OBSERVED'
          ? mainNames.filter((n) => IN_PROGRESS_ENTRIES.has(n))
          : undefined,
    },
    mutationEvidence: compareBeforeAfter(ledger),
    configuration,
    canonicalUnitFiles,
  };
}

/**
 * The corpus's own non-mutation proof, recomputed by the Observer.
 *
 * R-F-01, R-F-02 and R-F-08 are each issued twice, before and after the workspace pass. If any
 * entry's name, type, size or modification time changed between them, the observation itself
 * touched the repository. That turns "the read-only flags are sufficient" from a claim into
 * evidence, which is the whole reason the surface issues these families twice.
 */
function compareBeforeAfter(
  ledger: ObservationLedger,
): Observed<{ comparedPairs: number; differingPairs: readonly string[] }> {
  const differing: string[] = [];
  let compared = 0;
  let anyMissing = false;

  const pairs: { requestId: string; before: string; after: string }[] = [
    { requestId: 'R-F-01', before: 'BEFORE', after: 'AFTER' },
    { requestId: 'R-F-08', before: 'BEFORE', after: 'AFTER' },
  ];
  for (const entry of ledger.byRequestId('R-F-02')) {
    if (!entry.instanceKey.endsWith(':BEFORE')) continue;
    pairs.push({
      requestId: 'R-F-02',
      before: entry.instanceKey,
      after: entry.instanceKey.replace(/:BEFORE$/, ':AFTER'),
    });
  }

  for (const pair of pairs) {
    const before = ledger.one(pair.requestId, pair.before);
    const after = ledger.one(pair.requestId, pair.after);
    if (before === undefined || after === undefined) {
      anyMissing = true;
      continue;
    }
    compared += 1;
    const a = JSON.stringify(before.filesystem?.entries ?? null);
    const b = JSON.stringify(after.filesystem?.entries ?? null);
    if (a !== b) differing.push(`${pair.requestId} ${pair.before} vs ${pair.after}`);
  }

  if (compared === 0) {
    return { state: 'NOT_ATTEMPTED', notAttemptedReason: 'INSTANTIATION_PREDICATE_UNSATISFIED' };
  }
  if (anyMissing) {
    // A partial comparison cannot prove non-mutation, and reporting it as a clean pass would be the
    // exact silent weakening this pair exists to prevent.
    return { state: 'UNKNOWN', unknownReason: 'OUTPUT_UNPARSEABLE' };
  }
  return { state: 'OBSERVED', value: { comparedPairs: compared, differingPairs: differing } };
}

/**
 * Does the workspace's own git view name THIS repository?
 *
 * The comparison is on `--git-common-dir`, because that is what distinguishes a linked worktree of
 * this repository from an independent repository that happens to sit inside the same tree. Two of
 * the three spellings git produces are resolvable under the frozen path policy; the third is not,
 * and it is reported as UNRESOLVED rather than guessed:
 *
 *   absolute            used as-is
 *   exactly '.git'      joined to the reported toplevel (the main worktree and foreign roots)
 *   anything relative   e.g. '../../.git' for a directory nested inside the main worktree.
 *                       Resolving it needs '..' collapsing, which LITERAL_BACKSLASH_CONCATENATION_V1
 *                       forbids. Those candidates are already decided by TOPLEVEL_NOT_CANDIDATE, so
 *                       refusing to resolve costs nothing and invents nothing.
 */
function deriveMembership(
  entry: LedgerEntry | undefined,
  parsed: ReturnType<typeof parseWorkspaceRevParse> | null,
  repoCommonDirKey: string | undefined,
): Observed<'MEMBER' | 'FOREIGN' | 'UNRESOLVED'> {
  if (entry === undefined) {
    return { state: 'NOT_ATTEMPTED', notAttemptedReason: 'INSTANTIATION_PREDICATE_UNSATISFIED' };
  }
  if (entry.state === 'NOT_ATTEMPTED') {
    return { state: 'NOT_ATTEMPTED', notAttemptedReason: entry.notAttemptedReason };
  }
  if (parsed === null || repoCommonDirKey === undefined) {
    return { state: 'UNKNOWN', unknownReason: entry.unknownReason ?? 'OUTPUT_UNPARSEABLE' };
  }
  const raw = parsed.gitCommonDir;
  const isAbsolute = isAbsolutePath(raw);
  let resolved: string | undefined;
  if (isAbsolute) resolved = raw;
  else if (raw === '.git') resolved = joinPath(parsed.toplevel, '.git');
  if (resolved === undefined) return { state: 'OBSERVED', value: 'UNRESOLVED' };
  return {
    state: 'OBSERVED',
    value: comparisonKey(resolved) === repoCommonDirKey ? 'MEMBER' : 'FOREIGN',
  };
}

interface WorkspaceContext {
  readonly ledger: ObservationLedger;
  readonly repoCommonDirKey: string | undefined;
  readonly worktreeBlocks: ReturnType<typeof parseWorktreeList>;
  readonly localHeads: ReturnType<typeof parseLocalHeads>;
  readonly metadataByKey: ReadonlyMap<string, string>;
  readonly canonicalSha: string | null;
  readonly inScope: boolean;
}

function correlateWorkspace(candidate: Candidate, ctx: WorkspaceContext): WorkspaceObservation {
  const { ledger } = ctx;
  const key = candidate.comparisonKey;
  const proofs: PositiveProof[] = [];

  // --- source 1: git worktree list ------------------------------------------------------------
  const block = ctx.worktreeBlocks.find((b) => comparisonKey(b.path) === key);
  const gitWorktreeList: GitWorktreeListClaim =
    block === undefined
      ? { listed: false }
      : {
          listed: true,
          path: block.path,
          head: block.head ?? undefined,
          branch: block.branch ?? undefined,
          detached: block.detached,
          locked: block.locked,
          lockedReason: block.lockedReason ?? undefined,
          prunable: block.prunable,
          prunableReason: block.prunableReason ?? undefined,
          bare: block.bare,
        };
  if (block !== undefined) {
    proofs.push({
      predicate: 'REGISTERED_LINKED_WORKTREE',
      provenBy: 'git worktree list --porcelain',
      requestId: 'R-G-03',
      exitCode: 0,
    });
  }

  // --- source 2: the .git/worktrees metadata directory -----------------------------------------
  const worktreeId = ctx.metadataByKey.get(key);
  let gitMetadata: GitMetadataClaim = { registered: false };
  if (worktreeId !== undefined) {
    const pointer = fileText(ledger.one('R-F-03', `wt:${worktreeId}:gitdir`))?.trim();
    const target = ledger.one('R-F-04', `wt:${worktreeId}:gitdir-target`, 'gitdir-target');
    const metaList = ledger.one('R-F-02', `wt:${worktreeId}:BEFORE`);
    const headFile = fileText(ledger.one('R-F-03', `wt:${worktreeId}:HEAD`))?.trim();
    const lockedFile = ledger.one('R-F-03', `wt:${worktreeId}:locked`);
    const configFile = ledger.one('R-F-03', `wt:${worktreeId}:config.worktree`);
    const names = (metaList?.filesystem?.entries ?? []).map((e) => e.name).sort();

    gitMetadata = {
      registered: true,
      worktreeId,
      gitdirPointer: pointer,
      gitdirTargetPresent:
        target?.filesystem?.outcome === 'COMPLETED' ? target.filesystem.exists === true : undefined,
      gitdirTargetErrorCode: target?.filesystem?.errorCode ?? undefined,
      registeredHead: asSha(headFile) ?? undefined,
      lockedMarker: lockedFile?.filesystem?.outcome === 'COMPLETED',
      lockedMarkerReason: fileText(lockedFile)?.trim(),
      metadataEntryNames: names,
      lockFiles: names.filter((n) => LOCK_ENTRY_PATTERN.test(n)),
      inProgressMarkers: names.filter((n) => IN_PROGRESS_ENTRIES.has(n)),
      hasWorktreeConfig: configFile?.filesystem?.outcome === 'COMPLETED',
    };
    proofs.push({
      predicate: 'HAS_WORKTREE_METADATA_DIRECTORY',
      provenBy: `lstat ${pointer ?? '<gitdir>'}`,
      requestId: 'R-F-04',
      exitCode: null,
    });
  }

  // --- source 3: the filesystem ----------------------------------------------------------------
  const lstat = ledger.one('R-F-06', candidate.caseId, 'lstat');
  const realpath = ledger.one('R-F-06', candidate.caseId, 'realpath');
  const entryCount = ledger.one('R-F-06', candidate.caseId, 'entryCount');
  const dotGitLstat = ledger.one('R-F-06', candidate.caseId, 'dotgit-lstat');
  const dotGitContent = ledger.one('R-F-06', candidate.caseId, 'dotgit-content');

  const pathPresent: Observed<boolean> = observedFrom(lstat, () => {
    const r = lstat?.filesystem;
    if (r === undefined) return undefined;
    if (r.outcome === 'COMPLETED') return r.exists === true;
    // ENOENT and ENOTDIR are conclusive absences per the frozen errorCodeInterpretation.
    if (r.outcome === 'ERROR' && (r.errorCode === 'ENOENT' || r.errorCode === 'ENOTDIR')) return false;
    return undefined;
  });

  const pointerText = fileText(dotGitContent)?.trim();
  const filesystem: FilesystemClaim = {
    pathPresent,
    entryType: lstat?.filesystem?.outcome === 'COMPLETED' ? (lstat.filesystem.type ?? undefined) : undefined,
    errorCode: lstat?.filesystem?.errorCode ?? undefined,
    realpath: realpath?.filesystem?.realpath ?? undefined,
    entryCount: entryCount?.filesystem?.entryCount,
    dotGitType:
      dotGitLstat?.filesystem?.outcome === 'COMPLETED'
        ? (dotGitLstat.filesystem.type ?? undefined)
        : undefined,
    dotGitAbsent:
      dotGitLstat?.filesystem?.outcome === 'ERROR' && dotGitLstat.filesystem.errorCode === 'ENOENT'
        ? true
        : undefined,
    dotGitPointer:
      pointerText !== undefined && pointerText.startsWith('gitdir:')
        ? pointerText.slice('gitdir:'.length).trim()
        : undefined,
  };
  if (pathPresent.state === 'OBSERVED') {
    proofs.push({
      predicate: pathPresent.value === true ? 'PATH_EXISTS' : 'PATH_ABSENT',
      provenBy: `lstat ${candidate.preferredSpelling}`,
      requestId: 'R-F-06',
      exitCode: null,
    });
  }

  // --- source 4: the branch binding -------------------------------------------------------------
  const bound = ctx.localHeads.find(
    (r) => r.worktreePath !== '' && comparisonKey(r.worktreePath) === key,
  );
  const branchBinding: BranchBindingClaim =
    bound === undefined
      ? { bound: false }
      : {
          bound: true,
          refname: bound.refname,
          objectname: bound.objectname,
          upstream: bound.upstream === '' ? undefined : bound.upstream,
          upstreamTrack: bound.upstreamTrack === '' ? undefined : bound.upstreamTrack,
        };

  // --- the workspace's own git view -------------------------------------------------------------
  const revParse = ledger.one('R-W-03', candidate.caseId);
  const revParsed = (() => {
    const text = processText(revParse);
    return text === undefined ? null : parseWorkspaceRevParse(text);
  })();
  const toplevel: Observed<string> = observedFrom(revParse, () => revParsed?.toplevel);
  const toplevelMatchesCandidate: Observed<boolean> = observedFrom(revParse, () =>
    revParsed === null ? undefined : comparisonKey(revParsed.toplevel) === key,
  );
  if (toplevelMatchesCandidate.state === 'OBSERVED' && toplevelMatchesCandidate.value === true) {
    proofs.push({
      predicate: 'TOPLEVEL_EQUALS_CANDIDATE',
      provenBy: 'git rev-parse --show-toplevel',
      requestId: 'R-W-03',
      exitCode: 0,
    });
  }

  const workspaceGitUnavailable =
    revParse?.process?.outcome === 'COMPLETED' && revParse.process.exitCode === 128;
  const repositoryMembership = deriveMembership(revParse, revParsed, ctx.repoCommonDirKey);

  const symbolicRefEntry = ledger.one('R-W-02', candidate.caseId);
  const symbolicRef: Observed<string> = observedFrom(symbolicRefEntry, () =>
    processText(symbolicRefEntry)?.trim(),
  );

  const statusEntry = ledger.one('R-W-04', candidate.caseId);
  const status: Observed<StatusFacts> = observedFrom(statusEntry, () => {
    const text = processText(statusEntry);
    if (text === undefined) return undefined;
    const parsed = parseStatusPorcelainV2(text);
    // A missing '# branch.upstream' or '# branch.ab' header means the branch has no upstream — a
    // conclusive observation, not an inconclusive one. Treating an absent header as "could not
    // observe" would make clean, provably-safe workspaces BLOCKED and would fail UTILITY outright.
    return {
      trackedModificationCount: parsed.trackedModificationCount,
      untrackedEntryCount: parsed.untrackedEntryCount,
      unmergedCount: parsed.unmergedCount,
      branchHead: parsed.branchHead ?? undefined,
      branchOid: parsed.branchOid ?? undefined,
      branchUpstream: parsed.branchUpstream ?? undefined,
      aheadOfUpstream: parsed.ahead ?? undefined,
      behindUpstream: parsed.behind ?? undefined,
      pathsElided: statusEntry?.process?.truncation !== undefined ? true : undefined,
    };
  });
  if (status.state === 'OBSERVED') {
    proofs.push({
      predicate: 'WORKING_TREE_STATE_OBSERVED',
      provenBy: 'git status --porcelain=v2 --branch --untracked-files=normal --no-renames',
      requestId: 'R-W-04',
      exitCode: 0,
    });
  }

  // --- ancestry ----------------------------------------------------------------------------------
  const headEntry = ledger.one('R-W-01', candidate.caseId);
  const headSha = asSha(processText(headEntry));
  const ancestry = correlateAncestry(ledger, headSha, headEntry, proofs);

  const unitsEntry = ledger.one('R-W-05', candidate.caseId);
  const declaredUnitFiles = (unitsEntry?.filesystem?.entries ?? [])
    .filter((e) => e.type === 'file' && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort();

  // A17: content evidence never silently shadows topology, and REGISTERED_RECONCILIATION is not
  // emittable — no reconciliation registry exists at the frozen base, so absent registered evidence
  // the value is NONE, not assumed equivalence.
  const contentEvidence: ContentEvidence =
    ancestry.value?.allUniqueCommitsPatchEquivalent === true ? 'PATCH_ID_MATCH' : 'NONE';

  const observationState = ctx.inScope
    ? worstOf([pathPresent.state, toplevel.state, status.state, ancestry.state])
    : ('NOT_ATTEMPTED' as const);

  return {
    caseId: candidate.caseId,
    comparisonKey: candidate.comparisonKey,
    preferredSpelling: candidate.preferredSpelling,
    spellings: candidate.spellings.map((s) => ({ source: s.source, path: s.path })),
    observationState,
    notAttemptedReason: ctx.inScope ? undefined : 'OUT_OF_OBSERVATION_SCOPE',
    gitWorktreeList,
    gitMetadata,
    filesystem,
    branchBinding,
    toplevel,
    toplevelMatchesCandidate,
    workspaceGitDir: observedFrom(revParse, () => revParsed?.gitDir),
    workspaceGitCommonDir: observedFrom(revParse, () => revParsed?.gitCommonDir),
    insideWorkTree: observedFrom(revParse, () => revParsed?.isInsideWorkTree ?? undefined),
    workspaceGitExitCode: revParse?.process?.exitCode ?? undefined,
    repositoryMembership,
    workspaceGitUnavailable,
    symbolicRef,
    status,
    ancestry,
    declaredUnitFiles,
    contentEvidence,
    graphRelation: deriveGraphRelation(ancestry.value),
    proofs,
  };
}

/**
 * The workspace's overall state is the WORST of its required observations.
 *
 * Ordering matters and it is deliberately pessimistic: one inconclusive required fact makes the
 * whole workspace inconclusive, because a disposition is only as good as its weakest predicate.
 */
function worstOf(states: readonly ('OBSERVED' | 'UNKNOWN' | 'NOT_ATTEMPTED')[]): 'OBSERVED' | 'UNKNOWN' | 'NOT_ATTEMPTED' {
  if (states.includes('NOT_ATTEMPTED')) return 'NOT_ATTEMPTED';
  if (states.includes('UNKNOWN')) return 'UNKNOWN';
  return 'OBSERVED';
}

function correlateAncestry(
  ledger: ObservationLedger,
  headSha: string | null,
  headEntry: LedgerEntry | undefined,
  proofs: PositiveProof[],
): Observed<AncestryFacts> {
  if (headEntry === undefined) {
    return { state: 'NOT_ATTEMPTED', notAttemptedReason: 'INSTANTIATION_PREDICATE_UNSATISFIED' };
  }
  if (headEntry.state === 'NOT_ATTEMPTED') {
    return { state: 'NOT_ATTEMPTED', notAttemptedReason: headEntry.notAttemptedReason };
  }
  if (headSha === null) {
    const reason: UnknownReason = headEntry.unknownReason ?? 'OUTPUT_UNPARSEABLE';
    return { state: 'UNKNOWN', unknownReason: reason };
  }

  const key = `sha:${headSha}`;
  const exists = ledger.one('R-G-11', key);
  const isAncestor = ledger.one('R-G-12', key);
  const isDescendant = ledger.one('R-G-13', key);
  const mergeBaseEntry = ledger.one('R-G-14', key);
  const aheadEntry = ledger.one('R-G-15', key);
  const behindEntry = ledger.one('R-G-16', key);
  const cherryEntry = ledger.one('R-G-18', key);

  // `cat-file -e` exit 1 and 128 are both CONCLUSIVE per the frozen exitCodeInterpretation: the
  // object is missing, or the name is not a commit. That is an observed fact, not an inconclusive
  // one, and folding it into UNKNOWN would lose the distinction the conflict table needs.
  const existsValue =
    exists?.process?.outcome === 'COMPLETED' &&
    (exists.process.exitCode === 0 || exists.process.exitCode === 1 || exists.process.exitCode === 128)
      ? exists.process.exitCode === 0
      : undefined;

  if (existsValue === true) {
    proofs.push({
      predicate: 'HEAD_COMMIT_EXISTS',
      provenBy: `git cat-file -e ${headSha}^{commit}`,
      requestId: 'R-G-11',
      exitCode: 0,
    });
  }

  // `merge-base --is-ancestor` answers by exit status: 0 yes, 1 no. Anything else is inconclusive.
  const ancestorOf = (e: LedgerEntry | undefined): boolean | undefined => {
    if (e?.process?.outcome !== 'COMPLETED') return undefined;
    if (e.process.exitCode === 0) return true;
    if (e.process.exitCode === 1) return false;
    return undefined;
  };

  const headIsAncestorOfCanonical = ancestorOf(isAncestor);
  if (headIsAncestorOfCanonical === true) {
    proofs.push({
      predicate: 'EXACT_ANCESTOR',
      provenBy: 'git merge-base --is-ancestor <head> <canonical>',
      requestId: 'R-G-12',
      exitCode: 0,
    });
  }

  const cherryText = processText(cherryEntry);
  const cherry = cherryText === undefined ? undefined : parseCherry(cherryText);
  const ahead = asCount(processText(aheadEntry));
  if (ahead === 0) {
    proofs.push({
      predicate: 'NO_UNIQUE_COMMITS',
      provenBy: 'git rev-list --count <canonical>..<head>',
      requestId: 'R-G-15',
      exitCode: 0,
    });
  }

  const value: AncestryFacts = {
    headSha,
    headCommitExists: existsValue,
    headIsAncestorOfCanonical,
    canonicalIsAncestorOfHead: ancestorOf(isDescendant),
    mergeBase: asSha(processText(mergeBaseEntry)) ?? undefined,
    commitsAheadOfCanonical: ahead ?? undefined,
    commitsBehindCanonical: asCount(processText(behindEntry)) ?? undefined,
    allUniqueCommitsPatchEquivalent: cherry?.allEquivalent,
    uniqueCommitCount: cherry?.total,
  };

  // The ancestry observation is only OBSERVED when the object itself was resolvable. Everything
  // downstream of a missing commit is an answer about nothing.
  if (existsValue === undefined) {
    return { state: 'UNKNOWN', unknownReason: exists?.unknownReason ?? 'OUTPUT_UNPARSEABLE', value };
  }
  return { state: 'OBSERVED', value };
}
