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
import {
  LU_SPATIAL_CAPABILITY_KEY,
  runCanonicalLuProductAssessment,
  deriveLuExecutionSeed,
  createLuRegistryRuntime,
  type DocumentEvidenceArtifact,
  type AssessmentFinding,
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
import { resolveCanonicalProjectContext } from './resolveCanonicalProjectContext';
import { resolveCanonicalProductRelease } from '../../server/modules/release/productReleaseRuntime';
import { registerAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { resolveOrDeriveCurrentLocalizationGeometry } from '../../server/modules/localization/localizationGeometryService';
import {
  LocalizationGeometryCurrentnessError,
  failedClosedGeometryProvenanceRecord,
  resolvedGeometryProvenanceRecord,
  type LocalizationGeometryProvenanceRecord,
} from '../../server/modules/localization/localizationGeometryCurrentness';
import { computeGovernedLayerChecks, type GovernedLayerCheck } from '../../server/modules/localization/governedLayerChecks';

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
  /**
   * P3-LU-ASSESSMENT-PROJECTION-RELIABILITY-01. `null` iff assessment_artifact_id is null (no
   * assessment produced, so registration was never attempted). Otherwise: `true` if the durable,
   * non-authoritative discovery projection was registered; `false` if it failed -- the CAS
   * assessment above is STILL valid and authoritative either way. `false` means only that this
   * project's current assessment cannot yet be discovered by project without an explicit
   * reconciliation pass (see assessmentProjection.ts's reconcileAssessmentProjection).
   */
  assessment_projection_registered: boolean | null;
  property_context_id: string | null;
  assessment_status: LuAssessmentStatus;
  /**
   * LU-RESULT-VIEW-V1. The real governed findings this run produced (or [] when none were
   * produced) -- structured data for the client to present as finding cards via the
   * rule_id/risk_level -> category/attention presentation model, instead of the pre-flattened
   * text this file used to push into requiredActions/notes. Legacy compliance-rule-engine output
   * (VISS, monuments, protected areas -- see evaluateComplianceRules) is untouched; it never came
   * from AssessmentFinding[] and stays in requiredActions/notes exactly as before.
   */
  findings: readonly AssessmentFinding[];
  /**
   * DEMO M1a / D9(a). Which localization geometry this run used and how it came about (resolved
   * current point vs centroid derived on NOT_FOUND), or -- status FAILED_CLOSED -- the currentness
   * failure class and the Swedish reason why no governed run was made. Optional only so that
   * pre-existing constructions/tests of this type stay valid; every analyzeSite path sets it once
   * the geometry step has been reached.
   */
  localization_geometry?: LocalizationGeometryProvenanceRecord;
  /**
   * DEMO M1a / U12. Per governed layer: CHECKED_NO_HIT / CHECKED_HIT / NOT_CHECKED, derived from
   * this run's own governed evidence. Present only for an ASSESSED run. Adds a signal; the
   * NOT_CHECKED findings and `unresolvedChecks` remain the structured source of truth.
   */
  governed_layer_checks?: readonly GovernedLayerCheck[];
}

/**
 * LU_VERDICT_AUTHORITY_V1 — a verdict exists only when a governed assessment does.
 *
 * `overallRisk` and `permitProbability` are the verdict-bearing fields. They are stripped from
 * the result whenever no `LocalizationAssessmentArtifact` was produced, so an ungoverned
 * compliance evaluation cannot be read as an authoritative LU outcome. The remaining fields
 * (requiredActions, notes, …) stay: they are observations, not a verdict.
 *
 * LU_VERDICT_TYPE_BOUNDARY_V1 — the two outcomes are distinct types, discriminated by
 * `assessment_status`.
 *
 * They were previously one type with the verdict fields marked optional. That does not survive
 * this repository's compiler settings: with neither `strict` nor `strictNullChecks` set,
 * `RiskLevel | undefined` is assignable to `RiskLevel`, so any consumer reading a verdict field
 * into a required slot compiled silently. Enforcement rested entirely on the runtime guards in
 * `src/application/unit/`, which can only cover consumers that already exist.
 *
 * Absence is therefore modelled as the field not being in the type at all. Reading
 * `analysis.overallRisk` off the union is "property does not exist" — an error that needs no
 * `strictNullChecks` — so a consumer added tomorrow fails to compile until it narrows.
 *
 * Proven by src/application/types/LuVerdictTypeBoundary.type-proof.ts.
 */
export type GovernedVerdictAnalysis = Omit<SiteAnalysis, 'permitProbability'> & {
  assessment_status: 'ASSESSED';
  /**
   * W3a -- SEM-2/SEM-3 (Q2): set by `legacyObservationTag` below, independent of verdict status.
   * Declared here (not on `SiteAnalysis`, the legacy engine's own type) so the legacy engine
   * itself stays untouched by this unit; `NonVerdictAnalysis` carries the identical field for the
   * same reason.
   */
  legacyObservation?: LegacyObservationTag;
  /**
   * SEM-1/OD-03 (W2), corrected per cold review (K-35 M5): `null` -- never a fabricated number --
   * exactly when `unresolvedChecks` is non-empty and no completed check reached HIGH/MEDIUM.
   * ADR-28A section 1 / OD-03: "no permit/risk number may be derived solely from a null/unmeasured
   * [signal]"; an incomplete assessment is exactly that signal, and 0.5 here would repeat the
   * fabricated MEDIUM/0.5 unknown-distance stand-in ADR-28A's SEM-1/OD-03 decision itself retired
   * from the legacy engine. `null` may occur ONLY together with a non-empty `unresolvedChecks` --
   * proven in LuVerdictTypeBoundary.type-proof.ts (T6). A site with a null permitProbability is
   * excluded from the ranking population by `isAssessed` below, same as a non-verdict result.
   */
  permitProbability: number | null;
  /**
   * SEM-1 (W2) -- ADR-28A section 1: "no permit/risk number may be derived solely from a
   * null/unmeasured [signal]" generalizes here to every governed rule, not only water distance.
   * Non-empty exactly when at least one governed rule's required evidence could not be
   * technically checked (a `NOT_CHECKED` finding was produced). `overallRisk` above is added to
   * `SiteAnalysis` (the legacy engine's own type, untouched by this unit) and describes severity
   * among the checks that DID complete; it must never be read alone as "all checks passed" when
   * this array is non-empty -- see `governedVerdictFromFindings` below.
   */
  unresolvedChecks: readonly { readonly rule_id: string; readonly finding_id: string }[];
};

export type NonVerdictAnalysis = Omit<SiteAnalysis, 'overallRisk' | 'permitProbability'> & {
  assessment_status: Exclude<LuAssessmentStatus, 'ASSESSED'>;
  /** W3a -- see the identical field on `GovernedVerdictAnalysis` above. */
  legacyObservation?: LegacyObservationTag;
};

/** W3a -- SEM-2/SEM-3 (Q2): the shape `legacyObservationTag` below produces and tags onto both
 * verdict variants. Named once so `GovernedVerdictAnalysis`, `NonVerdictAnalysis`, and
 * `legacyObservationTag`'s own return type all refer to the same definition. */
export type LegacyObservationTag = { source: 'legacy_observation'; version: 'v1' };

export type LuVerdictAnalysis = GovernedVerdictAnalysis | NonVerdictAnalysis;

/**
 * The only supported way to reach the verdict fields.
 *
 * `assessment_status === 'ASSESSED'` narrows identically; this exists so consumers outside this
 * module do not have to restate the discriminant literal.
 */
export function isGovernedVerdict(
  analysis: LuVerdictAnalysis,
): analysis is GovernedVerdictAnalysis {
  return analysis.assessment_status === 'ASSESSED';
}

/**
 * LU-COMPLIANCE-ANALYSIS-VERDICT-AUTHORITY-CONVERGENCE-01.
 *
 * An ASSESSED verdict is a projection of the governed assessment findings only. The legacy
 * compliance analysis may still provide exploratory observations, but its live inputs must never
 * determine the verdict-bearing risk or permit probability of a governed result.
 */
/**
 * Exported for direct unit proof (tests/unit/generateLocalizationReportVerdictNotChecked.test.ts)
 * -- SEM-1's verdict-consequence claim is about this exact function's behavior, not about the
 * full DB-dependent governed pipeline that calls it. Still module-private in every other sense:
 * not part of this file's intended public surface, and not re-exported from any barrel.
 */
export function governedVerdictFromFindings(
  findings: readonly AssessmentFinding[],
): Pick<GovernedVerdictAnalysis, 'overallRisk' | 'permitProbability' | 'summary' | 'unresolvedChecks'> {
  // SEM-1 (W2): NOT_CHECKED is a non-severity state -- it never itself raises overallRisk to
  // HIGH/MEDIUM -- but its presence must never be silently absorbed into a clean LOW result.
  const unresolvedChecks = findings
    .filter((finding) => finding.risk_level === 'NOT_CHECKED')
    .map((finding) => ({ rule_id: finding.rule_id, finding_id: finding.finding_id }));
  const unresolvedNote =
    unresolvedChecks.length > 0
      ? ` ${unresolvedChecks.length} governed check(s) could not be completed and are not reflected in this risk grade (see unresolvedChecks).`
      : '';

  if (findings.some((finding) => finding.risk_level === 'HIGH')) {
    return {
      overallRisk: 'HIGH',
      permitProbability: 0.2,
      summary: 'Governed LU assessment findings establish HIGH risk.' + unresolvedNote,
      unresolvedChecks,
    };
  }
  if (findings.some((finding) => finding.risk_level === 'MEDIUM')) {
    return {
      overallRisk: 'MEDIUM',
      permitProbability: 0.5,
      summary: 'Governed LU assessment findings establish MEDIUM risk.' + unresolvedNote,
      unresolvedChecks,
    };
  }
  if (unresolvedChecks.length > 0) {
    // Not HIGH/MEDIUM among the checks that DID complete, but at least one governed check did
    // NOT complete. Corrected per K-35 M5: permitProbability is null, not a fabricated 0.5 --
    // OD-03/J-2 forbid deriving a permit/risk number from an unmeasured/incomplete state, and a
    // real number here (even one that "isn't 0.95") would repeat exactly the fabricated
    // MEDIUM/0.5 unknown-distance stand-in ADR-28A's own SEM-1/OD-03 decision retired from the
    // legacy engine.
    return {
      overallRisk: 'LOW',
      permitProbability: null,
      summary:
        'Governed LU assessment did not complete all checks; the completed checks found no ' +
        'HIGH/MEDIUM risk, but this is not a clean result.' + unresolvedNote,
      unresolvedChecks,
    };
  }
  return {
    overallRisk: 'LOW',
    permitProbability: 0.95,
    summary: 'Governed LU assessment findings establish LOW risk.',
    unresolvedChecks,
  };
}

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
  /** DEMO M1a / U12: says explicitly that `spatialAudit` is the older, ungoverned observation. */
  spatialAuditProvenance?: typeof LEGACY_SPATIAL_AUDIT_PROVENANCE;
  complianceAnalysis: LuVerdictAnalysis;
  monuments: Monument[];
  vissWaterStatus: VissWaterStatus | null;
  distanceToWaterMeters: number | null;
  dataSources: DataSourceStatus[];
  warnings: string[];
  sluObservationCount: number;
  /**
   * K0: the governed DocumentEvidence this run resolved from the caller's explicit
   * `documentEvidenceRefs` (CAS-resolved, property-bound) -- `[]` when none were given. Never an
   * ungoverned provider sweep.
   */
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

/** DEMO M1a / U12: marks text that comes from the older, ungoverned spatialAudit. */
export const LEGACY_SPATIAL_AUDIT_PREFIX_SV = 'Äldre observation (ingår inte i den styrda bedömningen):';

/** DEMO M1a / U12: tag on SiteAnalysisResult.spatialAudit's provenance (the block itself is unchanged). */
export const LEGACY_SPATIAL_AUDIT_PROVENANCE = {
  source: 'legacy_observation',
  version: 'v1',
  governed: false,
  note_sv:
    'Äldre observation från den lokala PostGIS-kontrollen (spatialAudit). Den ingår inte i den styrda ' +
    'bedömningen och kan inte motsäga den; se executionMotor för det styrda resultatet.',
} as const;

function collectWarnings(input: {
  spatial: SpatialAuditSummary;
  nvr: FetchOutcome<ProtectedArea[]>;
  raa: FetchOutcome<Monument[]>;
  viss: FetchOutcome<VissWaterStatus | null>;
  slu: FetchOutcome<SluObservation[]>;
  strict: boolean;
}): string[] {
  const warnings: string[] = [];
  // DEMO M1a / U12: these two come from the older, ungoverned spatialAudit (runSpatialAudit), not
  // from the governed layer query. Labelled as such so they cannot read as contradicting the
  // governed result (e.g. "kunde inte verifieras" next to a governed protected_area check).
  if (!input.spatial.protectedAreaAvailable && input.spatial.protectedAreaWarning) {
    warnings.push(`${LEGACY_SPATIAL_AUDIT_PREFIX_SV} Skyddad natur (lokal): ${input.spatial.protectedAreaWarning}`);
  }
  if (!input.spatial.distanceToWaterAvailable && input.spatial.distanceToWaterWarning) {
    warnings.push(`${LEGACY_SPATIAL_AUDIT_PREFIX_SV} Avstånd vatten: ${input.spatial.distanceToWaterWarning}`);
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

  // NO_LEGACY_WATER_DISTANCE_FALLBACK_MECHANICAL_V1: an unknown distance must reach the
  // compliance engine as `null`, never as a fabricated numeric value (the legacy 200 m
  // fallback REBUILD-GATE-STATUS.md explicitly bans). Mechanical only: this passes the real
  // measured value straight through, in every mode, and does not attempt to define what an
  // unknown distance should additionally communicate — that is a separate, later unit.
  //
  // The pre-existing strict-mode warning is preserved below, logically unchanged from main:
  // it fires exactly when the source could not produce a distance at all
  // (`distanceToWaterAvailable === false`) in strict mode. It must NOT fire when the query
  // succeeded and simply found no water within its search radius
  // (`distanceToWaterMeters === null` with `distanceToWaterAvailable === true`). OD-03 (W2):
  // the producer returns null with available=true when the bounded query found nothing; what
  // that specific producer state means is not decided here -- this warning only distinguishes
  // it from available=false, it does not interpret it. The trichotomy itself (technical
  // failure / checked-and-nothing-found / measured distance) is proven directly against the
  // producer in tests/unit/spatialAuditServiceExtended.test.ts.
  if (distanceToWaterMeters == null && strict && !spatialAudit.distanceToWaterAvailable) {
    warnings.push('Avstånd till vatten okänt — compliance använder inte standardfallback i strikt läge.');
  }

  const complianceAnalysis = evaluateComplianceRules(
    observations,
    protectedAreas,
    geologicalData,
    monuments,
    distanceToWaterMeters,
  );

  // Magic Moment path: property CAS → registry-resolved spatial provider → evidence → kernel → assessment
  let mpsFindings: AssessmentFinding[] = [];
  let executionMotor: ExecutionMotorMeta | undefined;
  let spatialRuntime: LocalizationSpatialRuntime | undefined;
  // K0: only governed DocumentEvidence resolved from explicit refs; never a provider sweep.
  let documentEvidence: DocumentEvidenceArtifact[] = [];
  try {
    spatialRuntime = await createSpatialRuntime();
    const repo = spatialRuntime.artifactRepository;
    const provider = spatialRuntime.resolveSpatialProvider(LU_SPATIAL_CAPABILITY_KEY);

    // PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1: resolve the REAL, already-issued, verified
    // project/property context for this authenticated project. Never fabricate prop-*/proj-*/
    // geom-* ids -- a project without a verified ProjectContextBinding fails closed here rather
    // than being silently assigned a fresh synthetic context on every run.
    const canonicalContext = await resolveCanonicalProjectContext(ctx.projectId, repo);
    const propRef = canonicalContext.propertyContextRef;
    const projRef = canonicalContext.projectContextRef;
    const geomRef = canonicalContext.geometryRef;

    // PRODUCT-LU-LOCALIZATION-GEOMETRY-01 Phase B: resolve the project's current explicit
    // LocalizationGeometry, or -- for a project that has never had one set (every project before
    // this unit) -- derive one from the property's own centroid, exactly the point the live
    // spatial query already used implicitly before this unit. This keeps existing projects usable
    // (never a hard failure just because no explicit point was ever chosen) while making the
    // artifact a real, versioned, content-addressed thing from here on, never a silent implicit
    // conflation of "property" with "site" again.
    // PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01: this resolve-or-derive step now lives in
    // localizationGeometryService.ts, shared with the GET read path the UI polls before any LU
    // run has ever executed -- the two must never disagree about what "current" means for a
    // project with no explicit point yet.
    // DEMO M1a / D9(a): derives ONLY on currentness NOT_FOUND; every other currentness failure
    // throws LocalizationGeometryCurrentnessError, handled in the catch below (fail closed).
    const resolvedGeometry = await resolveOrDeriveCurrentLocalizationGeometry({
      projectId: ctx.projectId,
      artifactRepository: repo,
      propertyContextRef: propRef,
      propertyCentroidSweref: canonicalContext.coordinates,
      sweref99ToWgs84: spatialRuntime.sweref99ToWgs84,
      createdBy: ctx.user?.id ?? 'system',
    });
    const currentLocalizationGeometry = resolvedGeometry.geometry;
    const geometryProvenance: LocalizationGeometryProvenanceRecord =
      resolvedGeometry.provenanceRecord ??
      resolvedGeometryProvenanceRecord({
        artifactId: currentLocalizationGeometry.artifact_id,
        provenance: currentLocalizationGeometry.payload?.provenance,
        derivedInThisRequest: Boolean(resolvedGeometry.wasDerived),
      });
    const locationRef = {
      artifact_id: currentLocalizationGeometry.artifact_id,
      artifact_type: currentLocalizationGeometry.artifact_type,
    };

    // LU-PRODUCT-GOLDEN-PATH-01: site_id and deterministic_seed must be the same canonical
    // values LU-EXECUTION-AUTHORITY-BOOTSTRAP-01 issued the ExecutionIdentity under -- never
    // site.id (caller-controlled) or a string derived only from it. A project/property with no
    // canonical execution identity issued for it fails closed at admission, exactly as intended;
    // this usecase does not mint one itself (that stays an explicit owner-run step).
    // PRODUCT-RELEASE-AUTHORITY-BINDING-V1 (H13): env may select which release is the
    // candidate, but only a real, trusted-issuer signature (verified here) may accept it -- a
    // bare artifact_id + hash match is no longer sufficient. See
    // server/modules/release/productReleaseRuntime.ts.
    const canonicalRelease = await resolveCanonicalProductRelease({ artifactRepository: repo });
    const currentRelease = {
      releaseRef: { artifact_id: canonicalRelease.artifact_id, artifact_type: canonicalRelease.artifact_type },
      releaseHash: canonicalRelease.release_hash.value,
    };
    const executionRegistry = createLuRegistryRuntime();
    const canonicalSiteId = canonicalContext.propertyIdentity;
    const canonicalDeterministicSeed = deriveLuExecutionSeed({
      site_id: canonicalSiteId,
      project_id: ctx.projectId,
      project_context_ref: canonicalContext.projectContextRef,
      property_context_ref: canonicalContext.propertyContextRef,
      project_context_binding_ref: canonicalContext.contextBindingRef,
      product_release_ref: currentRelease.releaseRef,
      product_release_hash: currentRelease.releaseHash,
      execution_contract_version: 'lu-execution-identity-v1',
      rule_registry_snapshot_id: executionRegistry.getReleaseSnapshot().snapshot_id,
      localization_geometry_ref: locationRef,
    });

    // LU-EXECUTION-IDENTITY-SCOPE-V2 (PRODUCT-LU-EXECUTION-IDENTITY-V2-WIRING-01): current
    // product execution must resolve the exact expected V2 ExecutionIdentity for this canonical
    // execution subject, never fall back to the legacy site-only V1 lookup. No field here is
    // caller-controlled -- every value comes from the same verified chain the seed above was just
    // derived from: canonicalContext.contextBindingRef is the current supersession-graph head
    // (resolveCanonicalProjectContext -> ProjectContextBindingProvider.resolveCurrent), never a
    // caller-supplied or historical ref. A site with an identity minted under a since-superseded
    // binding fails closed here exactly as intended -- this usecase does not mint one itself.
    // PRODUCT-LU-LOCALIZATION-GEOMETRY-01: current product execution must resolve the exact
    // expected V3 ExecutionIdentity -- scoped by the localization point too, on top of everything
    // V2 already required (project_context_binding_ref, product_release_ref,
    // execution_contract_version). Same fail-closed reasoning as V2 originally established: a
    // project/point combination with no V3 identity minted for it fails closed at admission; this
    // usecase does not mint one itself. Moving the point changes `locationRef`, which changes this
    // subject, which changes the expected identity/manifest -- a moved point can never reuse the
    // identity/manifest/evidence/assessment minted for the prior one.
    const canonicalIdentitySubjectV3 = {
      project_context_binding_ref: canonicalContext.contextBindingRef,
      product_release_ref: currentRelease.releaseRef,
      execution_contract_version: 'lu-execution-identity-v1',
      localization_geometry_ref: locationRef,
    };

    // K0 (DOC-EVIDENCE-CENSUS 2026-10-02): document evidence exists for this assessment ONLY as
    // governed DocumentEvidence the caller selected explicitly (site.documentEvidenceRefs),
    // resolved from CAS and admitted below. There is no fallback: without explicit refs no document
    // evidence is created, none is sent in the API response and none reaches the kernel. The former
    // "presentation-only" fallback (orchestrator.generateDocumentEvidence -> PostgisDocumentProvider,
    // the default provider) swept every DocumentRecord of the property's municipality and packaged
    // the rows as DOCUMENT_EVIDENCE with random ids and content_hash "uncalculated" -- ungoverned
    // observations presented as evidence. Removed from the product path, not mitigated by env.

    // Magic Moment spatial contract: fixed 500 m buffer for water/ebh/protected_area.
    // Do not inherit legacy distanceToWater fallback (200 m) — that collapses EBH/protected hits.
    const magicMomentBufferMeters = 500;
    const queryRequest = {
      property_ref: propRef,
      location_ref: locationRef,
      buffer_distance_meters: magicMomentBufferMeters,
      layers: [
        { name: 'water', version_hash: 'v1.0' },
        { name: 'ebh', version_hash: 'v1.0' },
        { name: 'protected_area', version_hash: 'v1.0' },
        // LU-BREADTH-01 Track A: already-governed layers (real SUCCESS PostgisImportBatch rows),
        // newly wired into the product query.
        { name: 'natura2000', version_hash: 'v1.0' },
        { name: 'water_protection_area', version_hash: 'v1.0' },
      ] as const,
      budget: {
        max_layers: 8,
        max_features_per_layer: 50,
        max_distance_meters: 2000,
        timeout_ms: 5000,
      },
    };

    const { evidence: mpsEvidence, unavailable_layers: mpsUnavailableLayers } =
      await provider.query(queryRequest);
    const governedDocumentEvidence = await resolveCanonicalDocumentEvidence(
      site.documentEvidenceRefs,
      propRef.artifact_id,
      repo,
    );
    // K0: the response carries exactly the governed, resolved evidence -- [] when no refs were given.
    documentEvidence = governedDocumentEvidence;
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
    const kernelResult = await runCanonicalLuProductAssessment({
      site_id: canonicalSiteId,
      deterministic_seed: canonicalDeterministicSeed,
      // SpatialQueryOutcomeV2.evidence is readonly (SEM-1/W2); LuKernelRunInput.evidence
      // predates that contract and still declares a mutable array. Copying is the minimal,
      // in-scope fix -- widening LuKernelRunInput's own field type would touch every existing
      // caller/test of runLuAssessmentViaKernel, none of which are in this unit's allowed_paths.
      evidence: [...mpsEvidence],
      document_evidence: governedDocumentEvidence,
      verified_document_facts: verifiedDocumentFacts,
      unavailable_layers: mpsUnavailableLayers,
      artifact_repository: repo,
      identity_subject_v3: canonicalIdentitySubjectV3,
      assessment_draft: {
        site_id: site.id,
        project_context_ref: projRef,
        property_ref: propRef,
        evidence_refs: assessmentEvidenceRefs,
        system_summary:
          `Governed LU assessment: ${mpsEvidence.length} spatial evidence, ` +
          `${governedDocumentEvidence.length} document evidence.`,
        localization_geometry_ref: locationRef,
      },
    });

    let ticket_id: string | null = null;
    let assessment_artifact_id: string | null = null;
    // P3-LU-ASSESSMENT-PROJECTION-RELIABILITY-01: null means "no assessment was produced, so
    // registration was never attempted" -- distinct from `false`, which means an assessment WAS
    // persisted to CAS (the canonical, authoritative fact) but the non-authoritative projection
    // write failed. That distinction must reach the caller, not just a server log line: CAS
    // success and projection-DB success are two different systems that can fail independently,
    // and a caller/operator needs to be able to tell "assessment invalid" apart from "assessment
    // valid, but not yet discoverable by project until reconciled" (see
    // server/modules/localization/assessmentProjection.ts's reconcileAssessmentProjection).
    let assessment_projection_registered: boolean | null = null;
    if (kernelResult.admitted) {
      ticket_id = await enqueueAdmittedLuTicket(kernelResult.manifest_id);
      mpsFindings = [...kernelResult.findings];
      logger.info(
        `ExecutionKernel admitted LU assessment. findings=${mpsFindings.length} attempt=${kernelResult.attempt_id}`,
        { site: site.id },
      );

      assessment_artifact_id = kernelResult.assessment?.artifact_id ?? null;

      // Registered here, not inside the generic kernel client -- this keeps product-specific
      // persistence out of the generic governed execution chain. A failure here must never
      // retroactively invalidate a real, already-admitted, already CAS-persisted assessment --
      // the assessment stays valid either way. The failure is instead surfaced on the returned
      // report (assessment_projection_registered: false) and logged, so it is observable and
      // reconcilable rather than silently lost.
      if (kernelResult.assessment) {
        try {
          await registerAssessmentProjection({
            projectId: ctx.projectId,
            assessment: kernelResult.assessment,
            contextBindingRef: canonicalContext.contextBindingRef,
            releaseRef: currentRelease.releaseRef,
            localizationGeometryArtifactId: currentLocalizationGeometry.artifact_id,
          });
          assessment_projection_registered = true;
        } catch (err) {
          assessment_projection_registered = false;
          logger.warn('Failed to register assessment projection -- assessment remains CAS-valid; reconcile separately', { site: site.id, err: String(err) });
        }
      }
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
      assessment_projection_registered,
      property_context_id: propRef.artifact_id,
      // Admission alone is not a verdict. The artifact is. An admitted run that produced no
      // LocalizationAssessmentArtifact is NOT_ASSESSED, not assessed-with-no-findings.
      assessment_status: !kernelResult.admitted
        ? 'GOVERNANCE_DENIED'
        : assessment_artifact_id
          ? 'ASSESSED'
          : 'NOT_ASSESSED',
      findings: [...mpsFindings],
      localization_geometry: geometryProvenance,
      ...(kernelResult.admitted && assessment_artifact_id
        ? {
            governed_layer_checks: computeGovernedLayerChecks({
              requestedLayers: queryRequest.layers.map((l) => l.name),
              evidence: mpsEvidence,
              unavailableLayers: mpsUnavailableLayers ?? [],
              findings: mpsFindings,
            }),
          }
        : {}),
    };

  } catch (err: any) {
    if (err instanceof LocalizationGeometryCurrentnessError) {
      // DEMO M1a / D9(a): fail closed on the localization geometry -- no derived point, no kernel
      // run, no verdict. The failure class is kept as structured data and the reason is shown in
      // Swedish. A deliberate refusal (ambiguity, invalid graph, unverifiable candidates) reads as
      // GOVERNANCE_DENIED; a technical failure (DB/CAS/config) reads as EXECUTION_FAILED.
      logger.warn('LU localization geometry currentness failed closed', {
        site: site.id,
        failureClass: err.failureClass,
        detail: err.technicalDetail,
      });
      warnings.push(`Lokalisering: ${err.userMessage}`);
      executionMotor = {
        admitted: false,
        reason_codes: [err.code, err.reasonCode],
        attempt_id: null,
        outcome_id: null,
        manifest_id: null,
        ticket_id: null,
        finding_ids: [],
        assessment_artifact_id: null,
        assessment_projection_registered: null,
        property_context_id: null,
        assessment_status: err.kind === 'REFUSED' ? 'GOVERNANCE_DENIED' : 'EXECUTION_FAILED',
        findings: [],
        localization_geometry: failedClosedGeometryProvenanceRecord(err),
      };
    } else {
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
        assessment_projection_registered: null,
        property_context_id: null,
        assessment_status: 'EXECUTION_FAILED',
        findings: [],
      };
    }
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
    spatialAuditProvenance: LEGACY_SPATIAL_AUDIT_PROVENANCE,
    complianceAnalysis: hasGovernedAssessment
      ? {
          ...complianceAnalysis,
          ...governedVerdictFromFindings(executionMotor?.findings ?? []),
          ...legacyObservationTag(complianceAnalysis),
          assessment_status: 'ASSESSED',
        }
      : { ...withoutVerdict(complianceAnalysis, executionMotor?.assessment_status), ...legacyObservationTag(complianceAnalysis) },
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
      assessment_projection_registered: null,
      property_context_id: null,
      assessment_status: 'NOT_ASSESSED',
      findings: [],
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
function withoutVerdict(
  analysis: SiteAnalysis,
  status: LuAssessmentStatus | undefined,
): NonVerdictAnalysis {
  const { overallRisk: _risk, permitProbability: _probability, ...rest } = analysis;
  if (status === 'ASSESSED') {
    // Reached only if the artifact check and the status assignment have diverged. Failing here
    // is the fail-closed choice: silently relabelling would produce a non-verdict result
    // claiming a governed assessment backs it.
    throw new Error(
      'LU_VERDICT_AUTHORITY_V1: verdict stripped from a site whose assessment_status is ' +
        "'ASSESSED'. The artifact binding and the status assignment have diverged.",
    );
  }
  return { ...rest, assessment_status: status ?? 'NOT_ASSESSED' };
}

/**
 * A site may enter the ranking population only if a governed assessment backs it AND that
 * assessment reached a real, non-null permitProbability.
 *
 * SEM-1 (W2): a site with `unresolvedChecks` and a `null` permitProbability carries a real
 * governed verdict (`assessment_status === 'ASSESSED'`) but no number an ordering could honestly
 * use -- ranking it (even last, even at a floor value) would still be inventing a comparison
 * ADR-28A/OD-03/J-2 forbid. Such a site is excluded from the ranking population here, the same
 * way a non-verdict result is, even though its own status is technically 'ASSESSED'.
 *
 * Narrows `complianceAnalysis` as well as testing it: the return type is what lets
 * `rankedProbability` and the reasoning string reach the verdict fields at all.
 */
function isAssessed(
  analysis: SiteAnalysisResult,
): analysis is SiteAnalysisResult & {
  complianceAnalysis: GovernedVerdictAnalysis & { permitProbability: number };
} {
  return (
    analysis.executionMotor?.assessment_status === 'ASSESSED' &&
    analysis.executionMotor?.assessment_artifact_id != null &&
    isGovernedVerdict(analysis.complianceAnalysis) &&
    analysis.complianceAnalysis.permitProbability !== null
  );
}

/**
 * The ranking value for an assessed site.
 *
 * Throws rather than defaulting. `?? 0` here would be a silent fail-open: if `isAssessed` ever
 * weakened, an unassessed site (or one with a null, SEM-1 permitProbability) would enter the
 * ranking at probability 0 — a fabricated verdict — instead of the population being wrong loudly.
 *
 * The compiler now also refuses the un-narrowed read (LU_VERDICT_TYPE_BOUNDARY_V1), but this
 * check stays: the type says what the shape is, not that the ranking filter agrees with the
 * strip point. Those are separate claims and this one is only observable at runtime.
 */
function rankedProbability(analysis: SiteAnalysisResult): number {
  const { complianceAnalysis } = analysis;
  if (!isGovernedVerdict(complianceAnalysis) || complianceAnalysis.permitProbability === null) {
    throw new Error(
      `LU_VERDICT_AUTHORITY_V1: site '${analysis.site.id}' entered the ranking population ` +
        'without a governed, non-null permitProbability. The ranking filter and the verdict ' +
        'strip point have diverged.',
    );
  }
  return complianceAnalysis.permitProbability;
}

/**
 * W3a -- SEM-2 (ADR-28A): "The legacy compliance engine is retained temporarily as an explicitly
 * labelled observation layer. It SHALL NOT determine the governed LU verdict or be presented as
 * an equivalent authoritative assessment." `restrictions`/`rules` (from `evaluateComplianceRules`)
 * pass through the merge below unlabeled today; this tags them so every consumer -- the API
 * response, the PDF projection -- can tell legacy observation apart from the governed verdict.
 *
 * A single container-level tag, not a per-entry one: every `restrictions`/`rules` entry in this
 * codebase comes from exactly this one call, so tagging the pair once is factually equivalent to
 * tagging each entry, without forcing a breaking type change onto `restrictions: string[]` (bare
 * strings can't carry a per-entry field without becoming an array of objects). Exported, like
 * `governedVerdictFromFindings`, so this claim is provable without the full DB-dependent pipeline.
 */
export function legacyObservationTag(
  analysis: Pick<SiteAnalysis, 'restrictions' | 'rules'>,
): { legacyObservation?: LegacyObservationTag } {
  if (analysis.restrictions.length === 0 && analysis.rules.length === 0) {
    return {};
  }
  return { legacyObservation: { source: 'legacy_observation', version: 'v1' } };
}

/**
 * W3a -- J-7/J-12 (ADR-28A): "Mimer is decision support, not the legal decision authority. A
 * named, authorized human actor makes the formal decision." Owner-decided final wording (K-146
 * cold review + Jimmy's own text, 2026-09-29), replacing the pre-W3a text that covered the same
 * ground ("review before a formal decision") without ever saying who decides.
 */
export const HUMAN_IN_THE_LOOP =
  'Human in the loop: Mimer är ett beslutsstödsystem och fattar inte myndighetsbeslut. Systemet ' +
  'sammanställer underlag, identifierar relevanta omständigheter och kan lämna förslag och ' +
  'rekommendationer med spårbara källor. En behörig handläggare ansvarar för att granska ' +
  'underlaget, bedöma dess relevans och tillförlitlighet samt fatta, motivera och expediera det ' +
  'formella beslutet.';

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
      : analyses.length === 0
        ? // Noll kandidater är inte samma sak som kandidater utan bedömning. Att säga
          // "inget av 0 alternativ har en governad bedömning" beskriver en frånvaro som
          // aldrig fanns.
          'Inga alternativ analyserade.'
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
