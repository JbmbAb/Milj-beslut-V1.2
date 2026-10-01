/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — parsers for the frozen command surface's outputs.
 *
 * Each parser returns either parsed data or an inconclusive reason. None of them guesses: a stream
 * that is not valid UTF-8, a line that does not have the shape the surface's exitCodeInterpretation
 * describes, or output that was truncated in a way that would change a count, all produce UNKNOWN
 * rather than a best-effort reading. A2 permits derived fields only when the raw input sits in the
 * same artifact, and the ledger keeps the raw response beside every derived value.
 */

export interface WorktreeListBlock {
  /** git's own spelling of the path, with forward slashes. */
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly lockedReason: string | null;
  readonly prunable: boolean;
  readonly prunableReason: string | null;
  readonly bare: boolean;
}

/**
 * R-G-03 `git worktree list --porcelain`: blocks separated by blank lines, each starting with
 * `worktree <path>`. Attributes appear as bare keywords or `keyword value`.
 */
export function parseWorktreeList(stdout: string): readonly WorktreeListBlock[] {
  const blocks: WorktreeListBlock[] = [];
  let current: {
    path: string;
    head: string | null;
    branch: string | null;
    detached: boolean;
    locked: boolean;
    lockedReason: string | null;
    prunable: boolean;
    prunableReason: string | null;
    bare: boolean;
  } | null = null;

  const flush = (): void => {
    if (current !== null) blocks.push({ ...current });
    current = null;
  };

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') {
      flush();
      continue;
    }
    const spaceAt = line.indexOf(' ');
    const keyword = spaceAt === -1 ? line : line.slice(0, spaceAt);
    const value = spaceAt === -1 ? '' : line.slice(spaceAt + 1);

    if (keyword === 'worktree') {
      flush();
      current = {
        path: value,
        head: null,
        branch: null,
        detached: false,
        locked: false,
        lockedReason: null,
        prunable: false,
        prunableReason: null,
        bare: false,
      };
      continue;
    }
    if (current === null) continue;
    switch (keyword) {
      case 'HEAD':
        current.head = value;
        break;
      case 'branch':
        current.branch = value;
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'locked':
        current.locked = true;
        current.lockedReason = value === '' ? null : value;
        break;
      case 'prunable':
        current.prunable = true;
        current.prunableReason = value === '' ? null : value;
        break;
      case 'bare':
        current.bare = true;
        break;
      default:
        // An unrecognised attribute is not an error: git may add keywords. It is simply not a fact
        // this surface claims to observe, and inventing a meaning for it would be policy.
        break;
    }
  }
  flush();
  return blocks;
}

export interface LocalHeadRef {
  readonly refname: string;
  readonly objectname: string;
  readonly upstream: string;
  readonly upstreamTrack: string;
  /** Empty when the branch is not checked out in any worktree. */
  readonly worktreePath: string;
}

/** R-G-05 `for-each-ref` with five tab-separated fields. */
export function parseLocalHeads(stdout: string): readonly LocalHeadRef[] {
  const out: LocalHeadRef[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') continue;
    const f = line.split('\t');
    if (f.length < 5) continue;
    out.push({
      refname: f[0],
      objectname: f[1],
      upstream: f[2],
      upstreamTrack: f[3],
      worktreePath: f[4],
    });
  }
  return out;
}

export interface StashEntry {
  readonly stashCommit: string;
  readonly parents: readonly string[];
  readonly selector: string;
  readonly subject: string;
}

/** R-G-04 `git log -g --format=%H%x09%P%x09%gd%x09%gs refs/stash`. */
export function parseStashReflog(stdout: string): readonly StashEntry[] {
  const out: StashEntry[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') continue;
    const f = line.split('\t');
    if (f.length < 4) continue;
    out.push({
      stashCommit: f[0],
      parents: f[1] === '' ? [] : f[1].split(' '),
      selector: f[2],
      subject: f[3],
    });
  }
  return out;
}

export interface StatusPorcelainV2 {
  readonly branchOid: string | null;
  readonly branchHead: string | null;
  readonly branchUpstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  /** '1', '2' and 'u' lines: entries with uncommitted tracked changes. */
  readonly trackedModificationCount: number;
  readonly unmergedCount: number;
  readonly untrackedEntryCount: number;
  readonly ignoredCount: number;
  readonly totalLines: number;
}

/**
 * R-W-04 `git status --porcelain=v2 --branch --untracked-files=normal --no-renames`.
 *
 * Counts, not names. The redaction policy replaces untracked paths with numbered placeholders and
 * elides paths beyond 400 lines, but it never drops a line and never changes a count, precisely so
 * that this parse yields the same numbers on the frozen bytes as it would live.
 */
