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
} from '@miljobeslut/mps-lu';
import { PrismaProjectContextBindingIndex } from '../../repositories/projectContextBindingRepository';
import { getProjectContextBindingIssuerVerifier } from '../../security/projectContextBindingIssuerKey';
import { resolveCurrentAssessmentProjection } from './assessmentProjection';
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
import { computeGovernedDocumentCheck, type GovernedDocumentCheck } from './governedLayerChecks';
import {
  governedOverallStatement,
  MISSING_IN_BASIS_SV,
  resolveGovernedAssessmentDetails,
  type GovernedEvidenceDetail,
  type GovernedOverallStatement,
  type PresentedGovernedLayerCheck,
  type PropertyRootDetails,
} from './governedEvidenceDetails';
import { governedLayerLabelSv } from './governedCoverageStatement';
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
  readonly derived: true;
  readonly derivation: 'governedVerdictFromFindings + governed layer checks (stored)';
  readonly risk_level: string;
  readonly checks_completed: number | null;
  readonly checks_total: number | null;
  readonly not_completed_layers: readonly string[];
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
    derived: true,
    derivation: 'governedVerdictFromFindings + governed layer checks (stored)',
    risk_level: statement.risk_level,
    checks_completed: statement.coverage?.checks_completed ?? null,
    checks_total: statement.coverage?.checks_total ?? null,
    not_completed_layers: statement.coverage?.not_completed_layers ?? [],
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
  } catch {
    // Covers: no assessment has ever been produced for this project, the only assessment(s) on
    // record are bound to a since-superseded context, or none survive CAS re-verification.
    // Explicit, never a silent stale fallback.
    return { ok: false, status: 404, error: 'No current governed LU assessment is available for this project.' };
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

  try {
    const result = await resolveGovernedLocalizationPresentation({
      authUser: input.authUser,
      projectId,
      assessmentArtifactId,
      artifactRepository,
      config,
      currentBindingProvider,
    });
    return {
      ok: true,
      geojson: result.geojson,
      assessmentArtifactId: result.assessmentArtifactId,
      capabilityArtifactId: result.capabilityArtifactId,
    };
  } catch (error) {
    // Covers: missing/superseded/tampered capability, missing/tampered CAS evidence, wrong
    // release/viewer-identity. Fail closed, never a stale or synthetic fallback.
    return {
      ok: false,
      status: 424,
      error: error instanceof Error ? error.message : 'Governed viewer presentation is unavailable.',
    };
  }
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
  | AssessmentIdMismatchFailure;

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
  } catch {
    return { ok: false, status: 404, error: 'No current governed LU assessment is available for this project.' };
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
  } catch {
    return { ok: false, status: 404, error: 'No current governed LU assessment is available for this project.' };
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
> {
  const core = await resolveCurrentLuAssessmentCore(input);
  if (core.ok === false) return core;
  const { assessment, artifactRepository, currentGeometry } = core;

  const details = await resolveGovernedAssessmentDetails({ assessment, artifactRepository });
  if (details.integrity.ok === false) {
    return {
      ok: false,
      status: 424,
      error:
        `Bedömningens underlag klarade inte integritetskontrollen (${details.integrity.failureClass}: ` +
        `${details.integrity.artifactId}). Bedömningen visas inte.`,
      code: 'GOVERNED_EVIDENCE_INTEGRITY_FAILED',
      failureClass: details.integrity.failureClass,
      reasonCode: details.integrity.failureClass,
    };
  }
  const boundGeometry = await resolveBoundLocalizationGeometry(assessment, artifactRepository, String(input.projectId || '').trim());
  if (boundGeometry.ok === false) return boundGeometry;
  const verdict = governedVerdictFromFindings(assessment.payload.findings);
  const overallStatement = governedOverallStatement(verdict.overallRisk, details.governedLayerChecks);

  return {
    ok: true,
    assessmentArtifactId: assessment.artifact_id,
    findings: assessment.payload.findings,
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
    documentCheck: computeGovernedDocumentCheck(assessment.payload.evidence_refs),
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
      orsak: summary.documentCheck.reason,
      underlag_artifact_id: summary.documentCheck.evidence_artifact_id,
      beskrivning: summary.documentCheck.message_sv,
    },
    // U20-D / OD-K0-1: the risk level never alone -- always with how many governed checks were done.
    helhetsbedomning: {
      risk_level: summary.overallStatement.risk_level,
      kontroller_totalt: summary.overallStatement.coverage?.checks_total ?? null,
      kontroller_genomforda: summary.overallStatement.coverage?.checks_completed ?? null,
      text: summary.overallStatement.statement_sv,
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
    integritet: orMissing(detail.integrity),
    tekniskt_fel: detail.technical_error_class,
    fynd: detail.cited_by_finding_ids,
  };
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
export async function verifyCurrentLuAssessment(input: CurrentAssessmentInput): Promise<
  | { ok: true; outcome: 'PASS' | 'DENY'; assessmentArtifactId: string; mismatches: readonly LuReExecutionMismatch[] }
  | { ok: false; status: number; error: string }
> {
  // U20-D: identity resolution only (plus the optional explicit-id binding) -- not the evidence
  // details, so a tampered evidence still reaches H15 and comes back as DENY/TAMPERED_EVIDENCE.
  const core = await resolveCurrentLuAssessmentCore(input);
  if (core.ok === false) {
    return core;
  }

  const result = await reExecuteLocalizationAssessment({
    assessmentArtifactId: core.assessment.artifact_id,
    artifactRepository: core.artifactRepository,
  });

  return {
    ok: true,
    outcome: result.outcome,
    assessmentArtifactId: result.assessment_artifact_id,
    mismatches: result.mismatches,
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
