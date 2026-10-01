/**
 * Regression tests for the CodeQL js/polynomial-redos alerts of PR #205.
 *
 * 1. Differential: every linear helper agrees with the regular expression it replaced on ALL strings
 *    up to a small length over an alphabet that contains every character the expression treats
 *    specially. The old expressions live here only as oracles.
 * 2. Pathological input: the inputs that reproduced the problem (100 000 characters took 4 to 7
 *    seconds; 200 000 would take about 30) now finish inside a one-second budget, through the public
 *    functions that contained the flagged expressions.
 */
import { describe, expect, it } from 'vitest';
import { classifyInstallProbeOutput } from '../src/docker/classify';
import { parseDockerignore } from '../src/docker/executors';
import { scriptCommandsOf } from '../src/docker/lifecycle-scripts';
import { isProjectInstallCommand, isProjectInstallShellText } from '../src/docker/stage-prefix';
import {
  isCombinedShortGlobalFlag,
  npmErrorCommandOf,
  splitShellCommands,
  stripLeadingDotSlash,
  trimTrailingSlashes,
} from '../src/internal/linear-text';
import {
  DOCKER_PRODUCTION_BASE_RED_OUTPUT,
  DOCKER_WORKDIR,
  PRODUCTION_BASE_INSTALL_COMMAND,
  PROBED_LIFECYCLE_PATHS,
  PROBED_PACKAGE_IDENTITY,
  PROBED_POSTINSTALL_SCRIPT,
} from './fixtures/probe-signatures';

function* allStrings(alphabet: readonly string[], maxLength: number): Generator<string> {
  yield '';
  let frontier = [''];
  for (let length = 1; length <= maxLength; length += 1) {
    const next: string[] = [];
    for (const prefix of frontier) {
      for (const ch of alphabet) {
        const candidate = prefix + ch;
        next.push(candidate);
        yield candidate;
      }
    }
    frontier = next;
  }
}

const PATHOLOGICAL_LENGTH = 200_000;
const BUDGET_MS = 1_000;

