/**
 * Orkestrering: lokaliseringsutredning (jämförande platsanalys).
 */

import { buildJsonPdfBuffer } from '../../services/pdfExportService';
import { buildLocalizationPdfData } from '../../services/localizationPdfService';
import {
  generateLocalizationReport,
  isLocalizationStrictMode,
  type LocalizationReport,
  type SiteAlternative,
} from '../../services/localizationReportService';
import { getAuditTrail } from '../../services/auditTrailService';
import { assertProjectAccess } from '../../security/projectAccess';
import type { AuthUser } from '../../security/types';
import { MimersIntegration, type ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import { ProjectContextBindingProvider, authorizeAssessmentPresentation } from './projectContextBindingRuntime';
import { sha256ContentHash } from '@miljobeslut/mps-compliance/src/canonical/sha256Canonical';
import {
  localizationAssessmentCanonicalBody,
  validateLocalizationAssessmentContractVersion,
  reExecuteLocalizationAssessment,
  validateLocalizationGeometryArtifact,
  type LocalizationAssessmentArtifact,
  type LocalizationGeometryArtifact,
  type LuReExecutionMismatch,
  type LuReExecutionResult,
} from '@miljobeslut/mps-lu';
import { PrismaProjectContextBindingIndex } from '../../repositories/projectContextBindingRepository';
import { getProjectContextBindingIssuerVerifier } from '../../security/projectContextBindingIssuerKey';
import {
  ASSESSMENT_PROJECTION_BINDING_UNRESOLVABLE,
  ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE,
  resolveCurrentAssessmentProjection,
} from './assessmentProjection';
import type { CurrentLocalizationGeometry } from './localizationGeometryProjection';
import {
  LocalizationGeometryCurrentnessError,
  currentnessFailureResponse,
  localizationGeometryProvenanceLabelSv,
  resolveLocalizationGeometryCurrentness,
  type LocalizationGeometryCurrentnessFailureResponse,
} from './localizationGeometryCurrentness';
import type { LocalizationGeometryProjectionIndex } from '../../repositories/localizationGeometryProjectionRepository';
import { resolveGovernedLocalizationPresentation } from './resolveGovernedLocalizationPresentation';
import { resolveLocalizationViewerRuntimeConfigForProject, type LocalizationViewerRuntimeConfig } from './createLocalizationViewerRuntime';
import { type GovernedDocumentCheck } from './governedLayerChecks';
import { recordIntegrityDiagnostic, type RecordIntegrityDiagnostic } from './recordIntegrityDiagnostic';
import {
  governedOverallStatement,
  MISSING_IN_BASIS_SV,
  resolveGovernedAssessmentDetails,
  type GovernedAssessmentDetails,
  type GovernedEvidenceDetail,
  type GovernedOverallStatement,
  type PresentedGovernedLayerCheck,
  type PropertyRootDetails,
} from './governedEvidenceDetails';
import { governedLayerLabelSv, storedRiskFindingsSv } from './governedCoverageStatement';
import type { KnownCoverageGap } from './knownCoverageGaps';
import { presentGovernedFindings } from './presentedGovernedFindings';
import { isPersistentStorageFault, retrySentenceSv } from './storageFaultClassification';
import { readFaultHttpStatus, readFaultOfClass, readFaultSentenceSv, type ReadFaultClass } from './readFaultClassification';
import { governedVerdictFromFindings } from '../../../src/application/generate-localization-report.usecase';
import type { ProjectAssessmentProjectionIndex } from '../../repositories/projectAssessmentProjectionRepository';

export class LocalizationDataUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'LOCALIZATION_DATA_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'LocalizationDataUnavailableError';
  }
}

/**
 * DEMO M1a / D9(a). Read-side currentness branch shared by the viewer-evidence, current-assessment,
 * PDF and verify paths: CURRENT -> filter by that geometry; NOT_FOUND -> `current: null` (legacy
 * binding-only eligibility, unchanged); anything else -> a fail-closed response that keeps the
 * failure class. Never swallows.
 */
async function resolveReadBackGeometryCurrentness(
  projectId: string,
  artifactRepository: ArtifactRepositoryPort,
  index: LocalizationGeometryProjectionIndex | undefined,
): Promise<
  | { readonly ok: true; readonly current: CurrentLocalizationGeometry | null }
  | { readonly ok: false; readonly failure: LocalizationGeometryCurrentnessFailureResponse }
> {
  try {
    const resolution = await resolveLocalizationGeometryCurrentness({ projectId, artifactRepository, index });
    return { ok: true, current: resolution.status === 'CURRENT' ? resolution.current : null };
  } catch (error) {
    if (error instanceof LocalizationGeometryCurrentnessError) {
      return { ok: false, failure: currentnessFailureResponse(error) };
    }
    throw error;
  }
}

/** DEMO M1a: geometry provenance as returned by the read-back and printed in the PDF. */
export interface LuAssessmentGeometryProvenance {
  readonly artifact_id: string | null;
  readonly provenance: 'user_defined' | 'derived_from_property_boundary' | null;
  readonly provenance_label_sv: string;
  /**
   * U20-D (read-back only, additions): the point THIS assessment is bound to, read from the
   * assessment's own localization_geometry_ref in CAS and verified (identity hash, project and
   * property binding) -- not the project's current point, which may have moved since.
   * VERIFIED: coordinates below are the bound artifact's. NOT_RECORDED: the assessment carries no
   * geometry ref (older assessment); coordinates are null, never guessed. A ref that cannot be
   * verified fails the whole read-back closed instead.
   */
  readonly bound_geometry_status?: 'VERIFIED' | 'NOT_RECORDED';
  readonly geometry_type?: string | null;
  /** GeoJSON order [lng, lat] (WGS84), as stored in the artifact's `geometry`. */
  readonly coordinates_wgs84?: readonly [number, number] | null;
  /** SWEREF99 TM [northing, easting], the canonical point the spatial query used. */
  readonly coordinates_sweref99tm?: readonly [number, number] | null;
  readonly srid?: number | null;
}

/** U20-D: the assessment's own bound point could not be verified -> the read-back fails closed. */
export interface AssessmentGeometryFailure {
  readonly ok: false;
  readonly status: 424 | 503;
  readonly error: string;
  readonly code: 'ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED';
  readonly failureClass:
    | 'LOCALIZATION_GEOMETRY_MISSING'
    | 'LOCALIZATION_GEOMETRY_TAMPERED'
    | 'LOCALIZATION_GEOMETRY_NOT_BOUND'
    | 'LOCALIZATION_GEOMETRY_READ_ERROR';
  readonly reasonCode: string;
}

type BoundGeometry = Pick<
  LuAssessmentGeometryProvenance,
  'bound_geometry_status' | 'geometry_type' | 'coordinates_wgs84' | 'coordinates_sweref99tm' | 'srid'
>;

/**
 * U20-D: resolves and verifies the localization geometry an assessment is bound to. Same
 * determined/technical split as elsewhere: missing, tampered or foreign -> 424; an unknown read
 * failure -> 503 (retryable). Never falls back to the project's current point.
 */
async function resolveBoundLocalizationGeometry(
  assessment: LocalizationAssessmentArtifact,
  artifactRepository: ArtifactRepositoryPort,
  projectId: string,
): Promise<{ ok: true; value: BoundGeometry } | AssessmentGeometryFailure> {
  const ref = assessment.payload.localization_geometry_ref;
  if (!ref?.artifact_id) {
    return {
      ok: true,
      value: { bound_geometry_status: 'NOT_RECORDED', geometry_type: null, coordinates_wgs84: null, coordinates_sweref99tm: null, srid: null },
    };
  }
  const fail = (status: 424 | 503, failureClass: AssessmentGeometryFailure['failureClass']): AssessmentGeometryFailure => ({
    ok: false,
    status,
    error: `Bedömningens lokaliseringspunkt (${ref.artifact_id}) kunde inte verifieras (${failureClass}). Bedömningen visas inte.`,
    code: 'ASSESSMENT_LOCALIZATION_GEOMETRY_UNVERIFIED',
    failureClass,
    reasonCode: failureClass,
  });
  let geometry: LocalizationGeometryArtifact;
  try {
    geometry = await artifactRepository.resolve<LocalizationGeometryArtifact>({ artifact_id: ref.artifact_id, artifact_type: ref.artifact_type });
  } catch (error) {
    if (error instanceof Error && error.message === `Artifact not found: ${ref.artifact_id}`) return fail(424, 'LOCALIZATION_GEOMETRY_MISSING');
    if (error instanceof Error && error.name === 'CASIntegrityError') return fail(424, 'LOCALIZATION_GEOMETRY_TAMPERED');
    return fail(503, 'LOCALIZATION_GEOMETRY_READ_ERROR');
  }
  try {
    validateLocalizationGeometryArtifact(geometry);
  } catch {
    return fail(424, 'LOCALIZATION_GEOMETRY_TAMPERED');
  }
  if (geometry.artifact_id !== ref.artifact_id) return fail(424, 'LOCALIZATION_GEOMETRY_TAMPERED');
  if (
    geometry.payload.project_id !== projectId ||
    geometry.payload.property_context_ref.artifact_id !== assessment.payload.property_ref.artifact_id
  ) {
    return fail(424, 'LOCALIZATION_GEOMETRY_NOT_BOUND');
  }
  return {
    ok: true,
    value: {
      bound_geometry_status: 'VERIFIED',
      geometry_type: geometry.payload.geometry_type,
      coordinates_wgs84: geometry.payload.geometry.coordinates,
      coordinates_sweref99tm: geometry.payload.coordinates,
      srid: geometry.payload.srid,
    },
  };
}

