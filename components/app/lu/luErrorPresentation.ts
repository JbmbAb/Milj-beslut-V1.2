/**
 * DEMO M2b (LU product demonstrator) -- plain-Swedish presentation of a failed API call.
 *
 * Presentation only: nothing here changes what the server decided. The main text the user sees is
 * always Swedish and written here; the server's own text, HTTP status and machine codes (code /
 * failureClass / reasonCode) are kept as rows for a collapsed "Teknisk information" section.
 *
 * What the classification reads, in this order:
 *   1. the structured fields `services/coreApiClient.ts` attaches to a thrown Error (status, code,
 *      failureClass, reasonCode), read by duck typing so a mocked client still works;
 *   2. a small set of exact server messages that carry no code yet (listed below -- these are the
 *      real strings of server/modules/localization/localizationOrchestrator.ts and
 *      resolveGovernedLocalizationPresentation.ts; a server-side code would be the better contract);
 *   3. the HTTP status class.
 *
 * W-M2d item 5: every machine code the LU server can send (localization routes, orchestrator,
 * currentness classes, read-back integrity, verify, property lookup) has its own Swedish text and
 * kind below -- including LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED per failure class, whose server
 * message (FAILURE_POLICY.messageSv) is kept under "Teknisk information" only, because one of them
 * claims more than M1a's KNOWN_LIMITATION allows ("En äldre punkt används aldrig i stället").
 *
 * W-UI1 (owner decision 2, 2026-10-03): "Försök igen" is offered ONLY when the server's answer says
 * `retryable: true` -- never by a code list in the client, never from the HTTP status. The UI can only keep
 * the button away where its own text says the fault is lasting or a refusal (the text and the button must
 * agree). An answer without the flag gets no button; only a request that got no answer at all (network) or
 * a UI-side message may be tried again, since no server decided anything. The 424 record-integrity body's
 * `record_integrity` is shown only as an unverified, non-authoritative diagnostic (luRecordIntegrity.ts).
 */

import { parseLuRecordIntegrityDiagnostic, type LuRecordIntegrityView } from './luRecordIntegrity';

export type LuErrorContext =
  | 'current-assessment'
  | 'viewer-evidence'
  | 'run'
  | 'geometry-load'
  | 'geometry-save'
  | 'geometry-retry'
  | 'export'
  | 'verify'
  | 'property-lookup'
  | 'property-search'
  | 'project-create'
  | 'bootstrap-retry';

/**
 * TECHNICAL  -- the system could not answer (network, 5xx, not yet provisioned): may work on retry.
 * REFUSED    -- a deliberate governance refusal (e.g. ambiguous localization): not a data answer.
 * NOT_FOUND  -- the thing asked for does not exist (yet).
 * UNAUTHORIZED -- session or project access.
 * INTEGRITY  -- stored material failed verification (tamper, binding, contract version).
 * INCOHERENT -- two sources that must describe the same assessment do not.
 */
export type LuErrorKind = 'TECHNICAL' | 'REFUSED' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'INTEGRITY' | 'INCOHERENT';

export interface LuErrorDetailRow {
  readonly label: string;
  readonly value: string;
}

export interface LuErrorPresentation {
  readonly kind: LuErrorKind;
  /** Swedish, user-facing. Never contains the server's raw text. */
  readonly messageSv: string;
  /** W-UI1: true only when the server says `retryable: true` (or no server answered at all). */
  readonly retryable: boolean;
  /** For the collapsed "Teknisk information": status, codes and the server's own text. */
  readonly technical: readonly LuErrorDetailRow[];
  /**
   * W-UI1 (B): the 424 ASSESSMENT_RECORD_INTEGRITY_ERROR's stored findings, ONLY as an unverified,
   * non-authoritative diagnostic (shown collapsed); absent for every other answer.
   */
  readonly diagnostic?: LuRecordIntegrityView;
}

/** A client-side error whose message is already plain Swedish written by this UI. */
export class LuClientError extends Error {
  readonly luClientError = true as const;
  constructor(messageSv: string) {
    super(messageSv);
    this.name = 'LuClientError';
  }
}

/** Exact server strings without a machine code (see module comment). */
export const LU_SERVER_MESSAGE = {
  NO_CURRENT_ASSESSMENT: 'No current governed LU assessment is available for this project.',
  VIEWER_CAPABILITY_NOT_CONFIGURED: 'Governed viewer capability is not configured for this project.',
  ASSESSMENT_TAMPER: 'Governed LU assessment failed tamper verification.',
  ASSESSMENT_NOT_BOUND: 'Governed LU assessment is not bound to this project.',
  NOT_AUTHORIZED: 'Not authorized for this project.',
  PRESENTATION_REJECT_PREFIX: 'REJECT_LOCALIZATION_PRESENTATION',
  /** localizationGeometryService.ts: 404 `No canonical project context available: <raw text>` (W-M2e item 2). */
  NO_CANONICAL_PROJECT_CONTEXT_PREFIX: 'No canonical project context available:',
  /**
   * W-UI1 (M2e verification finding 5): server/security/csrf.ts answers every LU POST with a stale or missing
   * CSRF token with 403 and this text (no code) -- it is no project permission.
   */
  CSRF_REJECTED: 'Möjlig Cross-Site Request Forgery attack blockerad. Ogiltig eller saknad CSRF-token.',
} as const;

/**
 * W-UI1-R2 (M2e verification finding 5): the 401 texts the server sends (server/security/auth.ts requireAuth and
 * getUserFromAccessToken, server/security/secureErrors.ts). Only these exact texts name a cause; any other 401
 * gets the neutral line (the UI cannot know whether the session expired).
 */
const UNAUTHORIZED_SV: Readonly<Record<string, string>> = {
  'Missing bearer token': 'Du är inte inloggad – logga in för att fortsätta.',
  'Token expired': 'Sessionen har gått ut – logga in igen.',
  'Session expired': 'Sessionen har gått ut – logga in igen.',
  'Token has been revoked or session terminated': 'Sessionen har avslutats – logga in igen.',
};
const UNAUTHORIZED_NEUTRAL_SV = 'Inloggningen kunde inte bekräftas – logga in igen.';

function unauthorizedSv(message: string): string {
  return Object.prototype.hasOwnProperty.call(UNAUTHORIZED_SV, message) ? UNAUTHORIZED_SV[message]! : UNAUTHORIZED_NEUTRAL_SV;
}

const CONTEXT_LEAD: Readonly<Record<LuErrorContext, string>> = {
  'current-assessment': 'Den sparade bedömningen kunde inte läsas.',
  // W-M2d item 1: the viewer evidence feeds only the MAP; the control panel reads the assessment.
  'viewer-evidence': 'Kontrollresultaten kunde inte hämtas till kartan.',
  run: 'Bedömningen kunde inte köras.',
  'geometry-load': 'Kontrollpunkten kunde inte hämtas.',
  'geometry-save': 'Kontrollpunkten kunde inte sparas.',
  'geometry-retry': 'Förberedelsen av analysen kunde inte startas om.',
  export: 'Rapporten kunde inte exporteras.',
  // W-M2d item 4: verify is a reproducibility (replay) check, never a proof of authenticity.
  verify: 'Reproducerbarhetskontrollen kunde inte genomföras.',
  'property-lookup': 'Fastigheten kunde inte slås upp.',
  'property-search': 'Fastighetssökningen misslyckades.',
  'project-create': 'Lokaliseringen kunde inte skapas.',
  'bootstrap-retry': 'Det gick inte att försöka igen.',
};

const NOT_FOUND_TEXT: Readonly<Partial<Record<LuErrorContext, string>>> = {
  'current-assessment': 'Det finns ingen sparad bedömning för kontrollpunkten ännu.',
  export: 'Det finns ingen sparad bedömning att exportera.',
  verify: 'Det finns ingen sparad bedömning att kontrollera.',
};

