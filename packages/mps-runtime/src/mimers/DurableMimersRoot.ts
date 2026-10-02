/**
 * U30-A / PRES-19 -- the ONE durable Mimers CAS root, as a named shared contract.
 *
 * Every process that persists or reads governed artifacts (web, LU workers, ceremony and proof
 * scripts, governance routes) resolves its CAS root through this function. There is deliberately
 * no fallback directory: a missing `MIMERS_ROOT` used to resolve silently to
 * `path.resolve(".data/mimers")` -- a different, cwd-relative CAS per process -- so artifacts
 * written by one process were invisible to another and "persisted" assessments could not be
 * reopened. Now a missing root is a configuration error with a stated cause.
 *
 * The in-memory CAS is a separate, explicit test-only mode (`isMimersTestEnvironment`), never a
 * fallback for a missing root.
 */
import path from "node:path";

export const MIMERS_ROOT_REQUIRED = "MIMERS_ROOT_REQUIRED" as const;

export class MimersRootRequiredError extends Error {
  readonly code = MIMERS_ROOT_REQUIRED;

  constructor(
    readonly consumer: string,
    detail?: string,
  ) {
    super(
      `${MIMERS_ROOT_REQUIRED}: ${detail ?? `MIMERS_ROOT is not set for ${consumer}`} ` +
        "(fail-closed: there is no fallback directory; set MIMERS_ROOT to the one durable Mimers root " +
        "shared by the web process, the LU workers and the ceremony scripts)",
    );
    this.name = "MimersRootRequiredError";
  }
}

/**
 * Resolve the durable Mimers root from `MIMERS_ROOT` (trimmed, made absolute).
 * Throws `MimersRootRequiredError` when it is unset or blank. Never touches the filesystem.
 */
export function resolveDurableMimersRoot(
  env: NodeJS.ProcessEnv = process.env,
  consumer = "Mimers CAS",
): string {
  const raw = env.MIMERS_ROOT?.trim();
  if (!raw) {
    throw new MimersRootRequiredError(consumer);
  }
  return path.resolve(raw);
}

/**
 * The only environments in which the in-memory CAS may be used: an explicit test runner
 * (`NODE_ENV=test` or `VITEST`). `LU_MPS_CAS=memory` alone is not a test environment.
 */
export function isMimersTestEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "test" || Boolean(env.VITEST);
}
