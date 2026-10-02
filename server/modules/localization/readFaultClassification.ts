/**
 * W-CATCH2 (owner decisions 2026-10-02/03, OD-R1/OD-R2): ONE classification for every catch around a
 * CAS / index / database read on the LU truth chain. A read that FAILED is never "absent":
 *
 *  - a read error is a technical error (retryable: the persistence of the fault is unknown);
 *  - a lasting storage fault, an artifact an index or a reference says must exist but the CAS does not
 *    hold, or an index that contradicts itself is a lasting integrity fault (not retryable);
 *  - an existing object that fails verification is a refusal (not retryable) -- never "not minted yet",
 *    so it is never minted or re-issued over, and never skipped as if it were not there;
 *  - ABSENCE is only what the caller can PROVE: the repository's exact "never stored" signal for the
 *    exact id the caller asked for (isProvenArtifactAbsence), or W-APR/W-BOOT's strict
 *    "no binding registered" (isProvenBindingAbsence). Nothing here turns a failure into absence.
 *
 * KNOWN LIMIT (W-CATCH3, CATCH2 verifier finding 5; storage layer, unchanged): "never stored" is the
 * storage's ENOENT on the INDEX ENTRY (packages/mps-runtime MimersByteStorageBackend isEnoent) -- also
 * when the whole index directory (the entry's parent) is gone. It proves that no entry is readable
 * under that id, not that nothing was ever stored. Where something says the artifact must exist (a
 * completed row, a reference, a projection row) that absence is MISSING_FROM_CAS and fails closed; but a
 * deterministic id that is minted on absence (the provisioning workers' issuers, capabilities, relations,
 * temporal statuses) is minted again after the loss of its single index entry -- byte-identical where
 * the content is fully deterministic, with a new decision_time for the temporal status (CATCH2 probe
 * I1). The class of BOOT's single-file-loss note; it needs its own owner decision (KNOWN_LIMITATION or
 * an index-root marker), not a change here.
 *
 * Reuses, never re-derives:
 *  - M1a-F1/U20CDF2's value-based lasting-storage rule (storageFaultClassification.ts
 *    isPersistentStorageFault: MIMERS_ARTIFACT_OBJECT_MISSING, a torn index entry, CASIntegrityError);
 *  - U30-R3's "never stored" signal (packages/mps-lu LuReExecutionStorageError.ts isArtifactNotFound:
 *    exactly `Artifact not found: <id>` from CasArtifactResolver / InMemoryArtifactRepository);
 *  - W-APR/W-BOOT's binding-resolution classes (READ_ERROR / STORAGE_INTEGRITY_FAULT / MISSING_FROM_CAS /
 *    REFUSED / BINDING_INDEX_INCONSISTENT; projectContextBootstrapBindingGate.ts and
 *    assessmentProjection.ts now delegate here instead of keeping their own copies).
 *
 * Everything is matched on stable codes, class names and REJECT_* tokens, never on free text (the one
 * exception is the repositories' own fixed signals `Artifact not found: ` and `WORM violation: `, which
 * have no code). The failure itself always stays server-side in `cause`; no message built here carries
 * an id, a path, a storage code or raw provider text.
 */
import { isPersistentStorageFault, retrySentenceSv } from './storageFaultClassification';

/**
 * - READ_ERROR: a read of unknown persistence (EIO, a lock, the index database down, an unknown error
 *   while reading) -- retryable;
 * - STORAGE_INTEGRITY_FAULT: a lasting storage fault (object gone behind its index entry, torn index
 *   entry, corrupt bytes, another object already stored under a write-once id);
 * - MISSING_FROM_CAS: the CAS has no entry for an artifact that must exist (registered, referenced,
 *   recorded as completed) -- lost storage, not absence;
 * - BINDING_INDEX_INCONSISTENT: the project-context binding index contradicts itself (lost or misfiled
 *   rows);
 * - REFUSED: verification refused (a REJECT_* token), or an existing object failed verification.
 * Every class except READ_ERROR is lasting: a retry cannot heal it.
 */
