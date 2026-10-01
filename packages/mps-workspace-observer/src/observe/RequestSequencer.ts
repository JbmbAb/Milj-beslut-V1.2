/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the frozen order of execution.
 *
 * Record order is digest-covered on the Phase 0 side, and three families are issued TWICE with
 * byte-identical argv (R-G-01, R-G-02) or byte-identical paths (R-F-01, R-F-02, R-F-08) as BEFORE
 * and AFTER passes. The replay transport therefore answers a repeated key from an ORDERED list. Two
 * consequences follow and both are load-bearing:
 *
 *  - the Observer must issue requests in the surface's declared order, or it receives the AFTER
 *    record for the BEFORE read and the observation-window evidence is silently destroyed;
 *  - the BEFORE/AFTER pair is not redundancy. It is the corpus's own proof that the observation
 *    mutated nothing, and an Observer that skipped the AFTER pass would discard that proof.
 *
 * Everything here follows candidateExpansion.orderOfExecution of the frozen command surface. The
 * metadata probes (git --version, git --exec-path) are deliberately NOT issued: they are recorded
 * in capture metadata, which is not digest-covered and holds no records, so requesting them would
 * be a corpus miss.
 */
import type { RequestPort } from '../port/RequestPort.js';
import type {
  CommandSurface,
  FilesystemOperation,
  FilesystemRequest,
} from '../surface/CommandSurface.js';
import {
  caseIdFromComparisonKey,
  comparisonKey,
  isAbsolutePath,
  joinPath,
  parentOfGitDir,
  preferredSpelling,
  sortCandidateSpellings,
} from '../surface/PathPolicy.js';
import type { CandidateSource, CandidateSpelling } from '../surface/PathPolicy.js';
import { ObservationLedger, decodeUtf8 } from './ObservationLedger.js';
import type { LedgerEntry, NotAttemptedReason, UnknownReason } from './ObservationLedger.js';
import {
  asSha,
  newestReflogEpochSeconds,
  parseGlobalRevParse,
  parseLocalHeads,
  parseLsRemoteSha,
  parseStashReflog,
  parseWorktreeList,
} from './parsers.js';

/**
 * R-F-07's allowlist rule: a regular `.json` file beside the verification worktrees that is NOT on
 * the frozen allowlist halts the run rather than being silently ingested, so a new uncommitted
 * governance file is adjudicated instead of quietly becoming evidence.
 */
export class CommandSurfaceIncomplete extends Error {
  readonly code = 'COMMAND_SURFACE_INCOMPLETE';
  constructor(detail: string) {
    super(`COMMAND_SURFACE_INCOMPLETE: ${detail}`);
    this.name = 'CommandSurfaceIncomplete';
  }
}

export interface Candidate {
  readonly caseId: string;
  readonly comparisonKey: string;
  readonly preferredSpelling: string;
  readonly spellings: readonly CandidateSpelling[];
}

export interface SequencerResult {
  readonly ledger: ObservationLedger;
  readonly repoRoot: string;
  readonly commonDir: string | null;
  readonly canonicalSha: string | null;
  readonly canonicalShaSource: 'R-G-02[BEFORE]' | 'R-G-01[BEFORE]' | 'NONE';
  readonly canonicalShaAfter: string | null;
  readonly canonicalRefReflogEpochSeconds: number | null;
  readonly worktreeIds: readonly string[];
  readonly candidates: readonly Candidate[];
  readonly shaSet: readonly string[];
  /** Candidates that received the WORKSPACE_LOCAL families in this run. */
  readonly observedCandidates: readonly string[];
}

export interface SequencerOptions {
  readonly surface: CommandSurface;
  readonly port: RequestPort;
  readonly repoRoot: string;
  /**
   * Which discovered candidates receive the WORKSPACE_LOCAL families.
   *
   * This is an explicit INPUT, not a judgement the Observer makes: replay feeds one case bundle at
   * a time, so a run that issued workspace-local requests for all 122 discovered candidates would
   * be a corpus miss on 121 of them. Every out-of-scope candidate is still emitted, with
   * NOT_ATTEMPTED and the reason OUT_OF_OBSERVATION_SCOPE — never omitted (A3), and never
   * mistakable for an inconclusive observation.
   */
  readonly observationScope: 'ALL' | { readonly caseIds: readonly string[] };
}