/**
 * DEMO M2c item 3 (M2b verifier finding 3): the control results are only fetched for an assessment
 * that IS displayed, so a 404 there contradicts the view -- it is never "there is no assessment".
 * It is an incoherence between two answers and is retried by reading the assessment again.
 */
const VIEWER_EVIDENCE_NO_CURRENT =
  'Kontrollresultaten kunde inte hämtas till kartan: servern anger att projektet inte längre har någon aktuell bedömning, men en bedömning visas här. Läs in bedömningen på nytt.';
const VIEWER_EVIDENCE_NOT_FOUND =
  'Kontrollresultaten kunde inte hämtas till kartan: servern hittade inga kontrollresultat för den visade bedömningen. Försök igen eller läs in bedömningen på nytt.';

interface ErrorFields {
  readonly status: number | null;
  readonly code: string | null;
  readonly failureClass: string | null;
  readonly reasonCode: string | null;
  /** W-M2d item 5: the server's own `retryable` flag, when the answer carries one. */
  readonly retryable: boolean | null;
  readonly message: string;
  readonly isClientError: boolean;
  /** W-UI1: the 424 record-integrity envelope the API client keeps (own property only), unparsed. */
  readonly recordIntegrity: unknown;
}

/**
 * W-UI1-R2 (UI1-VERIFICATION finding 4): every field is an OWN data property of the error -- an inherited value
 * (a polluted Object.prototype.retryable, say) or a getter is never read.
 */
function readFields(err: unknown): ErrorFields {
  const field = (key: string): unknown => {
    if (err === null || typeof err !== 'object') return undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(err, key);
      return descriptor && 'value' in descriptor ? descriptor.value : undefined;
    } catch {
      return undefined;
    }
  };
  const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const status = field('status');
  const retryable = field('retryable');
  const message = field('message');
  return {
    status: typeof status === 'number' && Number.isFinite(status) ? status : null,
    code: s(field('code')),
    failureClass: s(field('failureClass')),
    reasonCode: s(field('reasonCode')),
    retryable: typeof retryable === 'boolean' ? retryable : null,
    message: typeof err === 'string' ? err : typeof message === 'string' ? message : '',
    isClientError: field('luClientError') === true,
    recordIntegrity: field('record_integrity'),
  };
}

function technicalRows(f: ErrorFields): LuErrorDetailRow[] {
  const rows: LuErrorDetailRow[] = [];
  if (f.status !== null) rows.push({ label: 'HTTP-status', value: String(f.status) });
  if (f.code) rows.push({ label: 'Felkod', value: f.code });
  if (f.failureClass) rows.push({ label: 'Felklass', value: f.failureClass });
  if (f.reasonCode) rows.push({ label: 'Orsakskod', value: f.reasonCode });
  if (f.retryable !== null) rows.push({ label: 'Nytt försök kan lyckas', value: f.retryable ? 'ja' : 'nej' });
  if (f.message) rows.push({ label: f.status !== null ? 'Serverns meddelande' : 'Felmeddelande', value: f.message });
  return rows;
}

/**
 * One Swedish text of this UI. W-UI1: `retryable` says whether the TEXT allows a new attempt -- false when
 * the text calls the fault lasting or a refusal. It never turns "Försök igen" on by itself: only the
 * server's `retryable: true` does, and only where the text allows it.
 */
type CodeText = { readonly kind: LuErrorKind; readonly messageSv: string; readonly retryable: boolean };

/**
 * W-M2d item 5 / item 9: LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED per failure class
 * (server/modules/localization/localizationGeometryCurrentness.ts FAILURE_POLICY). Same meaning as the
 * server's text, in this UI's words ("kontrollpunkt"), and without claims stronger than M1a's
 * KNOWN_LIMITATION (currentness is fail-closed for detectable faults only).
 */
const CURRENTNESS_TEXT: Readonly<Record<string, CodeText>> = {
  AMBIGUOUS_CURRENT_GEOMETRY: {
    kind: 'REFUSED',
    messageSv: 'Projektet har flera möjliga aktuella kontrollpunkter. Ingen bedömning görs förrän det är utrett vilken punkt som gäller.',
    retryable: false,
  },
  INVALID_SUPERSESSION_GRAPH: {
    kind: 'REFUSED',
    messageSv: 'Projektets historik över kontrollpunkter är inkonsekvent (ogiltig ersättningskedja). Ingen bedömning görs.',
    retryable: false,
  },
  NO_VERIFIED_GEOMETRY_CANDIDATE: {
    kind: 'REFUSED',
    messageSv: 'Projektets sparade kontrollpunkt kunde inte bekräftas mot arkivet. Ingen punkt härleds automatiskt och ingen bedömning görs.',
    retryable: false,
  },
  CURRENT_GEOMETRY_UNVERIFIED: {
    kind: 'REFUSED',
    messageSv:
      'Projektets aktuella kontrollpunkt kunde inte bekräftas: den saknas eller är skadad i arkivet, har ändrats i efterhand eller ' +
      'stämmer inte med projektets fastighet. En äldre punkt används inte i stället och ingen punkt härleds automatiskt. Ingen bedömning görs.',
    retryable: false,
  },
  INVALID_GEOMETRY_HEAD: {
    kind: 'REFUSED',
    messageSv: 'Projektets kontrollpunkt är ogiltig och kan inte användas. Ingen bedömning görs.',
    retryable: false,
  },
  VERIFIER_CONFIGURATION: {
    kind: 'TECHNICAL',
    messageSv:
      'Projektets byten av kontrollpunkt kunde inte bekräftas med systemets verifieringsnyckel. Det är antingen ett konfigurationsfel i ' +
      'systemet eller en utfärdare som inte är betrodd; systemet kan inte avgöra vilket. Felet försvinner inte vid ett nytt försök. ' +
      'Ingen bedömning görs – kontakta systemets administratör.',
    retryable: false,
  },
  DERIVED_GEOMETRY_PERSISTENCE_FAILED: {
    kind: 'TECHNICAL',
    messageSv: 'Den automatiskt beräknade kontrollpunkten kunde inte sparas. Ingen bedömning görs. Ett nytt försök kan lyckas om felet var tillfälligt.',
    retryable: true,
  },
  CURRENTNESS_STORAGE_INTEGRITY_FAULT: {
    kind: 'INTEGRITY',
    messageSv:
      'Aktuell kontrollpunkt kunde inte fastställas: ett sparat objekt som kontrollpunkten bygger på saknas i arkivet eller har en skadad ' +
      'indexpost. Det är ett bestående lagringsfel som inte försvinner vid ett nytt försök. Ingen bedömning görs – kontakta systemets administratör.',
    retryable: false,
  },
  CURRENTNESS_RESOLUTION_ERROR: {
    kind: 'TECHNICAL',
    messageSv: 'Aktuell kontrollpunkt kunde inte fastställas på grund av ett tekniskt fel. Ingen bedömning görs. Ett nytt försök kan lyckas.',
    retryable: true,
  },
};

/** W-UI1: may "Försök igen" be offered -- the server said so, and the shown text does not call the fault lasting. */
function serverAllowsRetry(serverRetryable: unknown, text: CodeText): boolean {
  return serverRetryable === true && text.retryable && text.kind !== 'REFUSED' && text.kind !== 'INTEGRITY';
}

/**
 * W-M2d item 5: the Swedish text of a currentness failure CLASS, for answers that carry it outside an
 * HTTP error -- generate-report's executionMotor.localization_geometry { failure_class, retryable }
 * (a FAILED_CLOSED provenance record). null for a class this UI does not know.
 * W-UI1: `retryable` is the server's flag (false where the text calls the fault lasting), or null when the
 * record carries none -- then nothing is said about a new attempt.
 */
