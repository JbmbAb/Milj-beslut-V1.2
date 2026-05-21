/**
 * localizationReportService.ts
 *
 * Generates a localization study report by analyzing multiple site alternatives.
 * Integrates spatial analysis, compliance rule evaluation, cultural heritage (RAA),
 * VISS water status, SLU species observations, and audit trail logging.
 */

import { runSpatialAudit, type SpatialAuditSummary } from './spatialAuditService';
import { evaluateComplianceRules, type SiteAnalysis } from './complianceRuleEngine';
import { fetchProtectedAreas, type ProtectedArea } from './nvrService';
import { fetchAncientMonuments, type Monument } from './raaService';
import { queryVissPoint, type VissPointResult, type VissWaterStatus } from './vissService';
import { toGeologicalData } from './sguRiskService';
import { auditTrail } from './auditTrailService';
import { searchSluByCoordinates } from './sluService';
import { logger } from '../logger';
import type { AuthUser } from '../security/types';

export interface SiteAlternative {
  id: string;
  name?: string;
  lat: number;
  lng: number;
}

export type DataSourceStatus = {
  source: string;
  status: 'ok' | 'degraded' | 'unavailable';
  detail?: string;
};

export interface SiteAnalysisResult {
  site: SiteAlternative;
  spatialAudit: SpatialAuditSummary;
  complianceAnalysis: SiteAnalysis;
  monuments: Monument[];
  vissWaterStatus: VissWaterStatus | null;
  distanceToWaterMeters: number | null;
  dataSources: DataSourceStatus[];
  warnings: string[];
  sluObservationCount: number;
}

export interface LocalizationReport {
  projectId: string;
  generatedAt: string;
  siteAnalyses: SiteAnalysisResult[];
  summary: {
    bestAlternativeId?: string;
    reasoning: string;
  };
  warnings: string[];
  humanInTheLoop: string;
}

export function isLocalizationStrictMode(): boolean {
  if (process.env.LOCALIZATION_STRICT_SOURCES === 'true') return true;
  if (process.env.LOCALIZATION_STRICT_SOURCES === 'false') return false;
  const appEnv = String(process.env.APP_ENV || '').toLowerCase();
  if (appEnv === 'staging' || appEnv === 'production') return true;
  return process.env.NODE_ENV === 'production';
}

function hasSluSpeciesConfigured(): boolean {
  return Boolean(
    process.env.SLU_SPECIES_OBS_API_KEY || (process.env.SLU_SPECIES_OBS_BASE_PATH && process.env.SLU_API_KEY),
  );
}

function parseSluObservations(raw: unknown): Array<{ name?: string; status?: string }> {
  if (!raw || typeof raw !== 'object') return [];
  const record = raw as Record<string, unknown>;
  const list = Array.isArray(record.observations)
    ? record.observations
    : Array.isArray(record.features)
      ? record.features
      : Array.isArray(record.data)
        ? record.data
        : Array.isArray(record.results)
          ? record.results
          : [];

  return list.slice(0, 50).map((item) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const props =
      row.properties && typeof row.properties === 'object'
        ? (row.properties as Record<string, unknown>)
        : row;
    const name = props.taxonName ?? props.scientificName ?? props.species ?? props.name ?? row.name;
    const status = props.redlistCategory ?? props.conservationStatus ?? props.status;
    return {
      name: name != null ? String(name).slice(0, 120) : undefined,
      status: status != null ? String(status).slice(0, 40) : undefined,
    };
  });
}

type FetchOutcome<T> = { ok: true; data: T } | { ok: false; error: string };

function getFetchError<T>(outcome: FetchOutcome<T>): string {
  if ('error' in outcome) {
    return outcome.error;
  }
  return '';
}

async function fetchNvrAreas(
  lat: number,
  lng: number,
  siteId: string,
): Promise<FetchOutcome<ProtectedArea[]>> {
  try {
    const data = await fetchProtectedAreas(lat, lng, 500);
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('fetchProtectedAreas failed for localization', { site: siteId, err: msg });
    return { ok: false, error: msg };
  }
}

async function fetchRaaMonuments(
  lat: number,
  lng: number,
  siteId: string,
): Promise<FetchOutcome<Monument[]>> {
  try {
    const data = await fetchAncientMonuments(lat, lng);
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('fetchAncientMonuments failed for localization', { site: siteId, err: msg });
    return { ok: false, error: msg };
  }
}

