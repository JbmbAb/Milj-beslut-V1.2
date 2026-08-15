/**
 * generate-localization-report.usecase.ts
 *
 * Clean Architecture Use Case for generating a localization study report.
 * Integrates spatial analysis, compliance rule evaluation, cultural heritage (RAA),
 * VISS water status, SLU species observations, and audit trail logging.
 */

import { createHash } from 'node:crypto';
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
import {
  LU_SPATIAL_CAPABILITY_KEY,
  orchestrator,
  runLuAssessmentViaKernel,
  type DocumentEvidenceArtifact,
} from '@miljobeslut/mps-lu';
import {
  isVerifiedDocumentFact,
  type DocumentFactCandidateArtifact,
  type VerifiedDocumentFactArtifact,
} from '../../packages/mps-data-governance/src/DocumentFactArtifact';
import { enqueueAdmittedLuTicket } from './enqueue-lu-execution-ticket';
import {
  createLocalizationSpatialRuntime,
  type LocalizationSpatialRuntime,
} from '../../server/modules/localization/createLocalizationSpatialRuntime';

export interface SiteAlternative {
  id: string;
  name?: string;
  lat: number;
  lng: number;
  /** Canonical, governed DocumentEvidence selected for this site assessment. */
  documentEvidenceRefs?: readonly {
    artifact_id: string;
    artifact_type: 'DOCUMENT_EVIDENCE';
  }[];
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

/**
 * P3-LU-CANONICAL-CHAIN-01 — why a site may carry no verdict.
 *
 * A degraded STATUS is permitted. A degraded VERDICT is not. This field says which of the
 * non-verdict outcomes occurred, so a caller can distinguish "not attempted" from "governance
 * refused" from "execution broke" without any of them looking like a risk assessment.
 */
export type LuAssessmentStatus =
  | 'ASSESSED'
  | 'NOT_ASSESSED'
  | 'GOVERNANCE_DENIED'
  | 'EXECUTION_FAILED';

export interface ExecutionMotorMeta {
  admitted: boolean;
  reason_codes: string[];
  attempt_id: string | null;
  outcome_id: string | null;
  manifest_id: string | null;
  ticket_id: string | null;
  finding_ids: string[];
  /** CAS LocalizationAssessmentArtifact id. Null iff assessment_status !== 'ASSESSED'. */
  assessment_artifact_id: string | null;
  property_context_id: string | null;
  assessment_status: LuAssessmentStatus;
}

/**
 * LU_VERDICT_AUTHORITY_V1 — a verdict exists only when a governed assessment does.
 *
 * `overallRisk` and `permitProbability` are the verdict-bearing fields. They are stripped from
 * the result whenever no `LocalizationAssessmentArtifact` was produced, so an ungoverned
 * compliance evaluation cannot be read as an authoritative LU outcome. The remaining fields
 * (requiredActions, notes, …) stay: they are observations, not a verdict.
 */
export type NonVerdictAnalysis = Omit<SiteAnalysis, 'overallRisk' | 'permitProbability'> &
  Partial<Pick<SiteAnalysis, 'overallRisk' | 'permitProbability'>>;

/**
 * How much of the candidate set the comparison actually covers.
 *
 * This is metadata ABOUT the comparison, not a second verdict authority. It exists so a
 * `bestAlternativeId` chosen from a subset cannot be read as "best of all candidates".
 */
export type LuComparisonStatus = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';

export interface SiteAnalysisResult {
  site: SiteAlternative;
  spatialAudit: SpatialAuditSummary;
  complianceAnalysis: NonVerdictAnalysis;
  monuments: Monument[];
  vissWaterStatus: VissWaterStatus | null;
  distanceToWaterMeters: number | null;
  dataSources: DataSourceStatus[];
  warnings: string[];
  sluObservationCount: number;
  documentEvidence?: any[];
  executionMotor?: ExecutionMotorMeta;
}

export interface LocalizationReport {
  projectId: string;
  generatedAt: string;
  siteAnalyses: SiteAnalysisResult[];
  summary: {
    /** Present iff at least one site carries a governed verdict. */
    bestAlternativeId?: string;
    reasoning: string;
    comparison_status: LuComparisonStatus;
    /** Ranking population — sites with a governed LocalizationAssessmentArtifact. */
    assessed_site_ids: string[];
    /** Candidates excluded from ranking because they carry no verdict. */
    unassessed_site_ids: string[];
  };
  warnings: string[];
  humanInTheLoop: string;
}

async function resolveCanonicalDocumentEvidence(
  refs: SiteAlternative['documentEvidenceRefs'],
  expectedPropertyId: string,
  repository: LocalizationSpatialRuntime['artifactRepository'],
): Promise<DocumentEvidenceArtifact[]> {
  const resolved: DocumentEvidenceArtifact[] = [];
  for (const ref of refs ?? []) {
    if (ref.artifact_type !== 'DOCUMENT_EVIDENCE') {
      throw new Error(`REJECT_DOCUMENT_EVIDENCE: '${ref.artifact_id}' has the wrong artifact type`);
    }
    const canonical = await repository.resolve<DocumentEvidenceArtifact>({
      artifact_id: ref.artifact_id,
      artifact_type: ref.artifact_type,
    });
    if (
      canonical.artifact_id !== ref.artifact_id ||
      canonical.artifact_type !== 'DOCUMENT_EVIDENCE'
    ) {
      throw new Error(
        `REJECT_DOCUMENT_EVIDENCE: '${ref.artifact_id}' did not resolve to canonical DocumentEvidence`,
      );
    }
    if (canonical.payload.property_ref.artifact_id !== expectedPropertyId) {
      throw new Error(
        `REJECT_DOCUMENT_EVIDENCE: '${ref.artifact_id}' is not bound to '${expectedPropertyId}'`,
      );
    }
    resolved.push(canonical);
  }
  return resolved;
}

async function resolveVerifiedDocumentFacts(
  documentEvidence: readonly DocumentEvidenceArtifact[],
  repository: LocalizationSpatialRuntime['artifactRepository'],
): Promise<VerifiedDocumentFactArtifact[]> {
  const refs = new Map<string, { artifact_id: string; artifact_type: string }>();
  for (const evidence of documentEvidence) {
    for (const ref of evidence.payload.fact_refs ?? []) {
      if (ref.artifact_type !== 'VERIFIED_DOCUMENT_FACT') {
        throw new Error(
          `REJECT_DOCUMENT_FACT: '${ref.artifact_id}' is not a VERIFIED_DOCUMENT_FACT`,
        );
      }
      refs.set(ref.artifact_id, ref);
    }
  }

  const facts: VerifiedDocumentFactArtifact[] = [];
  for (const ref of refs.values()) {
    const resolved = await repository.resolve<
      DocumentFactCandidateArtifact | VerifiedDocumentFactArtifact
    >(ref);
    if (!isVerifiedDocumentFact(resolved) || resolved.artifact_id !== ref.artifact_id) {
      throw new Error(
        `REJECT_DOCUMENT_FACT: '${ref.artifact_id}' did not resolve to the referenced verified fact`,
      );
    }
    facts.push(resolved);
  }
  return facts;
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
  createSpatialRuntime: () => Promise<LocalizationSpatialRuntime>,
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
    // Canonical refs are the only governed rule input. The legacy provider remains a
    // presentation-only fallback when no governed evidence was selected for this assessment.
    if (site.documentEvidenceRefs?.length) {
      documentEvidence = [];
    } else {
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
    }
  } catch (err) {
    logger.warn(`Failed to generate document evidence for site ${site.id}`, { err: String(err) });
  }