export function presentCurrentnessFailureClass(
  failureClass: unknown,
  serverRetryable: unknown,
): { readonly messageSv: string; readonly retryable: boolean | null } | null {
  const entry = typeof failureClass === 'string' ? own(CURRENTNESS_TEXT, failureClass) : undefined;
  if (!entry) return null;
  return {
    messageSv: entry.messageSv,
    retryable: typeof serverRetryable === 'boolean' ? serverAllowsRetry(serverRetryable, entry) : null,
  };
}

/** W-M2d item 6: an exact designation the property data holds on more than one row (PROPERTY_LOOKUP_AMBIGUOUS). */
export const PROPERTY_LOOKUP_AMBIGUOUS_SV =
  'Fastigheten kan inte analyseras ännu: beteckningen är inte unik i fastighetsunderlaget. Det är en känd begränsning i underlaget, inte ett fel i din sökning.';

/**
 * W-M2e item 1 (M2d verification finding 1): the Swedish reason of a run that produced no assessment,
 * from generate-report's executionMotor.reason_codes (a code the run record names itself). Only codes
 * with a text of their own are listed; any other reason keeps the status line ("körning misslyckades").
 * REJECT_SPATIAL_EVIDENCE_FORM (server/modules/localization/governedSpatialEvidenceForm.ts): the
 * provider's answer was outside the common normal form and stopped the run BEFORE the rule engine --
 * no assessment, no verdict. The record carries no retry flag, so nothing is said about a new attempt.
 */
const RUN_REASON_TEXT: Readonly<Record<string, string>> = {
  REJECT_SPATIAL_EVIDENCE_FORM: 'Underlaget från en datakälla hade en oväntad form och avvisades innan bedömningsreglerna tillämpades',
};

/**
 * W-M2e item 2 (coordinator, U20CDF3): the violation the spatial evidence gate names as the second
 * reason code (governedSpatialEvidenceForm.ts SpatialQueryOutcomeViolation), said neutrally -- what
 * was wrong with the form, not who caused it. A violation this UI does not know adds nothing.
 */
const SPATIAL_FORM_VIOLATION_SV: Readonly<Record<string, string>> = {
  DATASET_MISSING: 'en evidens saknar lagernamn',
  RESULT_MISSING: 'resultat saknas i evidensen',
  RESULT_KIND_NOT_ADMITTED: 'evidensen anger en resultattyp som inte är tillåten',
  EXISTS_NOT_BOOLEAN: 'träffuppgiften är inte ett sant/falskt-värde',
  MATCH_COUNT_NOT_A_COUNT: 'antalet träffar är inget giltigt antal',
  MATCH_COUNT_CONTRADICTS_EXISTS: 'antalet träffar motsäger träffuppgiften',
  RESULT_FIELD_NOT_ADMITTED: 'resultatet innehåller fält utanför kontraktet',
  MAX_FEATURES_NOT_A_COUNT: 'träfftaket är inget giltigt antal',
  MATCH_COUNT_EXCEEDS_MAX_FEATURES: 'antalet träffar överstiger träfftaket',
  UNAVAILABLE_WITHOUT_DATASET: 'en uppgift om otillgängligt lager saknar lagernamn',
  EVIDENCE_AND_UNAVAILABLE: 'samma lager redovisas både med evidens och som otillgängligt',
  DATASET_NOT_REQUESTED: 'svaret gäller ett lager som inte efterfrågades',
  DUPLICATE_LAYER_OUTCOME: 'samma lager redovisas mer än en gång',
  LAYER_NOT_ANSWERED: 'ett efterfrågat lager redovisas varken med evidens eller som otillgängligt',
};

/** A run's / an assessment's governed status (executionMotor.assessment_status), in Swedish. */
const ASSESSMENT_STATUS_LABEL: Readonly<Record<string, string>> = {
  ASSESSED: 'Bedömd',
  NOT_ASSESSED: 'Ej bedömd',
  GOVERNANCE_DENIED: 'Ej bedömd – nekad av styrning',
  EXECUTION_FAILED: 'Ej bedömd – körning misslyckades',
  // W-UI1 (U20CDF4 beslut 1+3; U20CDF4 verification L6.1): the run stored a record, but its integrity is not
  // established -- no verdict, never ranked, never shown as a valid assessment.
  RECORD_INTEGRITY_ERROR: 'Ingen giltig bedömning – postens integritet kan inte intygas',
};

/** W-M2e item 2 (moved from LuWorkspace.tsx; own entries only): the status label, or "Okänd status". */
export function presentLuAssessmentStatus(status: unknown): string {
  return (typeof status === 'string' ? own(ASSESSMENT_STATUS_LABEL, status) : undefined) ?? 'Okänd status';
}

/** W-M2e item 2 (inventory): the statuses with a label of their own. */
export const LU_ASSESSMENT_STATUS_TEXTS: readonly string[] = Object.freeze(Object.keys(ASSESSMENT_STATUS_LABEL));

/** W-M2e item 2 (inventory): run reason codes and spatial-form violations with a text of their own. */
export const LU_RUN_REASON_TEXTS: readonly string[] = Object.freeze(Object.keys(RUN_REASON_TEXT));
export const LU_SPATIAL_FORM_VIOLATION_TEXTS: readonly string[] = Object.freeze(Object.keys(SPATIAL_FORM_VIOLATION_SV));

/** W-M2e item 1: the first reason code of a run record that has a Swedish text here, or null. */
export function presentLuRunReason(reasonCodes: unknown): { readonly code: string; readonly messageSv: string } | null {
  if (!Array.isArray(reasonCodes)) return null;
  const index = reasonCodes.findIndex((code) => typeof code === 'string' && own(RUN_REASON_TEXT, code) !== undefined);
  if (index < 0) return null;
  const code = reasonCodes[index] as string;
  const next = reasonCodes[index + 1];
  const violation = code === 'REJECT_SPATIAL_EVIDENCE_FORM' && typeof next === 'string' ? own(SPATIAL_FORM_VIOLATION_SV, next) : undefined;
  return { code, messageSv: `${own(RUN_REASON_TEXT, code)!}${violation ? ` (${violation})` : ''}. Ingen bedömning skapades.` };
}

/**
 * W-M2d items 5 + 6, W-M2e item 2 (moved here from PropertyFirstLuEntry.tsx so the inventory test
 * reads it): every failure code the project-context bootstrap worker records
 * (server/modules/localization/luProjectContextBootstrap.ts, PropertyLookupAmbiguousError,
 * W-BOOT projectContextBootstrapBindingGate.ts, W-CATCH2 bootstrapFailurePresentation.ts) with a Swedish
 * reason. Nothing beyond what the code says is claimed, and no action is invented.
 * W-UI1 (owner decision 2; CATCH2-VERIFICATION finding 10): whether "Försök igen" is offered is NOT decided
 * here any more -- bootstrap-status presents a FAILED request with the server's `retryable`
 * (presentBootstrapRequestStatus), and presentBootstrapFailure follows it.
 */