/**
 * U20-D, PROVISIONAL (coordinator item 3; owner decision pending): one deterministic summary of a
 * stored assessment, derived ONLY by functions the product already uses -- the governed risk level
 * from governedVerdictFromFindings (the exact derivation generate-report uses), the coverage from
 * summarizeGovernedCheckCoverage, and the stored document check. No new risk model, no score. Its
 * own field; nothing in the product reads it.
 */
export interface DerivedOverallSummary {
  /**
   * U20CDF (U20CD verification F10): provisional in the payload itself, not only in this comment --
   * a consumer must not build on the field before the owner decision (U20CD-REPORT question 9).
   */
  readonly provisional: true;
  readonly derived: true;
  readonly derivation: 'governedVerdictFromFindings + governed layer checks (stored)';
  readonly risk_level: string;
  /** U20CDF2 (G1): DETERMINED, or why the record's coverage cannot be established; counts null then. */
  readonly coverage_state: GovernedOverallStatement['coverage_state'];
  readonly checks_completed: number | null;
  readonly checks_total: number | null;
  readonly not_completed_layers: readonly string[] | null;
  /** Layers whose checked dataset carries an ADMIT v1 coverage limitation (e.g. Natura 2000: SPA only). */
  readonly coverage_limited_layers: readonly string[];
  readonly document_check_status: string | null;
  readonly statement_sv: string;
}

function derivedOverallSummary(
  statement: GovernedOverallStatement,
  checks: readonly PresentedGovernedLayerCheck[],
): DerivedOverallSummary {
  return {
    provisional: true,
    derived: true,
    derivation: 'governedVerdictFromFindings + governed layer checks (stored)',
    risk_level: statement.risk_level,
    coverage_state: statement.coverage_state,
    checks_completed: statement.coverage?.checks_completed ?? null,
    checks_total: statement.coverage?.checks_total ?? null,
    not_completed_layers: statement.coverage?.not_completed_layers ?? null,
    coverage_limited_layers: checks
      .filter((check) => check.coverage_limitation_sv !== MISSING_IN_BASIS_SV)
      .map((check) => check.layer),
    document_check_status: checks.find((check) => check.layer === 'document')?.status ?? null,
    statement_sv: statement.statement_sv,
  };
}

export function localizationAuditRef(projectId: string): string {
  return `LOK-${projectId}`;
}

function parseSiteAlternatives(raw: unknown): SiteAlternative[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const sites: SiteAlternative[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    const id = String(row.id || '').trim();
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < 55 || lat > 69.5 || lng < 10 || lng > 25.5) return null;
    let documentEvidenceRefs: SiteAlternative['documentEvidenceRefs'];
    if (Array.isArray(row.documentEvidenceRefs)) {
      const parsedRefs: NonNullable<SiteAlternative['documentEvidenceRefs']>[number][] = [];
      for (const value of row.documentEvidenceRefs) {
        if (!value || typeof value !== 'object') return null;
        const ref = value as Record<string, unknown>;
        const artifactId = String(ref.artifact_id || '').trim();
        if (!artifactId || ref.artifact_type !== 'DOCUMENT_EVIDENCE') return null;
        parsedRefs.push({ artifact_id: artifactId, artifact_type: 'DOCUMENT_EVIDENCE' });
      }
      documentEvidenceRefs = parsedRefs;
    }
    sites.push({
      id,
      name: row.name != null ? String(row.name).trim().slice(0, 120) : undefined,
      lat,
      lng,
      documentEvidenceRefs,
    });
  }
  return sites.length > 0 ? sites : null;
}

/*
 * U20-C (U20-U30 spec 1.4 U-1/U-2, K1): the former strict-mode gate `assertStrictReportUsable`
 * is gone. It turned the old local spatialAudit and the live NVR / RAÄ / VISS / SLU outcomes --
 * unbound reads, none of them governed evidence -- into a 503 AFTER the governed assessment had
 * already been persisted to CAS, so the answer and CAS drifted apart. Gating now rests on the
 * governed outcome alone, which every response already carries per site as
 * `executionMotor.assessment_status` (ASSESSED / GOVERNANCE_DENIED / EXECUTION_FAILED /
 * NOT_ASSESSED) with its reason codes. `LocalizationDataUnavailableError` stays exported for the
 * route's error mapping.
 */

export async function runLocalizationReport(input: {
  authUser: AuthUser;
  projectId: string;
  siteAlternatives: unknown;
  /** U20-C: only the older generate-pdf-data route sets this (see GenerateLocalizationReportUseCase). */
  includeLegacyObservations?: boolean;
}): Promise<
  | { ok: true; report: LocalizationReport; meta: { strictMode: boolean; warningCount: number } }
  | { ok: false; status: number; error: string }
> {
  const projectId = String(input.projectId || '').trim();
  const sites = parseSiteAlternatives(input.siteAlternatives);
  if (!projectId || !sites) {
    return {
      ok: false,
      status: 400,
      error: 'projectId and a non-empty siteAlternatives array are required.',
    };
  }

  await assertProjectAccess(input.authUser, projectId, input.authUser.organisationId);

  const report = await generateLocalizationReport({
    projectId,
    siteAlternatives: sites,
    userId: input.authUser.id,
    user: input.authUser,
    includeLegacyObservations: input.includeLegacyObservations === true,
  });

  const warningCount = report.warnings.length + report.siteAnalyses.reduce((n, s) => n + s.warnings.length, 0);

  return {
    ok: true,
    report,
    meta: {
      strictMode: isLocalizationStrictMode(),
      warningCount,
    },
  };
}

export async function exportLocalizationPdf(input: {
  authUser: AuthUser;
  projectId: string;
  siteAlternatives: unknown;
}): Promise<{ ok: true; buffer: Buffer; filename: string } | { ok: false; status: number; error: string }> {
  const projectId = String(input.projectId || '').trim();
  const sites = parseSiteAlternatives(input.siteAlternatives);
  if (!projectId || !sites) {
    return { ok: false, status: 400, error: 'projectId and a non-empty siteAlternatives array are required.' };
  }

  await assertProjectAccess(input.authUser, projectId, input.authUser.organisationId);

  const report = await generateLocalizationReport({
    projectId,
    siteAlternatives: sites,
    userId: input.authUser.id,
    user: input.authUser,
    // The older PDF projection prints the legacy observations (labelled, never governed).
    includeLegacyObservations: true,
  });

  const pdfPayload = buildLocalizationPdfData(report);
  const buffer = await buildJsonPdfBuffer(
    pdfPayload.title,
    `Projekt ${pdfPayload.projectId}`,
    pdfPayload,
  );
  const safeId = projectId.replace(/[^a-zA-Z0-9-_åäöÅÄÖ]+/g, '-').slice(0, 40) || 'projekt';
  return { ok: true, buffer, filename: `lokaliseringsutredning-${safeId}.pdf` };
}

/**
 * P3-LU-CESIUM-PRESENTATION-WIRING-01.
 *
 * The canonical LU product presentation path: authenticated request -> project authorization ->
 * current ProjectContextBinding -> current assessment projection -> resolveAuthorizedViewerCapability
 * -> resolveGovernedLocalizationPresentation -> CAS -> ViewerKernel -> governed GeoJSON.
 *
 * Never queries PostGIS as a new evidentiary source and never mints/signs anything -- it only
 * discovers and re-verifies already-captured, already-governed artifacts. This is the ONLY
 * server-side entrypoint the LU Cesium product flow may call for evidence; the older, ungoverned
 * GET /api/spatial/evidence route (raw PostGIS, no auth, no CAS) remains reachable for unrelated
 * general-purpose GIS exploration but is not used by this path.
 */
export async function resolveLuViewerPresentation(input: {
  readonly authUser: AuthUser;
  readonly projectId: string;
  /** Overridable for tests; defaults to the real CAS. */
  readonly artifactRepository?: ArtifactRepositoryPort;
  /** Overridable for tests; defaults to the real Postgres-backed resolver. */
  readonly currentBindingProvider?: ProjectContextBindingProvider;
  /** Overridable for tests; defaults to the real Postgres-backed projection index. */
  readonly assessmentProjectionIndex?: ProjectAssessmentProjectionIndex;
  /** Overridable for tests; defaults to the real Postgres-backed localization geometry index. */
  readonly localizationGeometryIndex?: LocalizationGeometryProjectionIndex;
  /** Overridable for tests; defaults to the env-configured deployment-wide capability. */
  readonly config?: LocalizationViewerRuntimeConfig;
}): Promise<
  | { ok: true; geojson: unknown; assessmentArtifactId: string; capabilityArtifactId: string }
  | { ok: false; status: number; error: string }
  | GovernedRecordIntegrityFailure
  | GovernedEvidenceIntegrityFailure
  | PinnedEvidenceUnreadableRefusal
