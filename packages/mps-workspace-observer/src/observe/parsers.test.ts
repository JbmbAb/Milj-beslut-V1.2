/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — parsers against the frozen Phase 0 corpus.
 *
 * These tests read the RECORDED BYTES, not fixtures somebody typed. The distinction is the whole
 * point: the parsers are the only thing standing between git's output and a count that a blocker
 * rests on, and a hand-written fixture proves the parser agrees with its author's memory of git's
 * format rather than with git. Every count asserted below was measured from the mirror at
 * e2eb8fbd… and is stated as a literal, so a parser change that shifts a count fails here loudly
 * instead of quietly re-scoring the corpus.
 *
 * Synthetic cases appear only for shapes the corpus does not contain — `bare` and `prunable`
 * worktrees, a `locked` with no reason, unmerged `u` entries, ignored `!` entries. Each one says so
 * and states the corpus count it stands in for (0), because a synthetic case that pretends to be
 * evidence is worse than no case.
 *
 * Where the authority mirror is absent the suite skips and says so, so an acceptance report can
 * state AUTHORITY_PRESENT: NO rather than silently show green.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  asCount,
  asSha,
  newestReflogEpochSeconds,
  parseGlobalRevParse,
  parseLocalHeads,
  parseLsRemoteSha,
  parseStashReflog,
  parseStatusPorcelainV2,
  parseWorkspaceRevParse,
  parseWorktreeList,
} from './parsers.js';

const AUTHORITY_ROOT =
  process.env.WLC_AUTHORITY_ROOT ??
  'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6';

const CORPUS = join(AUTHORITY_ROOT, 'corpus');
const authorityPresent = existsSync(join(CORPUS, 'capture-manifest-v1.json'));

interface ProcessRecord {
  readonly requestId: string;
  readonly kind: string;
  readonly exitCode: number | null;
  readonly stdout: { readonly data: string };
  readonly stderr: { readonly data: string };
}

interface FsRecord {
  readonly requestId: string;
  readonly kind: string;
  readonly redactions: readonly { readonly rule: string; readonly count: number }[];
  readonly result: { readonly content?: { readonly data: string } };
}