export type ReadFaultClass = 'READ_ERROR' | 'STORAGE_INTEGRITY_FAULT' | 'MISSING_FROM_CAS' | 'BINDING_INDEX_INCONSISTENT' | 'REFUSED';

export interface ReadFault {
  readonly faultClass: ReadFaultClass;
  readonly retryable: boolean;
  /** The REJECT_* token of a refusal, when there is one; null otherwise. */
  readonly refusalCode: string | null;
}

/**
 * 'read': the failure came from reading -- an unrecognised error has unknown persistence (READ_ERROR).
 * 'verify': the object WAS read and the failure came from verifying it -- an unrecognised error is a
 * failed verification (REFUSED), unless the cause chain shows a read fault (a read inside verification).
 */
export type ReadPhase = 'read' | 'verify';

/** projectContextBindingRuntime.ts PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT, matched by value. */
const BINDING_INDEX_INCONSISTENT_CODE = 'PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT';
/** resolveCurrent's one refusal (W-APR: unchanged message, typed fields). */
const CURRENT_BINDING_UNAVAILABLE = 'REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE';
/** resolveCurrentProjectContextBindingHead's refusal for a graph without any binding. */
const EMPTY_BINDING_GRAPH = 'REJECT_PROJECT_CONTEXT_BINDING_HEAD: bindings';
/**
 * resolveCurrentProjectContextBindingHead (packages/mps-lu ProjectContextBindingSupersessionGraph.ts)
 * refusals that describe the INDEX, not a signature: the same binding listed twice, a listed (verified)
 * binding or relation of another project, a relation naming a binding the index does not list. Reached
 * only after genuine absence was ruled out (callers check isProvenBindingAbsence first), so "bindings"
 * here means a duplicate listing. A fork, a cycle or two heads stay REFUSED (W-BOOT verifier finding 3).
 */
const BINDING_INDEX_DAMAGE_REFUSALS: ReadonlySet<string> = new Set([
  EMPTY_BINDING_GRAPH,
  'REJECT_PROJECT_CONTEXT_BINDING_HEAD: binding project',
  'REJECT_PROJECT_CONTEXT_BINDING_HEAD: supersession project',
  'REJECT_PROJECT_CONTEXT_BINDING_HEAD: missing relation binding',
]);
const ARTIFACT_NOT_FOUND = 'Artifact not found: ';
const WORM_VIOLATION = 'WORM violation: ';
const REJECT_TOKEN = /^(REJECT_[A-Z0-9_]+)/;
const MAX_CHAIN = 8;

/** The error and its `cause` chain (outermost first), bounded and cycle-safe. */
export function causeChain(error: unknown): readonly unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < MAX_CHAIN && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return chain;
}

function messageOf(node: unknown): string {
  return node instanceof Error ? node.message : '';
}

/** A fault that is a READ (of unknown persistence) by its stable code or class name -- never by text. */
function isReadFaultMarker(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const { code, reason, name } = node as { code?: unknown; reason?: unknown; name?: unknown };
  if (code === 'MIMERS_ARTIFACT_INDEX_READ_FAILED' && reason === 'IO') return true; // an index entry that could not be READ
  if (code === 'LU_REEXECUTION_STORAGE_FAULT') return true; // U30-R3: a storage fault met while re-executing
  if (typeof code === 'string' && /^E[A-Z0-9]{2,}$/.test(code)) return true; // a Node system error: EIO, EBUSY, ECONNREFUSED, ...
  if (typeof code === 'string' && /^P1\d{3}$/.test(code)) return true; // a Prisma connection/engine error (P1xxx)
  if (typeof name === 'string' && name.startsWith('PrismaClient')) return true; // any Prisma client error: the database could not answer
  // W-CATCH3 (CATCH2 verifier finding 13): a timeout or an abort (DOMException / AbortSignal names) has
  // unknown persistence in either phase -- never "refused at verification".
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  return false;
}