async function fetchVissStatus(
  lat: number,
  lng: number,
  siteId: string,
): Promise<FetchOutcome<VissWaterStatus | null>> {
  try {
    const result = await queryVissPoint(lat, lng);
    if (result.ok === true) {
      return { ok: true, data: (result as VissPointResult).primaryWaterStatus ?? null };
    }
    return { ok: false, error: (result as { error?: string }).error || 'VISS svarade inte ok' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('queryVissPoint failed for localization', { site: siteId, err: msg });
    return { ok: false, error: msg };
  }
}

async function fetchSluObservations(input: {
  site: SiteAlternative;
  projectId: string;
  user: AuthUser;
}): Promise<FetchOutcome<Array<{ name?: string; status?: string }>>> {
  if (!hasSluSpeciesConfigured()) {
    return { ok: false, error: 'SLU Artdata API-nyckel eller bas-URL saknas' };
  }
  try {
    const raw = await searchSluByCoordinates({
      lat: input.site.lat,
      lng: input.site.lng,
      purpose: 'localization_study',
      user: input.user,
      projectId: input.projectId,
    });
    return { ok: true, data: parseSluObservations(raw) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('searchSluByCoordinates failed for localization', { site: input.site.id, err: msg });
    return { ok: false, error: msg };
  }
}

function buildDataSources(input: {
  spatial: SpatialAuditSummary;
  nvr: FetchOutcome<ProtectedArea[]>;
  raa: FetchOutcome<Monument[]>;
  viss: FetchOutcome<VissWaterStatus | null>;
  slu: FetchOutcome<Array<{ name?: string; status?: string }>>;
}): DataSourceStatus[] {
  const sources: DataSourceStatus[] = [
    {
      source: 'PostGIS spatial',
      status:
        input.spatial.protectedAreaAvailable && input.spatial.distanceToWaterAvailable
          ? 'ok'
          : input.spatial.protectedAreaAvailable || input.spatial.distanceToWaterAvailable
            ? 'degraded'
            : 'unavailable',
      detail: input.spatial.protectedAreaWarning || input.spatial.distanceToWaterWarning,
    },
    {
      source: 'SGU jord/skred',
      status: input.spatial.sgu.manualReviewRequired ? 'degraded' : 'ok',
      detail: input.spatial.sgu.summary,
    },
    {
      source: 'NVR API',
      status: input.nvr.ok ? 'ok' : 'unavailable',
      detail: input.nvr.ok ? `${input.nvr.data.length} träffar` : getFetchError(input.nvr),
    },
    {
      source: 'RAA API',
      status: input.raa.ok ? 'ok' : 'unavailable',
      detail: input.raa.ok ? `${input.raa.data.length} fornlämningar` : getFetchError(input.raa),
    },
    {
      source: 'VISS',
      status: input.viss.ok ? 'ok' : 'unavailable',
      detail: input.viss.ok ? input.viss.data?.waterName || 'ingen primär status' : getFetchError(input.viss),
    },
    {
      source: 'SLU Artdata',
      status: input.slu.ok ? 'ok' : 'unavailable',
      detail: input.slu.ok ? `${input.slu.data.length} observationer` : getFetchError(input.slu),
    },
  ];
  return sources;
}

function collectWarnings(input: {
  spatial: SpatialAuditSummary;
  nvr: FetchOutcome<ProtectedArea[]>;
  raa: FetchOutcome<Monument[]>;
  viss: FetchOutcome<VissWaterStatus | null>;
  slu: FetchOutcome<Array<{ name?: string; status?: string }>>;
  strict: boolean;
}): string[] {
  const warnings: string[] = [];
  if (!input.spatial.protectedAreaAvailable && input.spatial.protectedAreaWarning) {
    warnings.push(`Skyddad natur (lokal): ${input.spatial.protectedAreaWarning}`);
  }
  if (!input.spatial.distanceToWaterAvailable && input.spatial.distanceToWaterWarning) {
    warnings.push(`Avstånd vatten: ${input.spatial.distanceToWaterWarning}`);
  }
  if (!input.nvr.ok) {
    warnings.push(
      input.strict
        ? `NVR API otillgänglig — skyddade områden från livekälla saknas: ${getFetchError(input.nvr)}`
        : `NVR API otillgänglig (använder endast lokal PostGIS): ${getFetchError(input.nvr)}`,
    );
  }
  if (!input.raa.ok) {
    warnings.push(`RAA/fornlämningar otillgängliga: ${getFetchError(input.raa)}`);
  }
  if (!input.viss.ok) {
    warnings.push(`VISS otillgänglig: ${getFetchError(input.viss)}`);
  }
  if (!input.slu.ok) {
    warnings.push(`SLU Artdata: ${getFetchError(input.slu)}`);
  }
  return warnings;
}

async function analyzeSite(
  site: SiteAlternative,
  ctx: { projectId: string; user?: AuthUser },
): Promise<SiteAnalysisResult> {
  logger.info(`Analyzing site: ${site.id} at (${site.lat}, ${site.lng})`);
  const strict = isLocalizationStrictMode();

  const spatialAudit = await runSpatialAudit(site.lat, site.lng);

  const [nvrOutcome, raaOutcome, vissOutcome, sluOutcome] = await Promise.all([
    fetchNvrAreas(site.lat, site.lng, site.id),
    fetchRaaMonuments(site.lat, site.lng, site.id),
    fetchVissStatus(site.lat, site.lng, site.id),
    ctx.user
      ? fetchSluObservations({ site, projectId: ctx.projectId, user: ctx.user })
      : Promise.resolve({
          ok: false as const,
          error: 'Ingen autentiserad användare för SLU-anrop',
        }),
  ]);

  const protectedAreas = nvrOutcome.ok ? nvrOutcome.data : [];
  const monuments = raaOutcome.ok ? raaOutcome.data : [];
  const vissWaterStatus = vissOutcome.ok ? vissOutcome.data : null;
  const observations = sluOutcome.ok ? sluOutcome.data : [];

  const dataSources = buildDataSources({
    spatial: spatialAudit,
    nvr: nvrOutcome,
    raa: raaOutcome,
    viss: vissOutcome,
    slu: sluOutcome,
  });
  const warnings = collectWarnings({
    spatial: spatialAudit,
    nvr: nvrOutcome,
    raa: raaOutcome,
    viss: vissOutcome,
    slu: sluOutcome,
    strict,
  });

  const geologicalData = toGeologicalData(spatialAudit.sgu);
  const distanceToWaterMeters = spatialAudit.distanceToWaterMeters;
  const distanceForCompliance =
    distanceToWaterMeters ?? (strict && !spatialAudit.distanceToWaterAvailable ? null : 200);

  if (distanceForCompliance == null) {
    warnings.push('Avstånd till vatten okänt — compliance använder inte standardfallback i strikt läge.');
  }

  const complianceAnalysis = evaluateComplianceRules(
    observations,
    protectedAreas,
    geologicalData,
    monuments,
    distanceForCompliance ?? 200,
  );

  return {
    site,
    spatialAudit,
    complianceAnalysis,
    monuments,
    vissWaterStatus,
    distanceToWaterMeters,
    dataSources,
    warnings,
    sluObservationCount: observations.length,
  };
}

const HUMAN_IN_THE_LOOP =
  'Human in the loop: Detta är AI-genererat beslutsstöd. Granska datakällor, varningar och ' +
  'rekommendationer mot primärkällor innan formellt beslut.';

/**
 * Generates a full localization report for a given project and site alternatives.
 */
export async function generateLocalizationReport(input: {
  projectId: string;
  siteAlternatives: SiteAlternative[];
  userId?: string;
  user?: AuthUser;
}): Promise<LocalizationReport> {
  const analyses = await Promise.all(
    input.siteAlternatives.map((site) => analyzeSite(site, { projectId: input.projectId, user: input.user })),
  );

  const sortedByPermit = [...analyses].sort(
    (a, b) => b.complianceAnalysis.permitProbability - a.complianceAnalysis.permitProbability,
  );
  const bestAlternative = sortedByPermit.length > 0 ? sortedByPermit[0] : null;

  const reasoning = bestAlternative
    ? `Alternativ ${bestAlternative.site.id} (${bestAlternative.site.name || 'namnlöst'}) har högst tillståndssannolikhet (${(bestAlternative.complianceAnalysis.permitProbability * 100).toFixed(0)}%) baserat på spatial analys, ${bestAlternative.monuments.length} kulturmiljöträffar, ${bestAlternative.sluObservationCount} SLU-observationer, och riskklassning ${bestAlternative.complianceAnalysis.overallRisk}.`
    : 'Inga alternativ analyserade.';

  const reportWarnings = analyses.flatMap((a) => a.warnings.map((w) => `${a.site.id}: ${w}`));

  const report: LocalizationReport = {
    projectId: input.projectId,
    generatedAt: new Date().toISOString(),
    siteAnalyses: analyses,
    summary: {
      bestAlternativeId: bestAlternative?.site.id,
      reasoning,
    },
    warnings: reportWarnings,
    humanInTheLoop: HUMAN_IN_THE_LOOP,
  };

  try {
    await auditTrail.logAction(
      `LOK-${input.projectId}`,
      'GIS_ANALYSIS_COMPLETED',
      'Document',
      input.projectId,
      input.userId || 'SYSTEM',
      `Lokaliseringsutredning genererad med ${input.siteAlternatives.length} alternativ. Bästa: ${bestAlternative?.site.id || 'N/A'}.`,
      {
        severity: reportWarnings.length > 0 ? 'warning' : 'info',
        details: {
          alternativeCount: input.siteAlternatives.length,
          bestAlternativeId: bestAlternative?.site.id,
          bestPermitProbability: bestAlternative?.complianceAnalysis.permitProbability,
          overallRisk: bestAlternative?.complianceAnalysis.overallRisk,
          warningCount: reportWarnings.length,
          strictMode: isLocalizationStrictMode(),
        },
      },
    );
  } catch (auditErr) {
    logger.warn('Audit trail logging failed for localization report', { err: String(auditErr) });
  }

  return report;
}

/** Bakåtkompatibel signatur för äldre anrop. */
export async function generateLocalizationReportLegacy(
  projectId: string,
  siteAlternatives: SiteAlternative[],
  userId?: string,
): Promise<LocalizationReport> {
  return generateLocalizationReport({ projectId, siteAlternatives, userId });
}
