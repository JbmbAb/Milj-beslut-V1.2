/**
 * W-BOOT (OD-R1/OD-R2, owner decisions 2026-10-02): when may the project-context bootstrap mint a
 * NEW ProjectContextBinding for a project?
 *
 * Only when NO INDEX TRACE shows a binding for the project (W-CATCH2, BOOT verifier finding 1: this is
 * what the gate proves -- not that the project "provably has none"; see
 * PROJECT_CONTEXT_BOOTSTRAP_KNOWN_LIMITATION below): ProjectContextBindingProvider.resolveCurrent refused
 * with W-APR's `noBindingRegistered` contract (the index lists no binding) because the binding graph is
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
 *    trace of a binding remain; or (W-CATCH2, BOOT verifier finding 3) the index lists a binding twice,
 *    lists a binding or relation of another project, or a relation naming a binding it lost -- not
 *    retryable.
 * W-CATCH2: the classification IS the shared rule (readFaultClassification.ts classifyReadFault, also
 * used by the selection, the geometry routes, the viewer runtime and the provisioning workers); it
 * reads codes and REJECT_* tokens, never free text.
 *
 * The message is the Swedish text the bootstrap-status API shows (failureDetail): no id, path,
 * storage code or REJECT_* token. The original failure stays server-side in `cause`.
 */
import { retrySentenceSv } from './storageFaultClassification';
import { classifyReadFault, isProvenBindingAbsence } from './readFaultClassification';

export const PROJECT_CONTEXT_BOOTSTRAP_BINDING_UNRESOLVED = 'PROJECT_CONTEXT_BOOTSTRAP_BINDING_UNRESOLVED' as const;

/**
 * KNOWN_LIMITATION (W-CATCH2 on the BOOT verifier's finding 1; owner decision (4) p.6, 2026-10-03:
 * correlated total metadata loss is the same documented class as M1a's -- documented, NOT approved
 * behaviour). The gate proves only that no index trace shows a binding. When every trace is lost
 * together -- the binding index's binding and supersession rows, the assessment projection's rows, the
 * localization geometry rows and a COMPLETED bootstrap request -- the bootstrap mints a new root (after
 * a re-import of the property layer: another property root) although the old binding is intact in CAS
 * (the BOOT verifier's probe K1; old code did the same). Pinned as a limit in
 * luProjectContextBootstrapCasFaultChainBOOT.test.ts. No text describing the bootstrap or bindings
 * (U51, reports, PDF, UI) may claim more than `meaning_sv`. The structural fix (a CAS-anchored binding
 * head) is not built.
 */
export const PROJECT_CONTEXT_BOOTSTRAP_KNOWN_LIMITATION = Object.freeze({
  code: 'KNOWN_LIMITATION',
  id: 'PROJECT_CONTEXT_BOOTSTRAP_CORRELATED_METADATA_LOSS',
  meaning_sv:
    'currentness/bindning är fail-closed för detekterbara fel men inte bevisad mot korrelerad förlust av all metadata som visar att en bindning existerat',
  scope_sv:
    'Bootstrapen bevisar bara att inget indexspår visar en bindning: bindningsindexets bindnings- och ersättningsrader, bedömningsprojektionens rader, lokaliseringsgeometrins rader och en slutförd bootstrap-begäran med bindning. Förloras alla dessa spår tillsammans mintas en ny bindning, efter en omimport av fastighetsskiktet med en annan fastighetsrot, fast den gamla bindningen finns kvar i CAS. För ett projekt som bootstrappats via kön krävs förlust i minst två tabeller (bindningsraden och den slutförda begäran); för ett projekt vars bindning installerats utanför kön och som saknar bedömnings- och geometrirader räcker att bindningsraden förloras.',
  owner_decision:
    'ACCEPTED 2026-10-03 (owner decision (4) p.6): correlated total metadata loss is the same documented KNOWN_LIMITATION class as M1a; documented, NOT approved behaviour; the structural fix (a CAS-anchored binding head) is not built',
} as const);

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
      'projektets bindningsindex är inkonsekvent: indexen visar att en bindning har funnits, men den saknas, är dubblerad eller hör till ett annat projekt (bestående integritetsfel).',
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

/**
 * The nature of a failure to resolve (or list) the project's bindings. W-CATCH2: the shared rule
 * (readFaultClassification.ts classifyReadFault) -- no second copy here. Structural index damage behind
 * a head refusal (a binding listed twice, a listed binding or relation of another project, a relation
 * naming a binding the index lost) is BINDING_INDEX_INCONSISTENT, not a verification refusal (W-BOOT
 * verifier finding 3).
 */
export function classifyBindingResolutionFailure(error: unknown): ProjectContextBootstrapBindingUnresolvedError {
  const fault = classifyReadFault(error);
  return new ProjectContextBootstrapBindingUnresolvedError(fault.faultClass, fault.refusalCode, error);
}

/** Exactly W-APR's genuine absence: the provider's own refusal, noBindingRegistered === true, empty graph. */
function isNoBindingRegistered(error: unknown): boolean {
  return isProvenBindingAbsence(error);
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
 * Called with the error resolveCurrent threw. Returns ONLY when no index trace shows a binding for the
 * project (minting may proceed; what that does NOT prove: PROJECT_CONTEXT_BOOTSTRAP_KNOWN_LIMITATION);
 * otherwise throws ProjectContextBootstrapBindingUnresolvedError. Every trace is consulted, in order,
 * before minting is allowed.
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
