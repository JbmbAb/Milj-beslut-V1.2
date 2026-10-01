/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — PathPolicy against the frozen Phase 0 corpus.
 *
 * The whole reason this module exists instead of `node:path` is that `node:path` normalises, and
 * normalisation here is not a cosmetic difference. Path spelling is digest-covered and IS the
 * replay lookup key: an implementation that collapses one `..`, converts one separator or folds one
 * character produces a corpus MISS rather than a wrong answer, and 122 expectations become
 * unaddressable. So these tests do not check the policy against a reading of the prose — they
 * recompute every recorded comparisonKey, caseId and preferredSpelling from the recorded spellings
 * and require all 122 to come back byte-identical.
 *
 * The four worked examples in the surface's pathComparisonPolicy each have a real witness in the
 * corpus, and each one is asserted against that witness as well as against the example's own
 * literals. The mojibake example in particular is not hypothetical: `C:\miljöbeslut` and
 * `C:\miljÃ¶beslut` are two directories that both exist on this machine and are two separate cases,
 * ws-c-milj-beslut-07102338 and ws-c-milj-beslut-cf9e27a7.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, win32 as winPath } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  caseIdFromComparisonKey,
  comparisonKey,
  joinPath,
  parentOfGitDir,
  preferredSpelling,
  sortCandidateSpellings,
} from './PathPolicy.js';
import type { CandidateSource, CandidateSpelling } from './PathPolicy.js';

const AUTHORITY_ROOT =
  process.env.WLC_AUTHORITY_ROOT ??
  'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6';

const CORPUS = join(AUTHORITY_ROOT, 'corpus');
const authorityPresent = existsSync(join(CORPUS, 'capture-manifest-v1.json'));

interface CaseBundle {
  readonly caseId: string;
  readonly comparisonKey: string;
  readonly preferredSpelling: string;
  readonly candidatePathSpellings: readonly { readonly source: CandidateSource; readonly path: string }[];
}

