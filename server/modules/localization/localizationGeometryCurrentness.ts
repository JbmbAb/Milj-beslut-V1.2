/**
 * DEMO M1a -- owner decision D9(a) (Jimmy, 2026-10-02).
 *
 * The localization geometry centroid may be DERIVED ONLY when currentness resolution reports
 * NOT_FOUND in its "no geometry yet" form (zero projection rows for the project). Every other
 * currentness outcome -- AMBIGUOUS_CURRENT_GEOMETRY, INVALID_SUPERSESSION_GRAPH, candidates that
 * exist but none survives CAS re-verification, an invalid head, a missing supersession verifier
 * key, a CAS/projection/DB error, or anything unrecognised -- FAILS CLOSED: no derived geometry,
 * no governed verdict, a Swedish user-facing reason, and the failure class kept as structured data.
 *
 * Classification is by the existing, stable error-message prefixes of
 * LocalizationGeometryCurrentProvider / resolveCurrentLocalizationGeometryHead. It is deliberately
 * asymmetric: only the EXACT "no projection" NOT_FOUND message permits derivation. If that message
 * ever changes, the error falls through to a fail-closed class, never to derivation -- a wording
 * drift can only make the system stricter, never laxer.
 *
 * M1a-repair (F1/F2): the provider no longer swallows a technical read/verification failure on a
 * single candidate (it used to drop the candidate, which could make a superseded point current). It
 * now throws LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE, classified here as the retryable
 * technical class CURRENTNESS_RESOLUTION_ERROR (503), never as a refusal.
 *
 * OD-R1 (owner decision 2026-10-02, forward-only): a geometry that may be the CURRENT point (no
 * verified outgoing supersession edge) but is missing, corrupted, tampered or inconsistent with its
 * projection row no longer lets an older point win. The provider throws
 * LOCALIZATION_GEOMETRY_CURRENT_CANDIDATE_UNVERIFIED, classified here as CURRENT_GEOMETRY_UNVERIFIED
 * (409, a refusal: the state was determined, retrying does not change it).
 */