/** The 400-line threshold above which R-W-04 paths are elided; counts are still exact. */
export class RequestSequencer {
  private readonly surface: CommandSurface;
  private readonly port: RequestPort;
  private readonly repoRoot: string;
  private readonly scope: SequencerOptions['observationScope'];
  private readonly ledger = new ObservationLedger();

  constructor(options: SequencerOptions) {
    this.surface = options.surface;
    this.port = options.port;
    this.repoRoot = options.repoRoot;
    this.scope = options.observationScope;
  }

  async run(): Promise<SequencerResult> {
    // --- step 1: repository geometry and the canonical reference, BEFORE pass -------------------
    const revParse = await this.process('R-G-07', '', {});
    const commonDir = this.deriveCommonDir(revParse);

    const canonBefore1 = await this.process('R-G-01', 'BEFORE', {});
    const canonBefore2 = await this.process('R-G-02', 'BEFORE', {});
    const { canonicalSha, canonicalShaSource } = this.selectCanonicalSha(canonBefore1, canonBefore2);

    const configKeys = this.surface.family('R-G-10').instances.keys ?? [];
    for (const key of configKeys) {
      await this.process('R-G-10', key, { configKey: key });
    }

    // --- step 2: repository-global evidence and worktree metadata, BEFORE pass ------------------
    const worktreeList = await this.process('R-G-03', '', {});
    const stashReflog = await this.process('R-G-04', '', {});
    const localHeads = await this.process('R-G-05', '', {});
    await this.process('R-G-06', '', {});

    if (commonDir === null) {
      // Without COMMON_DIR no metadata family can be addressed at all. Each one is still emitted
      // as NOT_ATTEMPTED with a stated reason rather than silently skipped.
      this.notAttemptedFamily('R-F-08', 'BEFORE', 'INSTANTIATION_PREDICATE_UNSATISFIED');
      this.notAttemptedFamily('R-F-01', 'BEFORE', 'INSTANTIATION_PREDICATE_UNSATISFIED');
    }

    let worktreeIds: readonly string[] = [];
    let reflogEpoch: number | null = null;
    const gitdirContentById = new Map<string, string>();

    if (commonDir !== null) {
      await this.filesystem('R-F-08', 'BEFORE', 'READDIR', '', commonDir);
      for (const metaFile of this.surface.family('R-F-09').instances.keys ?? []) {
        await this.filesystem(
          'R-F-09',
          `common:${metaFile}`,
          'READ_FILE',
          '',
          joinPath(commonDir, metaFile),
          this.surface.family('R-F-09').maxBytes,
        );
      }
      const reflog = await this.filesystem(
        'R-F-10',
        '',
        'READ_FILE',
        '',
        joinPath(joinPath(joinPath(joinPath(commonDir, 'logs'), 'refs'), 'remotes'), 'origin') +
          '\\main',
        this.surface.family('R-F-10').maxBytes,
      );
      const reflogText =
        reflog.filesystem?.outcome === 'COMPLETED'
          ? decodeUtf8(reflog.filesystem.content)
          : { unknownReason: 'FILESYSTEM_ERROR_INCONCLUSIVE' as UnknownReason };
      if ('text' in reflogText) reflogEpoch = newestReflogEpochSeconds(reflogText.text);

      const worktreesDir = joinPath(commonDir, 'worktrees');
      const listBefore = await this.filesystem('R-F-01', 'BEFORE', 'READDIR', '', worktreesDir);
      worktreeIds = (listBefore.filesystem?.entries ?? [])
        .filter((e) => e.type === 'dir')
        .map((e) => e.name);

      const fixedFiles = this.surface.family('R-F-03').instances.fixedFiles ?? [];
      for (const id of worktreeIds) {
        const wtDir = joinPath(worktreesDir, id);
        await this.filesystem('R-F-02', `wt:${id}:BEFORE`, 'READDIR', '', wtDir);
        for (const metaFile of fixedFiles) {
          const entry = await this.filesystem(
            'R-F-03',
            `wt:${id}:${metaFile}`,
            'READ_FILE',
            '',
            joinPath(wtDir, metaFile),
            this.surface.family('R-F-03').maxBytes,
          );
          if (metaFile === 'gitdir' && entry.filesystem?.outcome === 'COMPLETED') {
            const decoded = decodeUtf8(entry.filesystem.content);
            if ('text' in decoded) gitdirContentById.set(id, decoded.text.trim());
          }
        }

        const gitdir = gitdirContentById.get(id);
        if (gitdir === undefined) {
          this.notAttempted(
            'R-F-04',
            `wt:${id}:gitdir-target`,
            'gitdir-target',
            'INSTANTIATION_PREDICATE_UNSATISFIED',
          );
          this.notAttempted(
            'R-F-04',
            `wt:${id}:gitdir-parent`,
            'gitdir-parent',
            'INSTANTIATION_PREDICATE_UNSATISFIED',
          );
        } else {
          // R-F-04 is the one composite-shaped family whose two operations share a path template,
          // so the recorder keyed them by opKey as well as by instanceKey. The replay key includes
          // opKey, so omitting it here is a corpus miss rather than a wrong answer.
          await this.filesystem('R-F-04', `wt:${id}:gitdir-target`, 'LSTAT', 'gitdir-target', gitdir);
          const parent = parentOfGitDir(gitdir);
          if (parent === undefined) {
            // parentOf is undefined: the pointer has no trailing '.git' segment. The surface says
            // to emit a declared non-attempt rather than duplicate the target observation, so a
            // dangling pointer stays distinguishable from a pointer to a real parent directory.
            this.notAttempted(
              'R-F-04',
              `wt:${id}:gitdir-parent`,
              'gitdir-parent',
              'INSTANTIATION_PREDICATE_UNSATISFIED',
            );
          } else {
            await this.filesystem('R-F-04', `wt:${id}:gitdir-parent`, 'LSTAT', 'gitdir-parent', parent);
          }
        }
      }
    }

    // --- step 3: filesystem discovery ----------------------------------------------------------
    const containers = this.surface.family('R-F-05').instances.containers ?? [];
    const containerListings: { key: string; path: string; names: string[] }[] = [];
    for (const container of containers) {
      const path = container.path.replace('{REPO_ROOT}', this.repoRoot);
      const entry = await this.filesystem(
        'R-F-05',
        `container:${container.key}`,
        'READDIR',
        '',
        path,
        undefined,
        {
          nameFilter: container.nameFilter,
          nameFilterFlags: container.nameFilterFlags,
          onlyDirectories: container.onlyDirectories,
        },
      );
      containerListings.push({
        key: container.key,
        path,
        names: (entry.filesystem?.entries ?? []).map((e) => e.name),
      });
    }

    await this.observeCodexVerification();

    // --- step 4: DEV-GOV unit definitions at the canonical base ---------------------------------
    let blobPaths: readonly string[] = [];
    if (canonicalSha === null) {
      this.notAttempted('R-G-08', '', '', 'CANONICAL_SHA_UNAVAILABLE');
      this.notAttempted('R-G-09', '', '', 'CANONICAL_SHA_UNAVAILABLE');
    } else {
      const lsTree = await this.process('R-G-08', '', { canonicalSha });
      blobPaths = this.jsonLinesOf(lsTree);
      if (blobPaths.length === 0) {
        this.notAttempted('R-G-09', '', '', 'EXPANSION_EMPTY');
      } else {
        for (const blobPath of blobPaths) {
          await this.process('R-G-09', `blob:${blobPath}`, { canonicalSha, blobPath });
        }
      }
    }

    // --- step 5: candidate expansion and the workspace-local pass -------------------------------
    const candidates = this.expandCandidates(worktreeList, gitdirContentById, containerListings, localHeads);
    const inScope = this.resolveScope(candidates);
    const workspaceHeadShas: string[] = [];

    for (const candidate of candidates) {
      if (!inScope.has(candidate.caseId)) {
        this.notAttemptedWorkspaceLocal(candidate, 'OUT_OF_OBSERVATION_SCOPE');
        continue;
      }
      const head = await this.observeCandidate(candidate);
      if (head !== null) workspaceHeadShas.push(head);
    }

    // --- step 6: SHA relationships --------------------------------------------------------------
    const shaSet = this.buildShaSet(worktreeList, gitdirContentById, workspaceHeadShas, stashReflog, canonicalSha);
    for (const sha of shaSet) {
      const exists = await this.process('R-G-11', `sha:${sha}`, { sha });
      const objectExists = exists.process?.outcome === 'COMPLETED' && exists.process.exitCode === 0;
      if (canonicalSha === null || !objectExists) {
        for (const id of ['R-G-12', 'R-G-13', 'R-G-14', 'R-G-15', 'R-G-16', 'R-G-17', 'R-G-18']) {
          this.notAttempted(
            id,
            `sha:${sha}`,
            '',
            canonicalSha === null ? 'CANONICAL_SHA_UNAVAILABLE' : 'INSTANTIATION_PREDICATE_UNSATISFIED',
          );
        }
        continue;
      }
      await this.process('R-G-12', `sha:${sha}`, { sha, canonicalSha });
      await this.process('R-G-13', `sha:${sha}`, { sha, canonicalSha });
      await this.process('R-G-14', `sha:${sha}`, { sha, canonicalSha });
      await this.process('R-G-15', `sha:${sha}`, { sha, canonicalSha });
      await this.process('R-G-16', `sha:${sha}`, { sha, canonicalSha });
      await this.process('R-G-17', `sha:${sha}`, { sha, canonicalSha });
      await this.process('R-G-18', `sha:${sha}`, { sha, canonicalSha });
    }

    // --- step 7: AFTER pass, which is the non-mutation evidence ---------------------------------
    let canonicalShaAfter: string | null = null;
    if (commonDir !== null) {
      const worktreesDir = joinPath(commonDir, 'worktrees');
      await this.filesystem('R-F-01', 'AFTER', 'READDIR', '', worktreesDir);
      for (const id of worktreeIds) {
        await this.filesystem('R-F-02', `wt:${id}:AFTER`, 'READDIR', '', joinPath(worktreesDir, id));
      }
      await this.filesystem('R-F-08', 'AFTER', 'READDIR', '', commonDir);
    }
    const after1 = await this.process('R-G-01', 'AFTER', {});
    const after2 = await this.process('R-G-02', 'AFTER', {});
    canonicalShaAfter = this.selectCanonicalSha(after1, after2).canonicalSha;

    return {
      ledger: this.ledger,
      repoRoot: this.repoRoot,
      commonDir,
      canonicalSha,
      canonicalShaSource,
      canonicalShaAfter,
      canonicalRefReflogEpochSeconds: reflogEpoch,
      worktreeIds,
      candidates,
      shaSet,
      observedCandidates: [...inScope],
    };
  }

