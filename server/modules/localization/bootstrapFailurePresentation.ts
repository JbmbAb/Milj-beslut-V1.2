/**
 * W-CATCH2 #4 (owner decisions 2026-10-02/03): how a FAILED project-context bootstrap request is stored
 * and shown -- by its STABLE failureCode, never by stored free text.
 *
 * Before, the bootstrap's outer catch stored `error.message` as failureDetail for every error without
 * its own failureCode (raw storage paths, SQL, provider text) and GET .../bootstrap-status sent the row
 * as is. Now:
 *  - classifyBootstrapFailure gives such an error a stable code from the shared classification
 *    (readFaultClassification.ts) and the neutral Swedish text below; the raw text is only an internal
 *    `diagnostic` the worker logs (never stored, never sent);
 *  - presentBootstrapRequestStatus shows a FAILED request with the Swedish text of its code and a
 *    `retryable` derived DETERMINISTICALLY from that code -- also for rows stored before this change,
 *    whose failureDetail may still hold raw text. No schema change: `retryable` is never stored.
 * An unknown (older) code has no known class, so no retry is promised.
 */
import { retrySentenceSv } from './storageFaultClassification';
import { classifyReadFault } from './readFaultClassification';

/** A read of unknown persistence (or an unrecognised error) while bootstrapping -- the code it always had. */
export const BOOTSTRAP_EXECUTION_ERROR = 'BOOTSTRAP_EXECUTION_ERROR' as const;
/** A lasting storage or integrity fault (an object lost, corrupt or contradicted under a write-once id). */
export const BOOTSTRAP_STORAGE_INTEGRITY_FAULT = 'BOOTSTRAP_STORAGE_INTEGRITY_FAULT' as const;
/** A refusal (REJECT_*) met while bootstrapping. */
export const BOOTSTRAP_REFUSED = 'BOOTSTRAP_REFUSED' as const;

const PREFIX = 'Projektkontexten kunde inte etableras:';

/** Every code the bootstrap records, with its cause in Swedish and whether a new attempt can help. */
const BOOTSTRAP_FAILURE_PRESENTATION: Readonly<Record<string, { readonly causeSv: string; readonly retryable: boolean }>> = {
  PROJECT_NOT_FOUND: { causeSv: 'lokaliseringen hittades inte.', retryable: false },
  PROPERTY_MISMATCH: { causeSv: 'fastighetsbeteckningen i begäran stämmer inte med lokaliseringens egen fastighet.', retryable: false },
  NO_LEGITIMATE_OWNER: { causeSv: 'lokaliseringen saknar en behörig ägare.', retryable: false },
  PROPERTY_LOOKUP_NOT_EXACT: { causeSv: 'fastighetsbeteckningen gav ingen exakt träff i fastighetsunderlaget.', retryable: false },
  PROPERTY_LOOKUP_AMBIGUOUS: { causeSv: 'fastighetsbeteckningen matchar flera fastighetsytor i fastighetsunderlaget, och ingen fastighet valdes.', retryable: false },
  LOCAL_PROPERTY_NOT_FOUND: { causeSv: 'fastigheten hittades inte i fastighetsunderlaget.', retryable: false },
  PROPERTY_GEOMETRY_UNAVAILABLE: { causeSv: 'fastighetsunderlaget saknar gräns (geometri) för fastigheten.', retryable: false },
  PROPERTY_CENTROID_UNAVAILABLE: { causeSv: 'fastighetens mittpunkt kunde inte beräknas.', retryable: false },
  PROPERTY_PROVENANCE_INCOMPLETE: { causeSv: 'fastighetsunderlaget saknar uppgifter om fastighetsuppgiftens källa.', retryable: false },
  PROPERTY_MUNICIPALITY_UNAVAILABLE: { causeSv: 'fastighetsunderlaget saknar kommun för fastigheten.', retryable: false },
  FRESH_VERIFICATION_FAILED: { causeSv: 'den nyss skapade kopplingen klarade inte den oberoende kontrollen.', retryable: true },
  BOOTSTRAP_EXECUTION_ERROR: { causeSv: 'ett tekniskt fel uppstod.', retryable: true },
  BOOTSTRAP_STORAGE_INTEGRITY_FAULT: {
    causeSv: 'ett bestående lagrings- eller integritetsfel uppstod (ett sparat objekt saknas, är skadat eller motsäger ett annat).',
    retryable: false,
  },
  BOOTSTRAP_REFUSED: { causeSv: 'åtgärden underkändes vid verifieringen.', retryable: false },
  CURRENT_BINDING_READ_ERROR: { causeSv: 'projektets befintliga bindning kunde inte läsas (tekniskt fel). Ingen ny bindning skapades.', retryable: true },
  CURRENT_BINDING_INTEGRITY_FAULT: {
    causeSv:
      'projektets befintliga bindning kunde inte läsas eller verifieras, eller bindningsindexet är inkonsekvent (bestående integritetsfel). Ingen ny bindning skapades.',
    retryable: false,
  },
  CURRENT_BINDING_REFUSED: { causeSv: 'projektets befintliga bindning underkändes vid verifieringen. Ingen ny bindning skapades.', retryable: false },
};

const UNKNOWN_FAILURE_SV = 'Lokaliseringen kunde inte etableras (okänd felkod). Felet beskrivs inte närmare här.';

/** The Swedish text and `retryable` of a stored failure code (deterministic; unknown -> no retry promised). */
export function describeBootstrapFailureCode(failureCode: string | null | undefined): { readonly failureDetail: string; readonly retryable: boolean } {
  const known = failureCode && Object.prototype.hasOwnProperty.call(BOOTSTRAP_FAILURE_PRESENTATION, failureCode)
    ? BOOTSTRAP_FAILURE_PRESENTATION[failureCode]
    : undefined;
  if (!known) return { failureDetail: UNKNOWN_FAILURE_SV, retryable: false };
  return { failureDetail: `${PREFIX} ${known.causeSv} ${retrySentenceSv(known.retryable)}`, retryable: known.retryable };
}

/**
 * An error the bootstrap met that carries no failureCode of its own: a stable code by its class, the
 * neutral text of that code, and the raw text as an internal diagnostic (log only).
 */
export function classifyBootstrapFailure(error: unknown): {
  readonly failureCode: typeof BOOTSTRAP_EXECUTION_ERROR | typeof BOOTSTRAP_STORAGE_INTEGRITY_FAULT | typeof BOOTSTRAP_REFUSED;
  readonly failureDetail: string;
  readonly retryable: boolean;
  readonly diagnostic: string;
} {
  const fault = classifyReadFault(error);
  const failureCode =
    fault.faultClass === 'READ_ERROR' ? BOOTSTRAP_EXECUTION_ERROR : fault.faultClass === 'REFUSED' ? BOOTSTRAP_REFUSED : BOOTSTRAP_STORAGE_INTEGRITY_FAULT;
  const { failureDetail, retryable } = describeBootstrapFailureCode(failureCode);
  const diagnostic = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { failureCode, failureDetail, retryable, diagnostic };
}

/**
 * GET .../bootstrap-status: a FAILED request is shown by its stable code -- the Swedish text of the code
 * and a derived `retryable` -- never its stored failureDetail. Every other status is returned unchanged.
 */
export function presentBootstrapRequestStatus<T extends { readonly status: string; readonly failureCode: string | null; readonly failureDetail: string | null }>(
  record: T,
): T | (T & { readonly retryable: boolean }) {
  if (record.status !== 'FAILED') return record;
  const { failureDetail, retryable } = describeBootstrapFailureCode(record.failureCode);
  return { ...record, failureDetail, retryable };
}