  // Magic Moment path: property CAS → registry-resolved spatial provider → evidence → kernel → assessment
  let mpsFindings: any[] = [];
  let executionMotor: ExecutionMotorMeta | undefined;
  let spatialRuntime: LocalizationSpatialRuntime | undefined;
  try {
    spatialRuntime = await createSpatialRuntime();
    const repo = spatialRuntime.artifactRepository;
    const provider = spatialRuntime.resolveSpatialProvider(LU_SPATIAL_CAPABILITY_KEY);

    const propertyContextId = `prop-${site.id}`;
    const projectContextId = `proj-${ctx.projectId}`;
    const propRef = {
      artifact_id: propertyContextId,
      artifact_type: 'LU_PROPERTY_CONTEXT' as const,
    };
    const projRef = {
      artifact_id: projectContextId,
      artifact_type: 'LU_PROJECT_CONTEXT' as const,
    };
    const geomRef = {
      artifact_id: `geom-${site.id}`,
      artifact_type: 'CANONICAL_GEOMETRY' as const,
    };

    const [northing, easting] = await spatialRuntime.wgs84ToSweref99(site.lat, site.lng);
    const propertyPayload = {
      property_ref: site.name || site.id,
      official_name: site.name || site.id,
      geometry_ref: geomRef,
      municipality: 'UNKNOWN',
      coordinates: [northing, easting] as const,
    };
    const propertyHash = {
      algorithm: 'sha256' as const,
      value: createHash('sha256')
        .update(JSON.stringify(propertyPayload))
        .digest('hex'),
    };
    await repo.put({
      artifact_id: propertyContextId,
      content_hash: propertyHash,
      body: {
        artifact_id: propertyContextId,
        artifact_type: 'LU_PROPERTY_CONTEXT',
        content_hash: propertyHash,
        references: [geomRef],
        payload: propertyPayload,
      },
    });

    const projectPayload = {
      project_name: ctx.projectId,
      description: 'Localization Magic Moment',
      planned_activity: 'localization_assessment',
      property_refs: [propRef],
      created_by: ctx.user?.id ?? 'system',
    };
    const projectHash = {
      algorithm: 'sha256' as const,
      value: createHash('sha256')
        .update(JSON.stringify(projectPayload))
        .digest('hex'),
    };
    await repo.put({
      artifact_id: projectContextId,
      content_hash: projectHash,
      body: {
        artifact_id: projectContextId,
        artifact_type: 'LU_PROJECT_CONTEXT',
        content_hash: projectHash,
        references: [propRef],
        payload: projectPayload,
      },
    });

    // Magic Moment spatial contract: fixed 500 m buffer for water/ebh/protected_area.
    // Do not inherit legacy distanceToWater fallback (200 m) — that collapses EBH/protected hits.
    const magicMomentBufferMeters = 500;
    const queryRequest = {
      property_ref: propRef,
      buffer_distance_meters: magicMomentBufferMeters,
      layers: [
        { name: 'water', version_hash: 'v1.0' },
        { name: 'ebh', version_hash: 'v1.0' },
        { name: 'protected_area', version_hash: 'v1.0' },
      ] as const,
      budget: {
        max_layers: 8,
        max_features_per_layer: 50,
        max_distance_meters: 2000,
        timeout_ms: 5000,
      },
    };

    const mpsEvidence = await provider.query(queryRequest);
    const governedDocumentEvidence = await resolveCanonicalDocumentEvidence(
      site.documentEvidenceRefs,
      propertyContextId,
      repo,
    );
    if (site.documentEvidenceRefs?.length) {
      documentEvidence = governedDocumentEvidence;
    }
    const verifiedDocumentFacts = await resolveVerifiedDocumentFacts(governedDocumentEvidence, repo);
    const assessmentEvidenceRefs = Array.from(
      new Map(
        [
          ...mpsEvidence.map((evidence) => ({
            artifact_id: evidence.artifact_id,
            artifact_type: evidence.artifact_type,
          })),
          ...governedDocumentEvidence.map((evidence) => ({
            artifact_id: evidence.artifact_id,
            artifact_type: evidence.artifact_type,
          })),
          ...verifiedDocumentFacts.map((fact) => ({
            artifact_id: fact.artifact_id,
            artifact_type: fact.artifact_type,
          })),
        ].map((ref) => [`${ref.artifact_type}:${ref.artifact_id}`, ref] as const),
      ).values(),
    );
    const kernelResult = await runLuAssessmentViaKernel({
      site_id: site.id,
      deterministic_seed: `lu-seed-${site.id}`,
      evidence: mpsEvidence,
      document_evidence: governedDocumentEvidence,
      verified_document_facts: verifiedDocumentFacts,
      artifact_repository: repo,
      assessment_draft: {
        site_id: site.id,
        project_context_ref: projRef,
        property_ref: propRef,
        evidence_refs: assessmentEvidenceRefs,
        system_summary:
          `Governed LU assessment: ${mpsEvidence.length} spatial evidence, ` +
          `${governedDocumentEvidence.length} document evidence.`,
      },
    });

    let ticket_id: string | null = null;
    let assessment_artifact_id: string | null = null;
    if (kernelResult.admitted) {
      ticket_id = await enqueueAdmittedLuTicket(kernelResult.manifest_id);
      mpsFindings = [...kernelResult.findings];
      logger.info(
        `ExecutionKernel admitted LU assessment. findings=${mpsFindings.length} attempt=${kernelResult.attempt_id}`,
        { site: site.id },
      );

      assessment_artifact_id = kernelResult.assessment?.artifact_id ?? null;
    } else {
      logger.warn('LU ExecutionKernel denied admission', {
        site: site.id,
        reasons: kernelResult.reason_codes,
      });
      warnings.push(`ExecutionKernel denied: ${kernelResult.reason_codes.join(', ') || 'unknown'}`);
    }

    executionMotor = {
      admitted: kernelResult.admitted,
      reason_codes: [...kernelResult.reason_codes],
      attempt_id: kernelResult.attempt_id,
      outcome_id: kernelResult.outcome_id,
      manifest_id: kernelResult.manifest_id,
      ticket_id,
      finding_ids: [...kernelResult.finding_ids],
      assessment_artifact_id,
      property_context_id: propertyContextId,
      // Admission alone is not a verdict. The artifact is. An admitted run that produced no
      // LocalizationAssessmentArtifact is NOT_ASSESSED, not assessed-with-no-findings.
      assessment_status: !kernelResult.admitted
        ? 'GOVERNANCE_DENIED'
        : assessment_artifact_id
          ? 'ASSESSED'
          : 'NOT_ASSESSED',
    };

    if (mpsFindings.length > 0) {
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
  } catch (err: any) {
    const msg = err?.message || String(err);
    logger.warn('ExecutionKernel LU assessment failed', { err: msg, site: site.id });
    warnings.push(`ExecutionKernel error: ${msg}`);
    executionMotor = {
      admitted: false,
      reason_codes: ['EXECUTION_KERNEL_ERROR'],
      attempt_id: null,
      outcome_id: null,
      manifest_id: null,
      ticket_id: null,
      finding_ids: [],
      assessment_artifact_id: null,
      property_context_id: null,
      assessment_status: 'EXECUTION_FAILED',
    };
  } finally {
    await spatialRuntime?.close().catch(() => undefined);
  }

  // LU_VERDICT_AUTHORITY_V1 — the single point where a verdict is either bound to a governed
  // assessment or removed. Stripping here rather than at each failure branch means a future
  // branch that forgets to fail closed still cannot leak a verdict.
  const hasGovernedAssessment = executionMotor?.assessment_artifact_id != null;

  return {
    site,
    spatialAudit,
    complianceAnalysis: hasGovernedAssessment
      ? complianceAnalysis
      : withoutVerdict(complianceAnalysis),
    monuments,
    vissWaterStatus,
    distanceToWaterMeters,
    dataSources,
    warnings,
    sluObservationCount: observations.length,
    documentEvidence,
    executionMotor: executionMotor ?? {
      admitted: false,
      reason_codes: [],
      attempt_id: null,
      outcome_id: null,
      manifest_id: null,
      ticket_id: null,
      finding_ids: [],
      assessment_artifact_id: null,
      property_context_id: null,
      assessment_status: 'NOT_ASSESSED',
    },
  };
}

/**
 * Removes the verdict-bearing fields, keeping observations.
 *
 * Deleted rather than zeroed: `permitProbability: 0` reads as "certainly refused", and
 * `overallRisk: 'LOW'` reads as an assessment. Absence is the only representation that cannot
 * be mistaken for a finding.
 */
function withoutVerdict(analysis: SiteAnalysis): NonVerdictAnalysis {
  const { overallRisk: _risk, permitProbability: _probability, ...rest } = analysis;
  return rest;
}

/** A site may enter the ranking population only if a governed assessment backs it. */
function isAssessed(analysis: SiteAnalysisResult): boolean {
  return (
    analysis.executionMotor?.assessment_status === 'ASSESSED' &&
    analysis.executionMotor?.assessment_artifact_id != null &&
    typeof analysis.complianceAnalysis.permitProbability === 'number'
  );
}

/**
 * The ranking value for an assessed site.
 *
 * Throws rather than defaulting. `?? 0` here would be a silent fail-open: if `isAssessed` ever
 * weakened, an unassessed site would enter the ranking at probability 0 — a verdict — instead
 * of the population being wrong loudly.
 */
function rankedProbability(analysis: SiteAnalysisResult): number {
  const probability = analysis.complianceAnalysis.permitProbability;
  if (typeof probability !== 'number') {
    throw new Error(
      `LU_VERDICT_AUTHORITY_V1: site '${analysis.site.id}' entered the ranking population ` +
        'without a governed permitProbability. The ranking filter and the verdict strip point ' +
        'have diverged.',
    );
  }
  return probability;
}

const HUMAN_IN_THE_LOOP =
  'Human in the loop: Detta är AI-genererat beslutsstöd. Granska datakällor, varningar och ' +
  'rekommendationer mot primärkällor innan formellt beslut.';

export class GenerateLocalizationReportUseCase {
  constructor(
    private readonly createSpatialRuntime: () => Promise<LocalizationSpatialRuntime> =
      createLocalizationSpatialRuntime,
  ) {}