  // ---------------------------------------------------------------------------------------------

  private deriveCommonDir(entry: LedgerEntry): string | null {
    if (entry.process?.outcome !== 'COMPLETED' || entry.process.exitCode !== 0) return null;
    const decoded = decodeUtf8(entry.process.stdout);
    // A directory path may never be derived from base64 bytes: guessing an encoding here would
    // silently retarget every metadata family.
    if (!('text' in decoded)) return null;
    const parsed = parseGlobalRevParse(decoded.text);
    if (parsed === null) return null;
    const raw = parsed.commonDir;
    return isAbsolutePath(raw) ? raw : joinPath(this.repoRoot, raw);
  }

  /**
   * canonicalShaSelectionRule, verbatim: prefer R-G-02[BEFORE] when it completed with exit 0 and
   * stdout matching /^[0-9a-f]{40}\t/; otherwise R-G-01[BEFORE] with exit 0 and 40-hex stdout;
   * otherwise null.
   *
   * The rule's third clause — that the selected SHA must also exist locally, evidenced by the
   * R-G-11 record for it — is applied later, once that record exists. Until then the selection is
   * provisional, which is also the order in which Phase 0 recorded it: R-G-08 substitutes the
   * provisional value, and record order is digest-covered.
   */
  private selectCanonicalSha(
    rg01: LedgerEntry,
    rg02: LedgerEntry,
  ): { canonicalSha: string | null; canonicalShaSource: SequencerResult['canonicalShaSource'] } {
    if (rg02.process?.outcome === 'COMPLETED' && rg02.process.exitCode === 0) {
      const decoded = decodeUtf8(rg02.process.stdout);
      if ('text' in decoded) {
        const sha = parseLsRemoteSha(decoded.text);
        if (sha !== null) return { canonicalSha: sha, canonicalShaSource: 'R-G-02[BEFORE]' };
      }
    }
    if (rg01.process?.outcome === 'COMPLETED' && rg01.process.exitCode === 0) {
      const decoded = decodeUtf8(rg01.process.stdout);
      if ('text' in decoded) {
        const sha = asSha(decoded.text);
        if (sha !== null) return { canonicalSha: sha, canonicalShaSource: 'R-G-01[BEFORE]' };
      }
    }
    return { canonicalSha: null, canonicalShaSource: 'NONE' };
  }

