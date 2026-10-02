/**
 * W-BOOT (OD-R1/OD-R2, owner decisions 2026-10-02): when may the project-context bootstrap mint a
 * NEW ProjectContextBinding for a project?
 *
 * Only when the project provably has none: ProjectContextBindingProvider.resolveCurrent refused with
 * W-APR's `noBindingRegistered` contract (the index lists no binding) because the binding graph is
 * empty, AND the binding index lists no supersession relation for the project either (a relation
 * proves that bindings existed -- their rows are lost, not absent).
 *
 * W-BOOT (APR verifier F2): AND no other index trace shows that the project ever had a binding --
 * every trace the caller supplies (the bootstrap: assessment projection rows, which name their
 * binding; localization geometry rows, saved under the canonical context; a COMPLETED bootstrap
 * request, which records its binding) must be empty. Any of them present = lost binding rows.
 *
 * Every other resolveCurrent failure means the project may already have a binding that could not be
 * read or verified. Minting then could give the project a second binding with another property root,
 * so it is a typed, fail-closed error instead -- never "no binding yet":
 *  - READ_ERROR: a read of unknown persistence (EIO, a lock, the index database down, an unknown
 *    error) -- retryable;
 *  - STORAGE_INTEGRITY_FAULT / MISSING_FROM_CAS: a lasting storage fault, or an artifact the index
 *    lists is not in the CAS -- not retryable;
 *  - REFUSED: a binding, issuer or supersession failed verification, a contract version is refused,
 *    or the graph has no single head (`refusalCode` is the REJECT_* token) -- not retryable;
 *  - BINDING_INDEX_INCONSISTENT: no binding row, but supersession rows (the provider's typed cause
 *    PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT, or the bootstrap's own listing) or another index
 *    trace of a binding remain -- not retryable.
 * The classification is the same value-based rule W-APR uses for the current binding
 * (assessmentProjection.ts currentBindingFault) and M1a-F1/U20CDF2 use for storage faults
 * (storageFaultClassification.ts); it reads codes and REJECT_* tokens, never free text.
 *
 * The message is the Swedish text the bootstrap-status API shows (failureDetail): no id, path,
 * storage code or REJECT_* token. The original failure stays server-side in `cause`.
 */
import { isPersistentStorageFault, retrySentenceSv } from './storageFaultClassification';

export const PROJECT_CONTEXT_BOOTSTRAP_BINDING_UNRESOLVED = 'PROJECT_CONTEXT_BOOTSTRAP_BINDING_UNRESOLVED' as const;

export type BootstrapBindingFaultReason =
  | 'READ_ERROR'
  | 'STORAGE_INTEGRITY_FAULT'
  | 'MISSING_FROM_CAS'
  | 'REFUSED'
  | 'BINDING_INDEX_INCONSISTENT';

/** The persisted failure code (ProjectContextBootstrapRequest.failureCode): W-APR's binding reason codes. */
export type BootstrapBindingFailureCode =
  | 'CURRENT_BINDING_READ_ERROR'
  | 'CURRENT_BINDING_INTEGRITY_FAULT'
  | 'CURRENT_BINDING_REFUSED';

/** The refusal resolveCurrent throws for every failure (W-APR: unchanged message, typed fields). */
const CURRENT_BINDING_UNAVAILABLE = 'REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE';
/** resolveCurrentProjectContextBindingHead's refusal for a graph without any binding. */
const EMPTY_BINDING_GRAPH = 'REJECT_PROJECT_CONTEXT_BINDING_HEAD: bindings';
/** projectContextBindingRuntime.ts PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT, matched by value. */
const BINDING_INDEX_INCONSISTENT_CODE = 'PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT';

const PREFIX = 'Projektkontexten kunde inte etableras:';
const NO_NEW_BINDING =
  'Ingen ny bindning skapades, eftersom projektet redan kan ha en och en ny då skulle kunna ge det en andra fastighetsrot.';
const CONTACT = 'Kontakta systemets administratör.';

function swedishText(reason: BootstrapBindingFaultReason, retryable: boolean): string {
  const cause: Record<BootstrapBindingFaultReason, string> = {
    READ_ERROR: 'projektets befintliga bindning kunde inte läsas (tekniskt fel).',
    STORAGE_INTEGRITY_FAULT:
      'projektets befintliga bindning kunde inte läsas eller verifieras ur CAS (bestående lagrings- eller integritetsfel).',
    MISSING_FROM_CAS:
      'projektets befintliga bindning kunde inte läsas eller verifieras ur CAS (bestående lagrings- eller integritetsfel).',
    REFUSED:
      'projektets befintliga bindning underkändes vid verifieringen (utfärdare, signatur, innehåll, kontraktsversion eller ersättningskedja).',
    BINDING_INDEX_INCONSISTENT:
      'projektets bindning saknas i bindningsindexet, men indexen visar att en bindning har funnits (bestående integritetsfel).',
  };
  return [PREFIX, cause[reason], NO_NEW_BINDING, retrySentenceSv(retryable), ...(retryable ? [] : [CONTACT])].join(' ');
}