function fault(faultClass: ReadFaultClass, refusalCode: string | null = null): ReadFault {
  return { faultClass, retryable: faultClass === 'READ_ERROR', refusalCode };
}

/**
 * W-U20CDF5: the ReadFault of a class a caller already knows from an existing, reviewed classification
 * of its own reads (e.g. governedEvidenceDetails' EVIDENCE_NOT_FOUND / EVIDENCE_READ_ERROR) -- `retryable`
 * derived from the class exactly as classifyReadFault does, never chosen by the caller.
 */
export function readFaultOfClass(faultClass: ReadFaultClass): ReadFault {
  return fault(faultClass);
}

/**
 * The class of a failed read (or of the failed verification of an object that was read). Order:
 * an already-typed LuReadFaultError keeps its class; then index inconsistency, "never stored" for
 * something that must exist, a lasting storage fault, a read fault anywhere in the chain; then the ROOT
 * cause decides between a refusal (REJECT_*) and an unrecognised error (READ_ERROR when reading,
 * REFUSED when verifying).
 */
export function classifyReadFault(error: unknown, phase: ReadPhase = 'read'): ReadFault {
  if (error instanceof LuReadFaultError) return fault(error.faultClass, error.refusalCode);
  const chain = causeChain(error);
  if (chain.some((node) => (node as { code?: unknown } | null)?.code === BINDING_INDEX_INCONSISTENT_CODE)) {
    return fault('BINDING_INDEX_INCONSISTENT');
  }
  if (chain.some((node) => messageOf(node).startsWith(ARTIFACT_NOT_FOUND))) return fault('MISSING_FROM_CAS');
  if (chain.some((node) => isPersistentStorageFault(node) || messageOf(node).startsWith(WORM_VIOLATION))) {
    return fault('STORAGE_INTEGRITY_FAULT');
  }
  if (chain.some(isReadFaultMarker)) return fault('READ_ERROR');
  const rootMessage = messageOf(chain[chain.length - 1]);
  if (BINDING_INDEX_DAMAGE_REFUSALS.has(rootMessage)) return fault('BINDING_INDEX_INCONSISTENT');
  const refusal = REJECT_TOKEN.exec(rootMessage)?.[1];
  if (refusal) return fault('REFUSED', refusal);
  return phase === 'verify' ? fault('REFUSED') : fault('READ_ERROR');
}

/**
 * U30-R3's "never stored" signal, and ONLY it: the repository answered exactly
 * `Artifact not found: <artifactId>` for the very id the caller asked for. Not a wrapped error, not a
 * prefix match, not another id -- an index entry that could not be read, an object gone behind its
 * entry or a read error is never absence.
 */
export function isProvenArtifactAbsence(error: unknown, artifactId: string): boolean {
  return error instanceof Error && error.message === `${ARTIFACT_NOT_FOUND}${artifactId}`;
}

/**
 * W-APR/W-BOOT's genuine absence of a project-context binding, exactly: resolveCurrent's own refusal,
 * `noBindingRegistered === true` (the index lists neither a binding nor a supersession relation for the
 * project) and the empty-graph cause. What this proves is that no row of the BINDING INDEX shows a
 * binding; other indexes (assessment projection, geometry, bootstrap queue) are their owners' to check.
 */
export function isProvenBindingAbsence(error: unknown): boolean {
  if (!(error instanceof Error) || error.message !== CURRENT_BINDING_UNAVAILABLE) return false;
  if ((error as { noBindingRegistered?: unknown }).noBindingRegistered !== true) return false;
  return error.cause instanceof Error && error.cause.message === EMPTY_BINDING_GRAPH;
}

/** server/repositories/projectAccessRepository.ts ProjectAccessDeniedError, matched by value. */
export const PROJECT_ACCESS_DENIED = 'PROJECT_ACCESS_DENIED' as const;

/**
 * W-CATCH2 (#14): the project-access check DECIDED "no access" (not a member, another organisation,
 * project inactive or unknown). Anything else it throws -- a database that could not answer above all --
 * is a failed read of the access facts, never a denial.
 */