export function parseStatusPorcelainV2(stdout: string): StatusPorcelainV2 {
  let branchOid: string | null = null;
  let branchHead: string | null = null;
  let branchUpstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let tracked = 0;
  let unmerged = 0;
  let untracked = 0;
  let ignored = 0;
  let totalLines = 0;

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') continue;
    totalLines += 1;
    if (line.startsWith('# branch.oid ')) {
      branchOid = line.slice('# branch.oid '.length);
    } else if (line.startsWith('# branch.head ')) {
      branchHead = line.slice('# branch.head '.length);
    } else if (line.startsWith('# branch.upstream ')) {
      branchUpstream = line.slice('# branch.upstream '.length);
    } else if (line.startsWith('# branch.ab ')) {
      const m = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
      if (m !== null) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      tracked += 1;
    } else if (line.startsWith('u ')) {
      unmerged += 1;
      tracked += 1;
    } else if (line.startsWith('? ')) {
      untracked += 1;
    } else if (line.startsWith('! ')) {
      ignored += 1;
    }
  }

  return {
    branchOid,
    branchHead,
    branchUpstream,
    ahead,
    behind,
    trackedModificationCount: tracked,
    unmergedCount: unmerged,
    untrackedEntryCount: untracked,
    ignoredCount: ignored,
    totalLines,
  };
}

export interface RevParsePaths {
  readonly gitDir: string;
  readonly gitCommonDir: string;
  readonly toplevel: string;
  readonly isInsideWorkTree: boolean | null;
}

/**
 * Split `git rev-parse` output into its value lines.
 *
 * The trailing newline is stripped BEFORE the split, and that is not cosmetic. Splitting `'a\nb\n'`
 * on newlines yields three elements, the last of them empty, so a guard written as `length < 3`
 * accepts a TWO-value output and then reads the empty phantom as the third value. For R-G-07 that
 * assigns the toplevel an empty string, and every path derived from it is wrong while the
 * observation still looks conclusive — the exact failure shape the fail-closed rules exist to stop.
 *
 * The count is therefore checked for EQUALITY by the callers: too few values and too many are both
 * output this parser does not understand, and neither may be read as a partial success.
 */
function revParseLines(stdout: string): readonly string[] {
  const trimmed = stdout.replace(/\r?\n$/, '');
  if (trimmed === '') return [];
  return trimmed.split('\n').map((l) => l.replace(/\r$/, ''));
}

/**
 * R-W-03 `rev-parse --git-dir --git-common-dir --show-toplevel --is-inside-work-tree`.
 * Four lines, in the order the flags were given.
 */
export function parseWorkspaceRevParse(stdout: string): RevParsePaths | null {
  const lines = revParseLines(stdout);
  if (lines.length !== 4) return null;
  const flag = lines[3];
  return {
    gitDir: lines[0],
    gitCommonDir: lines[1],
    toplevel: lines[2],
    isInsideWorkTree: flag === 'true' ? true : flag === 'false' ? false : null,
  };
}

/** R-G-07 `rev-parse --git-common-dir --git-dir --show-toplevel`. Three lines, in flag order. */
export function parseGlobalRevParse(
  stdout: string,
): { readonly commonDir: string; readonly gitDir: string; readonly toplevel: string } | null {
  const lines = revParseLines(stdout);
  if (lines.length !== 3) return null;
  return { commonDir: lines[0], gitDir: lines[1], toplevel: lines[2] };
}

const HEX40 = /^[0-9a-f]{40}$/;

/** A 40-hex object name, or null. Never a prefix, never an abbreviation. */
export function asSha(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const t = text.trim();
  return HEX40.test(t) ? t : null;
}

/** R-G-02 `ls-remote --heads origin main`: `<sha>\trefs/heads/main`. */
export function parseLsRemoteSha(stdout: string): string | null {
  const m = /^([0-9a-f]{40})\t/.exec(stdout);
  return m === null ? null : m[1];
}

/** A non-negative integer count, or null when the output is not exactly that. */
export function asCount(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * R-F-10 reflog lines, after RD8 has replaced the committer identity:
 * `<old-sha> <new-sha> <REDACTED:identity> <epoch> <tz>\t<message>`.
 *
 * Only the newest epoch matters: it is the sole evidence for how stale the local canonical
 * reference is. Returning null rather than a guess keeps B9's staleness rule fail-closed.
 */
export function newestReflogEpochSeconds(content: string): number | null {
  let newest: number | null = null;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') continue;
    const head = line.split('\t')[0];
    const m = /(\d{9,11})\s+[+-]\d{4}\s*$/.exec(head);
    if (m === null) continue;
    const epoch = Number(m[1]);
    if (!Number.isSafeInteger(epoch)) continue;
    if (newest === null || epoch > newest) newest = epoch;
  }
  return newest;
}