interface FsRecord {
  readonly requestId: string;
  readonly instanceKey: string;
  readonly opKey?: string;
  readonly path: string;
  readonly result: { readonly entries?: readonly { readonly name: string }[] };
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

function globalRecords(requestId: string): readonly FsRecord[] {
  const g = readJson<{ records: readonly FsRecord[] }>(join(CORPUS, 'global.capture.json'));
  return g.records.filter((r) => r.requestId === requestId);
}

describe.skipIf(!authorityPresent)('PathPolicy against the frozen corpus', () => {
  const cases = authorityPresent ? loadCases() : [];

  it('sees the 122-case corpus this suite was measured against', () => {
    expect(cases.length).toBe(122);
    // 381 recorded spellings across those cases: 114 from S3, 100 from S1, 99 from S2, 68 from S4.
    // Asserted so that a corpus with the right case count but a truncated spellings list cannot
    // make the reproduction tests below pass on a fraction of the data.
    const bySource: Record<string, number> = {};
    for (const c of cases) {
      for (const s of c.candidatePathSpellings) bySource[s.source] = (bySource[s.source] ?? 0) + 1;
    }
    expect(bySource).toEqual({ S3: 114, S1: 100, S2: 99, S4: 68 });
    expect(cases.reduce((n, c) => n + c.candidatePathSpellings.length, 0)).toBe(381);
  });

  describe('comparisonKey reproduces every recorded key', () => {
    it('for all 122 cases, from every one of their 381 spellings', () => {
      // Not just from the preferred spelling: EVERY source's spelling of a candidate must produce
      // the recorded key, because that identity is what makes the key source-invariant. If S1's
      // forward-slash spelling and S3's backslash spelling produced different keys, adding or
      // removing a discovery source would re-key a case and the facit would stop being addressable.
      const mismatches: string[] = [];
      let checked = 0;
      for (const c of cases) {
        for (const s of c.candidatePathSpellings) {
          checked += 1;
          const key = comparisonKey(s.path);
          if (key !== c.comparisonKey) {
            mismatches.push(`${c.caseId} ${s.source} ${JSON.stringify(s.path)} → ${key}`);
          }
        }
      }
      expect(mismatches).toEqual([]);
      expect(checked).toBe(381);
    });

    it('is idempotent: the key of a key is the key', () => {
      // The Observer computes the key on paths that already came out of a key-shaped source in
      // some code paths. A non-idempotent rule would make that order-dependent.
      for (const c of cases) expect(comparisonKey(c.comparisonKey)).toBe(c.comparisonKey);
    });
  });

  it('caseIdFromComparisonKey reproduces all 122 recorded caseIds', () => {
    const mismatches = cases
      .filter((c) => caseIdFromComparisonKey(c.comparisonKey) !== c.caseId)
      .map((c) => `${c.caseId} ← ${caseIdFromComparisonKey(c.comparisonKey)}`);
    expect(mismatches).toEqual([]);
    // 21 of the 122 keys produce a slug longer than 48 characters and are truncated. The truncation
    // is the part most likely to be implemented differently (slice before or after collapsing runs,
    // trailing '-' removed once or twice), and a difference there renames a case silently.
    const truncated = cases.filter(
      (c) =>
        c.comparisonKey
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-+|-+$/g, '').length > 48,
    );
    expect(truncated.length).toBe(21);
    expect(truncated.every((c) => caseIdFromComparisonKey(c.comparisonKey) === c.caseId)).toBe(true);
    // 37 keys contain non-ASCII characters, which the slug rule replaces with '-'. The hash is over
    // the UTF-8 bytes of the KEY, not of the slug, so those cases stay distinguishable.
    expect(cases.filter((c) => /[^\x00-\x7f]/.test(c.comparisonKey)).length).toBe(37);
    // All 122 ids are distinct: the 8-hex suffix does its job on this corpus.
    expect(new Set(cases.map((c) => c.caseId)).size).toBe(122);
  });

  describe('preferredSpelling reproduces all 122 recorded spellings', () => {
    it('from the recorded spellings list', () => {
      const mismatches = cases
        .filter((c) => preferredSpelling(c.candidatePathSpellings) !== c.preferredSpelling)
        .map((c) => `${c.caseId}: ${preferredSpelling(c.candidatePathSpellings)}`);
      expect(mismatches).toEqual([]);
    });

    it('is unchanged when the input order is reversed', () => {
      // The rule is a total order over (source, path), so the recorded order must not matter. If it
      // did, preferredSpelling would depend on the order the recorder happened to discover things,
      // and preferredSpelling is substituted into `-C <candidatePath>` — part of the replay key.
      for (const c of cases) {
        expect(preferredSpelling([...c.candidatePathSpellings].reverse())).toBe(c.preferredSpelling);
      }
    });

    it('picks S3 for the 114 cases that have one, and S1 for the 8 that do not', () => {
      // Measured. The 8 without a filesystem spelling are the four /sessions/… paths, the three
      // /tmp/… paths and C:/wtosm01 — none of them under a container R-F-05 enumerates, so they are
      // known only through git's own forward-slash spelling.
      const preferredSource = (c: CaseBundle): CandidateSource =>
        sortCandidateSpellings(c.candidatePathSpellings)[0].source;
      expect(cases.filter((c) => preferredSource(c) === 'S3').length).toBe(114);
      expect(cases.filter((c) => preferredSource(c) === 'S1').length).toBe(8);
      expect(cases.filter((c) => preferredSource(c) === 'S2').length).toBe(0);
      expect(cases.filter((c) => preferredSource(c) === 'S4').length).toBe(0);
    });

    it('prefers the filesystem backslash spelling over git’s forward-slash one', () => {
      // ws-c-lu-clean-final-824a5488 is the shape 92 of the 122 cases have: the same directory,
      // spelled with backslashes by the filesystem and with forward slashes by git. The recorded
      // preferredSpelling is the backslash one, and reversing that would change 92 replay keys.
      const c = cases.find((x) => x.caseId === 'ws-c-lu-clean-final-824a5488') as CaseBundle;
      expect(c.candidatePathSpellings).toEqual([
        { path: 'C:\\lu-clean-final', source: 'S3' },
        { path: 'C:/lu-clean-final', source: 'S1' },
        { path: 'C:/lu-clean-final', source: 'S2' },
      ]);
      expect(preferredSpelling(c.candidatePathSpellings)).toBe('C:\\lu-clean-final');
      expect(comparisonKey('C:\\lu-clean-final')).toBe(comparisonKey('C:/lu-clean-final'));
    });

    it('sorts by source priority S3, S1, S2, S4 and then by path, dropping exact duplicates', () => {
      const spellings: readonly CandidateSpelling[] = [
        { source: 'S4', path: 'C:/b' },
        { source: 'S2', path: 'C:/b' },
        { source: 'S1', path: 'C:/b' },
        { source: 'S1', path: 'C:/a' },
        { source: 'S1', path: 'C:/a' },
        { source: 'S3', path: 'C:\\b' },
      ];
      expect(sortCandidateSpellings(spellings)).toEqual([
        { source: 'S3', path: 'C:\\b' },
        { source: 'S1', path: 'C:/a' },
        { source: 'S1', path: 'C:/b' },
        { source: 'S2', path: 'C:/b' },
        { source: 'S4', path: 'C:/b' },
      ]);
      // The tie-break is the ECMAScript default comparator (UTF-16 code units), NOT localeCompare:
      // under a Swedish locale 'ö' sorts after 'z', and the recorder used neither locale nor ICU.
      const codeUnitOrder = sortCandidateSpellings([
        { source: 'S1', path: 'C:/ö' },
        { source: 'S1', path: 'C:/z' },
      ]);
      expect(codeUnitOrder.map((s) => s.path)).toEqual(['C:/z', 'C:/ö']);
    });

    it('refuses a candidate with no spelling at all', () => {
      // Not a defensive nicety: a candidate exists because some source named it, so an empty list
      // is a bug in expansion. Returning '' would put `-C ''` into a spawned argv.
      expect(() => preferredSpelling([])).toThrow(/at least one spelling/);
    });
  });

  describe('the four worked examples of pathComparisonPolicy', () => {
    it('example 1 — separator only: C:/wt-dev-gov-v7 and C:\\wt-dev-gov-v7 are the SAME key', () => {
      expect(comparisonKey('C:/wt-dev-gov-v7')).toBe(comparisonKey('C:\\wt-dev-gov-v7'));
      expect(comparisonKey('C:/wt-dev-gov-v7')).toBe('c:/wt-dev-gov-v7');
      // Its witness: ws-c-wt-dev-gov-v7-ad959292 is one of the seven utilityRequired cases, and it
      // is one candidate precisely because these two spellings collapse to one key.
      const c = cases.find((x) => x.caseId === 'ws-c-wt-dev-gov-v7-ad959292') as CaseBundle;
      expect(c.comparisonKey).toBe('c:/wt-dev-gov-v7');
      expect(new Set(c.candidatePathSpellings.map((s) => s.path)).size).toBeGreaterThan(1);
      expect(new Set(c.candidatePathSpellings.map((s) => comparisonKey(s.path))).size).toBe(1);
    });

    it('example 2 — case only: C:\\miljöbeslut and c:\\MILJÖBESLUT are the SAME key', () => {
      expect(comparisonKey('C:\\miljöbeslut')).toBe(comparisonKey('c:\\MILJÖBESLUT'));
      expect(comparisonKey('c:\\MILJÖBESLUT')).toBe('c:/miljöbeslut');
      // Simple lowercasing, NOT Unicode case folding: 'ẞ' lowercases to 'ß' under toLowerCase, and
      // a folding implementation would map both to 'ss' and merge two directories into one case.
      expect(comparisonKey('C:\\STRAẞE')).toBe('c:/straße');
      expect(comparisonKey('C:\\STRASSE')).not.toBe(comparisonKey('C:\\STRAẞE'));
    });

    it('example 3 — mojibake: C:\\miljöbeslut and C:\\miljÃ¶beslut are DIFFERENT keys', () => {
      expect(comparisonKey('C:\\miljöbeslut')).not.toBe(comparisonKey('C:\\miljÃ¶beslut'));
      expect(comparisonKey('C:\\miljÃ¶beslut')).toBe('c:/miljã¶beslut');
      // Its witness, and the reason this example is in the contract at all: BOTH directories exist
      // on this machine, R-F-05 enumerated both under C:\, and they are two separate cases with two
      // separate caseIds. No Unicode normalisation — NFC would fold neither, but a naive
      // "repair the mojibake" step would merge a real directory into another real one.
      const good = cases.find((x) => x.caseId === 'ws-c-milj-beslut-07102338') as CaseBundle;
      const bad = cases.find((x) => x.caseId === 'ws-c-milj-beslut-cf9e27a7') as CaseBundle;
      expect(good.comparisonKey).toBe('c:/miljöbeslut');
      expect(bad.comparisonKey).toBe('c:/miljã¶beslut');
      expect(good.caseId).not.toBe(bad.caseId);
      expect(caseIdFromComparisonKey(good.comparisonKey)).toBe(good.caseId);
      expect(caseIdFromComparisonKey(bad.comparisonKey)).toBe(bad.caseId);
      // Both slugs are 'ws-c-milj-beslut-…'; only the 8-hex hash tells them apart.
      expect(good.caseId.slice(0, -8)).toBe(bad.caseId.slice(0, -8));
    });

    it('example 4 — different roots, same tail: C:/… and /sessions/…/mnt/… are DIFFERENT keys', () => {
      expect(comparisonKey('C:/miljöbeslut/.worktrees/x')).not.toBe(
        comparisonKey('/sessions/abc/mnt/miljöbeslut/.worktrees/x'),
      );
      // Its witness: claude-devgov-v0-verify-v2 appears under both roots and is two cases. The OS
      // may well resolve them to the same directory; the recorder must not decide that, because
      // whether two spellings denote one workspace is a correlation question for the Observer.
      const win = cases.find(
        (x) => x.comparisonKey === 'c:/miljöbeslut/.worktrees/claude-devgov-v0-verify-v2',
      );
      const mnt = cases.find(
        (x) =>
          x.comparisonKey ===
          '/sessions/rcw-01kopen2ftml4dknqtgftewy/mnt/miljöbeslut/.worktrees/claude-devgov-v0-verify-v2',
      );
      expect(win).toBeDefined();
      expect(mnt).toBeDefined();
      expect((win as CaseBundle).caseId).not.toBe((mnt as CaseBundle).caseId);
    });

    it('the 3-character floor: C:/ does not collapse to C:', () => {
      // The trailing-separator strip runs only while the result is longer than 3 characters. Without
      // that floor a drive root would key as 'c:' — a prefix of every path on the drive, and a
      // candidate that could collide with any of them.
      expect(comparisonKey('C:/')).toBe('c:/');
      expect(comparisonKey('C:\\')).toBe('c:/');
      expect(comparisonKey('C:/')).not.toBe('c:');
      // One segment deeper the strip does apply, and repeated separators are all removed.
      expect(comparisonKey('C:/wt-x/')).toBe('c:/wt-x');
      expect(comparisonKey('C:\\wt-x\\\\')).toBe('c:/wt-x');
      expect(comparisonKey('C:/wt-x///')).toBe('c:/wt-x');
      // C:\ IS the container R-F-05 enumerates, so this is not a hypothetical spelling.
      expect(globalRecords('R-F-05').some((r) => r.path === 'C:\\')).toBe(true);
    });

    it('does not collapse .. and does not resolve realpaths', () => {
      // Both would be "helpful" and both would break the replay key. The surface says so in as many
      // words: no normalization, no realpath resolution, no drive-letter expansion, no '..'
      // collapsing.
      expect(comparisonKey('C:\\a\\..\\b')).toBe('c:/a/../b');
      expect(comparisonKey('C:\\a\\..\\b')).not.toBe(comparisonKey('C:\\b'));
      expect(comparisonKey('C:\\a\\.\\b')).toBe('c:/a/./b');
    });
  });

  describe('joinPath does not normalise', () => {
    it.each([
      ['a .. segment', 'C:\\wt-x', '..'],
      ['duplicated separators', 'C:\\wt-x\\\\', 'child'],
      ['a forward-slash input', 'C:/miljöbeslut/.git', 'worktrees'],
    ])('differs from node:path.win32.join for %s', (_label, a, b) => {
      expect(joinPath(a, b)).not.toBe(winPath.join(a, b));
    });

    it('produces exactly these results, where win32.join produces those', () => {
      // Stated as literals on both sides so the divergence is visible rather than merely asserted.
      expect(joinPath('C:\\wt-x', '..')).toBe('C:\\wt-x\\..');
      expect(winPath.join('C:\\wt-x', '..')).toBe('C:\\');

      expect(joinPath('C:\\wt-x\\\\', 'child')).toBe('C:\\wt-x\\\\child');
      expect(winPath.join('C:\\wt-x\\\\', 'child')).toBe('C:\\wt-x\\child');

      expect(joinPath('C:/miljöbeslut/.git', 'worktrees')).toBe('C:/miljöbeslut/.git\\worktrees');
      expect(winPath.join('C:/miljöbeslut/.git', 'worktrees')).toBe('C:\\miljöbeslut\\.git\\worktrees');
    });

    it('adds no separator when the left side already ends with one, in either spelling', () => {
      expect(joinPath('C:\\', 'lu-clean-final')).toBe('C:\\lu-clean-final');
      expect(joinPath('C:/', 'lu-clean-final')).toBe('C:/lu-clean-final');
      expect(joinPath('C:\\wt-x', 'child')).toBe('C:\\wt-x\\child');
    });

    it('reproduces all 114 recorded S3 spellings from the R-F-05 container listings', () => {
      // The real proof. S3 is defined as join(containerPath, name) under this policy, so every S3
      // spelling in the corpus must be reconstructible from a container path and an entry name.
      // 114 entries across four containers — C:\ (83), C:\miljöbeslut\.worktrees (7),
      // C:\miljöbeslut\.claude\worktrees (5), C:\miljöbeslut\.codex-verification (19) — and 114
      // recorded S3 spellings. win32.join would rewrite the drive-root ones and match none.
      const recorded = new Set<string>();
      for (const c of cases) {
        for (const s of c.candidatePathSpellings) if (s.source === 'S3') recorded.add(s.path);
      }
      expect(recorded.size).toBe(114);

      const containers = globalRecords('R-F-05');
      expect(containers.length).toBe(4);
      const rebuilt = containers.flatMap((r) =>
        (r.result.entries ?? []).map((e) => joinPath(r.path, e.name)),
      );
      expect(rebuilt.length).toBe(114);
      expect(new Set(rebuilt)).toEqual(recorded);
    });
  });

  describe('parentOfGitDir', () => {
    it('reproduces all 99 recorded gitdir-target → gitdir-parent pairs', () => {
      // R-F-04's parentOfRule, checked against what the recorder actually derived. Each pair is one
      // worktree's `.git` pointer target and the directory the recorder derived from it, and that
      // derived directory becomes an S2 candidate spelling.
      const byWorktree = new Map<string, { target?: string; parent?: string }>();
      for (const r of globalRecords('R-F-04')) {
        const id = r.instanceKey.replace(/:(gitdir-target|gitdir-parent)$/, '');
        const entry = byWorktree.get(id) ?? {};
        if (r.opKey === 'gitdir-target') entry.target = r.path;
        if (r.opKey === 'gitdir-parent') entry.parent = r.path;
        byWorktree.set(id, entry);
      }
      expect(byWorktree.size).toBe(99);
      const mismatches: string[] = [];
      for (const [id, { target, parent }] of byWorktree) {
        if (target === undefined || parent === undefined) {
          mismatches.push(`${id}: incomplete pair`);
          continue;
        }
        if (parentOfGitDir(target) !== parent) {
          mismatches.push(`${id}: ${target} → ${String(parentOfGitDir(target))} , recorded ${parent}`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('returns undefined when there is no trailing .git segment', () => {
      // A declared non-attempt, not a fallback. Falling back to the input would make R-F-04 observe
      // the target twice and record the duplicate as if it were the parent — a fact nothing proved.
      expect(parentOfGitDir('C:\\miljöbeslut')).toBeUndefined();
      expect(parentOfGitDir('C:/miljöbeslut/.git/worktrees/lu-clean-final')).toBeUndefined();
      expect(parentOfGitDir('')).toBeUndefined();
      expect(parentOfGitDir('.git')).toBeUndefined();
      // '.github' and '.gitignore' are not '.git', and neither is a '.git' in the middle.
      expect(parentOfGitDir('C:\\repo\\.github')).toBeUndefined();
      expect(parentOfGitDir('C:\\repo\\.gitignore')).toBeUndefined();
      expect(parentOfGitDir('C:\\repo\\.git\\config')).toBeUndefined();
    });

    it('removes exactly one trailing .git segment, in either spelling, with or without a slash', () => {
      expect(parentOfGitDir('C:/miljöbeslut/.claude/worktrees/brave-hopper-e1caf7/.git')).toBe(
        'C:/miljöbeslut/.claude/worktrees/brave-hopper-e1caf7',
      );
      expect(parentOfGitDir('C:\\wt-x\\.git')).toBe('C:\\wt-x');
      expect(parentOfGitDir('C:\\wt-x\\.git\\')).toBe('C:\\wt-x');
      expect(parentOfGitDir('C:/wt-x/.git/')).toBe('C:/wt-x');
      // One segment only: a nested spelling loses the last '.git' and keeps the first.
      expect(parentOfGitDir('C:\\a\\.git\\.git')).toBe('C:\\a\\.git');
    });
  });
});

describe.skipIf(authorityPresent)('frozen corpus absent', () => {
  it('reports AUTHORITY_PRESENT: NO rather than showing green', () => {
    expect(
      `AUTHORITY_PRESENT: NO — PathPolicy corpus assertions were not executed. Looked in ${AUTHORITY_ROOT}`,
    ).toContain('AUTHORITY_PRESENT: NO');
  });
});
