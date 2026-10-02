/**
 * U30-R4 (owner 2026-10-03 (4) item 7) -- the ONLY way re-execution accepts an execution it cannot bind to
 * a governed canonical subject: a bootstrap execution (MPS_LU_BOOTSTRAP_ADMIT, admitted without an issued
 * execution identity) or a legacy site/V2-scoped one, as dev/test tooling and the package's own tests still
 * produce through the general engine (`runLuAssessmentViaKernel`).
 *
 * U30-R5 (owner principle, the K0 model -- NullDocumentProvider's mock gate; U30R4-VERIFICATION V2/point 3):
 * only an EXPLICIT test process may accept such an execution:
 *  - MPS_LU_BOOTSTRAP_ADMIT is exactly "1" -- the same explicit capability flag the general engine reads;
 *  - NODE_ENV is exactly "test";
 *  - APP_ENV is explicitly set to exactly "test" or "ci".
 * An unset or empty APP_ENV is NOT a test process, and neither is "development" (for NODE_ENV or APP_ENV):
 * the integrated runtime started from the worktree runs NODE_ENV=development with APP_ENV unset, so under the
 * U30-R4 rules only the flag separated a refusal from a PASS there. Exact, case-sensitive matches only;
 * nothing is trimmed or normalized into an allowed value.
 *
 * The flag gate (U30-R5 task 2): MPS_LU_BOOTSTRAP_ADMIT PRESENT in the environment -- any value, also "" or
 * "0" -- in a process that is not an explicit test process is a configuration error. The callers (re-execution
 * and the canonical product gate) then refuse to run at all with LuBootstrapAdmitFlagOutsideTestError, before any
 * CAS read: never a verdict about an assessment, never excusable by anything.
 *
 * Deliberately not exported from the package root (the API boundary snapshot is unchanged).
 */

/** The ONLY APP_ENV values of an explicit test process -- an allowlist, matched exactly. */
const EXPLICIT_TEST_APP_ENVS: ReadonlySet<string> = new Set(["test", "ci"]);

/**
 * Why the process is not an explicit test process (fixed texts naming the conditions, never an environment
 * value), or null when it is one.
 */
function explicitTestProcessRefusal(env: Readonly<Record<string, string | undefined>>): string | null {
  if (env.NODE_ENV !== "test") return "NODE_ENV is not exactly 'test'";
  const appEnv = env.APP_ENV;
  if (typeof appEnv !== "string" || appEnv === "") return "APP_ENV is not set";
  if (!EXPLICIT_TEST_APP_ENVS.has(appEnv)) return "APP_ENV is not exactly 'test' or 'ci'";
  return null;
}

/** NODE_ENV exactly "test" AND APP_ENV exactly "test" or "ci" -- the K0 model, nothing else. */
export function isExplicitLuTestProcess(env: Readonly<Record<string, string | undefined>>): boolean {
  return explicitTestProcessRefusal(env) === null;
}

/** Re-execution may accept an execution without a governed subject only in an explicit test process with the flag "1". */
export function isBootstrapExecutionReplayAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.MPS_LU_BOOTSTRAP_ADMIT === "1" && isExplicitLuTestProcess(env);
}

/** Which gate refused: re-execution (verify) or the canonical product assessment (assessment creation). */
export type LuBootstrapAdmitFlagGate = "reexecution" | "canonical_product_assessment";

/**
 * U30-R5 -- MPS_LU_BOOTSTRAP_ADMIT is set in a process that is not an explicit test process. A typed
 * configuration error of the PROCESS, not a statement about any assessment: it is never mapped to PASS or
 * DENY and nothing excuses it. The message carries the stable code and fixed condition texts only.
 */
export class LuBootstrapAdmitFlagOutsideTestError extends Error {
  readonly code = "BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST" as const;
  readonly gate: LuBootstrapAdmitFlagGate;

  constructor(gate: LuBootstrapAdmitFlagGate, unmetCondition: string) {
    super(
      `BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST: MPS_LU_BOOTSTRAP_ADMIT is set, but this process is not an explicit test ` +
        `process (${unmetCondition}; required: NODE_ENV exactly 'test' and APP_ENV exactly 'test' or 'ci'). ` +
        `The ${gate === "reexecution" ? "re-execution (verify)" : "canonical product assessment"} refuses to run; ` +
        `remove the flag from this process.`,
    );
    this.name = "LuBootstrapAdmitFlagOutsideTestError";
    this.gate = gate;
  }
}

/**
 * The flag gate: throws LuBootstrapAdmitFlagOutsideTestError when MPS_LU_BOOTSTRAP_ADMIT is present (any value)
 * and the process is not an explicit test process. Synchronous and read once by the caller, before its first
 * await.
 */
export function assertBootstrapAdmitFlagOnlyInExplicitTestProcess(
  env: Readonly<Record<string, string | undefined>>,
  gate: LuBootstrapAdmitFlagGate,
): void {
  if (env.MPS_LU_BOOTSTRAP_ADMIT === undefined) return;
  const refusal = explicitTestProcessRefusal(env);
  if (refusal !== null) throw new LuBootstrapAdmitFlagOutsideTestError(gate, refusal);
}