export function isProjectAccessDenied(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === PROJECT_ACCESS_DENIED;
}

/** The text every LU route has always answered a denial with (the UI keys on it: LU_SERVER_MESSAGE.NOT_AUTHORIZED). */
export const NOT_AUTHORIZED_FOR_PROJECT = 'Not authorized for this project.' as const;

/** W-CATCH2 #14: the access facts could not be read, so access is neither granted nor denied. */
export const PROJECT_ACCESS_UNRESOLVED = 'PROJECT_ACCESS_UNRESOLVED' as const;

export type ProjectAccessFailure =
  | { readonly ok: false; readonly status: 403; readonly error: typeof NOT_AUTHORIZED_FOR_PROJECT }
  | {
      readonly ok: false;
      readonly status: 409 | 503;
      readonly error: string;
      readonly code: typeof PROJECT_ACCESS_UNRESOLVED;
      readonly failureClass: ReadFaultClass;
      readonly reasonCode: string;
      readonly retryable: boolean;
    };

/**
 * W-CATCH2 #14 (OD-R2): the answer to a failed project-access check. 403 only for the check's own typed
 * denial (isProjectAccessDenied); anything else -- a database that cannot answer above all -- is a
 * failed READ of the access facts: 503 PROJECT_ACCESS_UNRESOLVED with the shared class and a Swedish
 * text, never "not authorized". The fault stays server-side.
 */
export function projectAccessFailure(error: unknown): ProjectAccessFailure {
  if (isProjectAccessDenied(error)) return { ok: false, status: 403, error: NOT_AUTHORIZED_FOR_PROJECT };
  const fault = classifyReadFault(error);
  return {
    ok: false,
    status: readFaultHttpStatus(fault),
    error: `${readFaultSentenceSv(fault, 'Behörigheten till projektet')} Begäran utfördes inte.`,
    code: PROJECT_ACCESS_UNRESOLVED,
    failureClass: fault.faultClass,
    reasonCode: fault.refusalCode ?? fault.faultClass,
    retryable: fault.retryable,
  };
}

export const LU_READ_FAULT = 'LU_READ_FAULT' as const;

/**
 * A typed, fail-closed read fault. `subject` is a stable lower-case id of WHAT could not be read or
 * verified (e.g. 'viewer-capability'). The message holds only stable codes -- never an id, a path, a
 * REJECT_* token or the cause's text -- because a few callers forward messages to clients; the original
 * failure stays in `cause`.
 */
export class LuReadFaultError extends Error {
  readonly code = LU_READ_FAULT;
  readonly subject: string;
  readonly faultClass: ReadFaultClass;
  readonly retryable: boolean;
  readonly refusalCode: string | null;

  constructor(subject: string, readFault: ReadFault, cause: unknown) {
    super(`${LU_READ_FAULT}: ${subject}: ${readFault.faultClass}`, { cause });
    this.name = 'LuReadFaultError';
    this.subject = subject;
    this.faultClass = readFault.faultClass;
    this.retryable = readFault.retryable;
    this.refusalCode = readFault.refusalCode;
  }
}

/** Classifies `error` and returns it as a LuReadFaultError for `subject` (an existing one passes through). */
export function toReadFaultError(subject: string, error: unknown, phase: ReadPhase = 'read'): LuReadFaultError {
  if (error instanceof LuReadFaultError) return error;
  return new LuReadFaultError(subject, classifyReadFault(error, phase), error);
}

/**
 * Reads an artifact that MAY legitimately not exist yet (a deterministic, content-addressed id the
 * caller is about to mint). `{ found: false }` ONLY for the proven absence of exactly that id; every
 * other failure throws a LuReadFaultError -- so a read error or a damaged existing object is never
 * "not minted yet" and never leads to a mint or a re-issue over it.
 */
