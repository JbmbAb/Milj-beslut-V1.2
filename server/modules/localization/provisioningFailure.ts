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
 */
import { classifyReadFault, LuReadFaultError, readFaultSentenceSv, type ReadFault } from './readFaultClassification';

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

export function provisioningFailure(error: unknown): ProvisioningFailureFields {
  const diagnostic = error instanceof Error ? `${error.name}: ${error.message}${error.cause instanceof Error ? ` <- ${error.cause.name}: ${error.cause.message}` : ''}` : String(error);
  if (error instanceof LuReadFaultError) {
    const existing = EXISTING_SUBJECT_SV[error.subject];
    if (existing) {
      return {
        failureCode: codeFor('EXISTING', error),
        failureDetail: `${readFaultSentenceSv(error, existing)} Inget utfärdades i dess ställe.`,
        diagnostic,
      };
    }
    if (error.subject === 'current-binding') {
      return {
        failureCode: codeFor('BINDING', error),
        failureDetail: `${readFaultSentenceSv(error, 'Projektets koppling till fastigheten')} Inget utfärdades.`,
        diagnostic,
      };
    }
  }
  const ownCode = (error as { failureCode?: unknown } | null)?.failureCode;
  if (typeof ownCode === 'string') {
    return { failureCode: ownCode, failureDetail: error instanceof Error ? error.message : String(error) };
  }
  const fault = classifyReadFault(error);
  return {
    failureCode: codeFor('OTHER', fault),
    failureDetail: `Provisioneringen kunde inte slutföras. ${readFaultSentenceSv(fault, 'Ett underlag som behövs')} Inget utfärdades.`,
    diagnostic,
  };
}