import type { ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import type { LocalizationGeometryProvenance } from '@miljobeslut/mps-lu';
import { resolveCurrentLocalizationGeometry, type CurrentLocalizationGeometry } from './localizationGeometryProjection';
import {
  LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE_PREFIX,
  LOCALIZATION_GEOMETRY_CURRENT_CANDIDATE_UNVERIFIED_PREFIX,
} from './localizationGeometryCurrentProvider';
import type { LocalizationGeometryProjectionIndex } from '../../repositories/localizationGeometryProjectionRepository';
import type { LocalizationGeometrySupersessionIndex } from '../../repositories/localizationGeometrySupersessionRepository';

/** The one message that means "this project has no localization geometry yet". */
export const LOCALIZATION_GEOMETRY_NOT_FOUND_NO_PROJECTION_MESSAGE =
  'REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND: no localization geometry projection for project';

export type LocalizationGeometryCurrentnessFailureClass =
  | 'AMBIGUOUS_CURRENT_GEOMETRY'
  | 'INVALID_SUPERSESSION_GRAPH'
  | 'NO_VERIFIED_GEOMETRY_CANDIDATE'
  | 'CURRENT_GEOMETRY_UNVERIFIED'
  | 'INVALID_GEOMETRY_HEAD'
  | 'VERIFIER_CONFIGURATION'
  | 'DERIVED_GEOMETRY_PERSISTENCE_FAILED'
  | 'CURRENTNESS_RESOLUTION_ERROR';

interface FailureClassPolicy {
  /** Swedish, user-facing. Always says that no assessment is made. */
  readonly messageSv: string;
  readonly httpStatus: number;
  /** REFUSED = a deliberate governance refusal; ERROR = a technical failure that may succeed on retry. */
  readonly kind: 'REFUSED' | 'ERROR';
}

const FAILURE_POLICY: Readonly<Record<LocalizationGeometryCurrentnessFailureClass, FailureClassPolicy>> = {
  AMBIGUOUS_CURRENT_GEOMETRY: {
    messageSv:
      'Projektet har flera möjliga aktuella lokaliseringspunkter. Ingen bedömning görs förrän det är utrett vilken punkt som gäller.',
    httpStatus: 409,
    kind: 'REFUSED',
  },
  INVALID_SUPERSESSION_GRAPH: {
    messageSv:
      'Lokaliseringshistoriken för projektet är inkonsekvent (ogiltig ersättningskedja). Ingen bedömning görs.',
    httpStatus: 409,
    kind: 'REFUSED',
  },
  NO_VERIFIED_GEOMETRY_CANDIDATE: {
    messageSv:
      'Projektets sparade lokalisering kunde inte verifieras mot arkivet. Ingen punkt härleds automatiskt och ingen bedömning görs.',
    httpStatus: 409,
    kind: 'REFUSED',
  },
  CURRENT_GEOMETRY_UNVERIFIED: {
    messageSv:
      'Projektets aktuella lokaliseringspunkt kunde inte verifieras: den saknas eller är skadad i arkivet, har ändrats i ' +
      'efterhand eller stämmer inte med projektets fastighet. En äldre punkt används aldrig i stället och ingen punkt ' +
      'härleds automatiskt. Ingen bedömning görs.',
    httpStatus: 409,
    kind: 'REFUSED',
  },
  INVALID_GEOMETRY_HEAD: {
    messageSv: 'Projektets lokalisering är ogiltig och kan inte användas. Ingen bedömning görs.',
    httpStatus: 409,
    kind: 'REFUSED',
  },
  VERIFIER_CONFIGURATION: {
    messageSv:
      'Verifieringsnyckeln för lokaliseringsbyten saknas i systemets konfiguration. Ingen bedömning görs.',
    httpStatus: 503,
    kind: 'ERROR',
  },
  DERIVED_GEOMETRY_PERSISTENCE_FAILED: {
    messageSv:
      'Den automatiskt härledda lokaliseringspunkten kunde inte sparas. Ingen bedömning görs – försök igen.',
    httpStatus: 503,
    kind: 'ERROR',
  },
  CURRENTNESS_RESOLUTION_ERROR: {
    messageSv:
      'Aktuell lokalisering kunde inte fastställas på grund av ett tekniskt fel. Ingen bedömning görs – försök igen.',
    httpStatus: 503,
    kind: 'ERROR',
  },
};

export class LocalizationGeometryCurrentnessError extends Error {
  readonly code = 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED' as const;
  readonly failureClass: LocalizationGeometryCurrentnessFailureClass;
  /** Machine-readable reason code, e.g. LOCALIZATION_GEOMETRY_AMBIGUOUS_CURRENT_GEOMETRY. */
  readonly reasonCode: string;
  readonly userMessage: string;
  readonly httpStatus: number;
  readonly kind: 'REFUSED' | 'ERROR';
  readonly technicalDetail: string;

  constructor(failureClass: LocalizationGeometryCurrentnessFailureClass, technicalDetail: string) {
    const reasonCode = `LOCALIZATION_GEOMETRY_${failureClass}`;
    super(`${reasonCode}: ${technicalDetail}`);
    this.name = 'LocalizationGeometryCurrentnessError';
    const policy = FAILURE_POLICY[failureClass];
    this.failureClass = failureClass;
    this.reasonCode = reasonCode;
    this.userMessage = policy.messageSv;
    this.httpStatus = policy.httpStatus;
    this.kind = policy.kind;
    this.technicalDetail = technicalDetail;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * NOT_FOUND (no geometry yet) is the ONLY outcome that permits derivation. Everything else maps to
 * a fail-closed class; anything unrecognised is CURRENTNESS_RESOLUTION_ERROR (fail closed).
 */
export function classifyLocalizationGeometryCurrentnessError(
  error: unknown,
): 'NOT_FOUND' | LocalizationGeometryCurrentnessFailureClass {
  if (error instanceof LocalizationGeometryCurrentnessError) return error.failureClass;
  const message = messageOf(error);
  if (message === LOCALIZATION_GEOMETRY_NOT_FOUND_NO_PROJECTION_MESSAGE) return 'NOT_FOUND';
  // A candidate whose state could not be determined (technical CAS/verification failure): a
  // retryable technical failure -- never a refusal, never NOT_FOUND. Explicit so that a later change
  // to the default below cannot silently move it.
  if (message.startsWith(LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE_PREFIX)) return 'CURRENTNESS_RESOLUTION_ERROR';
  // OD-R1: the possibly-current geometry was determined bad -- a refusal, never an older point.
  if (message.startsWith(LOCALIZATION_GEOMETRY_CURRENT_CANDIDATE_UNVERIFIED_PREFIX)) return 'CURRENT_GEOMETRY_UNVERIFIED';
  if (message.startsWith('AMBIGUOUS_CURRENT_GEOMETRY')) return 'AMBIGUOUS_CURRENT_GEOMETRY';
  if (message.startsWith('INVALID_SUPERSESSION_GRAPH')) return 'INVALID_SUPERSESSION_GRAPH';
  // Same NOT_FOUND prefix, but candidates DO exist and none survived CAS re-verification: that is
  // a corrupted/tampered/missing-CAS state, not "no geometry yet" -- never a reason to derive.
  if (message.startsWith('REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND')) return 'NO_VERIFIED_GEOMETRY_CANDIDATE';
  if (message.startsWith('REJECT_LOCALIZATION_GEOMETRY_HEAD')) return 'INVALID_GEOMETRY_HEAD';
  if (message.startsWith('REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CONFIGURATION')) return 'VERIFIER_CONFIGURATION';
  return 'CURRENTNESS_RESOLUTION_ERROR';
}

export type LocalizationGeometryCurrentnessResolution =
  | { readonly status: 'CURRENT'; readonly current: CurrentLocalizationGeometry }
  | { readonly status: 'NOT_FOUND' };

/**
 * The single branching point every caller uses: CURRENT, NOT_FOUND, or a thrown
 * LocalizationGeometryCurrentnessError (fail closed). Never swallows.
 */
export async function resolveLocalizationGeometryCurrentness(args: {
  readonly projectId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly index?: LocalizationGeometryProjectionIndex;
  readonly supersessionIndex?: LocalizationGeometrySupersessionIndex;
}): Promise<LocalizationGeometryCurrentnessResolution> {
  try {
    const current = await resolveCurrentLocalizationGeometry({
      projectId: args.projectId,
      artifactRepository: args.artifactRepository,
      index: args.index,
      supersessionIndex: args.supersessionIndex,
    });
    return { status: 'CURRENT', current };
  } catch (error) {
    const classification = classifyLocalizationGeometryCurrentnessError(error);
    if (classification === 'NOT_FOUND') return { status: 'NOT_FOUND' };
    throw new LocalizationGeometryCurrentnessError(classification, messageOf(error));
  }
}

/** The error variant every service-level `{ ok: false }` result carries for a currentness failure. */
export interface LocalizationGeometryCurrentnessFailureResponse {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
  readonly code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED';
  readonly failureClass: LocalizationGeometryCurrentnessFailureClass;
  readonly reasonCode: string;
}

export function currentnessFailureResponse(error: LocalizationGeometryCurrentnessError): LocalizationGeometryCurrentnessFailureResponse {
  return {
    ok: false,
    status: error.httpStatus,
    error: error.userMessage,
    code: error.code,
    failureClass: error.failureClass,
    reasonCode: error.reasonCode,
  };
}

const PROVENANCE_LABEL_SV: Readonly<Record<LocalizationGeometryProvenance, string>> = {
  user_defined: 'Användardefinierad lokaliseringspunkt (aktuell punkt)',
  derived_from_property_boundary:
    'Härledd från fastighetens centrumpunkt (ingen lokaliseringspunkt har angetts för projektet)',
};

export function localizationGeometryProvenanceLabelSv(provenance: string | null | undefined): string {
  if (provenance && provenance in PROVENANCE_LABEL_SV) {
    return PROVENANCE_LABEL_SV[provenance as LocalizationGeometryProvenance];
  }
  return 'Okänd – ingen aktuell lokaliseringspunkt är registrerad för bedömningen';
}

/**
 * Structured geometry provenance / failure record carried on the generate-report response
 * (executionMotor.localization_geometry), the current-assessment read-back and the PDF.
 */
export interface LocalizationGeometryProvenanceRecord {
  readonly status: 'RESOLVED' | 'FAILED_CLOSED';
  readonly artifact_id: string | null;
  readonly provenance: LocalizationGeometryProvenance | null;
  /** true only when THIS request derived the centroid because currentness reported NOT_FOUND. */
  readonly derived_in_this_request: boolean;
  readonly provenance_label_sv: string | null;
  readonly failure_class: LocalizationGeometryCurrentnessFailureClass | null;
  readonly reason_code: string | null;
  readonly message_sv: string | null;
}

export function resolvedGeometryProvenanceRecord(args: {
  readonly artifactId: string;
  readonly provenance: LocalizationGeometryProvenance | null | undefined;
  readonly derivedInThisRequest: boolean;
}): LocalizationGeometryProvenanceRecord {
  return {
    status: 'RESOLVED',
    artifact_id: args.artifactId,
    provenance: args.provenance ?? null,
    derived_in_this_request: args.derivedInThisRequest,
    provenance_label_sv: localizationGeometryProvenanceLabelSv(args.provenance),
    failure_class: null,
    reason_code: null,
    message_sv: null,
  };
}

export function failedClosedGeometryProvenanceRecord(error: LocalizationGeometryCurrentnessError): LocalizationGeometryProvenanceRecord {
  return {
    status: 'FAILED_CLOSED',
    artifact_id: null,
    provenance: null,
    derived_in_this_request: false,
    provenance_label_sv: null,
    failure_class: error.failureClass,
    reason_code: error.reasonCode,
    message_sv: error.userMessage,
  };
}
