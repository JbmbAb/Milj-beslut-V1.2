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
  type LocalizationAssessmentArtifact,
} from '@miljobeslut/mps-lu';
import { PrismaProjectContextBindingIndex } from '../../repositories/projectContextBindingRepository';
import { getProjectContextBindingIssuerVerifier } from '../../security/projectContextBindingIssuerKey';
import { resolveCurrentAssessmentProjection } from './assessmentProjection';
import { resolveCurrentLocalizationGeometry } from './localizationGeometryProjection';
import type { LocalizationGeometryProjectionIndex } from '../../repositories/localizationGeometryProjectionRepository';
import { resolveGovernedLocalizationPresentation } from './resolveGovernedLocalizationPresentation';
import { resolveLocalizationViewerRuntimeConfigForProject, type LocalizationViewerRuntimeConfig } from './createLocalizationViewerRuntime';
import type { ProjectAssessmentProjectionIndex } from '../../repositories/projectAssessmentProjectionRepository';

export class LocalizationDataUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'LOCALIZATION_DATA_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'LocalizationDataUnavailableError';
  }
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

function assertStrictReportUsable(report: LocalizationReport): void {
  if (!isLocalizationStrictMode()) return;

  const externalSources = new Set(['NVR API', 'RAA API', 'VISS', 'SLU Artdata']);

  for (const analysis of report.siteAnalyses) {
    const unavailableExternal = analysis.dataSources.filter(
      (ds) => externalSources.has(ds.source) && ds.status === 'unavailable',
    ).length;
    const spatialDown =
      !analysis.spatialAudit.protectedAreaAvailable && !analysis.spatialAudit.distanceToWaterAvailable;

    if (unavailableExternal >= 3 || (spatialDown && unavailableExternal >= 2)) {
      throw new LocalizationDataUnavailableError(
        `Otillräcklig datakvalitet för plats ${analysis.site.id} i strikt läge. ` +
          `Externa källor otillgängliga: ${unavailableExternal}. Spatial: ${
            spatialDown ? 'degraderad' : 'delvis'
          }.`,
      );
    }
  }
}

export async function runLocalizationReport(input: {
  authUser: AuthUser;
  projectId: string;
  siteAlternatives: unknown;
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
  });

  assertStrictReportUsable(report);

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
  });

  assertStrictReportUsable(report);

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
  let currentLocalizationGeometryArtifactId: string | undefined;
  try {
    const geometry = await resolveCurrentLocalizationGeometry({
      projectId,
      artifactRepository,
      index: input.localizationGeometryIndex,
    });
    currentLocalizationGeometryArtifactId = geometry.geometryArtifactId;
  } catch {
    currentLocalizationGeometryArtifactId = undefined;
  }

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
 * rules, and is not a second assessment path. The tamper/binding verification below mirrors
 * `resolveGovernedLocalizationPresentation` exactly (never trusts even `resolveCurrentAssessmentProjection`'s
 * own re-verified selection without re-verifying again at the point of use).
 */
export async function resolveCurrentLuAssessmentSummary(input: {
  readonly authUser: AuthUser;
  readonly projectId: string;
  readonly artifactRepository?: ArtifactRepositoryPort;
  readonly currentBindingProvider?: ProjectContextBindingProvider;
  readonly assessmentProjectionIndex?: ProjectAssessmentProjectionIndex;
  readonly localizationGeometryIndex?: LocalizationGeometryProjectionIndex;
}): Promise<
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
    }
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

  let currentLocalizationGeometryArtifactId: string | undefined;
  try {
    const geometry = await resolveCurrentLocalizationGeometry({
      projectId,
      artifactRepository,
      index: input.localizationGeometryIndex,
    });
    currentLocalizationGeometryArtifactId = geometry.geometryArtifactId;
  } catch {
    currentLocalizationGeometryArtifactId = undefined;
  }

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

  return {
    ok: true,
    assessmentArtifactId: assessment.artifact_id,
    findings: assessment.payload.findings,
    ruleRefs: assessment.payload.rule_refs,
    evidenceRefs: assessment.payload.evidence_refs,
    systemSummary: assessment.payload.system_summary,
    propertyContextRef: assessment.payload.property_ref,
    projectContextRef: assessment.payload.project_context_ref,
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
export async function exportCurrentLuAssessmentPdf(input: {
  readonly authUser: AuthUser;
  readonly projectId: string;
  readonly artifactRepository?: ArtifactRepositoryPort;
  readonly currentBindingProvider?: ProjectContextBindingProvider;
  readonly assessmentProjectionIndex?: ProjectAssessmentProjectionIndex;
  readonly localizationGeometryIndex?: LocalizationGeometryProjectionIndex;
}): Promise<
  | { ok: true; buffer: Buffer; filename: string }
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
  return { ok: true, buffer, filename: `lokaliseringsbedomning-${safeId}.pdf` };
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