function elapsedMs(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

/** The first string (up to `maxLength` over `alphabet`) for which `agrees` is false, or undefined. */
function firstDisagreement(
  alphabet: readonly string[],
  maxLength: number,
  agrees: (s: string) => boolean,
): string | undefined {
  for (const s of allStrings(alphabet, maxLength)) {
    if (!agrees(s)) return s;
  }
  return undefined;
}

describe('linear helpers agree with the expressions they replace (exhaustive on a small alphabet)', () => {
  it('trimTrailingSlashes === replace(/\\/+$/)', () => {
    expect(
      firstDisagreement(['/', '.', 'a', ' '], 8, (s) => trimTrailingSlashes(s) === s.replace(/\/+$/, '')),
    ).toBeUndefined();
  });

  it('stripLeadingDotSlash === replace(/^(\\.\\/|\\/)+/)', () => {
    expect(
      firstDisagreement(
        ['.', '/', 'a', '\\'],
        8,
        (s) => stripLeadingDotSlash(s) === s.replace(/^(\.\/|\/)+/, ''),
      ),
    ).toBeUndefined();
  });

  it('splitShellCommands === split(/\\s*(?:&&|\\|\\||\\||;)\\s*/) with every piece trimmed', () => {
    const agrees = (s: string): boolean => {
      const expected = s.split(/\s*(?:&&|\|\||\||;)\s*/).map((piece) => piece.trim());
      const actual = splitShellCommands(s);
      return actual.length === expected.length && actual.every((piece, i) => piece === expected[i]);
    };
    expect(firstDisagreement([' ', '&', '|', ';', 'a'], 7, agrees)).toBeUndefined();
    // the consumers tokenize after trimming, so the trimmed outer ends change nothing for them
    expect(scriptCommandsOf(' node a.mjs && node b.mjs ; ')).toEqual([
      ['node', 'a.mjs'],
      ['node', 'b.mjs'],
    ]);
  });

  it('isCombinedShortGlobalFlag === /^-[A-Za-z]*g[A-Za-z]*$/', () => {
    expect(
      firstDisagreement(
        ['-', 'g', 'G', 'f', '1', '='],
        7,
        (s) => isCombinedShortGlobalFlag(s) === /^-[A-Za-z]*g[A-Za-z]*$/.test(s),
      ),
    ).toBeUndefined();
  });

  it('npmErrorCommandOf matches /npm error command sh -c (.+?)\\s*$/ for every non-blank command', () => {
    const prefix = 'npm error command sh -c ';
    const scripts = ['a', 'a b', 'b', 'a  b', 'ab'];
    const agrees = (line: string, rest: string, before: string): boolean => {
      const old = /npm error command sh -c (.+?)\s*$/.exec(line)?.[1];
      const next = npmErrorCommandOf(line);
      // the consumer compares the capture with non-blank script strings
      const sameForConsumer =
        (old === undefined ? false : scripts.includes(old)) ===
        (next === undefined ? false : scripts.includes(next));
      const sameText = rest.trim().length === 0 || before === prefix || next === old;
      return sameForConsumer && sameText;
    };
    for (const before of ['', 'x ', prefix]) {
      const bad = firstDisagreement([' ', 'a', 'b'], 7, (rest) =>
        agrees(`${before}${prefix}${rest}`, rest, before),
      );
      expect(bad, JSON.stringify({ before, bad })).toBeUndefined();
    }
    expect(npmErrorCommandOf('no marker here')).toBeUndefined();
    expect(npmErrorCommandOf(prefix)).toBeUndefined();
    expect(npmErrorCommandOf(`${prefix}node scripts/x.mjs   `)).toBe('node scripts/x.mjs');
  });
});

describe('the pathological inputs finish inside the budget (they took seconds before)', () => {
  it('trimTrailingSlashes on "a" + many slashes + "x"', () => {
    const input = `a${'/'.repeat(PATHOLOGICAL_LENGTH)}x`;
    expect(elapsedMs(() => expect(trimTrailingSlashes(input)).toBe(input))).toBeLessThan(BUDGET_MS);
    expect(trimTrailingSlashes(`a${'/'.repeat(PATHOLOGICAL_LENGTH)}`)).toBe('a');
  }, 30_000);

  it('parseDockerignore on lines made of slashes (leading, inner and trailing runs)', () => {
    const text = [
      `a${'/'.repeat(PATHOLOGICAL_LENGTH / 2)}x`,
      `${'/'.repeat(PATHOLOGICAL_LENGTH / 2)}y`,
      `z${'/'.repeat(PATHOLOGICAL_LENGTH / 2)}`,
    ].join('\n');
    let patterns: string[] = [];
    expect(
      elapsedMs(() => {
        patterns = parseDockerignore(text).map((rule) => rule.pattern);
      }),
    ).toBeLessThan(BUDGET_MS);
    expect(patterns[0]).toBe(`a${'/'.repeat(PATHOLOGICAL_LENGTH / 2)}x`);
    expect(patterns[1]).toBe('y');
    expect(patterns[2]).toBe('z');
  }, 30_000);

  it('scriptCommandsOf and isProjectInstallShellText on a run of spaces', () => {
    const spaces = ' '.repeat(PATHOLOGICAL_LENGTH);
    expect(elapsedMs(() => expect(scriptCommandsOf(`${spaces}x`)).toEqual([['x']]))).toBeLessThan(BUDGET_MS);
    expect(
      elapsedMs(() => expect(isProjectInstallShellText(`${spaces}npm ci --omit=dev`)).toBe(true)),
    ).toBeLessThan(BUDGET_MS);
    expect(
      elapsedMs(() => expect(isProjectInstallShellText(`npm ci ${spaces} && ${spaces} echo`)).toBe(true)),
    ).toBeLessThan(BUDGET_MS);
  }, 30_000);

  it('isProjectInstallCommand on a huge combined flag group', () => {
    const global = `npm install -${'g'.repeat(PATHOLOGICAL_LENGTH)}`;
    const notGlobal = `npm install -${'g'.repeat(PATHOLOGICAL_LENGTH)}1`;
    expect(elapsedMs(() => expect(isProjectInstallCommand(global)).toBe(false))).toBeLessThan(BUDGET_MS);
    expect(elapsedMs(() => expect(isProjectInstallCommand(notGlobal)).toBe(true))).toBeLessThan(BUDGET_MS);
  }, 30_000);

  it('classifyInstallProbeOutput with a huge whitespace-heavy `npm error command` line in the failure output', () => {
    const lines = DOCKER_PRODUCTION_BASE_RED_OUTPUT.split('\n');
    const banner = lines.findIndex((line) => line.includes('postinstall') && line.includes('> '));
    expect(banner).toBeGreaterThan(-1);
    const hostile = `#12 42.59 npm error command sh -c x${' '.repeat(PATHOLOGICAL_LENGTH)}y`;
    const output = [...lines.slice(0, banner + 1), hostile, ...lines.slice(banner + 1)].join('\n');
    let classification = '';
    let reasonCode = '';
    expect(
      elapsedMs(() => {
        const result = classifyInstallProbeOutput({
          output,
          exitStatus: 1,
          timedOut: false,
          installStepStarted: true,
          lifecyclePaths: [...PROBED_LIFECYCLE_PATHS],
          lifecycleScriptStrings: [PROBED_POSTINSTALL_SCRIPT],
          workdir: DOCKER_WORKDIR,
          installCommand: PRODUCTION_BASE_INSTALL_COMMAND,
          packageIdentity: PROBED_PACKAGE_IDENTITY,
        });
        classification = result.classification;
        reasonCode = result.reasonCode;
      }),
    ).toBeLessThan(BUDGET_MS);
    // the hostile line changes nothing about the verdict: RED is still confirmed from the real lines
    expect(classification).toBe('FAIL');
    expect(reasonCode).toBe('LIFECYCLE_SCRIPT_MODULE_NOT_FOUND');
  }, 30_000);
});
