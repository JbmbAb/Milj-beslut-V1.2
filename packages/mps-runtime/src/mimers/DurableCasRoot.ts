import { existsSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

/**
 * Production CAS physical root is CAS_ROOT only.
 * MIMERS_ROOT is runtime/config/secrets and must never supply the CAS path.
 */
export const CAS_ROOT_REQUIRED = "CAS_ROOT_REQUIRED" as const;
export const LEDGER_ROOT_CONTRACT_BLOCKED = "BLOCKED_BY_LEDGER_ROOT_CONTRACT_DECISION" as const;

export class CasRootRequiredError extends Error {
  readonly code = CAS_ROOT_REQUIRED;

  constructor(consumer: string, detail?: string) {
    super(
      `${CAS_ROOT_REQUIRED}: ${detail ?? `CAS_ROOT is not set for ${consumer}`} ` +
        "(fail-closed: production durable CAS does not derive from MIMERS_ROOT/cas; " +
        "set CAS_ROOT to the exact physical CAS directory)",
    );
    this.name = "CasRootRequiredError";
  }
}

export class LedgerRootContractError extends Error {
  readonly code = LEDGER_ROOT_CONTRACT_BLOCKED;

  constructor(detail: string) {
    super(`${LEDGER_ROOT_CONTRACT_BLOCKED}: ${detail}`);
    this.name = "LedgerRootContractError";
  }
}

/**
 * Resolve the durable production CAS directory from CAS_ROOT.
 * Does not create directories. Does not fall back to MIMERS_ROOT.
 */
export function resolveDurableCasRoot(
  env: NodeJS.ProcessEnv = process.env,
  consumer = "durable CAS",
): string {
  const raw = env.CAS_ROOT?.trim();
  if (!raw) {
    throw new CasRootRequiredError(consumer);
  }
  const path = resolve(raw);
  if (!existsSync(path)) {
    throw new CasRootRequiredError(
      consumer,
      `CAS_ROOT '${raw}' for ${consumer} does not exist (do not fabricate empty CAS authority roots)`,
    );
  }
  try {
    if (!statSync(path).isDirectory()) {
      throw new CasRootRequiredError(
        consumer,
        `CAS_ROOT '${raw}' for ${consumer} is not a directory`,
      );
    }
  } catch (error) {
    if (error instanceof CasRootRequiredError) throw error;
    const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : "unknown";
    throw new CasRootRequiredError(
      consumer,
      `CAS_ROOT '${raw}' for ${consumer} cannot be inspected (${code})`,
    );
  }
  return path;
}

/**
 * Derive Mimers persistent backend parent from CAS_ROOT when basename is "cas".
 * Ledger is then the sibling `<parent>/ledger`.
 */
export function resolveMimersBackendRootFromCasRoot(casRoot: string): string {
  const resolved = resolve(casRoot);
  if (basename(resolved).toLowerCase() !== "cas") {
    throw new LedgerRootContractError(
      'CAS_ROOT basename must be "cas" so ledger can be sibling <parent>/ledger without inventing another authority root',
    );
  }
  return dirname(resolved);
}