> {
  const projectId = String(input.projectId || '').trim();
  if (!projectId) {
    return { ok: false, status: 400, error: 'projectId required' };
  }

  try {
    await assertProjectAccess(input.authUser, projectId, input.authUser.organisationId);
  } catch {
    return { ok: false, status: 403, error: 'Not authorized for this project.' };
  }

  const artifactRepository = input.artifactRepository ?? (await MimersIntegration.create()).artifactRepository;
  const currentBindingProvider =
    input.currentBindingProvider ??
    new ProjectContextBindingProvider(
      artifactRepository,
      new PrismaProjectContextBindingIndex(),
      getProjectContextBindingIssuerVerifier(),
    );

  // PRODUCT-LU-LOCALIZATION-GEOMETRY-01: a project that already has an explicit localization
  // geometry must have "current assessment" also mean "current point" -- otherwise a stale
  // point-A assessment could resolve as current after the user moves to point B. A project with
  // no localization geometry projection yet (pre-Phase-B / legacy) is unaffected: this is
  // additive, not a new failure mode for existing projects.
  // DEMO M1a / D9(a): ONLY currentness NOT_FOUND keeps the legacy binding-only eligibility. Any
  // other currentness failure fails closed here -- silently dropping the geometry filter would let
  // a binding-only (possibly stale-point) assessment be presented as current.
  const currentGeometry = await resolveReadBackGeometryCurrentness(projectId, artifactRepository, input.localizationGeometryIndex);
  if (currentGeometry.ok === false) return currentGeometry.failure;
  const currentLocalizationGeometryArtifactId = currentGeometry.current?.geometryArtifactId;

  let assessmentArtifactId: string;
  try {
    const projection = await resolveCurrentAssessmentProjection({
      projectId,
      artifactRepository,
      currentBindingProvider,
      currentLocalizationGeometryArtifactId,
      index: input.assessmentProjectionIndex,
    });
    assessmentArtifactId = projection.assessmentArtifactId;
  } catch (error) {
    // Covers: no assessment has ever been produced for this project, the only assessment(s) on
    // record are bound to a since-superseded context, or none survive CAS re-verification.
    // Explicit, never a silent stale fallback. U20CDF2 (add-on 2, OD-R2): a technical failure to
    // resolve (e.g. the projection index cannot be read) is a 503, never "no assessment".
    return assessmentResolutionFailure(error);
  }

  // PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01 Phase B: per-project resolution -- looks up
  // THIS project's own completed ViewerCapabilityProvisioningRequest, never a single
  // deployment-wide env var. A project with no completed request yet is simply "not ready", not
  // "wrong project configured".
  const config = input.config ?? (await resolveLocalizationViewerRuntimeConfigForProject(projectId, artifactRepository));
  if (!config) {
    return { ok: false, status: 404, error: 'Governed viewer capability is not configured for this project.' };
  }
  if (config.expectedProjectId !== projectId) {
    return { ok: false, status: 404, error: 'Governed viewer capability is not configured for this project.' };
  }

  let presentation: Awaited<ReturnType<typeof resolveGovernedLocalizationPresentation>>;
  try {
    presentation = await resolveGovernedLocalizationPresentation({
      authUser: input.authUser,
      projectId,
      assessmentArtifactId,
      artifactRepository,
      config,
      currentBindingProvider,
    });
  } catch (error) {
    // Covers: missing/superseded/tampered capability, missing/tampered CAS evidence, wrong
    // release/viewer-identity. Fail closed, never a stale or synthetic fallback.
    return {
      ok: false,
      status: 424,
      error: error instanceof Error ? error.message : 'Governed viewer presentation is unavailable.',
    };
  }

  // U20CDF4 (owner decision 2026-10-03 (4) point 1; coordinator clarification 2): the map presents the
  // same current assessment as the read-back, so it never treats one the read-back refuses as a valid
  // current assessment -- the same 424 for a record integrity error, and for a pinned artifact that
  // fails its own identity (the presentation itself re-verifies only the spatial evidence). The
  // assessment the presentation verified is read again and its identity re-checked before it is used.
  let assessment: LocalizationAssessmentArtifact;
  try {
    assessment = await artifactRepository.resolve<LocalizationAssessmentArtifact>({
      artifact_id: presentation.assessmentArtifactId,
      artifact_type: 'LOCALIZATION_ASSESSMENT',
    });
  } catch (error) {
    return assessmentArtifactReadFailure(error, presentation.assessmentArtifactId);
  }
  const recomputed = sha256ContentHash(localizationAssessmentCanonicalBody(assessment));
  if (assessment.artifact_id !== presentation.assessmentArtifactId || assessment.artifact_id !== `assessment-${recomputed.value}`) {
    return { ok: false, status: 424, error: 'Governed LU assessment failed tamper verification.' };
  }
  const recordRefusal = await currentRecordIntegrityRefusal(assessment, artifactRepository, 'map');
  if (recordRefusal) return recordRefusal;

  return {
    ok: true,
    geojson: presentation.geojson,
    assessmentArtifactId: presentation.assessmentArtifactId,
    capabilityArtifactId: presentation.capabilityArtifactId,
  };
}

/**
 * U20-D addition: the export and verify paths may be bound to an explicit assessment id (the one
 * the UI is showing). Anything other than the project's current, verified assessment is refused --
 * never a silent switch to another assessment.
 */
export interface AssessmentIdMismatchFailure {
  readonly ok: false;
  readonly status: 409;
  readonly error: string;
  readonly code: 'ASSESSMENT_ID_MISMATCH';
  readonly failureClass: 'ASSESSMENT_NOT_CURRENT';
  readonly reasonCode: 'REQUESTED_ASSESSMENT_IS_NOT_THE_CURRENT_ASSESSMENT';
}

/** U20-D: content read for the evidence/root details failed its own identity -> fail closed. */
export interface GovernedEvidenceIntegrityFailure {
  readonly ok: false;
  readonly status: 424;
  readonly error: string;
  readonly code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED';
  readonly failureClass: 'EVIDENCE_TAMPERED' | 'EVIDENCE_CORRUPTED' | 'ROOT_PROVENANCE_TAMPERED';
  readonly reasonCode: string;
}

function governedEvidenceIntegrityFailure(
  integrity: Extract<GovernedAssessmentDetails['integrity'], { ok: false }>,
): GovernedEvidenceIntegrityFailure {
  return {
    ok: false,
    status: 424,
    error:
      `Bedömningens underlag klarade inte integritetskontrollen (${integrity.failureClass}: ` +
      `${integrity.artifactId}). Bedömningen visas inte.`,
    code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED',
    failureClass: integrity.failureClass,
    reasonCode: integrity.failureClass,
  };
}

// ---------------------------------------------------------------------------------------------
// U20CDF4 -- RECORD_INTEGRITY_ERROR fails closed (owner decision 2026-10-03 night (4) point 1, and the
// coordinator's binding clarifications 1-2)
// ---------------------------------------------------------------------------------------------

/** The machine code of the fail-closed answer (PRES-24; failureClass RECORD_INTEGRITY_ERROR). */
export const ASSESSMENT_RECORD_INTEGRITY_CODE = 'ASSESSMENT_RECORD_INTEGRITY_ERROR';

/*
 * U20CDF4: the stored findings of a record that failed its integrity check travel only as the
 * NON-AUTHORITATIVE RecordIntegrityDiagnostic. W-U20CDF5: its builder and wire whitelist live in
 * recordIntegrityDiagnostic.ts (shared with the fresh run, L1; capped and registry-only, L5) and are
 * re-exported here unchanged.
 */
export {
  recordIntegrityDiagnosticWire,
  RECORD_INTEGRITY_MAX_ENTRIES,
  type RecordIntegrityDiagnostic,
  type StoredFindingLevelUnverified,
} from './recordIntegrityDiagnostic';

/**
 * U20CDF4 (owner decision (4) point 1): a CURRENT governed assessment whose stored record is
 * structurally inconsistent (coverage_state RECORD_INTEGRITY_ERROR) is not presented as an assessment
 * -- not by the read-back, the PDF, verify or the map. 424, not retryable. The stored findings do not
 * disappear from view: they are named in the Swedish text and travel in `record_integrity`, marked
 * unverified and non-authoritative. (HISTORICAL_COVERAGE_UNKNOWN and PINNED_EVIDENCE_UNREADABLE are
 * other states and keep their own answers.)
 */
export interface GovernedRecordIntegrityFailure {
  readonly ok: false;
  readonly status: 424;
  readonly error: string;
  readonly code: typeof ASSESSMENT_RECORD_INTEGRITY_CODE;
  readonly failureClass: 'RECORD_INTEGRITY_ERROR';
  /** The first basis code, e.g. UNKNOWN_SEVERITY (stable, without the id). */
  readonly reasonCode: string;
  readonly retryable: false;
  readonly record_integrity: RecordIntegrityDiagnostic;
}

const RISK_WORD_SV: Readonly<Record<string, string>> = { HIGH: 'hög', MEDIUM: 'måttlig', LOW: 'låg' };

function recordIntegrityFailure(
  assessmentArtifactId: string,
  statement: GovernedOverallStatement,
  rawFindings: unknown,
): GovernedRecordIntegrityFailure {
  const diagnostic = recordIntegrityDiagnostic(assessmentArtifactId, statement.coverage_basis, rawFindings);
  const basisCodes = diagnostic.basis_codes;
  const stored = diagnostic.stored_findings_unverified;
  const named = storedRiskFindingsSv(Array.isArray(rawFindings) ? rawFindings : []);
  const storedSv = !Array.isArray(rawFindings)
    ? // W-U20CDF5 (L3): never "inga fynd" for a record whose findings cannot be read at all.
      'Den lagrade postens fynd kan inte läsas: fältet saknas eller är inte en lista.'
    : stored.total === 0
      ? 'Den lagrade posten innehåller inga fynd.'
      : `Den lagrade posten innehåller ${stored.total} fynd som inte kan verifieras` +
        (stored.highest_level ? ` (högsta lagrade risknivå, overifierad: ${RISK_WORD_SV[stored.highest_level]})` : '') +
        (named ? `: ${named}.` : '.') +
        (stored.counts.malformed > 0 ? ` ${stored.counts.malformed} av dem är felformade.` : '');
  return {
    ok: false,
    status: 424,
    error:
      'Bedömningen kan inte visas: dess lagrade underlag är motsägelsefullt eller ligger utanför det styrda formatet ' +
      `(RECORD_INTEGRITY_ERROR: ${basisCodes.join(', ')}). Täckningsgrad och samlad risknivå kan därför inte fastställas, ` +
      `och bedömningen redovisas inte som en giltig bedömning. ${storedSv} ` +
      'Felet löses inte av ett nytt försök. Kontakta systemets administratör.',
    code: ASSESSMENT_RECORD_INTEGRITY_CODE,
    failureClass: 'RECORD_INTEGRITY_ERROR',
    reasonCode: basisCodes[0] ?? 'RECORD_INTEGRITY_ERROR',
    retryable: false,
    record_integrity: diagnostic,
  };
}