interface CaseBundle {
  readonly caseId: string;
  readonly records: readonly (ProcessRecord & FsRecord)[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function loadCases(): readonly CaseBundle[] {
  const dir = join(CORPUS, 'cases');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.capture.json'))
    .map((f) => readJson<CaseBundle>(join(dir, f)));
}

function globalRecord(requestId: string): ProcessRecord & FsRecord {
  const g = readJson<CaseBundle>(join(CORPUS, 'global.capture.json'));
  const rec = g.records.find((r) => r.requestId === requestId);
  if (rec === undefined) throw new Error(`global capture has no ${requestId} record`);
  return rec;
}

function caseRecord(bundle: CaseBundle, requestId: string): ProcessRecord & FsRecord {
  const rec = bundle.records.find((r) => r.requestId === requestId && r.kind === 'PROCESS');
  if (rec === undefined) throw new Error(`${bundle.caseId} has no ${requestId} record`);
  return rec;
}

/** Recount straight off the recorded bytes, so the parser is checked against the corpus, not itself. */
function recount(stdout: string, prefix: string): number {
  return stdout.split('\n').filter((l) => l.startsWith(prefix)).length;
}

describe.skipIf(!authorityPresent)('parsers against the frozen corpus', () => {
  const cases = authorityPresent ? loadCases() : [];
  const byId = new Map(cases.map((c) => [c.caseId, c]));

  function bundle(caseId: string): CaseBundle {
    const b = byId.get(caseId);
    if (b === undefined) throw new Error(`corpus has no case ${caseId}`);
    return b;
  }

  it('sees the 122-case corpus this suite was measured against', () => {
    // Every literal count below was measured on exactly this corpus. If the mirror is a different
    // one, the numbers are meaningless and must fail here rather than be reinterpreted.
    expect(cases.length).toBe(122);
  });

  describe('parseStatusPorcelainV2 with the branch headers ABSENT (R-W-04)', () => {
    /**
     * The single most dangerous case in the parser.
     *
     * Measured on the frozen corpus: of 122 cases, 61 have no `# branch.upstream` line and the same
     * 61 have no `# branch.ab` line. 18 of those 61 are cases where git answered exit 128 with
     * empty stdout (the candidate path is absent or is not a repository — A3 gives every candidate
     * every workspace-local family, existing or not). The other 43 are workspaces that git answered
     * fully, at exit 0, and simply have no configured upstream.
     *
     * 3 of the 7 utilityRequired cases are in that second group:
     * ws-c-wt-dev-gov-v6-bootstrap-probe-113b58d8, ws-c-wt-dev-gov-v7-ad959292 and
     * ws-c-wt-dev-gov-v8-d1da2f04. A parser that read a missing header as "could not observe" would
     * drive all three to UNKNOWN, and from UNKNOWN they fall closed to BLOCKED — failing the
     * UTILITY criterion outright on cases that are provably clean. Absent header means NO UPSTREAM
     * CONFIGURED, which is an observation, not a gap.
     */
    it.each([
      ['ws-c-wt-dev-gov-v6-bootstrap-probe-113b58d8', '128909dd931fcc2869749ac2f855fdf4297de82c'],
      ['ws-c-wt-dev-gov-v7-ad959292', '453af92986c29294abc88a82cadf401792261a9d'],
      ['ws-c-wt-dev-gov-v8-d1da2f04', '7e2f151c16d7bc3c9f54b19c6451530826c4ebbd'],
    ])('%s: no upstream header, yet exact counts survive', (caseId, expectedOid) => {
      const rec = caseRecord(bundle(caseId), 'R-W-04');
      expect(rec.exitCode).toBe(0);
      expect(rec.stdout.data).not.toContain('# branch.upstream');
      expect(rec.stdout.data).not.toContain('# branch.ab');

      const p = parseStatusPorcelainV2(rec.stdout.data);
      // The observation that matters: the branch identity was read, the counts are exact, and the
      // absent upstream is reported as absent rather than as a failure to observe.
      expect(p.branchOid).toBe(expectedOid);
      expect(p.branchHead).not.toBeNull();
      expect(p.branchUpstream).toBeNull();
      expect(p.ahead).toBeNull();
      expect(p.behind).toBeNull();
      expect(p.trackedModificationCount).toBe(0);
      expect(p.untrackedEntryCount).toBe(0);
      expect(p.unmergedCount).toBe(0);
      expect(p.totalLines).toBe(2);
    });

    it('counts exactly across all 122 cases, header present or not', () => {
      let lackingUpstream = 0;
      let lackingAb = 0;
      let answered = 0;
      let refused = 0;
      for (const c of cases) {
        const rec = caseRecord(c, 'R-W-04');
        const out = rec.stdout.data;
        const p = parseStatusPorcelainV2(out);
        // Recounted from the bytes rather than restated from the parser.
        expect(p.trackedModificationCount).toBe(
          recount(out, '1 ') + recount(out, '2 ') + recount(out, 'u '),
        );
        expect(p.unmergedCount).toBe(recount(out, 'u '));
        expect(p.untrackedEntryCount).toBe(recount(out, '? '));
        expect(p.ignoredCount).toBe(recount(out, '! '));
        expect(p.totalLines).toBe(out.split('\n').filter((l) => l !== '').length);
        if (p.branchUpstream === null) lackingUpstream += 1;
        if (p.ahead === null) lackingAb += 1;
        if (rec.exitCode === 0) answered += 1;
        else refused += 1;
      }
      expect(lackingUpstream).toBe(61);
      expect(lackingAb).toBe(61);
      expect(answered).toBe(104);
      expect(refused).toBe(18);
    });

    it('an exit-128 case parses to zero counts and no branch identity, not to a crash', () => {
      // 18 of the 122. git printed nothing on stdout; the parser must say "nothing", and the
      // ledger's exit-code interpretation — not the parser — decides that this is UNKNOWN.
      const rec = caseRecord(bundle('ws-c-milj-beslut-cf9e27a7'), 'R-W-04');
      expect(rec.exitCode).toBe(128);
      expect(rec.stdout.data).toBe('');
      const p = parseStatusPorcelainV2(rec.stdout.data);
      expect(p).toEqual({
        branchOid: null,
        branchHead: null,
        branchUpstream: null,
        ahead: null,
        behind: null,
        trackedModificationCount: 0,
        unmergedCount: 0,
        untrackedEntryCount: 0,
        ignoredCount: 0,
        totalLines: 0,
      });
    });
  });

  describe("parseStatusPorcelainV2 '1' '2' 'u' '?' line counting", () => {
    it('ws-c-lu-clean-final-824a5488: detached head, 2 untracked, no headers', () => {
      const out = caseRecord(bundle('ws-c-lu-clean-final-824a5488'), 'R-W-04').stdout.data;
      expect(out).toBe(
        '# branch.oid e5299c08057e9094a862e6abb343dddb8dcb2209\n' +
          '# branch.head (detached)\n' +
          '? <UNTRACKED_1>/\n' +
          '? <UNTRACKED_2>/\n',
      );
      const p = parseStatusPorcelainV2(out);
      expect(p.branchHead).toBe('(detached)');
      expect(p.branchUpstream).toBeNull();
      expect(p.untrackedEntryCount).toBe(2);
      expect(p.trackedModificationCount).toBe(0);
      expect(p.totalLines).toBe(4);
    });

    it('ws-c-milj-beslut-07102338: 34 tracked and 50 untracked, with an ab header', () => {
      // The repository root itself. RD1 replaced each untracked path with a numbered placeholder,
      // which is exactly why counting is safe on redacted bytes: the policy never drops a line.
      const out = caseRecord(bundle('ws-c-milj-beslut-07102338'), 'R-W-04').stdout.data;
      const p = parseStatusPorcelainV2(out);
      expect(p.branchHead).toBe('feat/p2-p3-governed-chain-reproducible');
      expect(p.branchUpstream).toBe('origin/feat/p2-p3-governed-chain-reproducible');
      expect(p.ahead).toBe(21);
      expect(p.behind).toBe(40);
      expect(p.trackedModificationCount).toBe(34);
      expect(p.unmergedCount).toBe(0);
      expect(p.untrackedEntryCount).toBe(50);
      expect(p.totalLines).toBe(88);
      expect(recount(out, '1 ')).toBe(34);
      expect(recount(out, '2 ')).toBe(0);
    });

    it('ws-c-wt-i2-db-provisioning-closure-rebased-0b469517: the 151-file cluster with no headers', () => {
      // The case that combines both hazards: a large modification cluster AND absent branch
      // headers. Counted wrong in either direction it changes a blocker.
      const out = caseRecord(
        bundle('ws-c-wt-i2-db-provisioning-closure-rebased-0b469517'),
        'R-W-04',
      ).stdout.data;
      const p = parseStatusPorcelainV2(out);
      expect(p.trackedModificationCount).toBe(151);
      expect(p.untrackedEntryCount).toBe(2);
      expect(p.branchHead).toBe('codex/i2-db-provisioning-closure-rebased');
      expect(p.branchUpstream).toBeNull();
      expect(p.totalLines).toBe(155);
      expect(recount(out, '1 ')).toBe(151);
    });

    it('ws-c-wt-document-evidence-v2-bridge-b9e9a8d0: the same 151 cluster WITH headers', () => {
      // The control for the case above: same count, four header lines instead of two, so a
      // header-counting bug cannot hide inside the modification count.
      const p = parseStatusPorcelainV2(
        caseRecord(bundle('ws-c-wt-document-evidence-v2-bridge-b9e9a8d0'), 'R-W-04').stdout.data,
      );
      expect(p.trackedModificationCount).toBe(151);
      expect(p.untrackedEntryCount).toBe(0);
      expect(p.ahead).toBe(0);
      expect(p.behind).toBe(0);
      expect(p.totalLines).toBe(155);
    });

    it('counts unmerged and ignored entries the corpus does not contain', () => {
      // Measured: 0 'u' lines and 0 '!' lines across all 122 cases, because the surface does not
      // pass --ignored and no workspace was mid-merge at capture time. Synthetic, and labelled so.
      expect(cases.every((c) => recount(caseRecord(c, 'R-W-04').stdout.data, 'u ') === 0)).toBe(true);
      expect(cases.every((c) => recount(caseRecord(c, 'R-W-04').stdout.data, '! ') === 0)).toBe(true);

      const p = parseStatusPorcelainV2(
        [
          '# branch.oid 0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85',
          '# branch.head main',
          '1 .M N... 100644 100644 100644 aaa bbb one.ts',
          '2 R. N... 100644 100644 100644 ccc ddd R100 new.ts\told.ts',
          'u UU N... 100644 100644 100644 100644 eee fff ggg conflict.ts',
          '? untracked.ts',
          '! ignored.ts',
          '',
        ].join('\n'),
      );
      // An unmerged entry is BOTH an uncommitted tracked change and an unmerged one: it counts in
      // both fields on purpose, because a blocker about uncommitted work must not miss a conflict.
      expect(p.trackedModificationCount).toBe(3);
      expect(p.unmergedCount).toBe(1);
      expect(p.untrackedEntryCount).toBe(1);
      expect(p.ignoredCount).toBe(1);
      expect(p.totalLines).toBe(7);
    });

    it('ignores a malformed ab header rather than inventing a number', () => {
      // `# branch.ab` without the +N -N shape leaves ahead/behind null. Guessing here would turn a
      // parse failure into a divergence claim, and A19 requires a named command to have proved it.
      const p = parseStatusPorcelainV2('# branch.oid abc\n# branch.ab weird\n');
      expect(p.ahead).toBeNull();
      expect(p.behind).toBeNull();
    });

    it('tolerates CRLF, because the parser strips a trailing CR before matching', () => {
      const p = parseStatusPorcelainV2('# branch.head main\r\n1 .M x\r\n? y\r\n');
      expect(p.branchHead).toBe('main');
      expect(p.trackedModificationCount).toBe(1);
      expect(p.untrackedEntryCount).toBe(1);
    });
  });

  describe('parseWorktreeList on the real R-G-03 stdout', () => {
    const stdout = authorityPresent ? globalRecord('R-G-03').stdout.data : '';
    const blocks = authorityPresent ? parseWorktreeList(stdout) : [];

    it('reads exactly the 100 blocks the corpus contains', () => {
      // Measured: 100 `worktree ` lines and 100 blank-line-separated blocks in 13726 bytes.
      expect(recount(stdout, 'worktree ')).toBe(100);
      expect(blocks.length).toBe(100);
      // The stdout ends with a blank line; a flush bug would show up as 99 or 101.
      expect(stdout.endsWith('\n\n')).toBe(true);
    });

    it('keeps git’s own forward-slash spelling verbatim', () => {
      // pathConstructionPolicy: a path derived from git output keeps git's slashes. Normalising
      // here would change the replay lookup key and turn every case into a corpus miss.
      expect(blocks[0].path).toBe('C:/miljöbeslut');
      expect(blocks[0].head).toBe('9650d07397a813da4a5b3556ae7c777ddbfe7d11');
      expect(blocks[0].branch).toBe('refs/heads/feat/p2-p3-governed-chain-reproducible');
      expect(blocks[0].detached).toBe(false);
    });

    it('reads 32 detached, 68 branch-bound and 7 locked blocks', () => {
      expect(blocks.filter((b) => b.detached).length).toBe(32);
      expect(blocks.filter((b) => b.branch !== null).length).toBe(68);
      expect(blocks.filter((b) => b.locked).length).toBe(7);
      // Every locked block in this corpus carries a reason, and it is the same one.
      expect(blocks.filter((b) => b.locked && b.lockedReason !== null).length).toBe(7);
      expect([...new Set(blocks.filter((b) => b.locked).map((b) => b.lockedReason))]).toEqual([
        'initializing',
      ]);
      // A detached block has no branch and vice versa — the two fields never both carry a value.
      expect(blocks.filter((b) => b.detached && b.branch !== null).length).toBe(0);
    });

    it('records 0 prunable and 0 bare blocks, and says so rather than assuming', () => {
      // Stated as a measurement, not an omission: the corpus has neither shape, which is why the
      // two synthetic cases below exist at all.
      expect(blocks.filter((b) => b.prunable).length).toBe(0);
      expect(blocks.filter((b) => b.bare).length).toBe(0);
      expect(stdout).not.toContain('\nprunable');
      expect(stdout).not.toContain('\nbare');
    });

    it('parses the last block, so nothing depends on a trailing separator', () => {
      const last = blocks[blocks.length - 1];
      expect(last.path).toBe('C:/wtosm01');
      expect(last.head).toBe('8c0cb08ed8177925abda523c663e36fd75c2fa81');
      expect(last.detached).toBe(true);
      expect(last.branch).toBeNull();
    });

    it('parses bare, prunable with and without a reason, and locked without a reason', () => {
      // SYNTHETIC. The frozen corpus contains none of these four shapes (0 bare, 0 prunable, and
      // all 7 locked blocks carry a reason), so these bytes are hand-built to git's porcelain
      // format. They cover the keyword-with-no-value branch, which the corpus never exercises.
      const parsed = parseWorktreeList(
        [
          'worktree C:/repo',
          'bare',
          '',
          'worktree C:/wt-gone',
          'HEAD 1111111111111111111111111111111111111111',
          'detached',
          'prunable gitdir file points to non-existent location',
          '',
          'worktree C:/wt-gone-2',
          'HEAD 2222222222222222222222222222222222222222',
          'branch refs/heads/x',
          'prunable',
          '',
          'worktree C:/wt-held',
          'HEAD 3333333333333333333333333333333333333333',
          'detached',
          'locked',
          '',
          'worktree C:/wt-future',
          'HEAD 4444444444444444444444444444444444444444',
          'detached',
          'somethingGitAddedLater value',
          '',
        ].join('\n'),
      );
      expect(parsed.length).toBe(5);
      expect(parsed[0]).toEqual({
        path: 'C:/repo',
        head: null,
        branch: null,
        detached: false,
        locked: false,
        lockedReason: null,
        prunable: false,
        prunableReason: null,
        bare: true,
      });
      expect(parsed[1].prunable).toBe(true);
      expect(parsed[1].prunableReason).toBe('gitdir file points to non-existent location');
      expect(parsed[2].prunable).toBe(true);
      expect(parsed[2].prunableReason).toBeNull();
      expect(parsed[3].locked).toBe(true);
      expect(parsed[3].lockedReason).toBeNull();
      // An attribute git adds later is not an error and is not invented a meaning for: the block
      // still parses, and the unknown keyword simply is not a fact this surface claims.
      expect(parsed[4].detached).toBe(true);
      expect(parsed[4].bare).toBe(false);
    });
  });

  describe('parseStashReflog on the real R-G-04 stdout', () => {
    const stdout = authorityPresent ? globalRecord('R-G-04').stdout.data : '';
    const entries = authorityPresent ? parseStashReflog(stdout) : [];

    it('reads all 7 recorded stash entries', () => {
      expect(entries.length).toBe(7);
      expect(entries.map((e) => e.selector)).toEqual([
        'stash@{0}',
        'stash@{1}',
        'stash@{2}',
        'stash@{3}',
        'stash@{4}',
        'stash@{5}',
        'stash@{6}',
      ]);
    });

    it('extracts the first parent of every entry', () => {
      // shaSetRule (d): the first space-separated token of the second tab field. A stash commit has
      // two or three parents — the corpus has three of each shape — and only the FIRST is the
      // commit the work was stashed from. Taking the wrong one puts a foreign SHA into the shaSet,
      // and every one of families R-G-11..R-G-18 is then instantiated against it.
      expect(entries.map((e) => e.parents.length)).toEqual([3, 3, 3, 2, 2, 2, 2]);
      expect(entries.map((e) => e.parents[0])).toEqual([
        'bfd2f7b0dae8e6bbffce3e47bdecacdc38e27c4d',
        'e1b216ed6cc35d97599247c4fe3167723ebb7f93',
        'cf2129fb0a53fc60b15fb5d8ec4bcf4ab32e2b95',
        '025802e51dfb4bbbc449abf9fca1e9bd870fc23e',
        '025802e51dfb4bbbc449abf9fca1e9bd870fc23e',
        '88e01635cab2601cfd3d7171478a85e601194848',
        '3ef5af41363e94770a9bf96565f3c5456d5e256e',
      ]);
      expect(entries.every((e) => asSha(e.parents[0]) !== null)).toBe(true);
    });

    it('keeps a subject containing parentheses and an em dash intact', () => {
      // stash@{2}'s subject carries an em dash and nested parentheses. A parser that split on
      // anything but the tab would truncate it, and the subject is what an operator reads before
      // deciding whether a stash may be dropped.
      expect(entries[2].stashCommit).toBe('e9c895ddc8812b5ab5ba8bb6398b270a0a939500');
      expect(entries[2].subject).toContain('PARKED: evolution-mutation-boundary');
      expect(entries[2].subject).toContain('TS2307');
      expect(entries[2].subject).not.toContain('\t');
    });

    it('skips a line with fewer than four tab fields rather than shifting the columns', () => {
      // SYNTHETIC: the corpus has no short line. Skipping is right and guessing is not — a
      // three-field line read as four would silently move a subject into the selector column.
      const parsed = parseStashReflog(
        'aaa\tbbb ccc\tstash@{0}\tsubject\ntruncated\tline\nddd\teee\tstash@{1}\tother\n',
      );
      expect(parsed.map((e) => e.selector)).toEqual(['stash@{0}', 'stash@{1}']);
    });

    it('reads an empty parent field as no parents, not as one empty parent', () => {
      const parsed = parseStashReflog('aaa\t\tstash@{0}\troot\n');
      expect(parsed[0].parents).toEqual([]);
    });
  });

  describe('newestReflogEpochSeconds on the real R-F-10 content after RD8 redaction', () => {
    const rec = authorityPresent ? globalRecord('R-F-10') : undefined;
    const content = rec?.result.content?.data ?? '';

    it('reads the file the corpus actually recorded, redacted by RD8', () => {
      // RD8 replaced the committer identity on all 16 lines. The epoch and the timezone offset
      // survive the redaction on purpose: staleness of the local canonical reference is the only
      // thing this file is read for, and the identity is not a material fact of this surface.
      expect(rec?.redactions).toEqual([{ rule: 'RD8_REFLOG_IDENTITY', count: 16 }]);
      const lines = content.split('\n').filter((l) => l !== '');
      expect(lines.length).toBe(16);
      expect(lines.every((l) => l.includes('<REDACTED:identity>'))).toBe(true);
      expect(content).not.toMatch(/<\S+@\S+>/);
    });

    it('finds the newest epoch', () => {
      expect(newestReflogEpochSeconds(content)).toBe(1788849027);
    });

    it('parses a line whose identity was redacted, including the first one', () => {
      const first = content.split('\n')[0];
      expect(first).toContain('<REDACTED:identity>');
      expect(newestReflogEpochSeconds(first)).toBe(1786624962);
    });

    it('takes the maximum, not the last line', () => {
      // The corpus file happens to be in ascending order, so "last line" and "newest" agree there
      // and a last-line implementation would pass on the corpus alone. Git does not guarantee it:
      // a reflog rewritten by `filter-branch` or an amended push can leave a later line older.
      const lines = content.split('\n').filter((l) => l !== '');
      const shuffled = [lines[15], lines[0], lines[8], lines[3]].join('\n');
      expect(newestReflogEpochSeconds(shuffled)).toBe(1788849027);
      const withoutNewest = [lines[0], lines[8], lines[3]].join('\n');
      expect(newestReflogEpochSeconds(withoutNewest)).toBe(1788471057);
    });

    it('returns null rather than a guess when no line carries an epoch', () => {
      // B9's staleness rule falls closed on null. A zero or a Date.now() here would silently
      // declare the canonical reference either infinitely stale or perfectly fresh.
      expect(newestReflogEpochSeconds('')).toBeNull();
      expect(newestReflogEpochSeconds('not a reflog line at all\n')).toBeNull();
      expect(newestReflogEpochSeconds('aaa bbb <REDACTED:identity> notanepoch +0200\tmsg\n')).toBeNull();
    });

    it('reads only the pre-tab head, so an epoch inside a commit message cannot win', () => {
      // SYNTHETIC. The message field is attacker-controlled in the sense that matters here: it is
      // arbitrary text a developer typed. It must not be able to move the staleness clock.
      const line =
        '5178c673263d7fa6aa11bc40aa3ff410f7e13377 b2f7ea9b8fe6fd43fb7829b39eafebca747d32e0 ' +
        '<REDACTED:identity> 1786624962 +0200\tsee 1999999999 +0000';
      expect(newestReflogEpochSeconds(line)).toBe(1786624962);
    });

    it('accepts a negative timezone offset', () => {
      expect(
        newestReflogEpochSeconds('aaa bbb <REDACTED:identity> 1788849027 -0500\tupdate by push\n'),
      ).toBe(1788849027);
    });
  });

  describe('rev-parse line ordering', () => {
    it('parseGlobalRevParse reads R-G-07 in flag order', () => {
      // R-G-07 is `rev-parse --git-common-dir --git-dir --show-toplevel`. In the real corpus the
      // first two are both '.git', so the recorded bytes alone cannot prove the ordering — the
      // synthetic case below does that. Both are asserted, so neither stands alone.
      const p = parseGlobalRevParse(globalRecord('R-G-07').stdout.data);
      expect(p).toEqual({ commonDir: '.git', gitDir: '.git', toplevel: 'C:/miljöbeslut' });

      const distinguishable = parseGlobalRevParse('COMMON\nGITDIR\nTOP\n');
      expect(distinguishable).toEqual({ commonDir: 'COMMON', gitDir: 'GITDIR', toplevel: 'TOP' });
    });

    it('parseWorkspaceRevParse reads R-W-03 in flag order, with all four values distinct', () => {
      // R-W-03 is `rev-parse --git-dir --git-common-dir --show-toplevel --is-inside-work-tree`.
      // This case is a linked worktree, so gitDir and commonDir differ and the ordering is proved
      // by the recorded bytes themselves. Swapping the two would make every linked worktree look
      // like the main checkout.
      const p = parseWorkspaceRevParse(
        caseRecord(bundle('ws-c-lu-clean-final-824a5488'), 'R-W-03').stdout.data,
      );
      expect(p).toEqual({
        gitDir: 'C:/miljöbeslut/.git/worktrees/lu-clean-final',
        gitCommonDir: 'C:/miljöbeslut/.git',
        toplevel: 'C:/lu-clean-final',
        isInsideWorkTree: true,
      });
    });

    it('returns null on empty output', () => {
      expect(parseGlobalRevParse('')).toBeNull();
      expect(parseWorkspaceRevParse('')).toBeNull();
      expect(parseGlobalRevParse('one\n')).toBeNull();
      expect(parseWorkspaceRevParse('one\ntwo\n')).toBeNull();
    });

    it('refuses a short output whose trailing newline would otherwise fake the missing value', () => {
      // This was a real defect, found by this test and since fixed. `'only\ntwo\n'.split('\n')` is
      // ['only','two',''] — three elements for two values — so a guard written as `length < 3`
      // passed, and `toplevel` was filled with the empty string the trailing newline produced.
      // The observation then looked conclusive while every path derived from it was wrong.
      //
      // It could not bite on the frozen corpus, where every recorded R-G-07 and R-W-03 stdout is
      // either complete or empty. It would bite on a truncated stream, and the family's maxBytes
      // makes truncation reachable. Both parsers now check the count for EQUALITY after stripping
      // the trailing newline: too few values and too many are both refused.
      expect(parseGlobalRevParse('only\ntwo\n')).toBeNull();
      expect(parseGlobalRevParse('only\ntwo')).toBeNull();
      expect(parseWorkspaceRevParse('a\nb\nc\n')).toBeNull();
      expect(parseWorkspaceRevParse('a\nb\nc')).toBeNull();

      // An extra value is refused too: output this parser does not understand is not a partial
      // success to be read optimistically.
      expect(parseGlobalRevParse('a\nb\nc\nd\n')).toBeNull();
      expect(parseWorkspaceRevParse('a\nb\nc\ntrue\nextra\n')).toBeNull();

      // The complete shapes still parse, with and without the trailing newline.
      expect(parseGlobalRevParse('a\nb\nc\n')).toEqual({ commonDir: 'a', gitDir: 'b', toplevel: 'c' });
      expect(parseGlobalRevParse('a\nb\nc')).toEqual({ commonDir: 'a', gitDir: 'b', toplevel: 'c' });
    });

    it('reads an unrecognised is-inside-work-tree answer as null, not as false', () => {
      // false means "inside a .git directory"; null means "git did not answer that question".
      // Collapsing them would let a parse failure masquerade as a positive observation (A19).
      expect(parseWorkspaceRevParse('a\nb\nc\ntrue\n')?.isInsideWorkTree).toBe(true);
      expect(parseWorkspaceRevParse('a\nb\nc\nfalse\n')?.isInsideWorkTree).toBe(false);
      expect(parseWorkspaceRevParse('a\nb\nc\n\n')?.isInsideWorkTree).toBeNull();
    });
  });

  describe('the remaining scalar readers, on real bytes', () => {
    it('parseLocalHeads reads all 146 R-G-05 rows with five fields each', () => {
      const stdout = globalRecord('R-G-05').stdout.data;
      const heads = parseLocalHeads(stdout);
      expect(heads.length).toBe(146);
      // 68 branches are checked out somewhere — the same 68 that R-G-03 reports as branch-bound.
      expect(heads.filter((h) => h.worktreePath !== '').length).toBe(68);
      expect(heads.filter((h) => h.upstream !== '').length).toBe(107);
      expect(heads[0]).toEqual({
        refname: 'refs/heads/chatgpt/devgov-orchestration-multi-proof',
        objectname: '12ab3acdecdc1fccb2d9b80c8f85e9a7798c16a8',
        upstream: 'refs/remotes/origin/chatgpt/devgov-orchestration-multi-proof',
        upstreamTrack: '',
        worktreePath: 'C:/wt-devgov-multiproof-repair',
      });
      expect(heads[1].upstreamTrack).toBe('[ahead 1]');
      expect(heads[1].worktreePath).toBe('');
    });

    it('parseLsRemoteSha reads the R-G-02 head', () => {
      expect(parseLsRemoteSha(globalRecord('R-G-02').stdout.data)).toBe(
        '0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85',
      );
      // The canonical base of this unit, and it must match R-G-01's local rev-parse.
      expect(asSha(globalRecord('R-G-01').stdout.data)).toBe(
        '0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85',
      );
      expect(parseLsRemoteSha('')).toBeNull();
      expect(parseLsRemoteSha('0d7b2bd5\trefs/heads/main\n')).toBeNull();
    });

    it('asSha refuses an abbreviation, uppercase hex and surrounding junk', () => {
      // A 40-hex string or nothing. An abbreviated SHA in the shaSet would key eight request
      // families to something git can resolve today and might not resolve tomorrow.
      expect(asSha('  0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85\n')).toBe(
        '0d7b2bd566b0d5f7c9d27d645c941acd66cb1e85',
      );
      expect(asSha('0D7B2BD566B0D5F7C9D27D645C941ACD66CB1E85')).toBeNull();
      expect(asSha('0d7b2bd')).toBeNull();
      expect(asSha(null)).toBeNull();
      expect(asSha(undefined)).toBeNull();
    });

    it('asCount refuses anything that is not exactly a non-negative integer', () => {
      expect(asCount(' 151 \n')).toBe(151);
      expect(asCount('0')).toBe(0);
      expect(asCount('-1')).toBeNull();
      expect(asCount('1.0')).toBeNull();
      expect(asCount('')).toBeNull();
      expect(asCount('12 34')).toBeNull();
      expect(asCount(null)).toBeNull();
    });
  });
});

describe.skipIf(authorityPresent)('frozen corpus absent', () => {
  it('reports AUTHORITY_PRESENT: NO rather than showing green', () => {
    // An acceptance report must be able to say the corpus was not read. A silently-skipped suite
    // that prints nothing is indistinguishable from one that ran.
    expect(
      `AUTHORITY_PRESENT: NO — parser corpus assertions were not executed. Looked in ${AUTHORITY_ROOT}`,
    ).toContain('AUTHORITY_PRESENT: NO');
  });
});
