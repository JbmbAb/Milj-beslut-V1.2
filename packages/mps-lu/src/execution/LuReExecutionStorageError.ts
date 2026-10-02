import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";

/**
 * U30-R3 K1 (OD-R2, owner 2026-10-02): a CAS storage fault met while re-executing an assessment is a
 * TECHNICAL error, never a verification verdict. Only the repositories' exact "never stored" signal
 * (`Artifact not found: <id>`, CasArtifactResolver / InMemoryArtifactRepository) is a statement about
 * the evidence chain -- for a pinned artifact that is an integrity/binding failure and becomes a DENY.
 * Everything else a read or write raises (MimersArtifactIndexReadError, MimersArtifactObjectMissingError,
 * a corrupt CAS object, an I/O error, ...) is this error: it carries the stage of the replay chain, the
 * artifact it concerns and the original fault as `cause`, and its message holds only stable codes and
 * ids, never the fault's free text.
 *
 * Deliberately not exported from the package root (that would change the API snapshot, PRES-24): a
 * consumer recognizes it by `code === LU_REEXECUTION_STORAGE_FAULT`.
 */
export const LU_REEXECUTION_STORAGE_FAULT = "LU_REEXECUTION_STORAGE_FAULT" as const;

export type LuReExecutionStage =
  | "assessment"
  | "execution_outcome"
  | "execution_attempt"
  | "execution_manifest"
  | "replay_record"
  | "replay_chain"
  | "pinned_evidence"
  | "capability_execution"
  | "capability_definition"
  | "authority_evidence"
  | "execution_identity";

/** A stable machine code for the fault: its own `code` when it has one, else its class name. */
function faultCode(fault: unknown): string {
  const code = (fault as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) return code;
  const name = fault instanceof Error ? fault.name : "";
  return /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(name) ? name : "UnknownError";
}

export class LuReExecutionStorageError extends Error {
  readonly code = LU_REEXECUTION_STORAGE_FAULT;
  readonly fault_code: string;

  constructor(
    readonly stage: LuReExecutionStage,
    readonly artifact_ref: ArtifactReference,
    readonly operation: "resolve" | "put",
    options: { readonly cause: unknown },
  ) {
    const fault_code = faultCode(options.cause);
    super(
      `${LU_REEXECUTION_STORAGE_FAULT}: ${operation} of ${artifact_ref.artifact_type} '${artifact_ref.artifact_id}' ` +
        `(${stage}) failed with a storage fault (${fault_code}); this is a technical error, not a verification verdict`,
      { cause: options.cause },
    );
    this.name = "LuReExecutionStorageError";
    this.fault_code = fault_code;
  }
}

/** The repositories' "never stored" signal -- the one read failure that is a statement, not a fault. */
export function isArtifactNotFound(error: unknown, artifactId: string): boolean {
  return error instanceof Error && error.message === `Artifact not found: ${artifactId}`;
}

/**
 * Reads a pinned artifact: `{ found: true, value }`, `{ found: false, error }` for a genuine absence
 * (the caller decides what absence means at its stage), or throws LuReExecutionStorageError for any
 * other failure. An error that already is a LuReExecutionStorageError passes through unchanged.
 */
export async function readPinnedArtifact<T>(
  repository: { resolve<R>(ref: ArtifactReference): Promise<R> },
  ref: ArtifactReference,
  stage: LuReExecutionStage,
): Promise<{ readonly found: true; readonly value: T } | { readonly found: false; readonly error: unknown }> {
  try {
    return { found: true, value: await repository.resolve<T>(ref) };
  } catch (error) {
    if (error instanceof LuReExecutionStorageError) throw error;
    if (isArtifactNotFound(error, ref.artifact_id)) return { found: false, error };
    throw new LuReExecutionStorageError(stage, ref, "resolve", { cause: error });
  }
}