/**
 * W-U20CDF5: the statement context of a STORED record, the same on every path that reads one back (the
 * read-back, the PDF, verify and the map): its findings, what the read could not read among its pinned
 * evidence, and the record facts the findings list alone cannot carry (L3: whether it has a findings field
 * at all).
 */
function storedRecordStatementContext(
  assessment: LocalizationAssessmentArtifact,
  details: Pick<GovernedAssessmentDetails, 'pinnedEvidence'>,
): Parameters<typeof governedOverallStatement>[2] {
  return {
    findings: assessment.payload.findings,
    pinnedEvidence: details.pinnedEvidence,
    storedRecord: { hasFindingsField: (assessment.payload as { findings?: unknown }).findings !== undefined },
  };
}

/** W-U20CDF5 (U20CDF4 verification M1): verify / the map could not read every pinned evidence of the record. */
export const ASSESSMENT_PINNED_EVIDENCE_UNREADABLE_CODE = 'ASSESSMENT_PINNED_EVIDENCE_UNREADABLE';

/**
 * W-U20CDF5 (U20CDF4 verification M1; owner decisions (4) point 1 and (5)): the integrity pre-check of verify
 * or the map could not read every pinned evidence, and nothing it could read establishes a break. The record
 * may be fine or may not: its integrity is not established, so verify does not replay it (never PASS) and the
 * map does not present it (never 200). A typed read fault in the shared classes: READ_ERROR (retryable) for a
 * read of unknown persistence, MISSING_FROM_CAS (lasting, not retryable) for pinned evidence the CAS does not
 * hold. (The read-back keeps its own 200 PINNED_EVIDENCE_UNREADABLE state, U20CDF2 G2: it presents no level
 * and no count, and names the stored findings.)
 */
export interface PinnedEvidenceUnreadableRefusal {
  readonly ok: false;
  readonly status: 409 | 503;
  readonly error: string;
  readonly code: typeof ASSESSMENT_PINNED_EVIDENCE_UNREADABLE_CODE;
  readonly failureClass: ReadFaultClass;
  /** EVIDENCE_READ_ERROR / EVIDENCE_NOT_FOUND (governedEvidenceDetails' class of the failed reads), else PINNED_EVIDENCE_UNREADABLE. */
  readonly reasonCode: string;
  readonly retryable: boolean;
}

function pinnedEvidenceUnreadableRefusal(statement: GovernedOverallStatement, path: 'verify' | 'map'): PinnedEvidenceUnreadableRefusal {
  const technical = statement.pinned_evidence?.technical_error_class ?? null;
  // governedEvidenceDetails' own reviewed classification of the failed reads, in the shared classes: a pinned
  // artifact the CAS does not hold is MISSING_FROM_CAS (lasting); anything else a READ_ERROR (retryable).
  const fault = readFaultOfClass(technical === 'EVIDENCE_NOT_FOUND' ? 'MISSING_FROM_CAS' : 'READ_ERROR');
  const consequence =
    path === 'verify'
      ? 'Bedömningens integritet kunde därför inte kontrolleras: reproducerbarhetskontrollen genomfördes inte och inget utfall anges.'
      : 'Bedömningens integritet kunde därför inte kontrolleras, och kartan visar inte bedömningen.';
  return {
    ok: false,
    status: readFaultHttpStatus(fault),
    error: `${readFaultSentenceSv(fault, 'Den pinnade evidensen som bedömningen är bunden till')} ${consequence}`,
    code: ASSESSMENT_PINNED_EVIDENCE_UNREADABLE_CODE,
    failureClass: fault.faultClass,
    reasonCode: technical ?? 'PINNED_EVIDENCE_UNREADABLE',
    retryable: fault.retryable,
  };
}

/**
 * U20CDF4: the record-integrity check of an already identity-verified current assessment, for the
 * paths that do not build the read-back themselves (verify, the map). 'map' answers a tampered/corrupted
 * pinned artifact with the read-back's own 424; 'verify' leaves it to H15 (its PASS/DENY semantics: H15
 * reports a tampered evidence as DENY).
 * W-U20CDF5 (U20CDF4 verification M1): a pre-check that could not read every pinned evidence never lets
 * either path go on -- a visible break is the 424 (assessGovernedCoverage puts it first), otherwise the
 * typed PinnedEvidenceUnreadableRefusal.
 */
async function currentRecordIntegrityRefusal(
  assessment: LocalizationAssessmentArtifact,
  artifactRepository: ArtifactRepositoryPort,
  path: 'verify' | 'map',
): Promise<GovernedRecordIntegrityFailure | GovernedEvidenceIntegrityFailure | PinnedEvidenceUnreadableRefusal | null> {
  const details = await resolveGovernedAssessmentDetails({ assessment, artifactRepository });
  if (details.integrity.ok === false) {
    return path === 'map' ? governedEvidenceIntegrityFailure(details.integrity) : null;
  }
  const statement = governedOverallStatement(
    governedVerdictFromFindings(assessment.payload.findings).overallRisk,
    details.governedLayerChecks,
    storedRecordStatementContext(assessment, details),
  );
  if (statement.coverage_state === 'RECORD_INTEGRITY_ERROR') {
    return recordIntegrityFailure(assessment.artifact_id, statement, assessment.payload.findings);
  }
  if (statement.coverage_state === 'PINNED_EVIDENCE_UNREADABLE') return pinnedEvidenceUnreadableRefusal(statement, path);
  return null;
}

type CurrentAssessmentInput = {
  readonly authUser: AuthUser;
  readonly projectId: string;
  readonly artifactRepository?: ArtifactRepositoryPort;
  readonly currentBindingProvider?: ProjectContextBindingProvider;
  readonly assessmentProjectionIndex?: ProjectAssessmentProjectionIndex;
  readonly localizationGeometryIndex?: LocalizationGeometryProjectionIndex;
  /**
   * U20-D: when given, the resolved current assessment must be exactly this one, or the call fails
   * closed with 409 ASSESSMENT_ID_MISMATCH. Omitted: unchanged behaviour (the current assessment).
   */
  readonly expectedAssessmentArtifactId?: string;
};

type CurrentAssessmentFailure =
  | { ok: false; status: number; error: string }
  | LocalizationGeometryCurrentnessFailureResponse
  | AssessmentIdMismatchFailure
  | AssessmentReadFailure
  | AssessmentSelectionRefusal;

/**
 * U20CDF2 (coordinator add-on 2; OD-R2: a CAS/read error is a technical error, never "missing").
 * Before, every failure to resolve or read the current assessment answered 404 "no current
 * assessment". Now only a genuine absence does (the projection's own REJECT_* refusals, or the
 * repository's "Artifact not found" for the assessment id -- the existing contract); a read that
 * FAILED is 503 with a typed class and an honest retryable flag:
 *  - ASSESSMENT_READ_ERROR: the assessment could not be read (e.g. EIO) -- retryable;
 *  - ASSESSMENT_STORAGE_INTEGRITY_FAULT: a lasting storage fault (object gone behind its index entry,
 *    torn index entry, corrupt bytes) -- not retryable;
 *  - ASSESSMENT_RESOLUTION_ERROR: the current assessment could not be determined for a technical
 *    reason (e.g. the projection index cannot be read) -- retryable.
 * The fault's own text never leaves the server.
 *
 * W-APR (OD-R1/OD-R2, forward-only): a candidate that may be the current assessment could not be read
 * or verified during the selection itself (AssessmentProjectionCandidateUnverifiableError). Same
 * classes, with the reason code saying it was the CURRENT-ASSESSMENT selection that could not finish:
 *  - CURRENT_ASSESSMENT_CANDIDATE_READ_ERROR (failureClass ASSESSMENT_READ_ERROR): retryable;
 *  - CURRENT_ASSESSMENT_CANDIDATE_INTEGRITY_FAULT (failureClass ASSESSMENT_STORAGE_INTEGRITY_FAULT):
 *    lost object, missing index entry, torn entry, corrupt bytes, tampered content, another artifact
 *    under the id, an inconsistent projection row -- not retryable.
 * The text says that an older assessment is never shown in its place.
 *
 * W-APR add-on 2 (U20CDF2 verifier H1): the current binding could not be resolved
 * (AssessmentProjectionBindingUnresolvableError) -- CURRENT_BINDING_READ_ERROR (failureClass
 * ASSESSMENT_RESOLUTION_ERROR, retryable) or CURRENT_BINDING_INTEGRITY_FAULT (failureClass
 * ASSESSMENT_STORAGE_INTEGRITY_FAULT, not retryable); a binding that fails verification is a
 * refusal, see AssessmentSelectionRefusal.
 */
export interface AssessmentReadFailure {
  ok: false;
  status: 503;
  error: string;
  code: 'ASSESSMENT_READ_ERROR';
  failureClass: 'ASSESSMENT_READ_ERROR' | 'ASSESSMENT_STORAGE_INTEGRITY_FAULT' | 'ASSESSMENT_RESOLUTION_ERROR';
  reasonCode:
    | 'ASSESSMENT_READ_ERROR'
    | 'ASSESSMENT_STORAGE_INTEGRITY_FAULT'
    | 'ASSESSMENT_RESOLUTION_ERROR'
    | 'CURRENT_ASSESSMENT_CANDIDATE_READ_ERROR'
    | 'CURRENT_ASSESSMENT_CANDIDATE_INTEGRITY_FAULT'
    | 'CURRENT_BINDING_READ_ERROR'
    | 'CURRENT_BINDING_INTEGRITY_FAULT';
  retryable: boolean;
}