const BOOTSTRAP_FAILURE: Readonly<Record<string, { readonly reasonSv: string; readonly lasting?: true }>> = {
  PROPERTY_LOOKUP_AMBIGUOUS: { reasonSv: PROPERTY_LOOKUP_AMBIGUOUS_SV },
  PROPERTY_LOOKUP_NOT_EXACT: {
    reasonSv: 'Fastighetsbeteckningen gav ingen exakt träff i fastighetsunderlaget, så fastigheten kan inte knytas till lokaliseringen.',
  },
  PROPERTY_GEOMETRY_UNAVAILABLE: { reasonSv: 'Fastighetsunderlaget saknar gräns (geometri) för fastigheten.' },
  PROPERTY_CENTROID_UNAVAILABLE: { reasonSv: 'Fastighetens mittpunkt kunde inte beräknas.' },
  PROPERTY_PROVENANCE_INCOMPLETE: {
    reasonSv: 'Fastighetsunderlaget saknar uppgifter om fastighetsuppgiftens källa (källa, nyckel eller uppdateringsdatum).',
  },
  PROPERTY_MUNICIPALITY_UNAVAILABLE: { reasonSv: 'Fastighetsunderlaget saknar kommun för fastigheten.' },
  // W-M2e item 2: the request named another property than the localization's own.
  PROPERTY_MISMATCH: { reasonSv: 'Fastighetsbeteckningen i begäran stämmer inte med lokaliseringens egen fastighet.' },
  PROJECT_NOT_FOUND: { reasonSv: 'Lokaliseringen hittades inte.' },
  NO_LEGITIMATE_OWNER: { reasonSv: 'Lokaliseringen saknar en behörig ägare och kan därför inte förberedas.' },
  // W-UI1: the bootstrap's own lookup found no such property in the local property data (W-CATCH2 #15).
  LOCAL_PROPERTY_NOT_FOUND: { reasonSv: 'Fastigheten hittades inte i fastighetsunderlaget.' },
  FRESH_VERIFICATION_FAILED: {
    reasonSv: 'Den nyss skapade kopplingen mellan lokaliseringen och fastigheten klarade inte kontrollen.',
  },
  BOOTSTRAP_EXECUTION_ERROR: { reasonSv: 'Ett tekniskt fel uppstod när fastigheten skulle knytas till lokaliseringen.' },
  // W-UI1 (W-CATCH2 #4): a lasting storage or integrity fault, or a refusal, met outside the binding gate.
  BOOTSTRAP_STORAGE_INTEGRITY_FAULT: {
    reasonSv:
      'Ett sparat objekt som kopplingen bygger på saknas, är skadat eller motsäger ett annat (bestående lagrings- eller integritetsfel). ' +
      'Ingen koppling skapades.',
    lasting: true,
  },
  BOOTSTRAP_REFUSED: {
    reasonSv: 'Ett steg i kopplingen av fastigheten till lokaliseringen underkändes vid kontrollen. Ingen koppling skapades.',
    lasting: true,
  },
  // W-M2e item 2 (W-BOOT ca2bfdbb): the localization already has a registered binding that could not be
  // read or verified -- the worker created no new one in its place (OD-R1/OD-R2).
  CURRENT_BINDING_READ_ERROR: {
    reasonSv:
      'Lokaliseringens befintliga koppling till fastigheten kunde inte läsas på grund av ett tekniskt fel. Ingen ny koppling skapades i dess ställe.',
  },
  CURRENT_BINDING_INTEGRITY_FAULT: {
    reasonSv:
      'Lokaliseringens befintliga koppling till fastigheten kunde inte läsas eller bekräftas (bestående lagrings- eller integritetsfel). ' +
      'Ingen ny koppling skapades i dess ställe.',
    lasting: true,
  },
  CURRENT_BINDING_REFUSED: {
    reasonSv: 'Lokaliseringens befintliga koppling till fastigheten underkändes vid kontrollen. Ingen ny koppling skapades i dess ställe.',
    lasting: true,
  },
};

/** W-M2e item 2 (inventory): bootstrap failure codes with a text of their own. */
export const LU_BOOTSTRAP_FAILURE_TEXTS: readonly string[] = Object.freeze(Object.keys(BOOTSTRAP_FAILURE));

const BOOTSTRAP_UNKNOWN_REASON_SV = 'Fastigheten kunde inte knytas till lokaliseringen.';

/**
 * The Swedish reason of a bootstrap failure code. W-UI1 (M2e verification finding 5): an unknown code claims
 * no cause -- not even one whose name says NOT_FOUND.
 */
export function describeBootstrapFailure(failureCode: string | null): { readonly reasonSv: string } {
  return { reasonSv: own(BOOTSTRAP_FAILURE, failureCode)?.reasonSv ?? BOOTSTRAP_UNKNOWN_REASON_SV };
}

export interface LuBootstrapFailureView {
  readonly reasonSv: string;
  /** Only the server's `retryable: true` on bootstrap-status (own property) offers "Försök igen". */
  readonly retryable: boolean;
  /** What the failure means for the localization, by the server's flag. */
  readonly consequenceSv: string;
}

/**
 * W-UI1 (owner decision 2): a FAILED bootstrap request as GET .../bootstrap-status presents it -- the reason
 * by its code, "Försök igen" exactly when the server sends `retryable: true` (BOOTSTRAP_STORAGE_INTEGRITY_FAULT
 * and BOOTSTRAP_REFUSED: retryable false), nothing promised when it sends no flag.
 */
export function presentBootstrapFailure(status: unknown): LuBootstrapFailureView {
  const record = status !== null && typeof status === 'object' && !Array.isArray(status) ? (status as Record<string, unknown>) : null;
  const ownValue = (key: string) => (record && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined);
  const code = ownValue('failureCode');
  const flag = ownValue('retryable');
  // W-UI1-R2 (UI1-VERIFICATION finding 4): a reason the text calls lasting or a refusal is never retried, whatever
  // the flag says -- the text and the button agree, as in presentLuError.
  const lasting = own(BOOTSTRAP_FAILURE, typeof code === 'string' ? code : null)?.lasting === true;
  const retryable = flag === true && !lasting;
  return {
    reasonSv: describeBootstrapFailure(typeof code === 'string' ? code : null).reasonSv,
    retryable,
    consequenceSv:
      retryable
        ? 'Lokaliseringen är skapad, men fastigheten är ännu inte knuten till den. Ingen bedömning kan göras förrän det lyckas.'
        : flag === false || lasting
          ? 'Lokaliseringen är skapad, men fastigheten kan inte knytas till den. Ingen bedömning kan göras.'
          : 'Lokaliseringen är skapad, men fastigheten är inte knuten till den. Ingen bedömning kan göras.',
  };
}

/** U20-D/U20CDF: the read-back's own bound point could not be verified (ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED). */
const ASSESSED_POINT_TEXT: Readonly<Record<string, CodeText>> = {
  LOCALIZATION_GEOMETRY_MISSING: {
    kind: 'INTEGRITY',
    messageSv: 'Bedömningens kontrollpunkt saknas i arkivet och kan inte bekräftas. Bedömningen visas därför inte.',
    retryable: false,
  },
  LOCALIZATION_GEOMETRY_TAMPERED: {
    kind: 'INTEGRITY',
    messageSv: 'Bedömningens kontrollpunkt stämmer inte med sin lagrade identitet. Bedömningen visas därför inte.',
    retryable: false,
  },
  LOCALIZATION_GEOMETRY_NOT_BOUND: {
    kind: 'INTEGRITY',
    messageSv: 'Bedömningens kontrollpunkt hör inte till det här projektet eller den här fastigheten. Bedömningen visas därför inte.',
    retryable: false,
  },
  LOCALIZATION_GEOMETRY_READ_ERROR: {
    kind: 'TECHNICAL',
    messageSv: 'Bedömningens kontrollpunkt kunde inte läsas på grund av ett tekniskt fel. Bedömningen visas inte just nu; ett nytt försök kan lyckas.',
    retryable: true,
  },
};

/**
 * U20CDF2 add-on 2 / W-APR (5b06336e): 503 ASSESSMENT_READ_ERROR per failure class. The server's own
 * text says "En äldre bedömning visas aldrig i stället" -- a guarantee wider than this fault; the UI
 * says only what holds for it.
 */