export async function readExistingOrProvenAbsent<T>(
  repository: { resolve<R>(ref: { readonly artifact_id: string; readonly artifact_type: string }): Promise<R> },
  ref: { readonly artifact_id: string; readonly artifact_type: string },
  subject: string,
): Promise<{ readonly found: true; readonly value: T } | { readonly found: false }> {
  try {
    return { found: true, value: await repository.resolve<T>(ref) };
  } catch (error) {
    if (isProvenArtifactAbsence(error, ref.artifact_id)) return { found: false };
    throw toReadFaultError(subject, error, 'read');
  }
}

/**
 * W-CATCH3 (CATCH2 verifier findings 1 and 2): the object a repository returned for `requestedId` names
 * exactly that id. CasArtifactResolver hands back the stored body without comparing the envelope or the
 * body with the id it was asked for, so an index entry pointing at another object's bytes would read as
 * that other object. A reader that turns "the object under id X" into a decision (select, reuse,
 * present) checks this first: a mismatch is a lasting integrity fault of the storage (a misdirected index
 * entry or a misfiled object) -- never absence, never "not current" and never the other object.
 */
export function assertReadUnderItsOwnId(subject: string, value: unknown, requestedId: string): void {
  const id = typeof value === 'object' && value !== null ? (value as { artifact_id?: unknown }).artifact_id : undefined;
  if (typeof id === 'string' && id.length > 0 && id === requestedId) return;
  throw new LuReadFaultError(subject, fault('STORAGE_INTEGRITY_FAULT'), new Error('the object read under an artifact id names another artifact id'));
}

/**
 * W-CATCH2 #10/#11: an existing artifact under a DETERMINISTIC id must be exactly the artifact that id
 * names. Its content without the attestation must equal the freshly built bare artifact field for field
 * (compared with keys sorted, so storage key order never matters); a valid CAS object whose content was
 * edited under the same id -- even with the content_hash field left untouched -- is not it.
 *
 * W-CATCH3 (CATCH2 verifier finding 3): this says NOTHING about the attestation (a garbled signature
 * passes it). A caller verifies the attestation against the trusted key before it uses the object or
 * writes anything that rests on it (the viewer-capability and geometry-supersession workers verify an
 * existing issuer right after this check, and their new issuers, capabilities and relations before they
 * are written).
 */
export function isExactlyTheDeterministicArtifact(existing: unknown, bare: object): boolean {
  if (typeof existing !== 'object' || existing === null) return false;
  const { attestation: _attestation, ...content } = existing as Record<string, unknown>;
  return sortedJson(content) === sortedJson(bare);
}

/** JSON with object keys sorted at every level, so storage key order never matters. */
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${sortedJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Swedish, neutral: what the fault means for `subjectSv` (a capitalised noun phrase such as
 * "Projektets koppling till fastigheten") and whether a retry can help. No id, path or code.
 */
export function readFaultSentenceSv(readFault: ReadFault, subjectSv: string): string {
  const cause: Record<ReadFaultClass, string> = {
    READ_ERROR: 'kunde inte läsas (tekniskt fel).',
    STORAGE_INTEGRITY_FAULT: 'kunde inte läsas eller verifieras ur arkivet (bestående lagrings- eller integritetsfel).',
    MISSING_FROM_CAS: 'kunde inte läsas eller verifieras ur arkivet (bestående lagrings- eller integritetsfel).',
    BINDING_INDEX_INCONSISTENT: 'kunde inte fastställas: bindningsindexet motsäger sig självt (bestående integritetsfel).',
    REFUSED: 'underkändes vid verifieringen.',
  };
  const contact = readFault.retryable ? [] : ['Kontakta systemets administratör.'];
  return [`${subjectSv} ${cause[readFault.faultClass]}`, retrySentenceSv(readFault.retryable), ...contact].join(' ');
}

/** The HTTP status of a read fault on a request path: a refusal is 409, every other fault 503 (never 404). */
export function readFaultHttpStatus(readFault: ReadFault): 409 | 503 {
  return readFault.faultClass === 'REFUSED' ? 409 : 503;
}