/**
 * W-APR add-on 3 (U20CDF2 verifier H1): a REJECT_* of the selection is classified as what it is --
 * 404 "no current assessment" is kept ONLY for genuine absence (REJECT_ASSESSMENT_PROJECTION_NOT_FOUND
 * and _NOT_CURRENT: no row, no row for the current binding/point, no binding registered, or every row
 * proven not current by its own verified content). Every other refusal is not absence:
 *  - REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT -> 409 ASSESSMENT_CURRENT_AMBIGUOUS (several valid
 *    assessments, none designated current);
 *  - REJECT_LOCALIZATION_ASSESSMENT* (validateLocalizationAssessmentContractVersion) -> 424
 *    ASSESSMENT_CONTRACT_INVALID (the stored assessment follows no accepted contract);
 *  - a binding that fails verification (AssessmentProjectionBindingUnresolvableError, REFUSED) -> 409
 *    CURRENT_BINDING_REFUSED;
 *  - any other REJECT_* -> 409 ASSESSMENT_SELECTION_REFUSED.
 * `reasonCode` is the stable REJECT_* token (never the message text); none is retryable.
 */
export interface AssessmentSelectionRefusal {
  ok: false;
  status: 409 | 424;
  error: string;
  code: 'ASSESSMENT_CURRENT_UNRESOLVED' | 'ASSESSMENT_CONTRACT_REFUSED';
  failureClass: 'ASSESSMENT_CURRENT_AMBIGUOUS' | 'ASSESSMENT_CONTRACT_INVALID' | 'CURRENT_BINDING_REFUSED' | 'ASSESSMENT_SELECTION_REFUSED';
  reasonCode: string;
  retryable: false;
}

/** The REJECT_* tokens of the selection that mean genuine absence -- the only ones answered with 404. */
const ASSESSMENT_ABSENCE_REFUSALS: ReadonlySet<string> = new Set([
  'REJECT_ASSESSMENT_PROJECTION_NOT_FOUND',
  'REJECT_ASSESSMENT_PROJECTION_NOT_CURRENT',
]);

const NO_CURRENT_ASSESSMENT_ERROR = 'No current governed LU assessment is available for this project.';

function assessmentReadFailure(
  failureClass: AssessmentReadFailure['failureClass'],
  retryable: boolean,
  error: string,
  reasonCode: AssessmentReadFailure['reasonCode'] = failureClass,
): AssessmentReadFailure {
  return { ok: false, status: 503, error, code: 'ASSESSMENT_READ_ERROR', failureClass, reasonCode, retryable };
}

/** W-APR: recognized by its stable code and flag (value-based, like the other storage-fault checks). */
function isCurrentAssessmentCandidateUnverifiable(error: unknown): error is { code: string; retryable: boolean } {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE &&
    typeof (error as { retryable?: unknown }).retryable === 'boolean'
  );
}

/** W-APR add-on 2: the binding-resolution fault, by its stable code (value-based). */
function isCurrentBindingUnresolvable(error: unknown): error is { reason: string; retryable: boolean; refusalCode: string | null } {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === ASSESSMENT_PROJECTION_BINDING_UNRESOLVABLE &&
    typeof (error as { reason?: unknown }).reason === 'string'
  );
}

function selectionRefusal(
  status: 409 | 424,
  code: AssessmentSelectionRefusal['code'],
  failureClass: AssessmentSelectionRefusal['failureClass'],
  reasonCode: string,
  error: string,
): AssessmentSelectionRefusal {
  return { ok: false, status, error, code, failureClass, reasonCode, retryable: false };
}

/**
 * A failure of resolveCurrentAssessmentProjection. 404 only for genuine absence (the projection's
 * NOT_FOUND / NOT_CURRENT); a technical or integrity fault is 503, any other REJECT_* is a refusal
 * (409/424) -- see AssessmentReadFailure and AssessmentSelectionRefusal.
 */
function assessmentResolutionFailure(error: unknown): { ok: false; status: number; error: string } | AssessmentReadFailure | AssessmentSelectionRefusal {
  if (isCurrentBindingUnresolvable(error)) {
    if (error.reason === 'REFUSED') {
      return selectionRefusal(
        409,
        'ASSESSMENT_CURRENT_UNRESOLVED',
        'CURRENT_BINDING_REFUSED',
        error.refusalCode ?? 'REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE',
        'Projektets aktuella bedömning kan inte fastställas: projektets aktuella bindning underkändes vid verifieringen ' +
          '(utfärdare, signatur, innehåll eller ersättningskedja). Ingen bedömning visas, och en äldre bedömning visas aldrig ' +
          'i stället. Felet löses inte av ett nytt försök. Kontakta systemets administratör.',
      );
    }
    return error.retryable
      ? assessmentReadFailure(
          'ASSESSMENT_RESOLUTION_ERROR',
          true,
          'Projektets aktuella bedömning kan inte fastställas: projektets aktuella bindning kunde inte läsas (tekniskt fel). ' +
            'Den saknas inte, men ingen bedömning kan visas nu. En äldre bedömning visas aldrig i stället. ' +
            retrySentenceSv(true),
          'CURRENT_BINDING_READ_ERROR',
        )
      : assessmentReadFailure(
          'ASSESSMENT_STORAGE_INTEGRITY_FAULT',
          false,
          'Projektets aktuella bedömning kan inte fastställas: projektets aktuella bindning kunde inte läsas ur CAS ' +
            '(bestående lagrings- eller integritetsfel). En äldre bedömning visas aldrig i stället. ' +
            `${retrySentenceSv(false)} Kontakta systemets administratör.`,
          'CURRENT_BINDING_INTEGRITY_FAULT',
        );
  }
  if (isCurrentAssessmentCandidateUnverifiable(error)) {
    return error.retryable
      ? assessmentReadFailure(
          'ASSESSMENT_READ_ERROR',
          true,
          'Projektets aktuella bedömning kan inte fastställas: en bedömning som kan vara den aktuella kunde inte läsas ur CAS ' +
            '(tekniskt fel). Den saknas inte, men kan inte visas nu. En äldre bedömning visas aldrig i stället. ' +
            retrySentenceSv(true),
          'CURRENT_ASSESSMENT_CANDIDATE_READ_ERROR',
        )
      : assessmentReadFailure(
          'ASSESSMENT_STORAGE_INTEGRITY_FAULT',
          false,
          'Projektets aktuella bedömning kan inte fastställas: en bedömning som kan vara den aktuella kunde inte läsas ' +
            'eller verifieras ur CAS (bestående lagrings- eller integritetsfel). En äldre bedömning visas aldrig i stället. ' +
            `${retrySentenceSv(false)} Kontakta systemets administratör.`,
          'CURRENT_ASSESSMENT_CANDIDATE_INTEGRITY_FAULT',
        );
  }
  const refusal = error instanceof Error ? /^(REJECT_[A-Z0-9_]+)/.exec(error.message)?.[1] : undefined;
  if (refusal !== undefined) {
    if (ASSESSMENT_ABSENCE_REFUSALS.has(refusal)) {
      return { ok: false, status: 404, error: NO_CURRENT_ASSESSMENT_ERROR };
    }
    if (refusal === 'REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT') {
      return selectionRefusal(
        409,
        'ASSESSMENT_CURRENT_UNRESOLVED',
        'ASSESSMENT_CURRENT_AMBIGUOUS',
        refusal,
        'Projektets aktuella bedömning kan inte fastställas: det finns flera giltiga bedömningar för den aktuella bindningen ' +
          'och platsen, och ingen av dem är utpekad som den aktuella. Ingen av dem visas som aktuell. Ett nytt försök ändrar ' +
          'inte detta.',
      );
    }
    if (refusal.startsWith('REJECT_LOCALIZATION_ASSESSMENT')) {
      return selectionRefusal(
        424,
        'ASSESSMENT_CONTRACT_REFUSED',
        'ASSESSMENT_CONTRACT_INVALID',
        refusal,
        'Projektets aktuella bedömning kan inte visas: den följer inget godkänt bedömningskontrakt (okänd eller ogiltig ' +
          'kontraktsversion). En äldre bedömning visas aldrig i stället. ' +
          `${retrySentenceSv(false)} Kontakta systemets administratör.`,
      );
    }
    return selectionRefusal(
      409,
      'ASSESSMENT_CURRENT_UNRESOLVED',
      'ASSESSMENT_SELECTION_REFUSED',
      refusal,
      'Projektets aktuella bedömning kan inte fastställas: urvalet av den aktuella bedömningen underkändes. Ingen bedömning ' +
        'visas, och en äldre bedömning visas aldrig i stället. Felet löses inte av ett nytt försök.',
    );
  }
  return assessmentReadFailure(
    'ASSESSMENT_RESOLUTION_ERROR',
    true,
    `Den aktuella bedömningen kunde inte fastställas på grund av ett tekniskt fel. ${retrySentenceSv(true)}`,
  );
}

/** A failed read of the resolved assessment itself: only the repository's "not found" is absence. */
function assessmentArtifactReadFailure(error: unknown, assessmentArtifactId: string): { ok: false; status: number; error: string } | AssessmentReadFailure {
  if (error instanceof Error && error.message === `Artifact not found: ${assessmentArtifactId}`) {
    return { ok: false, status: 404, error: NO_CURRENT_ASSESSMENT_ERROR };
  }
  if (isPersistentStorageFault(error)) {
    return assessmentReadFailure(
      'ASSESSMENT_STORAGE_INTEGRITY_FAULT',
      false,
      `Bedömningen kunde inte läsas ur CAS (bestående lagringsfel). ${retrySentenceSv(false)}`,
    );
  }
  return assessmentReadFailure(
    'ASSESSMENT_READ_ERROR',
    true,
    `Bedömningen kunde inte läsas ur CAS (tekniskt fel). Den saknas inte, men kan inte visas nu. ${retrySentenceSv(true)}`,
  );
}