const ASSESSMENT_READ_TEXT: Readonly<Record<string, CodeText>> = {
  ASSESSMENT_READ_ERROR: {
    kind: 'TECHNICAL',
    messageSv:
      'Projektets sparade bedömning kunde inte läsas på grund av ett tekniskt fel. Den saknas inte, men kan inte visas just nu. ' +
      'En äldre bedömning visas inte i stället. Ett nytt försök kan lyckas.',
    retryable: true,
  },
  ASSESSMENT_STORAGE_INTEGRITY_FAULT: {
    kind: 'INTEGRITY',
    messageSv:
      'Projektets aktuella bedömning kan inte fastställas: en sparad bedömning kunde inte läsas eller bekräftas ur arkivet ' +
      '(bestående lagrings- eller integritetsfel). En äldre bedömning visas inte i stället. Felet försvinner inte vid ett nytt försök.',
    retryable: false,
  },
  ASSESSMENT_RESOLUTION_ERROR: {
    kind: 'TECHNICAL',
    messageSv:
      'Projektets aktuella bedömning kunde inte fastställas på grund av ett tekniskt fel. En äldre bedömning visas inte i stället. ' +
      'Ett nytt försök kan lyckas.',
    retryable: true,
  },
};

/**
 * W-M2e item 1 (M2d verification finding 1; W-APR add-on 3, localizationOrchestrator.ts
 * assessmentResolutionFailure): the selection of the current assessment was REFUSED -- 409
 * ASSESSMENT_CURRENT_UNRESOLVED per failure class. None is a contradiction in the data ("motstridigt
 * underlag"), and none is retryable (the server sends retryable:false). The server's own texts say
 * "aldrig"; this UI says only what holds for the fault (M1a/APR KNOWN_LIMITATION), and adds no
 * authenticity language -- the binding "failed its check", nothing more.
 */
const SELECTION_REFUSAL_TEXT: Readonly<Record<string, CodeText>> = {
  CURRENT_BINDING_REFUSED: {
    // The stored binding of the project failed verification: stored material, like a tamper case.
    kind: 'INTEGRITY',
    messageSv:
      'Projektets aktuella bedömning kan inte fastställas: projektets aktuella bindning till fastigheten underkändes vid kontrollen. ' +
      'Ingen bedömning visas, och en äldre bedömning visas inte i stället. Felet försvinner inte vid ett nytt försök – kontakta systemets administratör.',
    retryable: false,
  },
  ASSESSMENT_CURRENT_AMBIGUOUS: {
    kind: 'REFUSED',
    messageSv:
      'Projektets aktuella bedömning kan inte fastställas: det finns flera giltiga bedömningar för den aktuella kontrollpunkten, och ingen av dem ' +
      'är utpekad som den aktuella. Ingen av dem visas som aktuell. Ett nytt försök ändrar inte detta.',
    retryable: false,
  },
  ASSESSMENT_SELECTION_REFUSED: {
    kind: 'REFUSED',
    messageSv:
      'Projektets aktuella bedömning kan inte fastställas: valet av aktuell bedömning nekades. Ingen bedömning visas, och en äldre bedömning ' +
      'visas inte i stället. Ett nytt försök ändrar inte detta.',
    retryable: false,
  },
};

/** W-M2e item 1: ASSESSMENT_CURRENT_UNRESOLVED with a class this UI does not know (still a refusal). */
const SELECTION_REFUSAL_DEFAULT: CodeText = {
  kind: 'REFUSED',
  messageSv:
    'Projektets aktuella bedömning kan inte fastställas. Ingen bedömning visas, och en äldre bedömning visas inte i stället. Ett nytt försök ändrar inte detta.',
  retryable: false,
};

/**
 * W-M2e item 1: 424 ASSESSMENT_CONTRACT_REFUSED -- the stored assessment follows no accepted assessment
 * contract (unknown or invalid contract VERSION). Not an identity/tamper fault; not retryable.
 */
const CONTRACT_REFUSAL_TEXT: CodeText = {
  kind: 'INTEGRITY',
  messageSv:
    'Projektets aktuella bedömning kan inte visas: den följer inget godkänt bedömningskontrakt (okänd eller ogiltig kontraktsversion). ' +
    'En äldre bedömning visas inte i stället. Felet försvinner inte vid ett nytt försök – kontakta systemets administratör.',
  retryable: false,
};

/**
 * U20-D: content read for the evidence/root details failed its own identity (GOVERNED_EVIDENCE_INTEGRITY_FAILED).
 * W-UI1 (A; U20CDF5-R2 verification R2-6): the last sentence says what THIS path does not do -- on verify the
 * assessment IS on screen, so the check was not run (never "Bedömningen visas därför inte"); on the map the
 * map does not show it; on the read-back and the export the assessment is not shown.
 */
const EVIDENCE_INTEGRITY_CAUSE_SV: Readonly<Record<string, string>> = {
  EVIDENCE_TAMPERED: 'en evidens stämmer inte med sin egen identitet',
  EVIDENCE_CORRUPTED: 'en evidens lagrade innehåll stämmer inte med sin innehållskontroll',
  // W-UI1 (D; owner decision R3-1): nothing is implied about the root's authenticity or present provenance.
  ROOT_PROVENANCE_TAMPERED:
    'fastighetsrotens artefakter stämmer inte med sin identitet. Ingen slutsats kan dras om fastighetsrotens äkthet eller om dess proveniens gäller nu',
};

function integrityConsequenceSv(context: LuErrorContext): string {
  if (context === 'verify') return 'Reproducerbarhetskontrollen genomfördes därför inte och inget utfall anges.';
  if (context === 'viewer-evidence') return 'Kartan visar därför inte bedömningen.';
  return 'Bedömningen visas därför inte.';
}

function evidenceIntegrityText(cause: string | null, context: LuErrorContext): CodeText {
  return {
    kind: 'INTEGRITY',
    messageSv: `Bedömningens underlag klarade inte integritetskontrollen${cause ? `: ${cause}` : ''}. ${integrityConsequenceSv(context)}`,
    retryable: false,
  };
}

/*
 * W-UI1 (owner decision 2, 2026-10-03): the client's never-retry CODE LIST (W-M2e item 3, LU_NEVER_RETRY) is
 * gone. "Försök igen" is the server's `retryable`; the UI keeps it away only where its OWN text calls the
 * fault lasting or a refusal (CodeText.retryable false, kind REFUSED/INTEGRITY), so text and button agree.
 */

