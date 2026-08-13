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
