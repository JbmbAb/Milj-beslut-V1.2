/**
 * W-U42 -- what an EXPLICIT development or test process is, for the process start-up gates of the product runtime
 * (release identity, execution-attestation secret).
 *
 * The K0 model (owner decisions 2026-10-02/03: K0-FIX-1 mock gating, U30-R5 bootstrap flag): both variables, exact,
 * case-sensitive, nothing trimmed or normalized into an allowed value; an unset or empty APP_ENV is NOT explicit, and
 * NODE_ENV=development alone (the integrated runtime started from a worktree) is NOT an explicit development process.
 * "Explicit dev" in the owner's HMAC decision ("product runtime outside explicit dev must NOT be able to start with
 * the default secret") is read with the same model: NODE_ENV exactly 'development' AND APP_ENV exactly 'development'.
 *
 * The TEST rule is the same rule as mps-lu's `assertBootstrapAdmitFlagOnlyInExplicitTestProcess` (which deliberately
 * does not export its predicate); tests/unit/productReleaseBuildIdentity.test.ts pins that the two agree on a table of
 * environments, so drift between them is red.
 */

const EXPLICIT_TEST_APP_ENVS: ReadonlySet<string> = new Set(['test', 'ci']);

export const EXPLICIT_PROCESS_RULE_TEXT =
  "an explicit development process has NODE_ENV exactly 'development' AND APP_ENV exactly 'development'; " +
  "an explicit test process has NODE_ENV exactly 'test' AND APP_ENV exactly 'test' or 'ci'";

export function isExplicitTestProcess(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.NODE_ENV === 'test' && typeof env.APP_ENV === 'string' && EXPLICIT_TEST_APP_ENVS.has(env.APP_ENV);
}

export function isExplicitDevelopmentProcess(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.NODE_ENV === 'development' && env.APP_ENV === 'development';
}

export function isExplicitDevelopmentOrTestProcess(env: Readonly<Record<string, string | undefined>>): boolean {
  return isExplicitTestProcess(env) || isExplicitDevelopmentProcess(env);
}
