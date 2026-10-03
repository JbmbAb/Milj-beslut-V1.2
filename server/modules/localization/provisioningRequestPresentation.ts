/**
 * W-CATCH3 (owner decision 2026-10-03: OLD provisioning rows' raw failureDetail is sanitised at
 * PRESENTATION -- no stored data changes, no schema change; CATCH2 verifier finding 11).
 *
 * The geometry view (localizationGeometryService.ts toView) sent a stored identity-provisioning or
 * geometry-supersession request's failureDetail as is. Rows written before W-CATCH2 hold raw storage
 * paths, provider text and SQL, and some fail() texts since still name artifact ids. A FAILED or
 * SUPERSEDED request is now shown by its STABLE failureCode -- the same principle as the bootstrap's
 * presentBootstrapRequestStatus: a neutral Swedish text, and a retry sentence ONLY where the code itself
 * determines whether a new attempt can help. An unknown (older) code or a row without a code promises
 * nothing. The stored text is never read here.
 */
import { retrySentenceSv } from './storageFaultClassification';

export type ProvisioningRequestKind = 'execution-identity' | 'geometry-supersession';

const LEAD_SV: Readonly<Record<ProvisioningRequestKind, string>> = {
  'execution-identity': 'Förberedelsen av analysen för kontrollpunkten slutfördes inte',
  'geometry-supersession': 'Bytet till den nya kontrollpunkten slutfördes inte',
};

/**
 * Every code the two workers store (provisioningFailure.ts and their own fail() codes), with its cause in
 * Swedish and whether a new attempt can help: true / false when the code determines it, null when the
 * same code is stored for faults of different classes (no promise either way).
 */
export const PROVISIONING_REQUEST_FAILURE_PRESENTATION: Readonly<Record<string, { readonly causeSv: string; readonly retryable: boolean | null }>> = {
  // provisioningFailure.ts: an existing object the worker found
  EXISTING_ARTIFACT_READ_ERROR: { causeSv: 'ett befintligt objekt som begäran bygger på kunde inte läsas (tekniskt fel).', retryable: true },
  EXISTING_ARTIFACT_INTEGRITY_FAULT: {
    causeSv: 'ett befintligt objekt som begäran bygger på saknas, är skadat eller är ett annat objekt än det som begärdes (bestående lagrings- eller integritetsfel).',
    retryable: false,
  },
  EXISTING_ARTIFACT_REFUSED: {
    causeSv: 'ett befintligt objekt som begäran bygger på underkändes vid verifieringen (skadat objekt eller felkonfigurerad verifieringsnyckel).',
    retryable: false,
  },
  // provisioningFailure.ts: the project's current binding
  CURRENT_BINDING_READ_ERROR: { causeSv: 'projektets koppling till fastigheten kunde inte läsas (tekniskt fel).', retryable: true },
  CURRENT_BINDING_INTEGRITY_FAULT: {
    causeSv: 'projektets koppling till fastigheten kunde inte läsas eller verifieras (bestående lagrings- eller integritetsfel).',
    retryable: false,
  },
  CURRENT_BINDING_REFUSED: { causeSv: 'projektets koppling till fastigheten underkändes vid verifieringen.', retryable: false },
  CURRENT_BINDING_UNAVAILABLE: { causeSv: 'projektet har ingen registrerad koppling till fastigheten.', retryable: false },
  // provisioningFailure.ts: anything else, by class
  PROVISIONING_EXECUTION_ERROR: { causeSv: 'ett tekniskt fel uppstod.', retryable: true },
  PROVISIONING_STORAGE_INTEGRITY_FAULT: { causeSv: 'ett bestående lagrings- eller integritetsfel uppstod.', retryable: false },
  PROVISIONING_REFUSED: { causeSv: 'ett steg underkändes vid verifieringen.', retryable: false },
  // both workers
  REQUESTER_NOT_AUTHORIZED: { causeSv: 'den som begärde ändringen har inte behörighet till projektet.', retryable: false },
  FRESH_VERIFICATION_FAILED: { causeSv: 'det nyss utfärdade objektet klarade inte den oberoende kontrollen.', retryable: true },
  // the execution-identity worker
  ISSUER_CONFIGURATION_MISSING: { causeSv: 'systemets utfärdare av exekveringsbehörighet är inte konfigurerad (konfigurationsfel).', retryable: false },
  TEMPORAL_AUTHORITY_CONFIGURATION_MISSING: { causeSv: 'systemets tidsbehörighet för körningar är inte konfigurerad (konfigurationsfel).', retryable: false },
  TEMPORAL_AUTHORITY_IDENTITY_MISMATCH: { causeSv: 'tidsbehörigheten för körningen fick inte den förväntade identiteten.', retryable: false },
  TEMPORAL_AUTHORITY_SIGNER_MISMATCH: { causeSv: 'den konfigurerade signeringsnyckeln hör inte till den verifierade utfärdaren (konfigurationsfel).', retryable: false },
  GEOMETRY_UNAVAILABLE_OR_TAMPERED: { causeSv: 'kontrollpunkten kunde inte läsas eller verifieras.', retryable: null },
  GEOMETRY_PROJECT_MISMATCH: { causeSv: 'kontrollpunkten hör till ett annat projekt.', retryable: false },
  GEOMETRY_PROPERTY_MISMATCH: { causeSv: 'kontrollpunkten är inte bunden till projektets aktuella fastighet.', retryable: false },
  CAPABILITY_UNAVAILABLE: { causeSv: 'analysfunktionen är inte registrerad i systemet (konfigurationsfel).', retryable: false },
  // the geometry-supersession worker
  PREDECESSOR_GEOMETRY_UNAVAILABLE: { causeSv: 'den tidigare kontrollpunkten kunde inte läsas eller verifieras.', retryable: null },
  PREDECESSOR_GEOMETRY_PROJECT_MISMATCH: { causeSv: 'den tidigare kontrollpunkten hör till ett annat projekt.', retryable: false },
  SUCCESSOR_GEOMETRY_UNAVAILABLE: { causeSv: 'den nya kontrollpunkten kunde inte läsas eller verifieras.', retryable: null },
  SUCCESSOR_GEOMETRY_PROJECT_MISMATCH: { causeSv: 'den nya kontrollpunkten hör till ett annat projekt.', retryable: false },
  CURRENT_GEOMETRY_UNAVAILABLE: { causeSv: 'projektet har ingen aktuell kontrollpunkt.', retryable: false },
  // the supersession queue's SUPERSEDED marking
  PREDECESSOR_NO_LONGER_CURRENT: {
    causeSv: 'en annan ändring av projektets kontrollpunkt hann före, så den här ändringen gäller inte längre.',
    retryable: null,
  },
};

