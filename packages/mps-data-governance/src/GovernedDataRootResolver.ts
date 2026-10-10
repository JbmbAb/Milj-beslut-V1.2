import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Runtime/config root (secrets, local keyrings, reviewer registries) is distinct from
 * governed data roots (Master / CAS / Quarantine). MIMERS_ROOT must never be treated as
 * an implicit Master or Quarantine substitute for DatasetApproval persistence.
 */
export interface GovernedDataRootResolution {
  readonly mimersRoot: string;
  readonly mimersRootPurpose: "runtime_config_secrets";
  readonly masterRoot: string | null;
  readonly casRoot: string | null;
  readonly quarantineRoot: string | null;
  readonly masterVisible: boolean;
  readonly casVisible: boolean;
  readonly quarantineVisible: boolean;
  readonly runtimeDataRootSeparation: "PASS" | "FAIL";
  readonly blocker: string | null;
}

export class GovernedDataRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernedDataRootError";
  }
}

function absoluteExistingDir(raw: string | undefined | null): { path: string | null; visible: boolean } {
  const trimmed = raw?.trim();
  if (!trimmed) return { path: null, visible: false };
  const path = resolve(trimmed);
  if (!existsSync(path)) return { path, visible: false };
  try {
    return { path, visible: statSync(path).isDirectory() };
  } catch {
    return { path, visible: false };
  }
}

/**
 * Read-only resolution of runtime vs governed data roots.
 * Does not create directories. Does not hardcode D:\Mimer into domain logic.
 */
export function resolveGovernedDataRoots(
  env: NodeJS.ProcessEnv = process.env,
): GovernedDataRootResolution {
  const mimersRaw = env.MIMERS_ROOT?.trim() || join(homedir(), ".mimers");
  const mimers = absoluteExistingDir(mimersRaw);
  const mimersRoot = mimers.path ?? resolve(mimersRaw);

  const masterEnv =
    env.MASTER_ARCHIVE_ROOT?.trim() ||
    env.MASTER_ROOT?.trim() ||
    env.GEO_MASTER_ARCHIVE?.trim() ||
    null;
  const casEnv = env.CAS_ROOT?.trim() || null;
  const quarantineEnv = env.QUARANTINE_ROOT?.trim() || null;

  const master = absoluteExistingDir(masterEnv);
  const cas = absoluteExistingDir(casEnv);
  const quarantine = absoluteExistingDir(quarantineEnv);

  // Separation: governed data roots must not silently collapse into MIMERS_ROOT.
  const collapsedIntoMimers =
    (master.path !== null && samePath(master.path, mimersRoot)) ||
    (quarantine.path !== null && samePath(quarantine.path, mimersRoot));
  const runtimeDataRootSeparation: "PASS" | "FAIL" = collapsedIntoMimers ? "FAIL" : "PASS";

  let blocker: string | null = null;
  if (!masterEnv || !casEnv || !quarantineEnv) {
    blocker =
      "BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION: set MASTER_ARCHIVE_ROOT (or MASTER_ROOT), " +
      "CAS_ROOT, and QUARANTINE_ROOT to the governed data layout. MIMERS_ROOT " +
      `(${mimersRoot}) is runtime/config/secrets only and is not a Master/CAS/Quarantine substitute.`;
  } else if (!master.visible || !cas.visible || !quarantine.visible) {
    blocker =
      "BLOCKED_BY_GOVERNED_DATA_ROOT_PROVISIONING: configured Master/CAS/Quarantine paths are " +
      "not visible directories. Creating them is a governed deployment step — do not fabricate " +
      "empty authority roots from this activation unit.";
  }

  return {
    mimersRoot,
    mimersRootPurpose: "runtime_config_secrets",
    masterRoot: master.path,
    casRoot: cas.path,
    quarantineRoot: quarantine.path,
    masterVisible: master.visible,
    casVisible: cas.visible,
    quarantineVisible: quarantine.visible,
    runtimeDataRootSeparation,
    blocker,
  };
}

/** Master archive root used by FileDatasetApprovalStore / FileCheckpointStore. */
export function requireMasterArchiveRootForDatasetApproval(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const resolved = resolveGovernedDataRoots(env);
  if (!resolved.masterRoot || !resolved.masterVisible) {
    throw new GovernedDataRootError(
      resolved.blocker ??
        "BLOCKED_BY_GOVERNED_DATA_ROOT_PROVISIONING: Master root unavailable for DatasetApproval persistence",
    );
  }
  return resolved.masterRoot;
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}
