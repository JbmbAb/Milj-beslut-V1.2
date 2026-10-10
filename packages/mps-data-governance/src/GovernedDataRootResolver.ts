import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

/**
 * Governed data-root contract (greenfield):
 *
 * - MIMERS_ROOT: runtime/config/secrets only (never Master / CAS / Quarantine).
 * - MASTER_ARCHIVE_ROOT / GEO_MASTER_ARCHIVE: legacy GEO archive only (may be H:).
 * - MASTER_ARCHIVE_HOST_PATH: non-authoritative Docker/runtime mirror only.
 * - GOVERNED_MASTER_ROOT: new governed Master authority (DatasetApproval staging).
 * - CAS_ROOT: canonical production CAS physical root.
 * - QUARANTINE_ROOT: raw acquisition quarantine only (DiskQuarantineStorage).
 *
 * DatasetApproval governance staging lives under:
 *   <GOVERNED_MASTER_ROOT>/National_Archive/_quarantine/{approvals,checkpoints}
 * That subtree is intentional and distinct from QUARANTINE_ROOT.
 *
 * Does not create directories. Does not hardcode production deployment paths.
 */
export interface GovernedDataRootResolution {
  readonly mimersRoot: string;
  readonly mimersRootPurpose: "runtime_config_secrets";
  /** @deprecated Use governedMasterRoot — retained for report compatibility. */
  readonly masterRoot: string | null;
  readonly governedMasterRoot: string | null;
  readonly casRoot: string | null;
  /** Raw acquisition quarantine (DiskQuarantineStorage). Not DatasetApproval staging. */
  readonly rawQuarantineRoot: string | null;
  /** @deprecated Use rawQuarantineRoot. */
  readonly quarantineRoot: string | null;
  /**
   * Deterministic staging path under governed Master. Not created by resolution.
   * Distinct from rawQuarantineRoot.
   */
  readonly datasetApprovalStagingRoot: string | null;
  readonly masterVisible: boolean;
  readonly governedMasterVisible: boolean;
  readonly casVisible: boolean;
  readonly quarantineVisible: boolean;
  readonly rawQuarantineVisible: boolean;
  readonly runtimeDataRootSeparation: "PASS" | "FAIL";
  readonly quarantineModel: "TWO_INTENTIONAL_LAYERS";
  readonly blocker: string | null;
}

export class GovernedDataRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernedDataRootError";
  }
}

function absolutePath(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return resolve(trimmed);
}