/**
 * The identity resolution shared by the read-back, the PDF and verify: project authorization ->
 * current geometry -> current assessment projection -> CAS read -> tamper / contract / binding
 * verification. Never runs the kernel. verify uses only this (not the evidence details), so its
 * PASS/DENY semantics are exactly as before.
 */
async function resolveCurrentLuAssessmentCore(input: CurrentAssessmentInput): Promise<
  | {
      ok: true;
      assessment: LocalizationAssessmentArtifact;
      artifactRepository: ArtifactRepositoryPort;
      currentGeometry: CurrentLocalizationGeometry | null;
    }
  | CurrentAssessmentFailure
> {
  const projectId = String(input.projectId || '').trim();
  if (!projectId) {
    return { ok: false, status: 400, error: 'projectId required' };
  }

  try {
    await assertProjectAccess(input.authUser, projectId, input.authUser.organisationId);
  } catch {
    return { ok: false, status: 403, error: 'Not authorized for this project.' };
  }

  const artifactRepository = input.artifactRepository ?? (await MimersIntegration.create()).artifactRepository;
  const currentBindingProvider =
    input.currentBindingProvider ??
    new ProjectContextBindingProvider(
      artifactRepository,
      new PrismaProjectContextBindingIndex(),
      getProjectContextBindingIssuerVerifier(),
    );

  // DEMO M1a / D9(a): ONLY currentness NOT_FOUND keeps the legacy binding-only eligibility. Any
  // other currentness failure fails closed here -- silently dropping the geometry filter would let
  // a binding-only (possibly stale-point) assessment be presented as current.
  const currentGeometry = await resolveReadBackGeometryCurrentness(projectId, artifactRepository, input.localizationGeometryIndex);
  if (currentGeometry.ok === false) return currentGeometry.failure;
  const currentLocalizationGeometryArtifactId = currentGeometry.current?.geometryArtifactId;

  let assessmentArtifactId: string;
  try {
    const projection = await resolveCurrentAssessmentProjection({
      projectId,
      artifactRepository,
      currentBindingProvider,
      currentLocalizationGeometryArtifactId,
      index: input.assessmentProjectionIndex,
    });
    assessmentArtifactId = projection.assessmentArtifactId;
  } catch (error) {
    // U20CDF2 (add-on 2, OD-R2): absence stays 404; a technical failure to resolve is 503.
    return assessmentResolutionFailure(error);
  }

  if (input.expectedAssessmentArtifactId !== undefined && input.expectedAssessmentArtifactId !== assessmentArtifactId) {
    return {
      ok: false,
      status: 409,
      error:
        'Den begärda bedömningen är inte projektets aktuella styrda bedömning. Ingen annan bedömning ' +
        'används i dess ställe; ladda om bedömningen och försök igen.',
      code: 'ASSESSMENT_ID_MISMATCH',
      failureClass: 'ASSESSMENT_NOT_CURRENT',
      reasonCode: 'REQUESTED_ASSESSMENT_IS_NOT_THE_CURRENT_ASSESSMENT',
    };
  }

  let assessment: LocalizationAssessmentArtifact;
  try {
    assessment = await artifactRepository.resolve<LocalizationAssessmentArtifact>({
      artifact_id: assessmentArtifactId,
      artifact_type: 'LOCALIZATION_ASSESSMENT',
    });
  } catch (error) {
    // U20CDF2 (add-on 2, OD-R2): only the repository's "not found" is absence (404); a read that
    // failed is a technical 503 -- retryable unless the storage fault is lasting.
    return assessmentArtifactReadFailure(error, assessmentArtifactId);
  }

  const recomputedAssessmentHash = sha256ContentHash(localizationAssessmentCanonicalBody(assessment));
  const untampered =
    recomputedAssessmentHash.algorithm === assessment.content_hash.algorithm &&
    recomputedAssessmentHash.value === assessment.content_hash.value &&
    assessment.artifact_id === `assessment-${recomputedAssessmentHash.value}`;
  if (!untampered) {
    return { ok: false, status: 424, error: 'Governed LU assessment failed tamper verification.' };
  }

  try {
    validateLocalizationAssessmentContractVersion(assessment.payload);
  } catch (error) {
    return {
      ok: false,
      status: 424,
      error: error instanceof Error ? error.message : 'Unsupported assessment contract version.',
    };
  }

  try {
    await authorizeAssessmentPresentation({
      projectId,
      assessment,
      assertProjectAccess: async () => {
        await assertProjectAccess(input.authUser, projectId, input.authUser.organisationId);
      },
      bindingProvider: currentBindingProvider,
    });
  } catch {
    return { ok: false, status: 424, error: 'Governed LU assessment is not bound to this project.' };
  }

  return { ok: true, assessment, artifactRepository, currentGeometry: currentGeometry.current };
}

/**
 * LU-ASSESSMENT-PERSISTENCE-READ-V1 (backend half).
 *
 * Read-only counterpart to `resolveLuViewerPresentation`: same discovery chain (project
 * authorization -> current-geometry-aware `resolveCurrentAssessmentProjection`), but returns the
 * assessment's own governed `findings`/`rule_refs`/`evidence_refs` rather than rendering geojson.
 * Deliberately does NOT require a configured ViewerCapability -- reading findings is not the same
 * product concern as rendering the map, and gating one on the other would be a wrong dependency.
 *
 * This is a read of an assessment that was ALREADY produced and persisted by a prior governed
 * kernel run (via GovernedAssessmentPersistence) -- it never runs the kernel, never re-evaluates
 * rules, and is not a second assessment path. The tamper/binding verification mirrors
 * `resolveGovernedLocalizationPresentation` exactly (never trusts even `resolveCurrentAssessmentProjection`'s
 * own re-verified selection without re-verifying again at the point of use).
 *
 * U20-D: also returns the governed layer checks (the same array the fresh run shows), the details
 * of every pinned evidence and the property root, all resolved from CAS by governedEvidenceDetails,
 * plus the coverage-qualified overall statement. Content that was read but fails its own identity
 * fails the whole read-back closed (424); content that could not be read is reported per entry.
 */
export async function resolveCurrentLuAssessmentSummary(input: CurrentAssessmentInput): Promise<
  | {
      ok: true;
      assessmentArtifactId: string;
      findings: LocalizationAssessmentArtifact['payload']['findings'];
      ruleRefs: LocalizationAssessmentArtifact['payload']['rule_refs'];
      evidenceRefs: LocalizationAssessmentArtifact['payload']['evidence_refs'];
      systemSummary: string;
      /** LU-REPORT-EXPORT-UI-V1. The assessment's own governed context refs -- for a caller (e.g.
       *  PDF export) that needs human-readable property/project identity without trusting
       *  anything client-supplied. Resolving these further is a CAS read, not a re-execution. */
      propertyContextRef: LocalizationAssessmentArtifact['payload']['property_ref'];
      projectContextRef: LocalizationAssessmentArtifact['payload']['project_context_ref'];
      /** DEMO M1a / D9(a): which geometry this assessment was produced for, and how it came about. */
      localizationGeometry: LuAssessmentGeometryProvenance;
      /**
       * K0: the machine-readable document check, derived from this assessment's own pinned
       * evidence_refs -- the same object the fresh generate-report run showed as its
       * `governed_layer_checks` element `layer: 'document'`. Never CHECKED_NO_HIT in v1.
       */
      documentCheck: GovernedDocumentCheck;
      /** U20-D: the same array as the fresh run's `executionMotor.governed_layer_checks`. */
      governedLayerChecks: readonly PresentedGovernedLayerCheck[];
      /** U20-D: one entry per pinned evidence ref, resolved from CAS. */
      evidenceDetails: readonly GovernedEvidenceDetail[];
      /** U20-D (K5): the property root's provenance and assurance. */
      propertyRoot: PropertyRootDetails;
      /** U20-D / OD-K0-1: the risk level only together with the governed check coverage. */
      overallStatement: GovernedOverallStatement;
      /** U20-D, provisional and derived (owner decision pending): see DerivedOverallSummary. */
      overall_summary: DerivedOverallSummary;
    }
  | CurrentAssessmentFailure
  | GovernedEvidenceIntegrityFailure
  | AssessmentGeometryFailure
  | GovernedRecordIntegrityFailure
