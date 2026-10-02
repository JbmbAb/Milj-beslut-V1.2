/**
 * U30-R4 (owner 2026-10-03 (4) item 7) -- the ONLY way re-execution accepts an execution it cannot bind to
 * a governed canonical subject: a bootstrap execution (MPS_LU_BOOTSTRAP_ADMIT, admitted without an issued
 * execution identity) or a legacy site/V2-scoped one, as dev/test tooling and the package's own tests still
 * produce through the general engine (`runLuAssessmentViaKernel`).
 *
 * Allowed only when ALL of these hold in the verifying process:
 *  - MPS_LU_BOOTSTRAP_ADMIT is exactly "1" -- the same explicit dev/test capability flag the kernel reads.
 *    The product runtime never sets it, and the canonical product path refuses to run while it is set
 *    (LU_CANONICAL_BOOTSTRAP_ADMIT_FORBIDDEN);
 *  - NODE_ENV is exactly "test" or "development" -- an unset NODE_ENV (as the demo/product runtime runs)
 *    or "production" refuses;
 *  - APP_ENV is unset/empty or exactly "test", "ci" or "development" -- demo, stage, staging, preprod,
 *    prod, production or any other value refuses, whatever NODE_ENV says.
 * Anything else is the product configuration: such an execution is EXECUTION_SUBJECT_UNBOUND (fail closed).
 * Exact, case-sensitive matches only; nothing is normalized into an allowed value.
 *
 * Deliberately not exported from the package root (the API boundary snapshot is unchanged).
 */
const DEV_TEST_NODE_ENVS: ReadonlySet<string> = new Set(["test", "development"]);
const DEV_TEST_APP_ENVS: ReadonlySet<string> = new Set(["test", "ci", "development"]);

export function isBootstrapExecutionReplayAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.MPS_LU_BOOTSTRAP_ADMIT !== "1") return false;
  if (!DEV_TEST_NODE_ENVS.has(env.NODE_ENV ?? "")) return false;
  const appEnv = env.APP_ENV ?? "";
  return appEnv === "" || DEV_TEST_APP_ENVS.has(appEnv);
}
