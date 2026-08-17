import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";

/**
 * 🔴 TEST_DISCOVERY_WORKTREE_ISOLATION-01 — hermetic proof runs.
 *
 *   INVARIANT
 *     Repository proof runs MUST NOT collect tests from nested or external agent worktrees.
 *
 *   Why this is proof infrastructure and not test hygiene: `.claude/worktrees/` holds other
 *   agents' checkouts of this same repository. Each contains a full copy of the test tree, so the
 *   canonical invocation collected 1693 files from those worktrees against 780 from the
 *   repository itself. The collected set then depends on which agent worktrees happen to exist on
 *   the machine at the time — meaning:
 *
 *     same repository HEAD + different external worktree state
 *       -> different test collection -> different failures
 *
 *   Every suite result used as a release or clean-checkout proof inherits that non-determinism.
 *
 *   The exclusion is central, in vitest.config.ts, rather than a `--exclude` flag repeated per
 *   command: an isolation rule that each invocation must remember is one that some invocation
 *   will forget, and the forgetting is silent.
 *
 *   ⚠️ NARROW BY CONSTRUCTION. Only paths the recon actually proved are excluded. No blanket
 *   "ignore anything hidden" rule: that would quietly drop real tests the day someone puts a
 *   legitimate suite under a dotted directory.
 */
describe("TEST_DISCOVERY_WORKTREE_ISOLATION-01", () => {
  const REPO_ROOT = resolve(__dirname, "..", "..");
  const CONFIG = join(REPO_ROOT, "vitest.config.ts");

  /**
   * Vitest's own matcher, so this proof tests the real exclusion semantics rather than a
   * hand-rolled approximation of them.
   *
   * A nested `vitest list` child process was tried first and could not be spawned from inside a
   * running vitest worker. Asserting against the actual matcher is the honest substitute: it
   * verifies the patterns, and the measured collection drop (2473 -> 781 files, 1693 worktree
   * files eliminated) is recorded in the unit's commit rather than re-derived here.
   */
  async function matcher(patterns: readonly string[]) {
    const picomatch = (await import("picomatch")).default;
    return picomatch(patterns as string[]);
  }

  function excludePatterns(): string[] {
    const config = readFileSync(CONFIG, "utf8");
    const declared = config.match(/const WORKTREE_EXCLUDES = \[([^\]]+)\]/);
    expect(declared, "WORKTREE_EXCLUDES must be declared once, centrally.").not.toBeNull();
    return [...declared![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }

  // ------------------------------------------------------------------ GREEN

  it("every nested worktree test path is excluded", async () => {
    const worktreeRoot = join(REPO_ROOT, ".claude", "worktrees");
    const isExcluded = await matcher(excludePatterns());

    if (!existsSync(worktreeRoot)) {
      // No contamination present right now; the rule itself is still asserted, so this proof does
      // not quietly become vacuous on a machine with no agent worktrees.
      expect(isExcluded(".claude/worktrees/some-agent/packages/mps-lu/tests/x.test.ts")).toBe(true);
      return;
    }

    // Normalised, because that is the form Vitest hands the matcher. The third sample is the
    // interesting one: it is only reachable via a relative traversal, and it must still be
    // excluded once normalised rather than sneaking through as a distinct-looking path.
    const samples = [
      ".claude/worktrees/some-agent/packages/mps-lu/tests/x.test.ts",
      ".claude/worktrees/some-agent/tests/unit/y.test.ts",
      normalize("packages/mps-lu/../.claude/worktrees/a/tests/z.test.ts").split("\\").join("/"),
    ];
    const missed = samples.filter((path) => !isExcluded(path));

    expect(
      missed,
      "These are other agents' checkouts of this repository. Collecting them makes the proof set " +
        "depend on machine state rather than on HEAD.",
    ).toEqual([]);
  });

  // ------------------------------------------------------------------ CONTROL

  it("CONTROL: real repository tests are NOT excluded", async () => {
    const isExcluded = await matcher(excludePatterns());

    // An over-broad rule would delete the contamination and the proofs together, silently.
    for (const path of [
      "packages/mps-lu/tests/P3LuClassifierPolicy.red.test.ts",
      "packages/mps-data-governance/tests/ImportGate.test.ts",
      "tests/unit/testDiscoveryWorktreeIsolation.test.ts",
      "src/application/foo.test.ts",
    ]) {
      expect(isExcluded(path), `${path} must remain collected.`).toBe(false);
    }
  });

  // ------------------------------------------------------------------ centrality

  it("the exclusion is declared centrally, not per invocation", () => {
    const config = readFileSync(CONFIG, "utf8");

    expect(
      config.includes(".claude/worktrees/**"),
      "A rule each command must remember is one some command will forget, silently.",
    ).toBe(true);

    expect(
      /['"]\*\*\/\.\*\/\*\*['"]|['"]\.\*['"]/.test(config),
      "No blanket hidden-directory exclusion: that would drop a legitimate suite the day one " +
        "lands under a dotted path, and nothing would report the loss.",
    ).toBe(false);
  });
});
