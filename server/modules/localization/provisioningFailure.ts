/**
 * W-CATCH2 #10/#11/#12 (owner decisions 2026-10-02/03): the failure outcome of the three provisioning
 * workers (viewer capability, geometry supersession, V3 execution identity), shared so they cannot drift.
 *
 * - A typed LuReadFaultError for an EXISTING object the worker found (issuer, capability, relation,
 *   temporal status, identity, attestation) -> EXISTING_ARTIFACT_READ_ERROR (retryable) /
 *   EXISTING_ARTIFACT_INTEGRITY_FAULT / EXISTING_ARTIFACT_REFUSED: the worker minted and re-issued
 *   NOTHING over it (only the proven absence of exactly the deterministic id may mint).
 * - A typed fault of the project's current binding -> CURRENT_BINDING_READ_ERROR / _INTEGRITY_FAULT /
 *   _REFUSED (the bootstrap's codes).
 * - An error that carries its own failureCode (fail()) -> unchanged.
 * - Anything else -> a stable code by the shared classification (PROVISIONING_EXECUTION_ERROR for a read
 *   error or an unknown error, as before; PROVISIONING_STORAGE_INTEGRITY_FAULT; PROVISIONING_REFUSED)
 *   and a neutral Swedish text, never the raw message; the raw text is only the internal `diagnostic`
 *   the workers log.
 *
 * W-CATCH3 (CATCH2 verifier finding 3): a text never claims "Inget utfärdades." after a write was
 * attempted. Every worker wraps its repository with trackArtifactWrites before its first read and hands
 * the record to provisioningFailure: a failure after a write says that an object may have been saved and
 * the request was not completed, and its class without claiming a read (it may have been a write).
 */