function absoluteExistingDir(raw: string | undefined | null): { path: string | null; visible: boolean } {
  const path = absolutePath(raw);
  if (!path) return { path: null, visible: false };
  if (!existsSync(path)) return { path, visible: false };
  try {
    return { path, visible: statSync(path).isDirectory() };
  } catch {
    return { path, visible: false };
  }
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

function isNestedUnder(child: string, parent: string): boolean {
  const c = resolve(child).toLowerCase();
  const p = resolve(parent).toLowerCase();
  if (c === p) return true;
  const prefix = p.endsWith("\\") || p.endsWith("/") ? p : `${p}\\`;
  const alt = p.endsWith("\\") || p.endsWith("/") ? p : `${p}/`;
  return c.startsWith(prefix) || c.startsWith(alt);
}

function isRuntimeMirrorRoot(candidate: string): boolean {
  const notePath = join(candidate, "RUNTIME_MIRROR_NOTE.json");
  if (!existsSync(notePath)) return false;
  try {
    const raw = readFileSync(notePath, "utf8");
    const note = JSON.parse(raw) as Record<string, unknown>;
    const noteText = String(note.note ?? "");
    const policy = String(note.policy ?? "");
    const hasCanonical = typeof note.canonical === "string" && note.canonical.length > 0;
    const hasRuntime = typeof note.runtime === "string" && note.runtime.length > 0;
    const declaresMirror =
      /runtime mirror|non-authoritative|Docker bind-mount|not visible inside Docker/i.test(noteText) ||
      /Mimers Brunn/i.test(policy);
    return hasCanonical && hasRuntime && declaresMirror;
  } catch {
    return false;
  }
}

function datasetApprovalStagingUnder(governedMasterRoot: string): string {
  return join(governedMasterRoot, "National_Archive", "_quarantine");
}

/**
 * Read-only resolution of runtime config vs governed data roots.
 * Does not create directories. Does not invent production paths.
 */
export function resolveGovernedDataRoots(
  env: NodeJS.ProcessEnv = process.env,
): GovernedDataRootResolution {
  const mimersRaw = env.MIMERS_ROOT?.trim() || join(homedir(), ".mimers");
  const mimers = absoluteExistingDir(mimersRaw);
  const mimersRoot = mimers.path ?? resolve(mimersRaw);

  const governedMasterEnv = env.GOVERNED_MASTER_ROOT?.trim() || null;
  const casEnv = env.CAS_ROOT?.trim() || null;
  const rawQuarantineEnv = env.QUARANTINE_ROOT?.trim() || null;

  const legacyGeo =
    absolutePath(env.MASTER_ARCHIVE_ROOT) ||
    absolutePath(env.MASTER_ROOT) ||
    absolutePath(env.GEO_MASTER_ARCHIVE);
  const runtimeMirrorHost = absolutePath(env.MASTER_ARCHIVE_HOST_PATH);

  const governed = absoluteExistingDir(governedMasterEnv);
  const cas = absoluteExistingDir(casEnv);
  const rawQuarantine = absoluteExistingDir(rawQuarantineEnv);

  const datasetApprovalStagingRoot =
    governed.path !== null ? datasetApprovalStagingUnder(governed.path) : null;

  let blocker: string | null = null;
  let runtimeDataRootSeparation: "PASS" | "FAIL" = "PASS";

  const reject = (message: string): void => {
    runtimeDataRootSeparation = "FAIL";
    if (!blocker) blocker = message;
  };

  if (!governedMasterEnv || !casEnv || !rawQuarantineEnv) {
    reject(
      "BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION: set GOVERNED_MASTER_ROOT, CAS_ROOT, and " +
        "QUARANTINE_ROOT to the greenfield governed data layout. " +
        "MASTER_ARCHIVE_ROOT / GEO_MASTER_ARCHIVE are legacy GEO archive only. " +
        `MIMERS_ROOT (${mimersRoot}) is runtime/config/secrets only and is not a ` +
        "Master/CAS/Quarantine substitute.",
    );
  } else {
    if (governed.path && legacyGeo && samePath(governed.path, legacyGeo)) {
      reject(
        "BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION: GOVERNED_MASTER_ROOT must not collapse onto " +
          "legacy MASTER_ARCHIVE_ROOT / GEO_MASTER_ARCHIVE.",
      );
    }
    if (governed.path && runtimeMirrorHost && samePath(governed.path, runtimeMirrorHost)) {
      reject(
        "BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION: GOVERNED_MASTER_ROOT must not collapse onto " +
          "MASTER_ARCHIVE_HOST_PATH (Docker/runtime mirror).",
      );
    }
    if (governed.path && isRuntimeMirrorRoot(governed.path)) {
      reject(
        "REJECT_GOVERNED_MASTER_RUNTIME_MIRROR: GOVERNED_MASTER_ROOT points at a directory " +
          "with RUNTIME_MIRROR_NOTE.json declaring a non-authoritative runtime mirror.",
      );
    }

    const secretsDir = join(mimersRoot, "secrets");
    const pairs: Array<readonly [string, string | null]> = [
      ["GOVERNED_MASTER_ROOT", governed.path],
      ["CAS_ROOT", cas.path],
      ["QUARANTINE_ROOT", rawQuarantine.path],
    ];
    for (const [label, pathValue] of pairs) {
      if (!pathValue) continue;
      if (samePath(pathValue, mimersRoot)) {
        reject(
          `BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION: ${label} must not equal MIMERS_ROOT ` +
            "(runtime/config/secrets only).",
        );
      }
      if (isNestedUnder(pathValue, secretsDir)) {
        reject(
          `BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION: ${label} must not nest under MIMERS_ROOT/secrets.`,
        );
      }
    }

    if (governed.path && cas.path && samePath(governed.path, cas.path)) {
      reject("BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION: GOVERNED_MASTER_ROOT must not equal CAS_ROOT.");
    }
    if (governed.path && rawQuarantine.path && samePath(governed.path, rawQuarantine.path)) {
      reject(
        "BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION: GOVERNED_MASTER_ROOT must not equal QUARANTINE_ROOT " +
          "(raw acquisition quarantine is a separate layer from DatasetApproval staging).",
      );
    }
    if (cas.path && rawQuarantine.path && samePath(cas.path, rawQuarantine.path)) {
      reject("BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION: CAS_ROOT must not equal QUARANTINE_ROOT.");
    }

    if (!blocker && (!governed.visible || !cas.visible || !rawQuarantine.visible)) {
      blocker =
        "BLOCKED_BY_GOVERNED_DATA_ROOT_PROVISIONING: configured GOVERNED_MASTER_ROOT / CAS_ROOT / " +
        "QUARANTINE_ROOT paths are not visible directories. Creating them is a governed deployment " +
        "step — do not fabricate empty authority roots from this activation unit.";
    }
  }

  return {
    mimersRoot,
    mimersRootPurpose: "runtime_config_secrets",
    masterRoot: governed.path,
    governedMasterRoot: governed.path,
    casRoot: cas.path,
    rawQuarantineRoot: rawQuarantine.path,
    quarantineRoot: rawQuarantine.path,
    datasetApprovalStagingRoot,
    masterVisible: governed.visible,
    governedMasterVisible: governed.visible,
    casVisible: cas.visible,
    quarantineVisible: rawQuarantine.visible,
    rawQuarantineVisible: rawQuarantine.visible,
    runtimeDataRootSeparation,
    quarantineModel: "TWO_INTENTIONAL_LAYERS",
    blocker,
  };
}

/** Governed Master root used by FileDatasetApprovalStore / FileCheckpointStore. */
export function requireGovernedMasterRootForDatasetApproval(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const resolved = resolveGovernedDataRoots(env);
  if (resolved.blocker?.startsWith("BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION") ||
      resolved.blocker?.startsWith("REJECT_GOVERNED_MASTER_RUNTIME_MIRROR")) {
    throw new GovernedDataRootError(resolved.blocker);
  }
  if (!resolved.governedMasterRoot || !resolved.governedMasterVisible) {
    throw new GovernedDataRootError(
      resolved.blocker ??
        "BLOCKED_BY_GOVERNED_DATA_ROOT_PROVISIONING: GOVERNED_MASTER_ROOT unavailable for DatasetApproval persistence",
    );
  }
  return resolved.governedMasterRoot;
}

/** @deprecated Use requireGovernedMasterRootForDatasetApproval. */
export function requireMasterArchiveRootForDatasetApproval(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return requireGovernedMasterRootForDatasetApproval(env);
}

/** Deterministic DatasetApproval staging root (not created). */
export function datasetApprovalStagingRootFor(governedMasterRoot: string): string {
  return datasetApprovalStagingUnder(governedMasterRoot);
}

export function isGovernedMasterRuntimeMirror(candidate: string): boolean {
  return isRuntimeMirrorRoot(candidate);
}

export function legacyGeoArchiveRootFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return (
    absolutePath(env.MASTER_ARCHIVE_ROOT) ||
    absolutePath(env.MASTER_ROOT) ||
    absolutePath(env.GEO_MASTER_ARCHIVE)
  );
}

export function assertCasRootBasenameForLedger(casRoot: string): string {
  const resolved = resolve(casRoot);
  if (basename(resolved).toLowerCase() !== "cas") {
    throw new GovernedDataRootError(
      'BLOCKED_BY_LEDGER_ROOT_CONTRACT_DECISION: CAS_ROOT basename must be "cas" so the ' +
        "persistent Mimers ledger can be the sibling <parent>/ledger without inventing a fourth authority.",
    );
  }
  return resolve(resolved, "..");
}
