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
 * Whether "Försök igen" is offered is the SERVER's `retryable` flag when it sends one (OD-R3,
 * M1a-F1) -- never inferred from the HTTP status alone; a refusal is never retryable.
 */

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
  /** True when trying again can reasonably give a different answer. */
  readonly retryable: boolean;
  /** For the collapsed "Teknisk information": status, codes and the server's own text. */
  readonly technical: readonly LuErrorDetailRow[];
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
} as const;

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
}

function readFields(err: unknown): ErrorFields {
  const e = (err ?? {}) as Record<string, unknown>;
  const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    status: typeof e.status === 'number' && Number.isFinite(e.status) ? e.status : null,
    code: s(e.code),
    failureClass: s(e.failureClass),
    reasonCode: s(e.reasonCode),
    retryable: typeof e.retryable === 'boolean' ? e.retryable : null,
    message: typeof err === 'string' ? err : typeof e.message === 'string' ? e.message : '',
    isClientError: e.luClientError === true,
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

type CodeText = { readonly kind: LuErrorKind; readonly messageSv: string; readonly retryable: boolean };

/**
 * W-M2d item 5 / item 9: LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED per failure class
 * (server/modules/localization/localizationGeometryCurrentness.ts FAILURE_POLICY). Same meaning as the
 * server's text, in this UI's words ("kontrollpunkt"), and without claims stronger than M1a's
 * KNOWN_LIMITATION (currentness is fail-closed for detectable faults only). `retryable` is the
 * fallback when the answer carries no flag; the server's own flag wins.
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

/**
 * W-M2d item 5: the Swedish text of a currentness failure CLASS, for answers that carry it outside an
 * HTTP error -- generate-report's executionMotor.localization_geometry { failure_class, retryable }
 * (a FAILED_CLOSED provenance record). null for a class this UI does not know.
 */
export function presentCurrentnessFailureClass(
  failureClass: unknown,
  serverRetryable: unknown,
): { readonly messageSv: string; readonly retryable: boolean } | null {
  const entry = typeof failureClass === 'string' ? CURRENTNESS_TEXT[failureClass] : undefined;
  if (!entry) return null;
  return {
    messageSv: entry.messageSv,
    retryable: entry.kind === 'REFUSED' ? false : typeof serverRetryable === 'boolean' ? serverRetryable : entry.retryable,
  };
}

/** W-M2d item 6: an exact designation the property data holds on more than one row (PROPERTY_LOOKUP_AMBIGUOUS). */
export const PROPERTY_LOOKUP_AMBIGUOUS_SV =
  'Fastigheten kan inte analyseras ännu: beteckningen är inte unik i fastighetsunderlaget. Det är en känd begränsning i underlaget, inte ett fel i din sökning.';

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

/** U20-D: content read for the evidence/root details failed its own identity (GOVERNED_EVIDENCE_INTEGRITY_FAILED). */
const EVIDENCE_INTEGRITY_TEXT: Readonly<Record<string, string>> = {
  EVIDENCE_TAMPERED: 'Bedömningens underlag klarade inte integritetskontrollen: en evidens stämmer inte med sin egen identitet. Bedömningen visas därför inte.',
  EVIDENCE_CORRUPTED:
    'Bedömningens underlag klarade inte integritetskontrollen: en evidens lagrade innehåll stämmer inte med sin innehållshash. Bedömningen visas därför inte.',
  ROOT_PROVENANCE_TAMPERED:
    'Bedömningens underlag klarade inte integritetskontrollen: fastighetsrotens artefakter stämmer inte med sin identitet. Bedömningen visas därför inte.',
};

export function presentLuError(err: unknown, context: LuErrorContext): LuErrorPresentation {
  const f = readFields(err);
  const lead = CONTEXT_LEAD[context];
  const technical = technicalRows(f);
  // W-M2d item 5: the server's own `retryable` decides when it sends one; a refusal never is.
  const make = (kind: LuErrorKind, messageSv: string, fallbackRetryable: boolean): LuErrorPresentation => ({
    kind,
    messageSv,
    retryable: kind === 'REFUSED' ? false : (f.retryable ?? fallbackRetryable),
    technical,
  });
  const fromTable = (entry: CodeText) => make(entry.kind, entry.messageSv, entry.retryable);

  // A Swedish message written by this UI itself.
  if (f.isClientError && f.message) return make('TECHNICAL', f.message, true);

  if (f.code === 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED') {
    const entry = f.failureClass ? CURRENTNESS_TEXT[f.failureClass] : undefined;
    if (entry) return fromTable(entry);
    const refused = f.status === 409;
    return make(refused ? 'REFUSED' : 'TECHNICAL', 'Kontrollpunkten kunde inte fastställas. Ingen bedömning görs.', !refused);
  }
  if (f.code === 'ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED') {
    const entry = f.failureClass ? ASSESSED_POINT_TEXT[f.failureClass] : undefined;
    return entry
      ? fromTable(entry)
      : make('INTEGRITY', 'Bedömningens kontrollpunkt kunde inte bekräftas. Bedömningen visas därför inte.', false);
  }
  if (f.code === 'GOVERNED_EVIDENCE_INTEGRITY_FAILED') {
    return make(
      'INTEGRITY',
      (f.failureClass && EVIDENCE_INTEGRITY_TEXT[f.failureClass]) ||
        'Bedömningens underlag klarade inte integritetskontrollen. Bedömningen visas därför inte.',
      false,
    );
  }
  if (f.code === 'ASSESSMENT_ID_MISMATCH') {
    return make(
      'INCOHERENT',
      `${lead} Den visade bedömningen är inte längre projektets aktuella bedömning, och ingen annan bedömning används i dess ställe. Läs in bedömningen på nytt.`,
      false,
    );
  }
  if (f.code === 'INVALID_ASSESSMENT_ARTIFACT_ID') {
    return make('TECHNICAL', `${lead} Begäran innehöll ett ogiltigt bedömnings-id.`, false);
  }
  if (f.code === 'ASSESSMENT_READ_ERROR') {
    // U20CDF2 add-on 2 / W-APR: the (possibly current) assessment could not be read -- a technical
    // or integrity fault, never "no assessment"; the server's flag says whether a retry can help.
    const entry = f.failureClass ? ASSESSMENT_READ_TEXT[f.failureClass] : undefined;
    return entry
      ? fromTable(entry)
      : make('TECHNICAL', `${lead} Projektets aktuella bedömning kunde inte fastställas på grund av ett tekniskt fel. En äldre bedömning visas inte i stället.`, true);
  }
  if (f.code === 'LU_REEXECUTION_STORAGE_FAULT') {
    // U20CDF2 add-on 1: a storage fault during re-execution is no verification verdict.
    return f.retryable === false
      ? make(
          'INTEGRITY',
          'Reproducerbarheten kunde inte kontrolleras: ett bestående lagringsfel uppstod vid läsning av lagrade artefakter. Det är inget kontrollutfall, och felet försvinner inte vid ett nytt försök.',
          false,
        )
      : make(
          'TECHNICAL',
          'Reproducerbarheten kunde inte kontrolleras just nu: ett tekniskt fel uppstod vid läsning av lagrade artefakter. Det är inget kontrollutfall; ett nytt försök kan lyckas.',
          true,
        );
  }
  if (f.code === 'LIVE_LANTMATERIET_DISABLED' || f.code === 'LIVE_LANTMATERIET_REQUIRED') {
    return make(
      'TECHNICAL',
      `${lead} Fastighetsuppslag mot Lantmäteriet är avstängt i den här miljön; endast det lokala fastighetsunderlaget används.`,
      false,
    );
  }
  if (f.code === 'PROPERTY_LOOKUP_AMBIGUOUS') {
    // W-M2d item 6 (U20-A): the exact designation is on several rows of the property data (about
    // 22 700 designations); the server refuses to choose one. Not the user's search, not retryable.
    return make('REFUSED', PROPERTY_LOOKUP_AMBIGUOUS_SV, false);
  }
  if (f.code === 'LOCAL_PROPERTY_NOT_FOUND' || f.code === 'PROPERTY_NOT_FOUND') {
    return make('NOT_FOUND', `${lead} Fastigheten hittades inte i fastighetsunderlaget. Kontrollera beteckningen.`, false);
  }
  if (f.code === 'LOCALIZATION_DATA_UNAVAILABLE') {
    return make('TECHNICAL', `${lead} För många datakällor var otillgängliga. Försök igen senare.`, true);
  }

  if (f.message === LU_SERVER_MESSAGE.NO_CURRENT_ASSESSMENT) {
    if (context === 'viewer-evidence') return make('INCOHERENT', VIEWER_EVIDENCE_NO_CURRENT, true);
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

  if (f.status === 401) return make('UNAUTHORIZED', `${lead} Sessionen har gått ut – logga in igen.`, false);
  if (f.status === 403 || f.message === LU_SERVER_MESSAGE.NOT_AUTHORIZED) {
    return make('UNAUTHORIZED', `${lead} Du saknar behörighet till det här projektet.`, false);
  }
  if (f.status === 424) return make('INTEGRITY', `${lead} Underlaget stämmer inte med sin lagrade identitet och visas därför inte.`, false);
  if (f.status === 404) {
    if (context === 'viewer-evidence') return make('INCOHERENT', VIEWER_EVIDENCE_NOT_FOUND, true);
    return make('NOT_FOUND', NOT_FOUND_TEXT[context] ?? `${lead} Det som efterfrågades finns inte.`, false);
  }
  if (f.status === 409) return make('REFUSED', `${lead} Åtgärden nekades eftersom underlaget är motstridigt.`, false);
  if (f.status === 429) return make('TECHNICAL', `${lead} För många förfrågningar just nu – vänta en stund och försök igen.`, true);
  if (f.status === 400) {
    if (context === 'property-lookup' || context === 'property-search') {
      return make('NOT_FOUND', `${lead} Kontrollera fastighetsbeteckningen.`, false);
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