/**
 * The bootstrap could not establish that the project has no binding, so it mints nothing. Carries
 * `failureCode` (the field the bootstrap's outcome mapping persists) and an honest `retryable`.
 */
export class ProjectContextBootstrapBindingUnresolvedError extends Error {
  readonly code = PROJECT_CONTEXT_BOOTSTRAP_BINDING_UNRESOLVED;
  readonly failureCode: BootstrapBindingFailureCode;
  readonly reason: BootstrapBindingFaultReason;
  readonly retryable: boolean;
  readonly refusalCode: string | null;

  constructor(reason: BootstrapBindingFaultReason, refusalCode: string | null, cause: unknown) {
    const retryable = reason === 'READ_ERROR';
    super(swedishText(reason, retryable), { cause });
    this.name = 'ProjectContextBootstrapBindingUnresolvedError';
    this.reason = reason;
    this.retryable = retryable;
    this.refusalCode = refusalCode;
    this.failureCode =
      reason === 'READ_ERROR'
        ? 'CURRENT_BINDING_READ_ERROR'
        : reason === 'REFUSED'
          ? 'CURRENT_BINDING_REFUSED'
          : 'CURRENT_BINDING_INTEGRITY_FAULT';
  }
}

/** The nature of a failure to resolve (or list) the project's bindings, read from its cause (value-based). */
export function classifyBindingResolutionFailure(error: unknown): ProjectContextBootstrapBindingUnresolvedError {
  const inner = error instanceof Error && error.cause !== undefined ? error.cause : error;
  if ((inner as { code?: unknown } | null)?.code === BINDING_INDEX_INCONSISTENT_CODE) {
    return new ProjectContextBootstrapBindingUnresolvedError('BINDING_INDEX_INCONSISTENT', null, error);
  }
  if (inner instanceof Error && inner.message.startsWith('Artifact not found: ')) {
    return new ProjectContextBootstrapBindingUnresolvedError('MISSING_FROM_CAS', null, error);
  }
  if (isPersistentStorageFault(inner)) {
    return new ProjectContextBootstrapBindingUnresolvedError('STORAGE_INTEGRITY_FAULT', null, error);
  }
  const refusal = inner instanceof Error ? /^(REJECT_[A-Z0-9_]+)/.exec(inner.message)?.[1] : undefined;
  if (refusal) {
    return new ProjectContextBootstrapBindingUnresolvedError('REFUSED', refusal, error);
  }
  return new ProjectContextBootstrapBindingUnresolvedError('READ_ERROR', null, error);
}

/** Exactly W-APR's genuine absence: the provider's own refusal, noBindingRegistered === true, empty graph. */
function isNoBindingRegistered(error: unknown): boolean {
  if (!(error instanceof Error) || error.message !== CURRENT_BINDING_UNAVAILABLE) return false;
  if ((error as { noBindingRegistered?: unknown }).noBindingRegistered !== true) return false;
  return error.cause instanceof Error && error.cause.message === EMPTY_BINDING_GRAPH;
}

/**
 * W-BOOT (APR verifier F2): another index that can only hold rows for the project once a binding
 * existed. `count` returns how many such rows the project has; a read failure is classified like any
 * other (a database error is a retryable READ_ERROR).
 */
export interface ProjectBindingTrace {
  readonly name: string;
  count(projectId: string): Promise<number>;
}

/**
 * Called with the error resolveCurrent threw. Returns ONLY when the project has no binding at all
 * (minting may proceed); otherwise throws ProjectContextBootstrapBindingUnresolvedError. Every trace
 * is consulted, in order, before minting is allowed.
 */
export async function assertNoProjectContextBindingRegistered(args: {
  readonly resolveCurrentError: unknown;
  readonly projectId: string;
  readonly index: { listSupersessionRefs(projectId: string): Promise<readonly unknown[]> };
  readonly traces: readonly ProjectBindingTrace[];
}): Promise<void> {
  if (!isNoBindingRegistered(args.resolveCurrentError)) {
    throw classifyBindingResolutionFailure(args.resolveCurrentError);
  }
  let supersessions: readonly unknown[];
  try {
    supersessions = await args.index.listSupersessionRefs(args.projectId);
  } catch (error) {
    throw classifyBindingResolutionFailure(error);
  }
  if (supersessions.length > 0) {
    throw new ProjectContextBootstrapBindingUnresolvedError('BINDING_INDEX_INCONSISTENT', null, args.resolveCurrentError);
  }
  for (const trace of args.traces) {
    let rows: number;
    try {
      rows = await trace.count(args.projectId);
    } catch (error) {
      throw classifyBindingResolutionFailure(error);
    }
    if (rows > 0) {
      throw new ProjectContextBootstrapBindingUnresolvedError(
        'BINDING_INDEX_INCONSISTENT',
        null,
        new Error(`${BINDING_INDEX_INCONSISTENT_CODE}: no binding registered, but ${rows} ${trace.name} row(s) of the project remain`, {
          cause: args.resolveCurrentError,
        }),
      );
    }
  }
}