> {
  const core = await resolveCurrentLuAssessmentCore(input);
  if (core.ok === false) return core;
  const { assessment, artifactRepository, currentGeometry } = core;

  const details = await resolveGovernedAssessmentDetails({ assessment, artifactRepository });
  if (details.integrity.ok === false) return governedEvidenceIntegrityFailure(details.integrity);
  const boundGeometry = await resolveBoundLocalizationGeometry(assessment, artifactRepository, String(input.projectId || '').trim());
  if (boundGeometry.ok === false) return boundGeometry;
  const verdict = governedVerdictFromFindings(assessment.payload.findings);
  // U20CDF2 (G1): coverage and risk from the same stored record -- its findings and its checks.
  // U20CDF2 (G2): and what this read could not read among the pinned refs (integrity/technical error).
  const overallStatement = governedOverallStatement(verdict.overallRisk, details.governedLayerChecks, storedRecordStatementContext(assessment, details));
  // U20CDF4 (owner decision 2026-10-03 (4) point 1): a structurally inconsistent current record is not
  // returned as a 200 assessment (and so not as a PDF either, which is built from this answer). Its
  // stored findings stay in view only as non-authoritative diagnostic data (GovernedRecordIntegrityFailure).
  if (overallStatement.coverage_state === 'RECORD_INTEGRITY_ERROR') {
    return recordIntegrityFailure(assessment.artifact_id, overallStatement, assessment.payload.findings);
  }

  return {
    ok: true,
    assessmentArtifactId: assessment.artifact_id,
    // U20CDF (U30-R2 verification follow-up): a NOT_CHECKED layer finding is shown with the neutral
    // standard text, never a stored provider/SQL text; the stored artifact is untouched.
    findings: presentGovernedFindings(assessment.payload.findings),
    ruleRefs: assessment.payload.rule_refs,
    evidenceRefs: assessment.payload.evidence_refs,
    systemSummary: assessment.payload.system_summary,
    propertyContextRef: assessment.payload.property_ref,
    projectContextRef: assessment.payload.project_context_ref,
    // The assessment's own content-addressed localization_geometry_ref is the stored binding; when
    // the project has a current geometry, resolveCurrentAssessmentProjection has already required
    // that ref to equal it, so the provenance below is the provenance of the assessed point itself
    // (read from the CAS-verified geometry artifact, never from a client or a projection row).
    localizationGeometry: {
      artifact_id: assessment.payload.localization_geometry_ref?.artifact_id ?? null,
      provenance: currentGeometry?.geometry.payload.provenance ?? null,
      provenance_label_sv: localizationGeometryProvenanceLabelSv(currentGeometry?.geometry.payload.provenance),
      // U20-D: the coordinates of the point THIS assessment is bound to (verified, from CAS).
      ...boundGeometry.value,
    },
    // K0: from the tamper-verified assessment's pinned refs only (no live read, not from findings).
    // U20CDF (F3): a pinned document artifact this read-back could not resolve from CAS makes it a
    // technical error (PINNED_EVIDENCE_UNREADABLE), never CHECKED_HIT -- the same row as below.
    documentCheck: details.documentCheck,
    governedLayerChecks: details.governedLayerChecks,
    evidenceDetails: details.evidenceDetails,
    propertyRoot: details.propertyRoot,
    overallStatement,
    overall_summary: derivedOverallSummary(overallStatement, details.governedLayerChecks),
  };
}

/**
 * LU-REPORT-EXPORT-UI-V1.
 *
 * Builds a PDF from the SAME resolved, tamper-verified assessment resolveCurrentLuAssessmentSummary
 * already produces -- never re-runs the kernel, never accepts client-supplied findings, risk
 * conclusions, evidence content, or coordinates as report authority. The caller identifies only
 * the project; everything rendered into the PDF is resolved server-side from already-governed CAS
 * artifacts (the assessment itself, plus its own property_ref/project_context_ref -- LU_PROPERTY_CONTEXT
 * and LU_PROJECT_CONTEXT, both already-governed context artifacts, not raw/derived data).
 *
 * Deliberately does NOT reuse buildLocalizationPdfData/LocalizationPdfData: that shape requires
 * legacy compliance-rule-engine output (VISS, monuments, per-rule chapter/recommendation text,
 * protected-area names) that was never persisted onto the governed LocalizationAssessmentArtifact
 * -- only computed live, per run, and discarded. Filling that shape here would mean either
 * re-running the ungoverned legacy analysis (forbidden) or fabricating placeholder values
 * (dishonest). This is a smaller, honest report: only what the persisted assessment and its own
 * governed context refs actually contain.
 */
export async function exportCurrentLuAssessmentPdf(input: CurrentAssessmentInput): Promise<
  | { ok: true; buffer: Buffer; filename: string; assessmentArtifactId: string }
  | { ok: false; status: number; error: string }
> {
  const summary = await resolveCurrentLuAssessmentSummary(input);
  if (summary.ok === false) {
    return summary;
  }

  const artifactRepository = input.artifactRepository ?? (await MimersIntegration.create()).artifactRepository;

  let property: { property_ref: string; official_name: string; municipality: string } | null = null;
  try {
    const propertyContext = await artifactRepository.resolve<{
      payload: { property_ref: string; official_name: string; municipality: string };
    }>(summary.propertyContextRef);
    property = {
      property_ref: propertyContext.payload.property_ref,
      official_name: propertyContext.payload.official_name,
      municipality: propertyContext.payload.municipality,
    };
  } catch {
    // Governed context artifact missing/unresolvable -- report the gap honestly rather than
    // fabricate a property identity. The assessment identity itself is still verified above.
    property = null;
  }

  let project: { project_name: string; description: string } | null = null;
  try {
    const projectContext = await artifactRepository.resolve<{
      payload: { project_name: string; description: string };
    }>(summary.projectContextRef);
    project = { project_name: projectContext.payload.project_name, description: projectContext.payload.description };
  } catch {
    project = null;
  }

  const pdfData = {
    title: 'Lokaliseringsbedömning',
    generatedAt: new Date().toISOString(),
    projectId: String(input.projectId || '').trim(),
    disclaimer:
      'Human in the Loop: Detta dokument är genererat från ett styrt (governed) underlag och ' +
      'ersätter inte juridisk eller teknisk expertbedömning. Alla slutsatser ska granskas av ' +
      'behörig handläggare innan formellt beslut fattas.',
    property: property ?? { note: 'Fastighetskontext kunde inte läsas -- se teknisk verifiering nedan.' },
    project: project ?? { note: 'Projektkontext kunde inte läsas -- se teknisk verifiering nedan.' },
    systemSummary: summary.systemSummary,
    // DEMO M1a / D9(a): geometry provenance survives into the exported report.
    lokalisering: {
      geometri_artifact_id: summary.localizationGeometry.artifact_id,
      provenance: summary.localizationGeometry.provenance,
      beskrivning: summary.localizationGeometry.provenance_label_sv,
      // U20-D: the bound point itself (verified), or "Saknas i underlaget" for an older assessment.
      koordinater_wgs84_lng_lat: orMissing(summary.localizationGeometry.coordinates_wgs84),
      koordinater_sweref99tm_n_e: orMissing(summary.localizationGeometry.coordinates_sweref99tm),
      srid: orMissing(summary.localizationGeometry.srid),
    },
    // K0: the machine-readable document check -- the same object as the read-back's documentCheck.
    dokumentkontroll: {
      kontroll: summary.documentCheck.layer,
      regel: summary.documentCheck.rule_id,
      status: summary.documentCheck.status,
      // U20CDF (F3): the section 11 state of the same row (TECHNICAL_ERROR for unreadable pinned documents).
      tillstand: summary.governedLayerChecks.find((check) => check.layer === summary.documentCheck.layer)?.coverage_state ?? null,
      orsak: summary.documentCheck.reason,
      underlag_artifact_id: summary.documentCheck.evidence_artifact_id,
      beskrivning: summary.documentCheck.message_sv,
    },
    // U20-D / OD-K0-1: the risk level never alone -- always with how many governed checks were done.
    helhetsbedomning: {
      risk_level: summary.overallStatement.risk_level,
      // U20CDF2 (G1): machine-readable coverage state; the counts are null unless DETERMINED.
      tackningsgrad: summary.overallStatement.coverage_state,
      tackningsgrad_grund: summary.overallStatement.coverage_basis,
      kontroller_totalt: summary.overallStatement.coverage?.checks_total ?? null,
      kontroller_genomforda: summary.overallStatement.coverage?.checks_completed ?? null,
      text: summary.overallStatement.statement_sv,
      // U20CDF2 (G2): the bound evidence cannot be verified -- said as a whole, with class and retry.
      ...(summary.overallStatement.pinned_evidence
        ? {
            pinnad_evidens: {
              verifierbar: false,
              bundna_totalt: summary.overallStatement.pinned_evidence.pinned_total,
              olasbara_artifact_ids: summary.overallStatement.pinned_evidence.unreadable_artifact_ids,
              tekniskt_fel: summary.overallStatement.pinned_evidence.technical_error_class,
              nytt_forsok_kan_lyckas: summary.overallStatement.pinned_evidence.retryable,
            },
          }
        : {}),
    },
    // U20-D: the same governed layer checks as the fresh run and the read-back (SI-2 wording,
    // SI-3 coverage limitation per layer from the ADMIT v1 contracts).
    lagerkontroller: summary.governedLayerChecks.map((check) => ({
      kontroll: governedLayerLabelSv(check.layer),
      lager: check.layer,
      regel: check.rule_id,
      status: check.status,
      tillstand: check.coverage_state,
      orsak: check.reason,
      underlag_artifact_id: check.evidence_artifact_id,
      beskrivning: check.message_sv,
      tackning: check.coverage_limitation_sv,
      kanda_tackningsluckor: pdfKnownCoverageGaps(check.known_coverage_gaps),
    })),
    // U20-D (K3/C10): per pinned evidence -- dataset version, radius, result, cap, time, binding.
    evidensdetaljer: summary.evidenceDetails.map(pdfEvidenceDetail),
    // U20-D (K5): the property root and its honest, lower assurance.
    fastighetsrot: pdfPropertyRoot(summary.propertyRoot),
    findings: summary.findings.map((f) => ({
      finding_id: f.finding_id,
      rule_id: f.rule_id,
      rule_version: f.rule_version,
      risk_level: f.risk_level,
      explanation: f.explanation,
    })),
    ruleReferences: summary.ruleRefs,
    evidenceReferences: summary.evidenceRefs.map((ref) => ({
      artifact_id: ref.artifact_id,
      artifact_type: ref.artifact_type,
    })),
    limitations: [
      'Detta underlag omfattar endast styrda (governed) fynd som ingår i den persisterade ' +
        'bedömningen. Det ersätter inte en fullständig juridisk/teknisk utredning.',
      summary.evidenceRefs.some((r) => r.artifact_type === 'DOCUMENT_EVIDENCE')
        ? 'Dokumentunderlag ingår i denna bedömning.'
        : 'Inget dokumentunderlag (t.ex. tidigare beslut) ingår ännu i denna bedömning.',
    ],
    verification: {
      assessment_artifact_id: summary.assessmentArtifactId,
      content_hash_verified: true,
    },
  };

  const buffer = await buildJsonPdfBuffer(pdfData.title, `Projekt ${pdfData.projectId}`, pdfData);
  const safeId = pdfData.projectId.replace(/[^a-zA-Z0-9-_åäöÅÄÖ]+/g, '-').slice(0, 40) || 'projekt';
  return { ok: true, buffer, filename: `lokaliseringsbedomning-${safeId}.pdf`, assessmentArtifactId: summary.assessmentArtifactId };
}