  async execute(input: {
    projectId: string;
    siteAlternatives: SiteAlternative[];
    userId?: string;
    user?: AuthUser;
  }): Promise<LocalizationReport> {
    const analyses = await Promise.all(
      input.siteAlternatives.map((site) =>
        analyzeSite(
          site,
          { projectId: input.projectId, user: input.user },
          this.createSpatialRuntime,
        ),
      ),
    );

    // REPORT COMPARISON INVARIANT — the ranking population is the assessed sites only. An
    // unassessed candidate stays in siteAnalyses with its status, but cannot be ranked and
    // cannot win.
    const assessed = analyses.filter(isAssessed);
    const unassessed = analyses.filter((a) => !isAssessed(a));

    const sortedByPermit = [...assessed].sort(
      (a, b) => rankedProbability(b) - rankedProbability(a),
    );
    const bestAlternative = sortedByPermit.length > 0 ? sortedByPermit[0] : null;

    const comparisonStatus: LuComparisonStatus =
      assessed.length === 0 ? 'UNAVAILABLE' : unassessed.length === 0 ? 'COMPLETE' : 'PARTIAL';

    // The qualifier is load-bearing: a winner drawn from a subset must never read as best of
    // all candidates.
    const coverageNote =
      comparisonStatus === 'PARTIAL'
        ? ` Jämförelsen är partiell: ${assessed.length} av ${analyses.length} alternativ har en governad bedömning. ` +
          `Ej bedömda alternativ (${unassessed.map((a) => a.site.id).join(', ')}) ingår inte i rangordningen.`
        : '';

    const reasoning = bestAlternative
      ? `Alternativ ${bestAlternative.site.id} (${bestAlternative.site.name || 'namnlöst'}) har högst tillståndssannolikhet (${(rankedProbability(bestAlternative) * 100).toFixed(0)}%) bland bedömda alternativ, baserat på spatial analys, ${bestAlternative.monuments.length} kulturmiljöträffar, ${bestAlternative.sluObservationCount} SLU-observationer, och riskklassning ${bestAlternative.complianceAnalysis.overallRisk}.${coverageNote}`
      : `Ingen rangordning tillgänglig: inget av ${analyses.length} alternativ har en governad bedömning (LocalizationAssessmentArtifact saknas).`;

    const reportWarnings = analyses.flatMap((a) => a.warnings.map((w) => `${a.site.id}: ${w}`));

    const report: LocalizationReport = {
      projectId: input.projectId,
      generatedAt: new Date().toISOString(),
      siteAnalyses: analyses,
      summary: {
        bestAlternativeId: bestAlternative?.site.id,
        reasoning,
        comparison_status: comparisonStatus,
        assessed_site_ids: assessed.map((a) => a.site.id),
        unassessed_site_ids: unassessed.map((a) => a.site.id),
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
            comparison_status: comparisonStatus,
            assessed_site_ids: assessed.map((a) => a.site.id),
            // Non-verdict sites are audited by STATUS only. Emitting a risk or probability for
            // them — even as null or 0 — would put an unbacked verdict into the audit record.
            unassessed_sites: unassessed.map((a) => ({
              site_id: a.site.id,
              assessment_status: a.executionMotor?.assessment_status ?? 'NOT_ASSESSED',
              reason_codes: a.executionMotor?.reason_codes ?? [],
            })),
            ...(bestAlternative
              ? {
                  bestAlternativeId: bestAlternative.site.id,
                  bestAssessmentArtifactId:
                    bestAlternative.executionMotor?.assessment_artifact_id ?? null,
                  bestPermitProbability: bestAlternative.complianceAnalysis.permitProbability,
                  overallRisk: bestAlternative.complianceAnalysis.overallRisk,
                }
              : {}),
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