  private jsonLinesOf(entry: LedgerEntry): readonly string[] {
    if (entry.process?.outcome !== 'COMPLETED' || entry.process.exitCode !== 0) return [];
    const decoded = decodeUtf8(entry.process.stdout);
    if (!('text' in decoded)) return [];
    return decoded.text
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.endsWith('.json'));
  }

  private async observeCodexVerification(): Promise<void> {
    const family = this.surface.family('R-F-07');
    const ops = family.operations ?? [];
    const listOp = ops.find((o) => o.key === 'list');
    const readOp = ops.find((o) => o.key.startsWith('file:'));
    if (listOp === undefined || readOp === undefined) return;

    const listPath = listOp.path.replace('{REPO_ROOT}', this.repoRoot);
    const listing = await this.filesystem('R-F-07', '', 'READDIR', 'list', listPath, undefined, {
      filesOnly: listOp.filesOnly,
    });
    const allowlist = family.allowlist ?? (family as unknown as { readAllowlist?: string[] }).readAllowlist ?? [];

    const jsonFiles = (listing.filesystem?.entries ?? [])
      .filter((e) => e.type === 'file' && e.name.endsWith('.json'))
      .map((e) => e.name);

    for (const name of jsonFiles) {
      if (!allowlist.includes(name)) {
        // Halting rather than ingesting: a new uncommitted governance file must be adjudicated,
        // not quietly folded into the evidence a disposition rests on.
        throw new CommandSurfaceIncomplete(
          `R-F-07 found ${JSON.stringify(name)}, which is not on the frozen readAllowlist`,
        );
      }
    }
    if (jsonFiles.length === 0) {
      this.notAttempted('R-F-07', '', 'file:', 'EXPANSION_EMPTY');
      return;
    }
    for (const name of jsonFiles) {
      await this.filesystem(
        'R-F-07',
        '',
        'READ_FILE',
        `file:${name}`,
        joinPath(listPath, name),
        readOp.maxBytes,
      );
    }
  }

  private expandCandidates(
    worktreeList: LedgerEntry,
    gitdirContentById: ReadonlyMap<string, string>,
    containerListings: readonly { key: string; path: string; names: string[] }[],
    localHeads: LedgerEntry,
  ): readonly Candidate[] {
    const spellings: { source: CandidateSource; path: string }[] = [];

    // S1: each 'worktree <path>' line of the R-G-03 stdout, in stdout order.
    for (const block of this.worktreeBlocks(worktreeList)) {
      spellings.push({ source: 'S1', path: block.path });
    }
    // S2: parentOf(trimmed gitdir content), in worktreeId listing order.
    for (const [, content] of gitdirContentById) {
      const parent = parentOfGitDir(content);
      if (parent !== undefined) spellings.push({ source: 'S2', path: parent });
    }
    // S3: each recorded entry of each container, in container declaration order then entry order.
    for (const container of containerListings) {
      for (const name of container.names) {
        spellings.push({ source: 'S3', path: joinPath(container.path, name) });
      }
    }
    // S4: each non-empty fifth field of each R-G-05 stdout line, in stdout order.
    for (const ref of this.localHeadRefs(localHeads)) {
      if (ref.worktreePath !== '') spellings.push({ source: 'S4', path: ref.worktreePath });
    }

    const byKey = new Map<string, CandidateSpelling[]>();
    for (const s of spellings) {
      const key = comparisonKey(s.path);
      const list = byKey.get(key);
      if (list === undefined) byKey.set(key, [s]);
      else list.push(s);
    }

    const candidates: Candidate[] = [];
    for (const [key, list] of byKey) {
      const sorted = sortCandidateSpellings(list);
      candidates.push({
        caseId: caseIdFromComparisonKey(key),
        comparisonKey: key,
        preferredSpelling: preferredSpelling(sorted),
        spellings: sorted,
      });
    }
    // Case order, so a run is reproducible and a replay consumes sequences in capture order.
    candidates.sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
    return candidates;
  }

  private resolveScope(candidates: readonly Candidate[]): ReadonlySet<string> {
    if (this.scope === 'ALL') return new Set(candidates.map((c) => c.caseId));
    return new Set(this.scope.caseIds);
  }

  /** Every WORKSPACE_LOCAL family for one candidate. Returns its HEAD sha when conclusive. */
  private async observeCandidate(candidate: Candidate): Promise<string | null> {
    const path = candidate.preferredSpelling;
    const composite = this.surface.family('R-F-06').operations ?? [];

    let dotGitType: string | null = null;
    for (const op of composite) {
      const opPath = op.path.replace('{candidatePath}', path);
      if (op.key === 'dotgit-content') {
        // The read is attempted when the .git entry is a regular file OR a symlink. A directory
        // .git is a separate repository or the main worktree, absence is ENOENT, and any other
        // case is a declared non-attempt rather than an invented result.
        if (dotGitType !== 'file' && dotGitType !== 'symlink') {
          this.notAttempted('R-F-06', candidate.caseId, op.key, 'INSTANTIATION_PREDICATE_UNSATISFIED');
          continue;
        }
      }
      const entry = await this.filesystem(
        'R-F-06',
        candidate.caseId,
        op.op,
        op.key,
        opPath,
        op.maxBytes,
      );
      if (op.key === 'dotgit-lstat') {
        dotGitType = entry.filesystem?.outcome === 'COMPLETED' ? (entry.filesystem.type ?? null) : null;
      }
    }

    const revParseHead = await this.process('R-W-01', candidate.caseId, { candidatePath: path });
    await this.process('R-W-02', candidate.caseId, { candidatePath: path });
    await this.process('R-W-03', candidate.caseId, { candidatePath: path });
    await this.process('R-W-04', candidate.caseId, { candidatePath: path });

    const unitsDir = joinPath(joinPath(joinPath(path, 'governance'), 'devgov'), 'units');
    const units = await this.filesystem('R-W-05', candidate.caseId, 'READDIR', '', unitsDir);
    const unitFiles = (units.filesystem?.entries ?? [])
      .filter((e) => e.type === 'file' && e.name.endsWith('.json'))
      .map((e) => e.name);
    if (unitFiles.length === 0) {
      this.notAttempted('R-W-06', candidate.caseId, '', 'EXPANSION_EMPTY');
    } else {
      for (const name of unitFiles) {
        await this.filesystem(
          'R-W-06',
          `${candidate.caseId}:${name}`,
          'READ_FILE',
          '',
          joinPath(unitsDir, name),
          this.surface.family('R-W-06').maxBytes,
        );
      }
    }

    if (revParseHead.process?.outcome !== 'COMPLETED' || revParseHead.process.exitCode !== 0) {
      return null;
    }
    const decoded = decodeUtf8(revParseHead.process.stdout);
    return 'text' in decoded ? asSha(decoded.text) : null;
  }

  private notAttemptedWorkspaceLocal(candidate: Candidate, reason: NotAttemptedReason): void {
    for (const op of this.surface.family('R-F-06').operations ?? []) {
      this.notAttempted('R-F-06', candidate.caseId, op.key, reason);
    }
    for (const id of ['R-W-01', 'R-W-02', 'R-W-03', 'R-W-04', 'R-W-05', 'R-W-06']) {
      this.notAttempted(id, candidate.caseId, '', reason);
    }
  }

  /**
   * shaSetRule: the sorted set of distinct 40-hex strings drawn from (a) every 'HEAD <sha>' line of
   * R-G-03, (b) every R-F-03 wt:{id}:HEAD content that is exactly 40 hex after trimming, (c) every
   * R-W-01 stdout that is exactly 40 hex after trimming, (d) the first parent of every R-G-04 line,
   * and (e) canonicalSha when it is not null.
   */
  private buildShaSet(
    worktreeList: LedgerEntry,
    _gitdirContentById: ReadonlyMap<string, string>,
    workspaceHeadShas: readonly string[],
    stashReflog: LedgerEntry,
    canonicalSha: string | null,
  ): readonly string[] {
    const set = new Set<string>();

    for (const block of this.worktreeBlocks(worktreeList)) {
      const sha = asSha(block.head);
      if (sha !== null) set.add(sha);
    }
    for (const entry of this.ledger.all()) {
      if (entry.requestId !== 'R-F-03' || !entry.instanceKey.endsWith(':HEAD')) continue;
      if (entry.filesystem?.outcome !== 'COMPLETED') continue;
      const decoded = decodeUtf8(entry.filesystem.content);
      if (!('text' in decoded)) continue;
      const sha = asSha(decoded.text);
      if (sha !== null) set.add(sha);
    }
    for (const sha of workspaceHeadShas) set.add(sha);
    for (const stash of this.stashEntries(stashReflog)) {
      const first = stash.parents[0];
      const sha = asSha(first);
      if (sha !== null) set.add(sha);
    }
    if (canonicalSha !== null) set.add(canonicalSha);

    return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  private worktreeBlocks(entry: LedgerEntry): ReturnType<typeof parseWorktreeList> {
    if (entry.process?.outcome !== 'COMPLETED' || entry.process.exitCode !== 0) return [];
    const decoded = decodeUtf8(entry.process.stdout);
    return 'text' in decoded ? parseWorktreeList(decoded.text) : [];
  }

  private localHeadRefs(entry: LedgerEntry): ReturnType<typeof parseLocalHeads> {
    if (entry.process?.outcome !== 'COMPLETED' || entry.process.exitCode !== 0) return [];
    const decoded = decodeUtf8(entry.process.stdout);
    return 'text' in decoded ? parseLocalHeads(decoded.text) : [];
  }

  private stashEntries(entry: LedgerEntry): ReturnType<typeof parseStashReflog> {
    if (entry.process?.outcome !== 'COMPLETED' || entry.process.exitCode !== 0) return [];
    const decoded = decodeUtf8(entry.process.stdout);
    return 'text' in decoded ? parseStashReflog(decoded.text) : [];
  }

  // --- request issuing --------------------------------------------------------------------------

  private async process(
    requestId: string,
    instanceKey: string,
    values: Readonly<Record<string, string>>,
  ): Promise<LedgerEntry> {
    const family = this.surface.family(requestId);
    const argv = this.surface.assembleArgv(requestId, values);
    const response = await this.port.executeProcess({
      kind: 'PROCESS',
      requestId,
      scope: family.scope,
      instanceKey,
      executable: 'git',
      argv,
      cwd: this.repoRoot,
      env: this.surface.mandatoryEnvironment,
      timeoutMs: family.timeoutMs,
    });

    const state = processState(response);
    const entry: LedgerEntry = {
      requestId,
      instanceKey,
      opKey: '',
      state: state.state,
      unknownReason: state.unknownReason,
      process: response,
      argv,
      timing: this.port.timingFor(requestId, instanceKey, ''),
    };
    this.ledger.add(entry);
    return entry;
  }

  private async filesystem(
    requestId: string,
    instanceKey: string,
    operation: FilesystemOperation,
    opKey: string,
    path: string,
    maxBytes?: number,
    listing?: FilesystemRequest['listing'],
  ): Promise<LedgerEntry> {
    const family = this.surface.family(requestId);
    const response = await this.port.executeFilesystem({
      kind: 'FS',
      requestId,
      scope: family.scope,
      instanceKey,
      operation,
      opKey,
      path,
      timeoutMs: family.timeoutMs,
      maxBytes,
      listing,
    });

    const state = filesystemState(response);
    const entry: LedgerEntry = {
      requestId,
      instanceKey,
      opKey,
      state: state.state,
      unknownReason: state.unknownReason,
      filesystem: response,
      path,
      timing: this.port.timingFor(requestId, instanceKey, opKey),
    };
    this.ledger.add(entry);
    return entry;
  }

  private notAttempted(
    requestId: string,
    instanceKey: string,
    opKey: string,
    reason: NotAttemptedReason,
  ): void {
    this.ledger.add({
      requestId,
      instanceKey,
      opKey,
      state: 'NOT_ATTEMPTED',
      notAttemptedReason: reason,
    });
  }

  private notAttemptedFamily(
    requestId: string,
    instanceKey: string,
    reason: NotAttemptedReason,
  ): void {
    this.notAttempted(requestId, instanceKey, '', reason);
  }
}