/** W-M2e item 2: a lookup that never reaches Object.prototype (a class named "constructor" is no entry). */
function own<T>(table: Readonly<Record<string, T>>, key: string | null): T | undefined {
  return key !== null && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * W-M2e item 2: one machine `code` of an LU error answer with a Swedish text of its own -- `classes`
 * are its failure classes with a text of their own, `fallback` is the code's text for any other class.
 */
type ClassPresenter = (f: ErrorFields, lead: string, context: LuErrorContext) => CodeText;

interface CodePresenter {
  /** The code's failure classes with a text of their own (the inventory reads the keys). */
  readonly classes: Readonly<Record<string, ClassPresenter>>;
  readonly fallback: ClassPresenter;
}

/** A table of fixed class texts as class presenters. */
function constClasses(table: Readonly<Record<string, CodeText>>): Readonly<Record<string, ClassPresenter>> {
  return Object.fromEntries(Object.entries(table).map(([cls, entry]) => [cls, () => entry]));
}

const fixed = (kind: LuErrorKind, retryable: boolean, text: (lead: string) => string): ClassPresenter => (_f, lead) => ({
  kind,
  messageSv: text(lead),
  retryable,
});

const LIVE_LANTMATERIET_OFF = fixed(
  'TECHNICAL',
  false,
  (lead) => `${lead} Fastighetsuppslag mot Lantmäteriet är avstängt i den här miljön; endast det lokala fastighetsunderlaget används.`,
);
const PROPERTY_NOT_IN_DATA = fixed('NOT_FOUND', false, (lead) => `${lead} Fastigheten hittades inte i fastighetsunderlaget. Kontrollera beteckningen.`);

/**
 * W-UI1 (B; W-CATCH2/W-U20CDF5 shared read-fault classes, readFaultClassification.ts): what each class means
 * for the user, in this UI's words. The four doctrines are kept apart: a read error (transient, a new attempt
 * can help) is never a proven absence, a lasting storage/integrity fault, an inconsistent index or a refusal.
 */
const SHARED_FAULT_CLASS: Readonly<Record<string, { readonly kind: LuErrorKind; readonly retryable: boolean; readonly sentence: (subject: string) => string }>> = {
  READ_ERROR: { kind: 'TECHNICAL', retryable: true, sentence: (subject) => `${subject} kunde inte läsas just nu (tekniskt fel).` },
  STORAGE_INTEGRITY_FAULT: {
    kind: 'INTEGRITY',
    retryable: false,
    sentence: (subject) => `${subject} kunde inte läsas eller bekräftas ur arkivet (bestående lagrings- eller integritetsfel).`,
  },
  MISSING_FROM_CAS: {
    kind: 'INTEGRITY',
    retryable: false,
    sentence: (subject) => `${subject} kunde inte hämtas ur arkivet (bestående fel: objektet finns inte där det ska finnas).`,
  },
  BINDING_INDEX_INCONSISTENT: {
    kind: 'INTEGRITY',
    retryable: false,
    sentence: (subject) => `${subject} kunde inte fastställas: registreringen av kopplingar motsäger sig själv (bestående fel).`,
  },
  REFUSED: { kind: 'REFUSED', retryable: false, sentence: (subject) => `${subject} underkändes vid kontrollen.` },
};

const RETRY_CAN_HELP_SV = 'Ett nytt försök kan lyckas.';
const LASTING_SV = 'Felet försvinner inte vid ett nytt försök – kontakta systemets administratör.';

/**
 * A code answered in the shared classes: `subject` names what could not be read or verified, `consequence`
 * what this path therefore does not do. A class this UI does not know claims no cause; whether it may be
 * retried is then only the server's flag.
 */
function sharedFaultPresenter(
  subject: (f: ErrorFields) => string,
  consequence: (context: LuErrorContext, f: ErrorFields) => string,
  refusedSentence?: (f: ErrorFields, subjectSv: string) => string | null,
): CodePresenter {
  const classes: Record<string, ClassPresenter> = {};
  for (const [cls, c] of Object.entries(SHARED_FAULT_CLASS)) {
    classes[cls] = (f, _lead, context) => {
      const subjectSv = subject(f);
      const what = (cls === 'REFUSED' ? refusedSentence?.(f, subjectSv) : null) ?? c.sentence(subjectSv);
      return { kind: c.kind, retryable: c.retryable, messageSv: `${what} ${consequence(context, f)} ${c.retryable ? RETRY_CAN_HELP_SV : LASTING_SV}` };
    };
  }
  return {
    classes,
    fallback: (f, _lead, context) => ({
      kind: f.status === 409 ? 'REFUSED' : 'TECHNICAL',
      retryable: f.status !== 409,
      messageSv: `${subject(f)} kunde inte fastställas. ${consequence(context, f)}`,
    }),
  };
}

/** What an incomplete integrity check means on the path that answered (verify, the map, the read-back). */
function uncheckedIntegritySv(context: LuErrorContext): string {
  if (context === 'verify') return 'Bedömningens integritet kunde därför inte kontrolleras: reproducerbarhetskontrollen genomfördes inte och inget utfall anges.';
  if (context === 'viewer-evidence') return 'Bedömningens integritet kunde därför inte kontrolleras, och kartan visar inte bedömningen.';
  if (context === 'export') return 'Bedömningens integritet kunde därför inte kontrolleras, och ingen rapport skapades.';
  return 'Bedömningens integritet kunde därför inte kontrolleras, och bedömningen visas inte.';
}

/** W-UI1 (D): a read error says nothing about the material -- said once, plainly, never "äkthet". */
const READ_FAULT_NO_CLAIM_SV = 'Läsfelet säger inget om underlagets riktighet.';

/** W-UI1 (B; U20CDF4 beslut 1): 424 ASSESSMENT_RECORD_INTEGRITY_ERROR -- never a valid assessment, never retried. */
function recordIntegrityText(context: LuErrorContext): CodeText {
  const consequence =
    context === 'verify'
      ? 'Reproducerbarhetskontrollen genomfördes inte.'
      : context === 'export'
        ? 'Ingen rapport skapades.'
        : context === 'viewer-evidence'
          ? 'Kartan visar inte bedömningen.'
          : 'Bedömningen visas inte.';
  return {
    kind: 'INTEGRITY',
    retryable: false,
    messageSv:
      'Postens integritet kan inte intygas: den lagrade bedömningen är motsägelsefull eller ligger utanför det styrda formatet. ' +
      `Den redovisas inte som en giltig bedömning, och täckningsgrad och samlad risknivå kan inte fastställas. ${consequence} ` +
      'De lagrade fynden finns bara som overifierad diagnostik under ”Lagrade fynd”. ' +
      LASTING_SV,
  };
}

/**
 * W-M2e item 2 (M2d verification finding 1: "every error code has its own Swedish text" kept drifting):
 * the table IS the presentation -- presentLuError reads it, and the exhaustive inventory test
 * (tests/unit/luErrorCodeInventory.test.ts) reads its keys. A code the server can send that has
 * neither an entry here nor a reviewed fallback entry in that test fails the test.
 */
const CODE_PRESENTERS: Readonly<Record<string, CodePresenter>> = {
  LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED: {
    classes: constClasses(CURRENTNESS_TEXT),
    fallback: (f) => {
      const refused = f.status === 409;
      return { kind: refused ? 'REFUSED' : 'TECHNICAL', messageSv: 'Kontrollpunkten kunde inte fastställas. Ingen bedömning görs.', retryable: !refused };
    },
  },
  ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED: {
    classes: constClasses(ASSESSED_POINT_TEXT),
    fallback: fixed('INTEGRITY', false, () => 'Bedömningens kontrollpunkt kunde inte bekräftas. Bedömningen visas därför inte.'),
  },
  GOVERNED_EVIDENCE_INTEGRITY_FAILED: {
    classes: Object.fromEntries(
      Object.entries(EVIDENCE_INTEGRITY_CAUSE_SV).map(([cls, cause]) => [cls, (_f: ErrorFields, _lead: string, context: LuErrorContext) => evidenceIntegrityText(cause, context)]),
    ),
    fallback: (_f, _lead, context) => evidenceIntegrityText(null, context),
  },
  ASSESSMENT_ID_MISMATCH: {
    classes: {},
    fallback: fixed(
      'INCOHERENT',
      false,
      (lead) =>
        `${lead} Den visade bedömningen är inte längre projektets aktuella bedömning, och ingen annan bedömning används i dess ställe. Läs in bedömningen på nytt.`,
    ),
  },
  INVALID_ASSESSMENT_ARTIFACT_ID: {
    classes: {},
    fallback: fixed('TECHNICAL', false, (lead) => `${lead} Begäran innehöll ett ogiltigt bedömnings-id.`),
  },
  // U20CDF2 add-on 2 / W-APR: the (possibly current) assessment could not be read -- a technical or
  // integrity fault, never "no assessment"; the server's flag says whether a retry can help.
  ASSESSMENT_READ_ERROR: {
    classes: constClasses(ASSESSMENT_READ_TEXT),
    fallback: fixed(
      'TECHNICAL',
      true,
      (lead) => `${lead} Projektets aktuella bedömning kunde inte fastställas på grund av ett tekniskt fel. En äldre bedömning visas inte i stället.`,
    ),
  },
  // W-M2e item 1 (W-APR add-on 3): the selection was refused -- per class, never "motstridigt".
  ASSESSMENT_CURRENT_UNRESOLVED: {
    classes: constClasses(SELECTION_REFUSAL_TEXT),
    fallback: () => SELECTION_REFUSAL_DEFAULT,
  },
  // W-M2e item 1 (W-APR add-on 3): a contract-VERSION refusal, never "stämmer inte med sin lagrade identitet".
  ASSESSMENT_CONTRACT_REFUSED: {
    classes: constClasses({ ASSESSMENT_CONTRACT_INVALID: CONTRACT_REFUSAL_TEXT }),
    fallback: () => CONTRACT_REFUSAL_TEXT,
  },
  // U20CDF2 add-on 1: a storage fault during re-execution is no verification verdict.
  LU_REEXECUTION_STORAGE_FAULT: {
    classes: {},
    fallback: (f) =>
      f.retryable === false
        ? {
            kind: 'INTEGRITY',
            messageSv:
              'Reproducerbarheten kunde inte kontrolleras: ett bestående lagringsfel uppstod vid läsning av lagrade artefakter. Det är inget kontrollutfall, och felet försvinner inte vid ett nytt försök.',
            retryable: false,
          }
        : {
            kind: 'TECHNICAL',
            messageSv:
              'Reproducerbarheten kunde inte kontrolleras just nu: ett tekniskt fel uppstod vid läsning av lagrade artefakter. Det är inget kontrollutfall; ett nytt försök kan lyckas.',
            retryable: true,
          },
  },
  LIVE_LANTMATERIET_DISABLED: { classes: {}, fallback: LIVE_LANTMATERIET_OFF },
  LIVE_LANTMATERIET_REQUIRED: { classes: {}, fallback: LIVE_LANTMATERIET_OFF },
  // W-M2d item 6 (U20-A): the exact designation is on several rows of the property data (about 22 700
  // designations); the server refuses to choose one. Not the user's search, not retryable.
  PROPERTY_LOOKUP_AMBIGUOUS: { classes: {}, fallback: fixed('REFUSED', false, () => PROPERTY_LOOKUP_AMBIGUOUS_SV) },
  LOCAL_PROPERTY_NOT_FOUND: { classes: {}, fallback: PROPERTY_NOT_IN_DATA },
  PROPERTY_NOT_FOUND: { classes: {}, fallback: PROPERTY_NOT_IN_DATA },
  LOCALIZATION_DATA_UNAVAILABLE: {
    classes: {},
    fallback: fixed('TECHNICAL', true, (lead) => `${lead} För många datakällor var otillgängliga. Försök igen senare.`),
  },
  // W-UI1 (B; W-U20CDF5 M1/R3): verify or the map could not read every pinned evidence (or the property root,
  // reasonCode ROOT_READ_ERROR) -- the record's integrity was not checked, so nothing is replayed or shown.
  ASSESSMENT_PINNED_EVIDENCE_UNREADABLE: sharedFaultPresenter(
    (f) => (f.reasonCode === 'ROOT_READ_ERROR' ? 'Fastighetsrotens proveniens' : 'Den pinnade evidensen som bedömningen är bunden till'),
    (context, f) => `${uncheckedIntegritySv(context)}${f.failureClass === 'READ_ERROR' ? ` ${READ_FAULT_NO_CLAIM_SV}` : ''}`,
  ),
  // W-UI1 (B; W-U20CDF5 B4): the assessment's binding to the project could not be read or verified.
  ASSESSMENT_BINDING_UNRESOLVED: sharedFaultPresenter(
    () => 'Bedömningens koppling till projektet',
    (context) =>
      context === 'export'
        ? 'Ingen rapport skapades, och ingen annan bedömning används i dess ställe.'
        : context === 'verify'
          ? 'Reproducerbarhetskontrollen genomfördes inte.'
          : 'Bedömningen visas inte, och ingen annan bedömning visas i dess ställe.',
  ),
  // W-UI1 (B; W-U20CDF5 B2): the map's governed presentation could not be read or verified.
  VIEWER_PRESENTATION_UNRESOLVED: sharedFaultPresenter(
    () => 'Kartans styrda underlag (bedömning, evidens eller visningsbehörighet)',
    () => 'Kartan visar inte kontrollresultaten, och inget annat underlag används i stället.',
  ),
  // W-UI1 (B; W-U20CDF5 B5/L4/R3): the PDF's property/project context (or the property root) could not be read,
  // verified or referenced -- no report is built, and nothing is printed as "missing" instead.
  ASSESSMENT_PDF_CONTEXT_UNRESOLVED: sharedFaultPresenter(
    (f) => (f.reasonCode === 'ROOT_READ_ERROR' ? 'Bedömningens fastighetsrot' : 'Bedömningens fastighets- eller projektkontext'),
    () => 'Ingen rapport skapades. Ingen uppgift redovisas som saknad när den inte gick att läsa.',
    (f, subjectSv) =>
      f.reasonCode === 'MALFORMED_RECORD_ENTRY' ? `${subjectSv} underkändes vid kontrollen: bedömningen saknar en giltig referens till sin kontext.` : null,
  ),
  // W-UI1 (B; W-CATCH2 #14): the project-access facts could not be read (never "no permission").
  PROJECT_ACCESS_UNRESOLVED: sharedFaultPresenter(
    () => 'Behörigheten till projektet',
    () => 'Begäran utfördes inte.',
  ),
  // W-UI1 (B; W-CATCH2 #8): the geometry routes could not read or verify the project's canonical context.
  PROJECT_CONTEXT_UNRESOLVED: sharedFaultPresenter(
    () => 'Projektets koppling till fastigheten',
    () => 'Ingen kontrollpunkt hämtas, härleds eller sparas.',
  ),
  // W-UI1 (B; W-CATCH2 #13, W-CATCH3): the governed viewer capability could not be read or verified.
  VIEWER_CAPABILITY_UNRESOLVED: sharedFaultPresenter(
    () => 'Kartvisningens behörighet',
    () => 'Kartan kan inte visa kontrollresultaten, och ingen annan behörighet används i dess ställe.',
  ),
  // W-UI1 (B; U20CDF4 beslut 1): the stored record is not established -- fail-closed 424, never a valid assessment.
  ASSESSMENT_RECORD_INTEGRITY_ERROR: {
    classes: { RECORD_INTEGRITY_ERROR: (_f, _lead, context) => recordIntegrityText(context) },
    fallback: (_f, _lead, context) => recordIntegrityText(context),
  },
  // W-UI1 (B; U30-R5 K5, W-PLUMB-S LuVerifyConfigurationErrorAnswer): a configuration error of the server
  // process (a test-mode flag outside an explicit test process) -- no fault of the assessment, never retried.
  BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST: {
    classes: {},
    fallback: fixed(
      'TECHNICAL',
      false,
      (lead) =>
        `${lead} Kontrollen kan inte köras: servern är felkonfigurerad (ett testläge är påslaget utanför testmiljön). ` +
        `Det är inget fel i bedömningen. ${LASTING_SV}`,
    ),
  },
};

/** W-M2e item 2 (inventory): every error `code` with a text of its own, with its classes that have one. */
export const LU_ERROR_CODE_TEXTS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(Object.entries(CODE_PRESENTERS).map(([code, p]) => [code, Object.keys(p.classes)])),
);

