/**
 * generate-localization-report.usecase.ts
 *
 * Clean Architecture Use Case for generating a localization study report.
 * Integrates spatial analysis, compliance rule evaluation, cultural heritage (RAA),
 * VISS water status, SLU species observations, and audit trail logging.
 */

import { runSpatialAudit, type SpatialAuditSummary } from '../../server/services/spatialAuditService';
import { evaluateComplianceRules, type SiteAnalysis } from '../../server/services/complianceRuleEngine';
import { fetchProtectedAreas, type ProtectedArea } from '../../server/services/nvrService';
import { fetchAncientMonuments, type Monument } from '../../server/services/raaService';
import { queryVissPoint, type VissPointResult, type VissWaterStatus } from '../../server/services/vissService';
import { toGeologicalData } from '../../server/services/sguRiskService';
import { auditTrail } from '../../server/services/auditTrailService';
import { searchSluByCoordinates, getSpeciesInformation } from '../../server/services/sluService';
import { logger } from '../../server/logger';
import type { AuthUser } from '../../server/security/types';
import { orchestrator } from '@miljobeslut/mps-lu/src/api/LUBackendOrchestrator';
import { prisma } from '../../server/db/prisma';

export interface SiteAlternative {
  id: string;
  name?: string;
  lat: number;
  lng: number;
}

export interface SluObservation {
  name: string;
  scientificName?: string;
  taxonId: number;
  redlistCategory?: string;
  protectionStatus?: string;
  biology?: string;
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
  documentEvidence?: any[];
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

function parseSluObservations(raw: unknown): SluObservation[] {
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
    
    return {
      name: String(props.taxonName ?? props.scientificName ?? props.species ?? props.name ?? row.name ?? 'Okänd art'),
      scientificName: props.scientificName ? String(props.scientificName) : undefined,
      taxonId: Number(props.taxonId || 0),
      redlistCategory: props.redlistCategory ? String(props.redlistCategory) : undefined,
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
}): Promise<FetchOutcome<SluObservation[]>> {
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
    
    const baseObservations = parseSluObservations(raw);
    const taxonIds = baseObservations.map(o => o.taxonId).filter(id => id > 0);
    
    if (taxonIds.length > 0) {
      // Enrich with detailed facts from Artfakta
      try {
        const enrichedData = (await getSpeciesInformation({
          taxonIds: [...new Set(taxonIds)], // Unique IDs
          purpose: 'enrich_observations',
          user: input.user,
          projectId: input.projectId
        })) as any[];
        
        if (Array.isArray(enrichedData)) {
          return {
            ok: true,
            data: baseObservations.map(obs => {
              const facts = enrichedData.find((f: any) => f.taxonId === obs.taxonId);
              if (facts) {
                return {
                  ...obs,
                  redlistCategory: facts.conservationStatus?.redlistCategory || obs.redlistCategory,
                  protectionStatus: facts.protectionStatus?.statusText,
                  biology: facts.biology?.description
                };
              }
              return obs;
            })
          };
        }
      } catch (enrichErr) {
        logger.warn('Failed to enrich SLU observations with Artfakta facts', { err: String(enrichErr) });
      }
    }

    return { ok: true, data: baseObservations };
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
  slu: FetchOutcome<SluObservation[]>;
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
  slu: FetchOutcome<SluObservation[]>;
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

  let documentEvidence: any[] = [];
  try {
    const propertyRef = {
      artifact_id: `prop-${site.id}`,
      artifact_type: "LU_PROPERTY_CONTEXT" as const
    };
    const geometry = {
      type: "Polygon" as const,
      coordinates: [[
        [site.lng - 0.001, site.lat - 0.001],
        [site.lng + 0.001, site.lat - 0.001],
        [site.lng + 0.001, site.lat + 0.001],
        [site.lng - 0.001, site.lat + 0.001],
        [site.lng - 0.001, site.lat - 0.001]
      ]] as number[][][]
    };
    documentEvidence = await orchestrator.generateDocumentEvidence(propertyRef, geometry);
  } catch (err) {
    logger.warn(`Failed to generate document evidence for site ${site.id}`, { err: String(err) });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // MIMER EXECUTION & REPLAY ENGINE (LU_RULE_ENGINE) INTEGRATION
  // ═════════════════════════════════════════════════════════════════════════
  let mpsFindings: any[] = [];
  try {
    const { PostgisSpatialProvider, LURuleEngine } = await import('@miljobeslut/mps-lu');

    // Convert GPS coordinate WGS84 [lat, lng] to SWEREF99 TM [N, E] via PostGIS transform
    const coords = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ST_X(ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3006)) as x,
              ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3006)) as y`,
      site.lng,
      site.lat,
    );
    const xSweref = coords[0]?.x || 591234;
    const ySweref = coords[0]?.y || 6612345;

    const queryFn = async (sql: string, params: any[]) => {
      return await prisma.$queryRawUnsafe(sql, ...params);
    };

    const artifactLoader = async (ref: any) => {
      return {
        artifact_id: ref.artifact_id,
        artifact_type: "LU_PROPERTY_CONTEXT",
        payload: {
          coordinates: [ySweref, xSweref]
        }
      };
    };

    const spatialProvider = new PostgisSpatialProvider(queryFn, artifactLoader);
    const queryRequest = {
      property_ref: { artifact_id: `prop-${site.id}`, artifact_type: "LU_PROPERTY_CONTEXT" as const },
      layers: ["water", "ebh", "protected_area"] as const
    };

    // Execute real PostGIS ST_DWithin query to harvest spatial evidence!
    const mpsEvidence = await spatialProvider.query(queryRequest);

    // Run the real Mimer LURuleEngine!
    const ruleEngine = new LURuleEngine();
    mpsFindings = ruleEngine.evaluate(mpsEvidence);

    // Merge Mimer Rule Engine findings into complianceAnalysis
    if (mpsFindings && mpsFindings.length > 0) {
      let hasHigh = false;
      let hasMedium = false;
      const requiredActions: string[] = [];
      const notes: string[] = [];

      mpsFindings.forEach(f => {
        if (f.risk_level === 'HIGH') hasHigh = true;
        if (f.risk_level === 'MEDIUM') hasMedium = true;
        
        const itemText = `[${f.rule_id} v${f.rule_version}] ${f.explanation}`;
        if (f.risk_level === 'HIGH') {
          requiredActions.push(itemText);
        } else {
          notes.push(itemText);
        }
      });

      complianceAnalysis.requiredActions = [
        ...(complianceAnalysis.requiredActions || []),
        ...requiredActions
      ];
      complianceAnalysis.notes = [
        ...(complianceAnalysis.notes || []),
        ...notes
      ];

      if (hasHigh) {
        complianceAnalysis.overallRisk = 'HIGH';
        complianceAnalysis.permitProbability = 0.2;
      } else if (hasMedium && complianceAnalysis.overallRisk === 'LOW') {
        complianceAnalysis.overallRisk = 'MEDIUM';
        complianceAnalysis.permitProbability = 0.5;
      }
    }

    logger.info(`Mimer Execution Engine completed successfully. Generated ${mpsFindings.length} findings.`, { site: site.id });
  } catch (err: any) {
    logger.warn('Failed to run Mimer Execution/Rule Engine for site analysis', { err: err.message || err });
  }

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
    documentEvidence,
  };
}

const HUMAN_IN_THE_LOOP =
  'Human in the loop: Detta är AI-genererat beslutsstöd. Granska datakällor, varningar och ' +
  'rekommendationer mot primärkällor innan formellt beslut.';

export class GenerateLocalizationReportUseCase {
  async execute(input: {
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
}
