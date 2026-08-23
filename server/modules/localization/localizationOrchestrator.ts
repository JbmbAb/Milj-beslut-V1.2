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
import { ProjectContextBindingProvider } from './projectContextBindingRuntime';
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