/**
 * A recorded TIMEOUT, SPAWN_ERROR or non-zero exit is DATA, replayed as such, and the Observer
 * derives UNKNOWN from it here rather than the transport handing UNKNOWN down.
 *
 * A non-zero exit is UNKNOWN at this layer even where the surface calls it conclusive (exit 128
 * from `cat-file -e` means "object missing", conclusively). That is deliberate: conclusiveness is a
 * per-family reading of an exit code, and the family-specific readings live where the fact is
 * derived, with the raw exit code beside them. Treating every non-zero exit as inconclusive HERE
 * keeps the default fail-closed, and a family that can prove more says so explicitly.
 */
export function processState(response: {
  outcome: string;
  exitCode: number | null;
  truncation?: unknown;
}): { state: 'OBSERVED' | 'UNKNOWN'; unknownReason?: UnknownReason } {
  if (response.outcome === 'TIMEOUT') return { state: 'UNKNOWN', unknownReason: 'TIMEOUT' };
  if (response.outcome === 'SPAWN_ERROR') return { state: 'UNKNOWN', unknownReason: 'SPAWN_ERROR' };
  if (response.exitCode !== 0) return { state: 'UNKNOWN', unknownReason: 'NON_ZERO_EXIT' };
  return { state: 'OBSERVED' };
}

export function filesystemState(response: {
  outcome: string;
  errorCode?: string | null;
}): { state: 'OBSERVED' | 'UNKNOWN'; unknownReason?: UnknownReason } {
  if (response.outcome === 'TIMEOUT') return { state: 'UNKNOWN', unknownReason: 'TIMEOUT' };
  if (response.outcome === 'ERROR') {
    // errorCodeInterpretation: ENOENT and ENOTDIR are conclusive absences; everything else is
    // inconclusive. A conclusive absence is an OBSERVED fact — "this path is not there" — and
    // collapsing it into UNKNOWN would make every missing file indistinguishable from an
    // unreadable one, which is exactly the distinction the conflict table needs.
    const code = response.errorCode ?? 'UNKNOWN';
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'OBSERVED' };
    return { state: 'UNKNOWN', unknownReason: 'FILESYSTEM_ERROR_INCONCLUSIVE' };
  }
  return { state: 'OBSERVED' };
}