import type { ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import { classifyReadFault, LuReadFaultError, readFaultSentenceSv, type ReadFault, type ReadFaultClass } from './readFaultClassification';
import { retrySentenceSv } from './storageFaultClassification';

/**
 * W-CATCH3: whether this worker run has attempted any write -- a CAS put (trackArtifactWrites) or an
 * index row the worker registers itself (it sets the flag before the registration) -- set before the
 * write is awaited.
 */
export interface ProvisioningWrites {
  written: boolean;
}

/**
 * W-CATCH3: the same repository, recording in `writes` that a put was ATTEMPTED (before it is awaited, so
 * a put that fails half-way counts too). Every other member is the repository's own.
 */
export function trackArtifactWrites<R extends ArtifactRepositoryPort>(repository: R, writes: ProvisioningWrites): R {
  return new Proxy(repository, {
    get(target, property) {
      if (property === 'put') {
        return (artifact: Parameters<ArtifactRepositoryPort['put']>[0]) => {
          writes.written = true;
          return target.put(artifact);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

const NOTHING_ISSUED_SV = 'Inget utfärdades.';
const MAY_HAVE_WRITTEN_SV = 'Ett eller flera objekt kan ha sparats innan felet uppstod, men begäran slutfördes inte.';

/** W-CATCH3: a failure that came after a write was attempted, by its class -- never "could not be read". */
const AFTER_WRITE_CAUSE_SV: Readonly<Record<ReadFaultClass, string>> = {
  READ_ERROR: 'ett tekniskt fel',
  STORAGE_INTEGRITY_FAULT: 'ett bestående lagrings- eller integritetsfel',
  MISSING_FROM_CAS: 'ett bestående lagrings- eller integritetsfel',
  BINDING_INDEX_INCONSISTENT: 'ett bestående integritetsfel',
  REFUSED: 'att ett steg underkändes vid verifieringen',
};

/**
 * W-CATCH3: whether a write may have happened. Fail-closed: a caller that hands over no record (not
 * possible from TypeScript) is treated as "may have written", so "Inget utfärdades." is never claimed
 * without the record that proves it.
 */
function mayHaveWritten(writes: ProvisioningWrites | undefined): boolean {
  return writes?.written !== false;
}

/** W-CATCH3: the closing sentence about writes -- "Inget utfärdades." only when no write was attempted. */
function withWrites(detail: string, writes: ProvisioningWrites): string {
  if (!mayHaveWritten(writes)) return detail;
  const claim = ` ${NOTHING_ISSUED_SV}`;
  const base = detail.endsWith(claim) ? detail.slice(0, -claim.length) : detail === NOTHING_ISSUED_SV ? '' : detail;
  return base ? `${base} ${MAY_HAVE_WRITTEN_SV}` : MAY_HAVE_WRITTEN_SV;
}

/** Existing objects a provisioning worker reads before deciding to mint (stable lower-case subjects). */
const EXISTING_SUBJECT_SV: Readonly<Record<string, string>> = {
  'viewer-capability-issuer': 'Den befintliga utfärdaren av kartbehörigheter',
  'viewer-capability': 'Den befintliga kartbehörigheten (kapabiliteten)',
  'geometry-supersession-issuer': 'Den befintliga utfärdaren av lokaliseringsbyten',
  'geometry-supersession': 'Det befintliga lokaliseringsbytet',
  'temporal-authorization': 'Den befintliga tidsbehörigheten för körningen',
  'execution-identity': 'Den befintliga exekveringsidentiteten',
  'execution-identity-attestation': 'Exekveringsidentitetens befintliga attestering',
};

/**
 * W-CATCH3-R2 (OD-C3-2): an existing ISSUER is verified against the configured key, so a refusal can be
 * a damaged object OR a misconfigured verification key; the text names both (the system cannot tell).
 */
const ISSUER_SUBJECTS: ReadonlySet<string> = new Set(['viewer-capability-issuer', 'geometry-supersession-issuer']);
const ISSUER_REFUSED_CAUSES_SV = 'skadat objekt eller felkonfigurerad verifieringsnyckel';

/** Literal codes (so the error-code inventory sees each one): class -> code, per kind of subject. */
const CODES = {
  EXISTING: { READ_ERROR: 'EXISTING_ARTIFACT_READ_ERROR', REFUSED: 'EXISTING_ARTIFACT_REFUSED', LASTING: 'EXISTING_ARTIFACT_INTEGRITY_FAULT' },
  BINDING: { READ_ERROR: 'CURRENT_BINDING_READ_ERROR', REFUSED: 'CURRENT_BINDING_REFUSED', LASTING: 'CURRENT_BINDING_INTEGRITY_FAULT' },
  OTHER: { READ_ERROR: 'PROVISIONING_EXECUTION_ERROR', REFUSED: 'PROVISIONING_REFUSED', LASTING: 'PROVISIONING_STORAGE_INTEGRITY_FAULT' },
} as const;

function codeFor(kind: keyof typeof CODES, fault: ReadFault): string {
  if (fault.faultClass === 'READ_ERROR') return CODES[kind].READ_ERROR;
  if (fault.faultClass === 'REFUSED') return CODES[kind].REFUSED;
  return CODES[kind].LASTING;
}

/** The Swedish text of a read fault on a pinned or required input the worker needs (no raw text). */
export function provisioningReadFaultDetailSv(error: unknown, subjectSv: string): string {
  return `${readFaultSentenceSv(classifyReadFault(error), subjectSv)} Inget utfärdades.`;
}

export type ProvisioningFailureFields = {
  readonly failureCode: string;
  readonly failureDetail: string;
  /** Raw fault text for the server log only (never stored, never sent); absent for errors with their own code. */
  readonly diagnostic?: string;
};

export function provisioningFailure(error: unknown, writes: ProvisioningWrites): ProvisioningFailureFields {
  const diagnostic = error instanceof Error ? `${error.name}: ${error.message}${error.cause instanceof Error ? ` <- ${error.cause.name}: ${error.cause.message}` : ''}` : String(error);
  if (error instanceof LuReadFaultError) {
    const existing = EXISTING_SUBJECT_SV[error.subject];
    if (existing) {
      return {
        failureCode: codeFor('EXISTING', error),
        failureDetail: withWrites(
          `${readFaultSentenceSv(error, existing, ISSUER_SUBJECTS.has(error.subject) ? ISSUER_REFUSED_CAUSES_SV : undefined)} Inget utfärdades i dess ställe.`,
          writes,
        ),
        diagnostic,
      };
    }
    if (error.subject === 'current-binding') {
      return {
        failureCode: codeFor('BINDING', error),
        failureDetail: withWrites(`${readFaultSentenceSv(error, 'Projektets koppling till fastigheten')} ${NOTHING_ISSUED_SV}`, writes),
        diagnostic,
      };
    }
  }
  const ownCode = (error as { failureCode?: unknown } | null)?.failureCode;
  if (typeof ownCode === 'string') {
    // W-CATCH3-R2 (CATCH3 verifier Low 5): the stored text of an own code is Swedish; its ids and technical
    // detail travel as the internal diagnostic (log only).
    const ownDiagnostic = (error as { diagnostic?: unknown }).diagnostic;
    return {
      failureCode: ownCode,
      failureDetail: withWrites(error instanceof Error ? error.message : String(error), writes),
      ...(typeof ownDiagnostic === 'string' ? { diagnostic: ownDiagnostic } : {}),
    };
  }
  const fault = classifyReadFault(error);
  if (mayHaveWritten(writes)) {
    const contact = fault.retryable ? '' : ' Kontakta systemets administratör.';
    return {
      failureCode: codeFor('OTHER', fault),
      failureDetail: `Provisioneringen kunde inte slutföras på grund av ${AFTER_WRITE_CAUSE_SV[fault.faultClass]}. ${retrySentenceSv(fault.retryable)}${contact} ${MAY_HAVE_WRITTEN_SV}`,
      diagnostic,
    };
  }
  return {
    failureCode: codeFor('OTHER', fault),
    failureDetail: `Provisioneringen kunde inte slutföras. ${readFaultSentenceSv(fault, 'Ett underlag som behövs')} ${NOTHING_ISSUED_SV}`,
    diagnostic,
  };
}