/** U20-D / SI-3: what is missing reads "Saknas i underlaget", never an empty field or a zero. */
function orMissing<T>(value: T | null | undefined): T | string {
  return value === null || value === undefined ? MISSING_IN_BASIS_SV : value;
}

function pdfEvidenceDetail(detail: GovernedEvidenceDetail) {
  return {
    evidens_artifact_id: detail.evidence_artifact_id,
    typ: detail.artifact_type,
    lager: detail.layer ? governedLayerLabelSv(detail.layer) : MISSING_IN_BASIS_SV,
    kalla: orMissing(detail.provider),
    datasetversion: orMissing(detail.dataset_version_hash),
    versionsetikett: orMissing(detail.layer_version_label),
    kontrakt_kalla: orMissing(detail.contract?.source_id),
    importbatch: orMissing(detail.import_batch_id),
    sokradie_m: orMissing(detail.query?.distance_meters),
    fragesubjekt: orMissing(detail.query?.location_ref?.artifact_id ?? detail.query?.property_context_ref?.artifact_id),
    resultat: detail.message_sv,
    antal_traffar: orMissing(detail.result?.match_count_observed),
    tak_natt: orMissing(detail.result?.cap_reached),
    hamtad: orMissing(detail.retrieved_at),
    bindning: detail.binding_assurance,
    bindning_beskrivning: detail.binding_note_sv,
    tackning: detail.coverage_limitation_sv,
    kanda_tackningsluckor: pdfKnownCoverageGaps(detail.known_coverage_gaps),
    integritet: orMissing(detail.integrity),
    tekniskt_fel: detail.technical_error_class,
    fynd: detail.cited_by_finding_ids,
  };
}

/** U20CDF: the machine-readable coverage-gap entries behind "tackning", with date, basis and source. */
function pdfKnownCoverageGaps(gaps: readonly KnownCoverageGap[]) {
  return gaps.map((gap) => ({
    id: gap.gap_id,
    typ: gap.kind,
    lager: gap.layer_id,
    datum: gap.as_of,
    grund: gap.basis_sv,
    omkontrollerad_mot_nuvarande_tabell: gap.rechecked_against_current_table,
    kallor: gap.sources,
  }));
}

function pdfPropertyRoot(root: PropertyRootDetails) {
  return {
    status: root.status,
    fastighet: orMissing(root.property_designation),
    kalla: orMissing(root.source_dataset),
    nyckel: orMissing(root.source_key),
    kalla_uppdaterad: orMissing(root.source_updated_at),
    uppslag_artifact_id: orMissing(root.observation_artifact_id),
    kontraktsversion: orMissing(root.observation_contract_version),
    datasetbindning: orMissing(root.dataset_binding),
    sakerhet: root.assurance,
    tekniskt_fel: root.technical_error_class,
    beskrivning: root.message_sv,
  };
}

/**
 * LU-REEXECUTION-VERIFY-UI-V1.
 *
 * The narrowest possible authenticated wrapper around H15's existing, already-PROVEN
 * reExecuteLocalizationAssessment (packages/mps-lu/src/execution/LuDeterministicReExecution.ts) --
 * no replay/re-execution logic is duplicated here. Recon confirmed no production/authenticated
 * route exposed it before this unit (only scripts/ops/prove-lu-deterministic-reexecution-01.ts and
 * its own unit tests called it).
 *
 * This function's ONLY job is identity resolution: authenticate, authorize the project, resolve
 * WHICH assessment is current (reusing resolveCurrentLuAssessmentSummary exactly as
 * exportCurrentLuAssessmentPdf does), then hand that one resolved assessment_id to H15 unchanged.
 * reExecuteLocalizationAssessment's own signature (assessmentArtifactId + artifactRepository only)
 * is itself the guarantee that no client-supplied findings, evidence, expected result, or
 * coordinates can reach it -- there is no parameter through which a caller could supply them, here
 * or in H15 itself. No PostGIS/current-runtime-state dependency is introduced: H15 resolves
 * everything it needs from CAS-pinned artifacts only, exactly as it already did before this unit.
 */
const NOT_CHECKED_FINDING_ID_PREFIX = 'finding-notchecked-';

/**
 * U20CDF (U30-R2 follow-up; U30R2-REPORT section 3, owner question 6): the Swedish result text of a
 * verification, on top of the machine outcome and notices (both returned unchanged). A PASS that
 * carries NOT_CHECKED_CAUSE_NOT_PINNED is identical in layer, rule, version, risk level and evidence,
 * but the cause text of the listed NOT_CHECKED layers was never saved -- the text says so instead of
 * an unqualified "identiskt". Neutral wording; nothing here suggests tampering.
 *
 * U20CDF2 (coordinator add-on 3; owner 2026-10-02, U30R3 decision 2): verify is REPLAY/CONSISTENCY
 * verification -- the re-execution matches the pinned artifacts -- not proof of authenticity (no
 * attestation check yet). The text says exactly that ("Reproducerbarhet verifierad – resultatet
 * matchar de pinnade artefakterna"), never "verifierad/identisk/intakt" about the assessment itself;
 * the notices are shown under it as before. The machine fields (outcome, mismatches, notices) are
 * unchanged.
 */
export function verifyOutcomeSv(
  outcome: 'PASS' | 'DENY',
  notices: LuReExecutionResult['notices'],
): string {
  if (outcome !== 'PASS') {
    return 'Reproducerbarheten kunde inte bekräftas: återexekveringen gav inte samma resultat som den sparade bedömningen.';
  }
  const unpinned = notices
    .filter((notice) => notice.code === 'NOT_CHECKED_CAUSE_NOT_PINNED')
    .flatMap((notice) => notice.finding_ids);
  const passed = 'Reproducerbarhet verifierad – resultatet matchar de pinnade artefakterna';
  if (unpinned.length === 0) return `${passed}.`;
  const layers = unpinned
    .filter((id) => id.startsWith(NOT_CHECKED_FINDING_ID_PREFIX))
    .map((id) => governedLayerLabelSv(id.slice(NOT_CHECKED_FINDING_ID_PREFIX.length)));
  const named = layers.length > 0 ? ` (${layers.join(', ')})` : '';
  return `${passed}, men orsaken till att ${unpinned.length > 1 ? 'lagren' : 'lagret'} inte kontrollerades sparades inte${named}.`;
}

export async function verifyCurrentLuAssessment(input: CurrentAssessmentInput): Promise<
  | {
      ok: true;
      outcome: 'PASS' | 'DENY';
      assessmentArtifactId: string;
      mismatches: readonly LuReExecutionMismatch[];
      /** U30-R2: machine-readable statuses that are not deviations (e.g. NOT_CHECKED_CAUSE_NOT_PINNED). */
      notices: LuReExecutionResult['notices'];
      /** U20CDF: Swedish presentation of outcome + notices (verifyOutcomeSv). */
      outcome_sv: string;
    }
  | { ok: false; status: number; error: string }
  | GovernedRecordIntegrityFailure
  | PinnedEvidenceUnreadableRefusal
> {
  // U20-D: identity resolution only (plus the optional explicit-id binding) -- not the evidence
  // details, so a tampered evidence still reaches H15 and comes back as DENY/TAMPERED_EVIDENCE.
  const core = await resolveCurrentLuAssessmentCore(input);
  if (core.ok === false) {
    return core;
  }

  // U20CDF4 (owner decision 2026-10-03 (4) point 1; coordinator clarification 2: verify must never give
  // PASS for such a record): a current record that fails its integrity check is the same 424 as the
  // read-back -- never replayed and never "Reproducerbarhet verifierad" next to an integrity error. A
  // tampered/corrupted pinned evidence is left to H15 as before (DENY/TAMPERED_EVIDENCE).
  // W-U20CDF5 (U20CDF4 verification M1): nor when the pre-check could not read every pinned evidence.
  const recordRefusal = await currentRecordIntegrityRefusal(core.assessment, core.artifactRepository, 'verify');
  if (recordRefusal) return recordRefusal;

  const result = await reExecuteLocalizationAssessment({
    assessmentArtifactId: core.assessment.artifact_id,
    artifactRepository: core.artifactRepository,
  });

  const notices = Array.isArray(result.notices) ? result.notices : [];
  return {
    ok: true,
    outcome: result.outcome,
    assessmentArtifactId: result.assessment_artifact_id,
    mismatches: result.mismatches,
    notices,
    outcome_sv: verifyOutcomeSv(result.outcome, notices),
  };
}

export async function fetchLocalizationAuditTrail(projectId: string) {
  const ref = localizationAuditRef(projectId);
  const entries = await getAuditTrail(ref);
  return { ok: true as const, projectId, referenceNumber: ref, entries };
}

/** Validering utan att generera rapport (för tester). */
export function validateLocalizationBody(body: unknown): { projectId?: string; sites?: SiteAlternative[] } {
  if (!body || typeof body !== 'object') return {};
  const row = body as Record<string, unknown>;
  const projectId = row.projectId != null ? String(row.projectId).trim() : undefined;
  const sites = parseSiteAlternatives(row.siteAlternatives) ?? undefined;
  return { projectId, sites };
}