/**
 * M1a's currentness classes reach a supersession row as LOCALIZATION_GEOMETRY_<class>; their own text
 * and retryable live in localizationGeometryCurrentness.ts (never re-derived here), so the row says
 * only what every class means and promises nothing.
 */
const CURRENTNESS_REASON_PREFIX = 'LOCALIZATION_GEOMETRY_';
const CURRENTNESS_CAUSE_SV = 'projektets aktuella kontrollpunkt kunde inte fastställas.';

/**
 * W-CATCH3-R2 (CATCH3 verifier Low 3): the explicit mark of a view this process built itself
 * (localizationGeometryService.ts unenqueuedRequest), whose text is neutral by construction. Before,
 * the ABSENCE of a failureCode field was that mark -- a stored record read without its failureCode
 * column (a future select, an inherited field) would have passed its raw text. A record never carries
 * this symbol.
 */
export const PROCESS_BUILT_REQUEST_VIEW: unique symbol = Symbol('lu.process-built-request-view');

/** A stored request, or a view this process built itself (marked PROCESS_BUILT_REQUEST_VIEW). */
export type ProvisioningRequestLike = {
  readonly status: string | null;
  readonly failureCode?: string | null;
  readonly failureDetail?: string | null;
  readonly [PROCESS_BUILT_REQUEST_VIEW]?: true;
};

/**
 * The text the geometry view shows for a request: null unless it FAILED or was SUPERSEDED; then the
 * neutral text of its OWN stored code (an inherited or missing field is no code) -- never the stored
 * failureDetail. Only a view marked PROCESS_BUILT_REQUEST_VIEW (exactly true) keeps its own text.
 */
export function presentProvisioningRequestDetail(kind: ProvisioningRequestKind, request: ProvisioningRequestLike | null | undefined): string | null {
  if (!request) return null;
  if (request[PROCESS_BUILT_REQUEST_VIEW] === true) return request.failureDetail ?? null;
  if (request.status !== 'FAILED' && request.status !== 'SUPERSEDED') return null;
  const lead = LEAD_SV[kind];
  const code = Object.prototype.hasOwnProperty.call(request, 'failureCode') ? request.failureCode : undefined;
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(PROVISIONING_REQUEST_FAILURE_PRESENTATION, code)) {
    const known = PROVISIONING_REQUEST_FAILURE_PRESENTATION[code]!;
    return known.retryable === null ? `${lead}: ${known.causeSv}` : `${lead}: ${known.causeSv} ${retrySentenceSv(known.retryable)}`;
  }
  if (typeof code === 'string' && code.startsWith(CURRENTNESS_REASON_PREFIX) && code.length > CURRENTNESS_REASON_PREFIX.length) {
    return `${lead}: ${CURRENTNESS_CAUSE_SV}`;
  }
  return `${lead} (okänd felkod). Felet beskrivs inte närmare här.`;
}
