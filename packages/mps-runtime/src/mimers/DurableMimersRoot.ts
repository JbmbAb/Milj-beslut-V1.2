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
 *
 * ADV-1 rest / U30 verification F7: the root must be an ABSOLUTE path to an EXISTING directory. A
 * relative MIMERS_ROOT re-introduced the cwd dependency through configuration, and a misspelled root
 * was silently initialized as a new, EMPTY CAS (FileCASRepository.initialize creates it), in which
 * every stored artifact read as "Artifact not found". The durable root is created explicitly by the
 * operator or deployment, never implicitly by a process that happens to start.
 */
import { statSync } from "node:fs";
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
 * M1a-F1 (3): on Windows `path.isAbsolute` also accepts a ROOTED path without a volume ("\cas",
 * "/cas"), which resolves against the drive of the process's working directory -- the same root
 * string then names different directories for processes started from different drives. A durable root
 * must name its volume: a drive letter ("D:\..." or "D:/...") or a UNC share ("\\server\share\...").
 */
function namesItsVolume(raw: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return true;
  return /^[A-Za-z]:[\\/]/.test(raw) || /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(raw);
}

/**
 * Resolve the durable Mimers root from `MIMERS_ROOT` (trimmed, normalized).
 * Throws `MimersRootRequiredError` when it is unset or blank, not an absolute path, (on Windows) names
 * no drive letter or UNC share, does not exist, or is not a directory. Only stats the path; never
 * creates anything.
 *
 * Not decided here: whether an existing directory is the RIGHT root (e.g. its parent, or another
 * install's root). Nothing in the root identifies it today; see M1A-F1-REPORT.md for the proposed
 * root identity marker (owner decision).
 */
export function resolveDurableMimersRoot(
  env: NodeJS.ProcessEnv = process.env,
  consumer = "Mimers CAS",
  platform: NodeJS.Platform = process.platform,
): string {
  const raw = env.MIMERS_ROOT?.trim();
  if (!raw) {
    throw new MimersRootRequiredError(consumer);
  }
  if (!path.isAbsolute(raw)) {
    throw new MimersRootRequiredError(
      consumer,
      `MIMERS_ROOT '${raw}' for ${consumer} is not an absolute path (a relative root would resolve against the process's working directory)`,
    );
  }
  if (!namesItsVolume(raw, platform)) {
    throw new MimersRootRequiredError(
      consumer,
      `MIMERS_ROOT '${raw}' for ${consumer} names no drive letter or UNC share (on Windows such a root resolves against the drive of the process's working directory)`,
    );
  }
  const root = path.resolve(raw);
  let isDirectory: boolean;
  try {
    isDirectory = statSync(root).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    throw new MimersRootRequiredError(
      consumer,
      code === "ENOENT"
        ? `MIMERS_ROOT '${raw}' for ${consumer} does not exist (a misspelled root must not become a new, empty CAS; create the durable root explicitly)`
        : `MIMERS_ROOT '${raw}' for ${consumer} cannot be inspected (${code ?? "unknown error"})`,
    );
  }
  if (!isDirectory) {
    throw new MimersRootRequiredError(consumer, `MIMERS_ROOT '${raw}' for ${consumer} is not a directory`);
  }
  return root;
}

/**
 * The only environments in which the in-memory CAS may be used: an explicit test runner
 * (`NODE_ENV=test` or `VITEST`). `LU_MPS_CAS=memory` alone is not a test environment.
 */
export function isMimersTestEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "test" || Boolean(env.VITEST);
}