/**
 * W-M2e item 2: the geometry routes answer every failure to resolve the project's canonical context
 * (no verified binding yet, a binding refused at verification, or one that could not be read) with
 * 404 "No canonical project context available: <raw text>". The UI cannot tell which, so it states
 * only what holds for all of them -- never "Det som efterfrågades finns inte".
 */
const NO_CANONICAL_PROJECT_CONTEXT_SV = 'Projektets koppling till fastigheten kunde inte fastställas, så kontrollpunkten kan inte användas.';

/** W-M2e item 2 (inventory): machine tokens that start a server message with a text of its own here. */
export const LU_MESSAGE_PREFIX_TOKENS_WITH_TEXT: readonly string[] = Object.freeze(['REJECT_LOCALIZATION_PRESENTATION']);

export function presentLuError(err: unknown, context: LuErrorContext): LuErrorPresentation {
  const f = readFields(err);
  const lead = CONTEXT_LEAD[context];
  const technical = technicalRows(f);
  // W-UI1 (B): the stored findings of a record whose integrity cannot be attested -- only for that code, only
  // as an unverified, non-authoritative diagnostic, and only when the envelope says so itself.
  const diagnostic = f.code === 'ASSESSMENT_RECORD_INTEGRITY_ERROR' ? parseLuRecordIntegrityDiagnostic(f.recordIntegrity) : null;
  /**
   * W-UI1 (owner decision 2): "Försök igen" only when the server says `retryable: true` and the shown text
   * allows it (a refusal, an integrity fault or a text that calls the fault lasting never). No HTTP answer at
   * all (network, a UI-side message): the text decides, nothing was decided by a server. `reread`: the action
   * is re-reading the assessment to resolve an incoherence between two answers, not repeating the failed call.
   */
  const make = (kind: LuErrorKind, messageSv: string, textAllowsRetry: boolean, opts: { reread?: boolean } = {}): LuErrorPresentation => ({
    kind,
    messageSv,
    retryable: opts.reread
      ? true
      : f.status === null
        ? // W-UI1-R2 (UI1-VERIFICATION finding 4): a server's `false` holds here too.
          f.retryable !== false && textAllowsRetry && kind !== 'REFUSED' && kind !== 'INTEGRITY'
        : serverAllowsRetry(f.retryable, { kind, messageSv, retryable: textAllowsRetry }),
    technical,
    ...(diagnostic ? { diagnostic } : {}),
  });
  const fromTable = (entry: CodeText) => make(entry.kind, entry.messageSv, entry.retryable);

  // A Swedish message written by this UI itself.
  if (f.isClientError && f.message) return make('TECHNICAL', f.message, true);

  const presenter = own(CODE_PRESENTERS, f.code);
  if (presenter) {
    const byClass = own(presenter.classes, f.failureClass);
    return fromTable(byClass ? byClass(f, lead, context) : presenter.fallback(f, lead, context));
  }

  if (f.message.startsWith(LU_SERVER_MESSAGE.NO_CANONICAL_PROJECT_CONTEXT_PREFIX)) {
    return make('NOT_FOUND', `${lead} ${NO_CANONICAL_PROJECT_CONTEXT_SV}`, false);
  }
  if (f.message === LU_SERVER_MESSAGE.NO_CURRENT_ASSESSMENT) {
    if (context === 'viewer-evidence') return make('INCOHERENT', VIEWER_EVIDENCE_NO_CURRENT, true, { reread: true });
    return make('NOT_FOUND', NOT_FOUND_TEXT[context] ?? `${lead} Det finns ingen sparad bedömning.`, false);
  }
  if (f.message === LU_SERVER_MESSAGE.VIEWER_CAPABILITY_NOT_CONFIGURED) {
    return make(
      'TECHNICAL',
      'Kartvisningen för projektet är inte förberedd ännu, så kontrollresultaten kan inte visas på kartan. Försök igen om en stund.',
      true,
    );
  }
  if (f.message === LU_SERVER_MESSAGE.ASSESSMENT_TAMPER) {
    return make(
      'INTEGRITY',
      'Den sparade bedömningen klarade inte integritetskontrollen. Den visas, kontrolleras och exporteras därför inte.',
      false,
    );
  }
  if (f.message === LU_SERVER_MESSAGE.ASSESSMENT_NOT_BOUND) {
    return make(
      'INTEGRITY',
      'Det gick inte att bekräfta att den sparade bedömningen hör till det här projektet. Den visas, kontrolleras och exporteras därför inte.',
      false,
    );
  }
  if (f.message.startsWith(LU_SERVER_MESSAGE.PRESENTATION_REJECT_PREFIX)) {
    return make('INTEGRITY', 'Kontrollunderlaget klarade inte integritetskontrollen och visas därför inte.', false);
  }
  // W-UI1 (M2e verification finding 5): the CSRF middleware's 403 is no project permission.
  if (f.message === LU_SERVER_MESSAGE.CSRF_REJECTED) {
    return make('TECHNICAL', `${lead} Sidans säkerhetstoken saknas eller har gått ut. Ladda om sidan och försök sedan igen.`, false);
  }

  // W-UI1-R2 (M2e verification finding 5): "expired" only where the server says so; otherwise a neutral text.
  if (f.status === 401) return make('UNAUTHORIZED', `${lead} ${unauthorizedSv(f.message)}`, false);
  if (f.status === 403 || f.message === LU_SERVER_MESSAGE.NOT_AUTHORIZED) {
    return make('UNAUTHORIZED', `${lead} Du saknar behörighet till det här projektet.`, false);
  }
  // W-M2e items 1-2: a 424 without a code of its own is a failed dependency check of some kind (tamper,
  // binding, contract version, viewer capability): the text claims no particular cause.
  if (f.status === 424) return make('INTEGRITY', `${lead} Underlaget kunde inte bekräftas och visas därför inte.`, false);
  if (f.status === 404) {
    if (context === 'viewer-evidence') return make('INCOHERENT', VIEWER_EVIDENCE_NOT_FOUND, true, { reread: true });
    // W-UI1 (M2e verification finding 5): only the exact "no current assessment" answer means absence (above);
    // any other 404 says what the server answered, never "det finns ingen sparad bedömning".
    return make('NOT_FOUND', `${lead} Servern hittade inte det som efterfrågades.`, false);
  }
  // W-M2e items 1-2: a 409 without a code of its own is a refusal -- not necessarily contradictory data.
  if (f.status === 409) return make('REFUSED', `${lead} Servern nekade åtgärden.`, false);
  if (f.status === 429) return make('TECHNICAL', `${lead} För många förfrågningar just nu – vänta en stund och försök igen.`, true);
  if (f.status === 400) {
    if (context === 'property-lookup' || context === 'property-search') {
      // W-UI1 (M2e verification finding 5): the property routes answer 400 for every failure, also a technical one.
      return make('NOT_FOUND', `${lead} Kontrollera fastighetsbeteckningen; om den stämmer kan felet vara tekniskt.`, false);
    }
    return make('TECHNICAL', `${lead} Begäran kunde inte behandlas.`, false);
  }
  if (f.status !== null && f.status >= 500) return make('TECHNICAL', `${lead} Ett tekniskt fel uppstod på servern.`, true);
  // DEMO M2c item 3: any other status (e.g. 422) -- the server DID answer; the status is technical.
  if (f.status !== null) return make('TECHNICAL', `${lead} Servern svarade med ett oväntat fel.`, false);

  // No HTTP status: the request never got a normal answer (network, unexpected response shape).
  return make('TECHNICAL', `${lead} Servern kunde inte nås eller svarade oväntat.`, true);
}

/**
 * The ONLY signal that a project has no current assessment yet: the server's exact 404 text. Any
 * other failure -- including some other 404 -- is an error, never "there is no assessment".
 */
export function isNoCurrentAssessmentError(err: unknown): boolean {
  return err instanceof Error && err.message === LU_SERVER_MESSAGE.NO_CURRENT_ASSESSMENT;
}

/** An incoherence between sources that must describe the same assessment (DEMO M2b item 2). */
export function presentLuIncoherence(messageSv: string, technical: readonly LuErrorDetailRow[]): LuErrorPresentation {
  return { kind: 'INCOHERENT', messageSv, retryable: true, technical };
}
