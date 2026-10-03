/**
 * generate-localization-report.usecase.ts
 *
 * Clean Architecture Use Case for generating a localization study report.
 *
 * The governed path: property/project context -> current localization geometry -> registry-bound
 * spatial evidence -> kernel -> LocalizationAssessmentArtifact, plus audit trail logging.
 *
 * U20-C (LU 72h, DP-04): the older, unbound reads (local spatialAudit, live NVR / RAÄ / VISS / SLU
 * and the legacy compliance rules over them) are no longer part of the governed request. They run
 * only when a caller asks for them explicitly (`includeLegacyObservations`) and are then returned
 * in `legacyObservations` (governed: false) -- never in gating, the verdict or the reasoning.
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
import type { GovernedLayerCheck } from '../../server/modules/localization/governedLayerChecks';
import {
  assertGovernedSpatialQueryOutcome,
  GovernedSpatialEvidenceFormError,
  SPATIAL_QUERY_OUTCOME_VIOLATION_SV,
} from '../../server/modules/localization/governedSpatialEvidenceForm';
import {
  LU_V1_GOVERNED_SPATIAL_LAYERS,
  presentedGovernedLayerChecks,
  resolveGovernedAssessmentDetails,
  type GovernedAssessmentDetails,
  type GovernedEvidenceDetail,
  type PropertyRootDetails,
} from '../../server/modules/localization/governedEvidenceDetails';
import {
  assessGovernedCoverage,
  governedLayerLabelSv,
  governedOverallStatementSv,
  isWellFormedArtifactRef,
  RECORD_INTEGRITY_ERROR_SV,
  type GovernedRecordCoverageState,
} from '../../server/modules/localization/governedCoverageStatement';
import { recordIntegrityDiagnostic, type RecordIntegrityDiagnostic } from '../../server/modules/localization/recordIntegrityDiagnostic';

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
  | 'EXECUTION_FAILED'
  /**
   * U20CDF4 (owner decisions 2026-10-03 (4) points 1 and 3): the run admitted and persisted a governed
   * LocalizationAssessmentArtifact (assessment_artifact_id is set), but the record it holds is not
   * established -- a combination the current producer contract never writes (governed_coverage_state
   * RECORD_INTEGRITY_ERROR). No verdict is exposed, the site is never ranked, and the read-back of the
   * same record answers 424 ASSESSMENT_RECORD_INTEGRITY_ERROR.
   */
  | 'RECORD_INTEGRITY_ERROR';

export interface ExecutionMotorMeta {
  admitted: boolean;
  reason_codes: string[];
  attempt_id: string | null;
  outcome_id: string | null;
  manifest_id: string | null;
  ticket_id: string | null;
  finding_ids: string[];
  /**
   * CAS LocalizationAssessmentArtifact id. Null iff no assessment artifact was produced: set for
   * 'ASSESSED' and (U20CDF4) for 'RECORD_INTEGRITY_ERROR' -- the artifact exists and is registered, but
   * its record is not established and carries no verdict.
   */
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
   * (VISS, monuments, protected areas -- see evaluateComplianceRules) never came from
   * AssessmentFinding[]; since U20-C it is returned only in `legacyObservations`, on request.
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
   * K0: the last element is the document check (`layer: 'document'`, see GovernedDocumentCheck),
   * derived from the persisted assessment's pinned evidence_refs and (W-U20CDF6, OD-K0-3) its findings:
   * CHECKED_HIT only when LU-DOC-BESLUT-001 fired, CHECKED_NO_HIT when its pinned inputs are there and it did
   * not fire, NOT_CHECKED with a reason otherwise. The read-back returns the same object as `documentCheck`.
   */
  governed_layer_checks?: readonly GovernedLayerCheck[];
  /**
   * U20CDF2 (U20CDF verification G1): whether this run's record lets its coverage be established
   * (DETERMINED) or not (HISTORICAL_COVERAGE_UNKNOWN / CHECKS_UNAVAILABLE), with the machine codes
   * why -- the same assessGovernedCoverage the read-back and the PDF use. Present with
   * governed_layer_checks.
   */
  governed_coverage_state?: GovernedRecordCoverageState;
  governed_coverage_basis?: readonly string[];
  /**
   * U20-D: per pinned evidence of the persisted assessment, read back from CAS (layer, dataset
   * version hash, query radius/subject, result and cap, retrieval time, binding strength, ADMIT v1
   * coverage limitation, citing findings). The read-back returns the same entries as
   * `evidenceDetails`. Present only for an ASSESSED run; `null` with `evidence_details_error` when
   * the details could not be produced (never silently absent).
   */
  evidence_details?: readonly GovernedEvidenceDetail[] | null;
  evidence_details_error?: 'EVIDENCE_DETAILS_UNAVAILABLE';
  /** U20-D (K5): the property root's provenance and its honest, lower assurance. */
  property_root?: PropertyRootDetails;
  /** U20-D: integrity of the content read for the details (the read-back fails closed on `ok: false`). */
  evidence_integrity?: GovernedAssessmentDetails['integrity'];
  /**
   * W-U20CDF5 (U20CDF4 verification L1; owner decision 2026-10-02 point 2): present iff assessment_status is
   * RECORD_INTEGRITY_ERROR. The record's stored findings ONLY as the non-authoritative, whitelisted diagnostic
   * of the 424 (recordIntegrityDiagnostic.ts) -- such a site carries `findings: []`, `finding_ids: []`, no
   * governed_layer_checks / evidence_details / property_root / evidence_integrity, and its
   * governed_coverage_basis as bare codes: never anything in the form of a valid assessment.
   */
  record_integrity?: RecordIntegrityDiagnostic;
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
  // U20CDF4 (U20CDF3 verification L6.3): a stored record may hold an entry that is not a finding (null,
  // a number) or no list at all; it is reported as MALFORMED_RECORD_ENTRY (the read-back answers 424)
  // and must never make this derivation throw (it used to: a generic 500). Unchanged for real findings.
  findings = (Array.isArray(findings) ? findings : []).filter((finding) => Boolean(finding) && typeof finding === 'object');
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

/**
 * U20-C (U20-U30 spec 1.4 U-1/U-2, 1.5 K1; owner decision DP-04): the observations of the older,
 * ungoverned sources -- the local spatialAudit (U-1), the live NVR / RAÄ / VISS / SLU fetchers
 * (U-2) and the legacy compliance rules evaluated over them.
 *
 * Present ONLY when the caller explicitly asks for it (`includeLegacyObservations`, used by the
 * older generate-pdf-data route, the one existing consumer). The governed generate-report request
 * never performs these reads. Nothing in this block feeds the verdict, `summary.reasoning`, the
 * site/report warnings outside this block, strict gating or the assessment artifact.
 *
 * Technical failures are reported by status plus a sanitized Swedish text; the raw error (SQL
 * state, provider response) goes to the server log only, never into the HTTP body. No source or
 * table is removed by this (PRES-14); only its role changes.
 */
export interface LegacyObservationsBlock {
  readonly governed: false;
  readonly source: 'legacy_observation';
  readonly version: 'v1';
  readonly note_sv: string;
  /**
   * U20CDF (U20CD verification F4): whether each older source could be read at all. An unreadable
   * source is "not available" -- never "nothing found": its values below are null / empty and every
   * consumer must show it as unavailable, never as false or 0.
   */
  readonly sourceAvailability: {
    readonly spatialAudit: boolean;
    readonly nvr: boolean;
    readonly raa: boolean;
    readonly viss: boolean;
    readonly slu: boolean;
  };
  readonly protectedArea: {
    readonly available: boolean;
    /** null when the protected-area read was not available (never false for "could not read"). */
    readonly isProtected: boolean | null;
    readonly hitNames: readonly string[];
  };
  readonly distanceToWater: { readonly available: boolean; readonly meters: number | null };
  /** [] when RAÄ was not available -- see sourceAvailability.raa. */
  readonly monuments: readonly Monument[];
  readonly vissWaterStatus: VissWaterStatus | null;
  /** null when SLU was not available (never 0 for "could not read"). */
  readonly sluObservationCount: number | null;
  readonly dataSources: readonly DataSourceStatus[];
  readonly warnings: readonly string[];
  /** The legacy compliance engine's observations. Its own risk/probability are discarded. */
  readonly restrictions: readonly string[];
  readonly rules: SiteAnalysis['rules'];
}

export interface SiteAnalysisResult {
  site: SiteAlternative;
  /**
   * The governed verdict projection only (LU_VERDICT_AUTHORITY_V1). Since U20-C the legacy
   * engine's `restrictions`/`rules` are always [] here: they live only in `legacyObservations`.
   */
  complianceAnalysis: LuVerdictAnalysis;
  /** Governed-path warnings only (geometry, admission, kernel), sanitized. Never legacy-source text. */
  warnings: string[];
  /** U20-C: only when explicitly requested (older generate-pdf-data route). Never governed. */
  legacyObservations?: LegacyObservationsBlock;
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
    /**
     * Ranking population — sites with a governed LocalizationAssessmentArtifact AND a non-null
     * permitProbability (isAssessed).
     */
    assessed_site_ids: string[];
    /**
     * U20CDF4 (owner decision 2026-10-03 (4) point 4): candidates that HAVE a governed
     * LocalizationAssessmentArtifact but are not in the ranking population -- a withheld
     * permitProbability (SEM-1: a NOT_CHECKED finding and no HIGH/MEDIUM one) or a record that is not
     * established (RECORD_INTEGRITY_ERROR). assessed_site_ids + not_ranked_site_ids +
     * unassessed_site_ids partition the candidates.
     */
    not_ranked_site_ids: string[];
    /**
     * COMPATIBILITY FIELD (U20CDF4, owner decision (4) point 4): kept only until its consumers have moved
     * to assessed_site_ids / not_ranked_site_ids, and only in its original, narrower meaning --
     * candidates WITHOUT a governed assessment (no artifact: NOT_ASSESSED, GOVERNANCE_DENIED,
     * EXECUTION_FAILED). An assessed but unranked site is never listed here any more (U20CDF3 H2 had
     * noted that it was).
     */
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
    logger.warn('fetchProtectedAreas failed for localization', { site: siteId, err: redactInternalDiagnostic(msg) });
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
    logger.warn('fetchAncientMonuments failed for localization', { site: siteId, err: redactInternalDiagnostic(msg) });
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
    logger.warn('queryVissPoint failed for localization', { site: siteId, err: redactInternalDiagnostic(msg) });
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
        logger.warn('Failed to enrich SLU observations with Artfakta facts', { err: redactInternalDiagnostic(String(enrichErr)) });
      }
    }

    return { ok: true, data: baseObservations };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('searchSluByCoordinates failed for localization', { site: input.site.id, err: redactInternalDiagnostic(msg) });
    return { ok: false, error: msg };
  }
}

/** U20-C: the only text a legacy-source failure may show. The raw error is logged, never returned. */
const LEGACY_SOURCE_UNREADABLE_SV = 'Källan kunde inte läsas (tekniskt fel; detaljer finns i serverloggen).';

function buildDataSources(input: {
  spatial: SpatialAuditSummary | null;
  nvr: FetchOutcome<ProtectedArea[]>;
  raa: FetchOutcome<Monument[]>;
  viss: FetchOutcome<VissWaterStatus | null>;
  slu: FetchOutcome<SluObservation[]>;
}): DataSourceStatus[] {
  const spatial = input.spatial;
  const spatialStatus: DataSourceStatus['status'] = !spatial
    ? 'unavailable'
    : spatial.protectedAreaAvailable && spatial.distanceToWaterAvailable
      ? 'ok'
      : spatial.protectedAreaAvailable || spatial.distanceToWaterAvailable
        ? 'degraded'
        : 'unavailable';
  const sources: DataSourceStatus[] = [
    {
      source: 'PostGIS spatial',
      status: spatialStatus,
      detail: spatialStatus === 'ok' ? 'Lokal kontroll läst' : LEGACY_SOURCE_UNREADABLE_SV,
    },
    {
      source: 'SGU jord/skred',
      status: !spatial ? 'unavailable' : spatial.sgu.manualReviewRequired ? 'degraded' : 'ok',
      detail: !spatial || spatial.sgu.manualReviewRequired ? LEGACY_SOURCE_UNREADABLE_SV : 'SGU-underlag läst',
    },
    {
      source: 'NVR API',
      status: input.nvr.ok ? 'ok' : 'unavailable',
      detail: input.nvr.ok ? `${input.nvr.data.length} träffar` : LEGACY_SOURCE_UNREADABLE_SV,
    },
    {
      source: 'RAA API',
      status: input.raa.ok ? 'ok' : 'unavailable',
      detail: input.raa.ok ? `${input.raa.data.length} fornlämningar` : LEGACY_SOURCE_UNREADABLE_SV,
    },
    {
      source: 'VISS',
      status: input.viss.ok ? 'ok' : 'unavailable',
      detail: input.viss.ok ? input.viss.data?.waterName || 'ingen primär status' : LEGACY_SOURCE_UNREADABLE_SV,
    },
    {
      source: 'SLU Artdata',
      status: input.slu.ok ? 'ok' : 'unavailable',
      detail: input.slu.ok ? `${input.slu.data.length} observationer` : LEGACY_SOURCE_UNREADABLE_SV,
    },
  ];
  return sources;
}

/** DEMO M1a / U12: marks text that comes from the older, ungoverned sources. */
export const LEGACY_SPATIAL_AUDIT_PREFIX_SV = 'Äldre observation (ingår inte i den styrda bedömningen):';

const LEGACY_OBSERVATIONS_NOTE_SV =
  'Äldre observationer från den lokala PostGIS-kontrollen (spatialAudit) och livekällorna NVR, RAÄ, VISS ' +
  'och SLU. De är inte styrd evidens, ingår inte i den styrda bedömningen och kan inte motsäga den; se ' +
  'executionMotor för det styrda resultatet.';

function collectWarnings(input: {
  spatial: SpatialAuditSummary | null;
  nvr: FetchOutcome<ProtectedArea[]>;
  raa: FetchOutcome<Monument[]>;
  viss: FetchOutcome<VissWaterStatus | null>;
  slu: FetchOutcome<SluObservation[]>;
  strict: boolean;
}): string[] {
  const warnings: string[] = [];
  const unreadable = (what: string) => `${LEGACY_SPATIAL_AUDIT_PREFIX_SV} ${what}: ${LEGACY_SOURCE_UNREADABLE_SV}`;
  // DEMO M1a / U12 + U20-C: every warning here comes from an older, ungoverned source, carries the
  // legacy prefix, and never echoes the raw error (U-1 used to put Prisma/SQL errors in the body).
  if (!input.spatial) {
    warnings.push(unreadable('Lokal PostGIS-kontroll'));
  } else {
    if (!input.spatial.protectedAreaAvailable && input.spatial.protectedAreaWarning) {
      warnings.push(unreadable('Skyddad natur (lokal)'));
    }
    if (!input.spatial.distanceToWaterAvailable && input.spatial.distanceToWaterWarning) {
      warnings.push(unreadable('Avstånd vatten'));
    }
  }
  if (!input.nvr.ok) {
    warnings.push(unreadable(input.strict ? 'NVR API (skyddade områden från livekälla saknas)' : 'NVR API'));
  }
  if (!input.raa.ok) warnings.push(unreadable('RAÄ/fornlämningar'));
  if (!input.viss.ok) warnings.push(unreadable('VISS'));
  if (!input.slu.ok) warnings.push(unreadable('SLU Artdata'));
  return warnings;
}

/**
 * U20-C: the older, ungoverned observations, collected only on explicit request. Never throws: a
 * failing legacy source must not be able to break (or otherwise touch) the governed run.
 */
async function collectLegacyObservations(
  site: SiteAlternative,
  ctx: { projectId: string; user?: AuthUser },
): Promise<LegacyObservationsBlock> {
  const strict = isLocalizationStrictMode();

  let spatialAudit: SpatialAuditSummary | null;
  try {
    spatialAudit = await runSpatialAudit(site.lat, site.lng);
  } catch (err) {
    logger.warn('runSpatialAudit failed (legacy observation)', { site: site.id, err: redactInternalDiagnostic(String(err)) });
    spatialAudit = null;
  }

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

  const distanceToWaterMeters = spatialAudit ? spatialAudit.distanceToWaterMeters : null;
  const distanceToWaterAvailable = spatialAudit ? spatialAudit.distanceToWaterAvailable : false;

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
  // U20-C: the warning now lives in the legacy block only.
  if (distanceToWaterMeters == null && strict && !distanceToWaterAvailable) {
    warnings.push(`${LEGACY_SPATIAL_AUDIT_PREFIX_SV} Avstånd till vatten okänt — compliance använder inte standardfallback i strikt läge.`);
  }

  // The legacy engine's own overallRisk / permitProbability / summary are discarded here: only its
  // restrictions and rules are kept, as labelled observations (W3a SEM-2).
  let restrictions: string[] = [];
  let rules: SiteAnalysis['rules'] = [];
  try {
    const legacyRules = evaluateComplianceRules(
      observations,
      protectedAreas,
      spatialAudit ? toGeologicalData(spatialAudit.sgu) : {},
      monuments,
      distanceToWaterMeters,
    );
    restrictions = legacyRules.restrictions;
    rules = legacyRules.rules;
  } catch (err) {
    logger.warn('evaluateComplianceRules failed (legacy observation)', { site: site.id, err: redactInternalDiagnostic(String(err)) });
    warnings.push(`${LEGACY_SPATIAL_AUDIT_PREFIX_SV} Äldre regelmotor: ${LEGACY_SOURCE_UNREADABLE_SV}`);
  }

  const protectedAreaAvailable = spatialAudit ? spatialAudit.protectedAreaAvailable === true : false;
  return {
    governed: false,
    source: 'legacy_observation',
    version: 'v1',
    note_sv: LEGACY_OBSERVATIONS_NOTE_SV,
    sourceAvailability: {
      spatialAudit: spatialAudit !== null,
      nvr: nvrOutcome.ok,
      raa: raaOutcome.ok,
      viss: vissOutcome.ok,
      slu: sluOutcome.ok,
    },
    protectedArea: {
      available: protectedAreaAvailable,
      // U20CDF (F4): "could not read" is null, never "not protected".
      isProtected: protectedAreaAvailable ? spatialAudit!.isProtected : null,
      hitNames: protectedAreaAvailable ? spatialAudit!.protectedAreaHits.map((hit) => hit.name || 'Namnlöst område') : [],
    },
    distanceToWater: { available: distanceToWaterAvailable, meters: distanceToWaterMeters },
    monuments,
    vissWaterStatus,
    sluObservationCount: sluOutcome.ok ? observations.length : null,
    dataSources,
    warnings,
    restrictions,
    rules,
  };
}

/**
 * U20-C: a governed-path technical failure is reported without the raw database / provider text.
 * The full message always goes to the server log.
 *
 * U20CDF (U20CD verification F7): an ALLOWLIST, not a denylist of raw-text patterns. Only a leading
 * code of the governed error vocabulary (`REJECT_*`, `LU_*`) is passed on, and only the code itself:
 * the text after it can carry a file path, a connection detail or a driver message, so it is never
 * echoed. Anything else -- including an upper-case token outside the vocabulary such as `ERROR` or
 * `ENOENT` -- becomes the one generic Swedish class text.
 */
const GOVERNED_ERROR_CODE = /^(?:REJECT|LU)_[A-Z0-9_]+(?=[:\s]|$)/;
export const GOVERNED_ERROR_GENERIC_SV = 'tekniskt fel (detaljer finns i serverloggen)';

export function sanitizeGovernedErrorMessage(message: string): string {
  const code = GOVERNED_ERROR_CODE.exec(String(message));
  return code ? code[0] : GOVERNED_ERROR_GENERIC_SV;
}

/**
 * U20CDF (U30-R2 follow-up): internal diagnostics only. The provider's raw technical text for a
 * layer whose governed query failed (SpatialLayerUnavailable.diagnostic) may name a connection
 * string, a credential or a token; those are masked before the text reaches the server log, and it
 * is truncated. It is never put in a response, an artifact, a PDF or the kernel input.
 *
 * U20CDF2 (U20CDF verification G4; owner: internal logging may be rich but never leaks a secret).
 * Masked, in this order:
 *  - PEM private key blocks;
 *  - URI userinfo up to the LAST "@" of the token (a password may contain "@", "/" or %-escapes; a
 *    token may stand in the user part);
 *  - Authorization / Proxy-Authorization values, whatever their scheme (Basic, Bearer, ...);
 *  - bare "Bearer <token>" / "Basic <credentials>" and bare JWTs;
 *  - CLI flags "--password <value>" (and passwd / pwd / token / secret / api-key);
 *  - any key that CONTAINS password / passwd / pwd / secret / token / api key / credential /
 *    private key / access key -- env forms (PGPASSWORD=, DB_PASSWORD:, MIMERS_API_TOKEN=,
 *    AWS_SECRET_ACCESS_KEY=), JSON and single-quoted fields ("password":"...", 'secret': '...'),
 *    libpq (password='...') and query strings (?api_key=...) -- with a quoted or bare value.
 * U20CDF3 (U20CDF2 verification H3 / low 1; probe D found these passing), also masked:
 *  - Digest parameter lists (Authorization / Proxy-Authorization / WWW-Authenticate: response=,
 *    nonce=, cnonce=, opaque=, ...);
 *  - provider token shapes without a key: sk-..., sk_live_/sk_test_, rk_..., ghp_/gho_/ghu_/ghs_/ghr_,
 *    github_pat_, glpat-, xox?-, AKIA/ASIA access key ids, AIza..., npm_...;
 *  - Cookie / Set-Cookie values (every name=value; attribute up to the first unrelated word);
 *  - the short CLI flag -p<value> / -p <value> (mysql password; over-masks a psql port);
 *  - keys that END in or are pass, passphrase, auth, sig, session, sid, cookie (pass=, PGPASS=,
 *    ?sig=, ?auth=) next to the earlier list;
 *  - "password <value>" / "passwd <value>" / "pwd <value>" without = or : -- except when the next word
 *    is ordinary error text ("password authentication failed ...").
 * Over-masking is accepted; codes, hosts and relation names stay for diagnosis.
 */
const DIAGNOSTIC_MAX_LENGTH = 1000;
const SECRET_KEY =
  /[A-Za-z0-9_.-]*(?:password|passwd|passphrase|pwd|secret|token|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|(?:pass|auth|sig|session|sid|cookie)(?![a-z]))[A-Za-z0-9_.-]*/
    .source;
/**
 * U20CDF4 (U20CDF3 verification L3): a ";" ends an unquoted value only where a new `key=` follows it
 * (a connection-string separator) -- "Password=Semi;Colon34;Host=db" used to leave "Colon34" in the
 * clear. A ";" followed by anything else is taken as part of the secret (over-masking accepted). ODBC
 * braced values ({...}) are masked whole.
 */
const VALUE_SEMICOLON = /;(?![A-Za-z][A-Za-z0-9_.-]*=)/.source;
const SECRET_VALUE = new RegExp(`(?:"[^"]*"|'[^']*'|\\{[^}]*\\}|(?:[^\\s,;}"']|${VALUE_SEMICOLON})+)`).source;
const SECRET_KEY_VALUE = new RegExp(`(${SECRET_KEY})(["']?)(\\s*[=:]\\s*)${SECRET_VALUE}`, 'gi');
/** U20CDF3 (low 1): a Digest parameter list (all of it -- response, nonce, cnonce, opaque, ...). */
const DIGEST_PARAMS =
  /\b(Digest)\s+[A-Za-z][A-Za-z0-9_-]*\s*=\s*(?:"[^"]*"|[^\s,"]+)(?:\s*,\s*[A-Za-z][A-Za-z0-9_-]*\s*=\s*(?:"[^"]*"|[^\s,"]+))*/gi;
/** U20CDF3 (low 1): provider tokens recognisable by their own shape, with no key in front. */
const PROVIDER_TOKEN =
  /\b(?:sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{8,}|[sr]k_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,}|xox[abposr]-[A-Za-z0-9-]{8,}|A(?:KI|SI)A[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|npm_[A-Za-z0-9]{20,})/g;
/** U20CDF3 (low 1): a Cookie / Set-Cookie value -- name=value pairs and attributes joined by ";". */
const COOKIE_VALUE = /\b((?:set-)?cookie2?)(["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s;,"']+(?:\s*;\s*[^\s;,"']+)*)/gi;
/** U20CDF3 (low 1): mysql-style -p<password> / -p <password>. */
const SHORT_PASSWORD_FLAG = /(^|[\s'"(=])(-p)(\s*)(?![-\s])([^\s'"]+)/g;
/**
 * U20CDF3 (low 1): "passwd <value>" -- not when the next word is ordinary error text. U20CDF4 (L3): a
 * ";" inside the value is part of it unless a new `key=` follows.
 */
const PASSWORD_WORD_VALUE = new RegExp(
  /\b(password|passwd|passphrase|pwd)(\s+)(?!(?:authentication|auth|for|is|was|were|must|required|missing|not|expired|incorrect|invalid|too|has|have|cannot|can|should|failed|mismatch|changed|reset|and|or|of|the|to|policy|length|field|hash|\*\*\*)\b)(?![=:"'*])/
    .source + `(?:[^\\s,;]|${VALUE_SEMICOLON})+`,
  'gi',
);

export function redactInternalDiagnostic(text: unknown): string | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '-----BEGIN PRIVATE KEY----- *** -----END PRIVATE KEY-----')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s'"<>]*@/gi, '$1***@')
    .replace(DIGEST_PARAMS, '$1 ***')
    .replace(/\b((?:proxy-)?authorization)(["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|(?:basic|bearer|digest|token|negotiate|ntlm)\s+\S+|\S+)/gi, '$1$2***')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 ***')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '***')
    .replace(PROVIDER_TOKEN, '***')
    .replace(COOKIE_VALUE, '$1$2***')
    .replace(/(--?(?:password|passwd|pwd|token|secret|api[_-]?key)\b)(\s+)(?!-)\S+/gi, '$1$2***')
    .replace(SHORT_PASSWORD_FLAG, '$1$2$3***')
    .replace(SECRET_KEY_VALUE, '$1$2$3***')
    .replace(PASSWORD_WORD_VALUE, '$1$2***')
    .slice(0, DIAGNOSTIC_MAX_LENGTH);
}

/**
 * U20CDF2 (G1): the fresh run's layer checks plus its coverage state, from the same rows and the
 * same findings the read-back uses (assessGovernedCoverage).
 */
function freshGovernedCoverage(
  checks: readonly GovernedLayerCheck[],
  findings: readonly AssessmentFinding[],
  /** W-U20CDF6 (R2-5): whether the record THIS run persisted names a well-formed property_ref. */
  propertyRefWellFormed: boolean,
): Pick<ExecutionMotorMeta, 'governed_layer_checks' | 'governed_coverage_state' | 'governed_coverage_basis'> {
  // U20CDF4: the record of THIS run -- anything not DETERMINED is RECORD_INTEGRITY_ERROR, never historical.
  const assessed = assessGovernedCoverage(checks, { findings, freshRun: true, propertyRefWellFormed });
  return {
    governed_layer_checks: checks,
    governed_coverage_state: assessed.coverage_state,
    governed_coverage_basis: assessed.coverage_basis,
  };
}

/** U20-C: the Swedish summary of a site without a governed assessment (no verdict, no legacy text). */
function nonVerdictSummarySv(status: LuAssessmentStatus | undefined): string {
  switch (status) {
    case 'GOVERNANCE_DENIED':
      return 'Ingen styrd bedömning: körningen nekades av styrningen. Ingen risknivå anges.';
    case 'EXECUTION_FAILED':
      return 'Ingen styrd bedömning: körningen avbröts av ett tekniskt fel. Ingen risknivå anges.';
    default:
      return 'Ingen styrd bedömning gjordes. Ingen risknivå anges.';
  }
}

async function analyzeSite(
  site: SiteAlternative,
  ctx: { projectId: string; user?: AuthUser },
  createSpatialRuntime: () => Promise<LocalizationSpatialRuntime>,
  options: { readonly includeLegacyObservations: boolean },
): Promise<SiteAnalysisResult> {
  logger.info(`Analyzing site: ${site.id} at (${site.lat}, ${site.lng})`);

  // U20-C / DP-04: the governed request performs no unbound read. The older observations exist
  // only for a caller that explicitly asks for them, in their own labelled block, and are
  // collected independently of (and can never alter) anything below.
  const legacyObservations = options.includeLegacyObservations
    ? await collectLegacyObservations(site, ctx)
    : undefined;
  const warnings: string[] = [];

  // Magic Moment path: property CAS → registry-resolved spatial provider → evidence → kernel → assessment
  let mpsFindings: AssessmentFinding[] = [];
  let executionMotor: ExecutionMotorMeta | undefined;
  let spatialRuntime: LocalizationSpatialRuntime | undefined;
  // K0: only governed DocumentEvidence resolved from explicit refs; never a provider sweep.
  let documentEvidence: DocumentEvidenceArtifact[] = [];
  // M1a verification F4: set as soon as the geometry step has resolved (or derived) the point, so
  // the generic failure branch below can still report it -- e.g. a centroid derived in THIS request
  // when the release, provider or kernel fails afterwards. Undefined iff the step was not reached.
  let geometryProvenance: LocalizationGeometryProvenanceRecord | undefined;
  // W-U20CDF5 (L1): the statement of a RECORD_INTEGRITY_ERROR site, taken before its findings are withheld from
  // executionMotor -- it names every stored finding (a known risk never disappears).
  let recordIntegritySummarySv: string | null = null;
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
    geometryProvenance =
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
      // water / ebh / protected_area, plus (LU-BREADTH-01 Track A) the already-governed natura2000
      // and water_protection_area. U20-D: one list, shared with the read-back's layer checks.
      layers: LU_V1_GOVERNED_SPATIAL_LAYERS.map((name) => ({ name, version_hash: 'v1.0' })),
      budget: {
        max_layers: 8,
        max_features_per_layer: 50,
        max_distance_meters: 2000,
        timeout_ms: 5000,
      },
    };

    const { evidence: mpsEvidence, unavailable_layers: providerUnavailableLayers } =
      await provider.query(queryRequest);
    // U20CDF (U30-R2 follow-up): the raw provider text of a failed layer query is internal
    // diagnostics -- logged here, structured and redacted, and passed on nowhere: the kernel gets
    // only the stable cause code (reason), so the diagnostic cannot reach a finding, an artifact,
    // a response or a PDF.
    // U20CDF4 (U20CDF3 verification L1): this loop runs BEFORE the gate below, so it reads the entries
    // as untrusted -- any shape (a null entry used to throw here and turn the gate's typed
    // UNAVAILABLE_WITHOUT_DATASET into a generic EXECUTION_KERNEL_ERROR), and the not yet admitted
    // layer and reason are redacted like the diagnostic.
    for (const unavailable of providerUnavailableLayers as readonly unknown[]) {
      const entry = (unavailable && typeof unavailable === 'object' ? unavailable : {}) as {
        dataset?: unknown;
        reason?: unknown;
        diagnostic?: unknown;
      };
      logger.warn('Governed LU layer query failed (internal diagnostic)', {
        site: site.id,
        layer: redactInternalDiagnostic(entry.dataset),
        reason: redactInternalDiagnostic(entry.reason),
        diagnostic: redactInternalDiagnostic(entry.diagnostic),
      });
    }
    // U20CDF2 (U20CDF verification G3; owner's locked specification): the provider's outcome must be
    // in the common normal form BEFORE the rule engine reads it -- the same form the layer checks
    // read stored evidence through. An evidence with a non-boolean `exists`, a match count that
    // contradicts it or another declared kind, or a layer both evidenced and unavailable, fails the
    // run closed (REJECT_SPATIAL_EVIDENCE_FORM -> EXECUTION_FAILED, no assessment, no verdict).
    // U20CDF3 (low 2): and every entry names exactly one of the layers this run requested.
    assertGovernedSpatialQueryOutcome(
      { evidence: mpsEvidence, unavailable_layers: providerUnavailableLayers },
      queryRequest.layers.map((layer) => layer.name),
    );
    const mpsUnavailableLayers = providerUnavailableLayers.map(({ dataset, reason }) => ({ dataset, reason }));
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
          logger.warn('Failed to register assessment projection -- assessment remains CAS-valid; reconcile separately', { site: site.id, err: redactInternalDiagnostic(String(err)) });
        }
      }
    } else {
      logger.warn('LU ExecutionKernel denied admission', {
        site: site.id,
        reasons: kernelResult.reason_codes,
      });
      warnings.push(`ExecutionKernel denied: ${kernelResult.reason_codes.join(', ') || 'unknown'}`);
    }

    // U20-D: the same function the read-back and the PDF use, over the same inputs -- the spatial
    // evidence and findings this run persisted, and (K0) the PERSISTED assessment's pinned
    // evidence_refs for the document check. A layer whose query failed shows through its NOT_CHECKED
    // finding (coverage_state SOURCE_UNAVAILABLE), not through the provider's raw error text.
    // W-U20CDF6 (owner decision R2-5): the PERSISTED record's own property_ref, the one every later path reads -- a
    // record without a well-formed one is a RECORD_INTEGRITY_ERROR here exactly as on the read-back, the PDF, verify
    // and the map (never ASSESSED, never ranked).
    const persistedPropertyRefWellFormed = isWellFormedArtifactRef(
      (kernelResult.assessment?.payload as { property_ref?: unknown } | undefined)?.property_ref,
    );
    const freshCoverage =
      kernelResult.admitted && assessment_artifact_id
        ? freshGovernedCoverage(
            presentedGovernedLayerChecks({
              spatialEvidence: mpsEvidence,
              findings: mpsFindings,
              pinnedEvidenceRefs: kernelResult.assessment?.payload?.evidence_refs,
            }),
            mpsFindings,
            persistedPropertyRefWellFormed,
          )
        : null;
    // U20CDF4 (owner decisions 2026-10-03 (4) points 1 and 3): an artifact whose record is not
    // established carries no verdict and is never ranked -- its own status, never ASSESSED.
    const recordIntegrityError = freshCoverage?.governed_coverage_state === 'RECORD_INTEGRITY_ERROR';
    // W-U20CDF5 (U20CDF4 verification L1; owner decision 2026-10-02 point 2): such a record is never serialised
    // in the form of a valid assessment -- its stored findings travel only as the 424's non-authoritative,
    // whitelisted diagnostic (record_integrity); no findings / finding ids / layer rows / evidence details /
    // root / id-bearing basis entries below.
    const recordIntegrity: RecordIntegrityDiagnostic | null =
      recordIntegrityError && assessment_artifact_id
        ? recordIntegrityDiagnostic(assessment_artifact_id, freshCoverage?.governed_coverage_basis ?? [], mpsFindings)
        : null;
    if (recordIntegrity) {
      recordIntegritySummarySv = governedOverallStatementSv(
        governedVerdictFromFindings(mpsFindings).overallRisk,
        freshCoverage?.governed_layer_checks,
        { findings: mpsFindings, freshRun: true, propertyRefWellFormed: persistedPropertyRefWellFormed },
      );
    }
    if (recordIntegrityError) {
      // W-TEXT2 (U6-3): the warning reaches the PDF data -- the id and the class stay in executionMotor
      // (assessment_artifact_id, governed_coverage_state, record_integrity), never in the user text.
      warnings.push(
        'Integritetsfel: den styrda bedömning som körningen sparade har ett lagrat underlag som är ' +
          'motsägelsefullt eller ligger utanför det styrda formatet. Ingen risknivå och ingen sannolikhet ' +
          'anges, och alternativet rangordnas inte.',
      );
    }
    executionMotor = {
      admitted: kernelResult.admitted,
      reason_codes: [...kernelResult.reason_codes],
      attempt_id: kernelResult.attempt_id,
      outcome_id: kernelResult.outcome_id,
      manifest_id: kernelResult.manifest_id,
      ticket_id,
      finding_ids: recordIntegrity ? [] : [...kernelResult.finding_ids],
      assessment_artifact_id,
      assessment_projection_registered,
      property_context_id: propRef.artifact_id,
      // Admission alone is not a verdict. The artifact is. An admitted run that produced no
      // LocalizationAssessmentArtifact is NOT_ASSESSED, not assessed-with-no-findings.
      assessment_status: !kernelResult.admitted
        ? 'GOVERNANCE_DENIED'
        : assessment_artifact_id
          ? recordIntegrityError
            ? 'RECORD_INTEGRITY_ERROR'
            : 'ASSESSED'
          : 'NOT_ASSESSED',
      findings: recordIntegrity ? [] : [...mpsFindings],
      localization_geometry: geometryProvenance,
      ...(recordIntegrity
        ? {
            governed_coverage_state: 'RECORD_INTEGRITY_ERROR' as const,
            governed_coverage_basis: recordIntegrity.basis_codes,
            record_integrity: recordIntegrity,
          }
        : (freshCoverage ?? {})),
    };

    // U20-D: evidence and property-root details of the persisted assessment, read back from CAS by
    // the same module as the read-back/PDF. Presentation only: whatever happens here can never
    // change the status, the verdict or the assessment, and a failure is reported, not thrown.
    // W-U20CDF5 (L1): not for a RECORD_INTEGRITY_ERROR site -- its evidence is not presented as valid details.
    if (kernelResult.admitted && assessment_artifact_id && kernelResult.assessment && !recordIntegrity) {
      try {
        const details = await resolveGovernedAssessmentDetails({
          assessment: kernelResult.assessment,
          artifactRepository: repo,
        });
        executionMotor = {
          ...executionMotor,
          evidence_details: details.evidenceDetails,
          property_root: details.propertyRoot,
          evidence_integrity: details.integrity,
        };
      } catch (err) {
        logger.warn('Governed evidence details could not be resolved for the fresh run', { site: site.id, err: redactInternalDiagnostic(String(err)) });
        executionMotor = { ...executionMotor, evidence_details: null, evidence_details_error: 'EVIDENCE_DETAILS_UNAVAILABLE' };
      }
    }

  } catch (err: any) {
    if (err instanceof LocalizationGeometryCurrentnessError) {
      // DEMO M1a / D9(a): fail closed on the localization geometry -- no derived point, no kernel
      // run, no verdict. The failure class is kept as structured data and the reason is shown in
      // Swedish. A deliberate refusal (ambiguity, invalid graph, unverifiable candidates) reads as
      // GOVERNANCE_DENIED; a technical failure (DB/CAS/config) reads as EXECUTION_FAILED.
      logger.warn('LU localization geometry currentness failed closed', {
        site: site.id,
        failureClass: err.failureClass,
        // U20CDF3 (low 1): rich internal detail, never a leaked secret.
        detail: redactInternalDiagnostic(err.technicalDetail),
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
    } else if (err instanceof GovernedSpatialEvidenceFormError) {
      // U20CDF3 (U20CDF2 verification H6 / low 6): the gate stopped the run BEFORE the kernel and the
      // rule engine -- reported as exactly that (its own code + the violation, Swedish text), never as
      // an "ExecutionKernel error" / EXECUTION_KERNEL_ERROR. No assessment, no verdict.
      logger.warn('Governed LU spatial query outcome rejected before the rule engine', {
        site: site.id,
        code: err.code,
        violation: err.violation,
        layer: err.layer,
      });
      // A layer is named only when it is a governed one (never an arbitrary provider string).
      const layerSv =
        err.layer !== null && (LU_V1_GOVERNED_SPATIAL_LAYERS as readonly string[]).includes(err.layer)
          ? ` för lagret ${governedLayerLabelSv(err.layer)}`
          : '';
      warnings.push(
        `Spatialt underlag avvisat: ${SPATIAL_QUERY_OUTCOME_VIOLATION_SV[err.violation]}${layerSv} ` +
          `(${err.code}: ${err.violation}). Ingen bedömning gjordes; regelmotorn nåddes aldrig.`,
      );
      executionMotor = {
        admitted: false,
        reason_codes: [err.code, err.violation],
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
        ...(geometryProvenance ? { localization_geometry: geometryProvenance } : {}),
      };
    } else {
      const msg = err?.message || String(err);
      // U20CDF3 (low 1): the raw text stays in the internal log, redacted like every other diagnostic.
      logger.warn('ExecutionKernel LU assessment failed', { err: redactInternalDiagnostic(msg), site: site.id });
      // U20-C: never the raw database/provider text in the HTTP body (it stays in the log above).
      warnings.push(`ExecutionKernel error: ${sanitizeGovernedErrorMessage(msg)}`);
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
        // F4: the geometry this request resolved/derived before failing (absent if not reached).
        ...(geometryProvenance ? { localization_geometry: geometryProvenance } : {}),
      };
    }
  } finally {
    await spatialRuntime?.close().catch(() => undefined);
  }

  // LU_VERDICT_AUTHORITY_V1 — the single point where a verdict is either bound to a governed
  // assessment or removed. Stripping here rather than at each failure branch means a future
  // branch that forgets to fail closed still cannot leak a verdict.
  // U20CDF4: the verdict belongs to ASSESSED only -- an artifact whose record is not established
  // (RECORD_INTEGRITY_ERROR) carries none.
  const hasGovernedAssessment = executionMotor?.assessment_artifact_id != null && executionMotor?.assessment_status === 'ASSESSED';

  // U20-C: the verdict projection is built from the governed findings only -- never from the legacy
  // engine (its restrictions/rules live in `legacyObservations`). The summary text states the risk
  // level only together with how many governed checks were completed (owner decision OD-K0-1);
  // the machine-readable overallRisk / permitProbability / unresolvedChecks are unchanged.
  let complianceAnalysis: LuVerdictAnalysis;
  if (hasGovernedAssessment) {
    const verdict = governedVerdictFromFindings(executionMotor?.findings ?? []);
    complianceAnalysis = {
      restrictions: [],
      rules: [],
      ...verdict,
      // U20CDF2 (G1): coverage and risk from the same record -- the run's checks and its findings.
      summary: governedOverallStatementSv(verdict.overallRisk, executionMotor?.governed_layer_checks, {
        findings: executionMotor?.findings ?? [],
        freshRun: true,
      }),
      assessment_status: 'ASSESSED',
    };
  } else if (executionMotor?.assessment_status === 'RECORD_INTEGRITY_ERROR') {
    // U20CDF4 (owner decision (4) point 1): not returned as an assessment -- no overallRisk, no
    // permitProbability (withoutVerdict, under the record's own status, never ASSESSED). The summary is
    // the integrity statement, which names every stored finding: a known risk never disappears.
    // W-U20CDF5 (L1): taken before the findings were withheld from executionMotor.
    complianceAnalysis = withoutVerdict(
      { restrictions: [], rules: [], summary: recordIntegritySummarySv ?? RECORD_INTEGRITY_ERROR_SV },
      'RECORD_INTEGRITY_ERROR',
    );
  } else {
    complianceAnalysis = withoutVerdict(
      { restrictions: [], rules: [], summary: nonVerdictSummarySv(executionMotor?.assessment_status) },
      executionMotor?.assessment_status,
    );
  }

  return {
    site,
    complianceAnalysis,
    warnings,
    ...(legacyObservations ? { legacyObservations } : {}),
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
  analysis: Omit<SiteAnalysis, 'overallRisk' | 'permitProbability'> &
    Partial<Pick<SiteAnalysis, 'overallRisk' | 'permitProbability'>>,
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
    // U20CDF4 (owner decision 2026-10-03 (4) point 3; coordinator clarification 5): only a record whose
    // coverage is established may compete with other sites -- never one that is not, whatever its
    // machine probability says.
    analysis.executionMotor?.governed_coverage_state === 'DETERMINED' &&
    isGovernedVerdict(analysis.complianceAnalysis) &&
    analysis.complianceAnalysis.permitProbability !== null
  );
}

/**
 * U20CDF3 (U20CDF2 verification H2): a site that HAS a governed assessment (status ASSESSED, an
 * artifact) but is outside the ranking population because its permitProbability is withheld
 * (SEM-1: a NOT_CHECKED finding and no HIGH/MEDIUM one). It is assessed -- never described as
 * "ej bedömd" or as lacking a LocalizationAssessmentArtifact. U20CDF4: its record is established
 * (DETERMINED), so its sentence ("ofullständig ... ingen sannolikhet") is true.
 */
function isAssessedButUnranked(analysis: SiteAnalysisResult): boolean {
  return (
    analysis.executionMotor?.assessment_status === 'ASSESSED' &&
    analysis.executionMotor?.assessment_artifact_id != null &&
    analysis.executionMotor?.governed_coverage_state === 'DETERMINED' &&
    isGovernedVerdict(analysis.complianceAnalysis) &&
    analysis.complianceAnalysis.permitProbability === null
  );
}

/**
 * U20CDF4 (owner decisions 2026-10-03 (4) points 1 and 3): a site whose run persisted a governed
 * assessment artifact but whose record is not established -- status RECORD_INTEGRITY_ERROR (no
 * verdict), or (defensively) ASSESSED without an established coverage. Never ranked, never described as
 * lacking an assessment, and its own sentence says why it is not ranked.
 */
function hasUnestablishedRecord(analysis: SiteAnalysisResult): boolean {
  const motor = analysis.executionMotor;
  return (
    motor?.assessment_artifact_id != null &&
    (motor.assessment_status === 'RECORD_INTEGRITY_ERROR' ||
      (motor.assessment_status === 'ASSESSED' && motor.governed_coverage_state !== 'DETERMINED'))
  );
}

function unestablishedRecordSentenceSv(analysis: SiteAnalysisResult): string {
  const label = siteLabelSv(analysis.site);
  if (analysis.executionMotor?.assessment_status === 'RECORD_INTEGRITY_ERROR') {
    return (
      `${label} har en sparad styrd bedömning men rangordnas inte: bedömningens lagrade post har ett integritetsfel ` +
      '(underlaget är motsägelsefullt eller ligger utanför det styrda formatet), så ingen risknivå och ingen sannolikhet anges ' +
      `för den och den jämförs inte med de rangordnade alternativen. Bedömningens sammanfattning: ${analysis.complianceAnalysis.summary}`
    );
  }
  return (
    `${label} har en styrd bedömning men rangordnas inte: täckningsgraden för bedömningens lagrade post kunde inte fastställas, ` +
    `så den jämförs inte med de rangordnade alternativen. Bedömningens sammanfattning: ${analysis.complianceAnalysis.summary}`
  );
}

function siteLabelSv(site: SiteAlternative): string {
  return `Alternativ ${site.id} (${site.name || 'namnlöst'})`;
}

/**
 * U20CDF3 (H2): the report reasoning, sentence by sentence from the analyses themselves. Three kinds
 * of candidates, each named for what it is:
 *  - ranked: a governed assessment with a probability (isAssessed);
 *  - assessed but not ranked: a governed assessment whose probability is withheld -- its own
 *    coverage-qualified summary is repeated (so "0 av M" never comes with a risk word);
 *  - without a governed assessment: denied, failed or not produced.
 * No sentence claims an absence that is not there, and no risk level is named except inside a
 * site's own governed summary.
 */
function comparisonReasoningSv(
  analyses: readonly SiteAnalysisResult[],
  ranked: readonly SiteAnalysisResult[],
  best: SiteAnalysisResult | null,
): string {
  // Noll kandidater är inte samma sak som kandidater utan bedömning.
  if (analyses.length === 0) return 'Inga alternativ analyserade.';
  const sentences: string[] = [];
  if (best) {
    sentences.push(
      `${siteLabelSv(best.site)} rangordnas först bland de rangordnade alternativen enligt de styrda fynden. ` +
        best.complianceAnalysis.summary,
    );
    if (ranked.length < analyses.length) {
      // The qualifier is load-bearing: a winner drawn from a subset must never read as best of all.
      sentences.push(`Jämförelsen är partiell: ${ranked.length} av ${analyses.length} alternativ ingår i rangordningen.`);
    }
  } else {
    sentences.push(`Ingen rangordning tillgänglig: inget av ${analyses.length} alternativ kan rangordnas.`);
  }
  for (const analysis of analyses.filter(isAssessedButUnranked)) {
    sentences.push(
      `${siteLabelSv(analysis.site)} har en styrd bedömning men rangordnas inte: bedömningen är ofullständig ` +
        '(minst en styrd kontroll kunde inte genomföras) och ingen sannolikhet anges för den. ' +
        `Bedömningens sammanfattning: ${analysis.complianceAnalysis.summary}`,
    );
  }
  // U20CDF4 (owner decision (4) point 3): a site whose record is not established, with its own true sentence.
  for (const analysis of analyses.filter(hasUnestablishedRecord)) sentences.push(unestablishedRecordSentenceSv(analysis));
  const withoutAssessment = analyses.filter(
    (analysis) => !isAssessed(analysis) && !isAssessedButUnranked(analysis) && !hasUnestablishedRecord(analysis),
  );
  if (withoutAssessment.length > 0) {
    sentences.push(
      `Alternativ utan styrd bedömning ingår inte i rangordningen: ${withoutAssessment.map((a) => a.site.id).join(', ')}.`,
    );
  }
  return sentences.join(' ');
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
    /**
     * U20-C / DP-04: false (default) for the governed request -- no unbound read is performed.
     * Only the older generate-pdf-data route, the one existing consumer of those observations,
     * sets it; they then come back in `legacyObservations` (governed: false) and nowhere else.
     */
    includeLegacyObservations?: boolean;
  }): Promise<LocalizationReport> {
    const analyses = await Promise.all(
      input.siteAlternatives.map((site) =>
        analyzeSite(
          site,
          { projectId: input.projectId, user: input.user },
          this.createSpatialRuntime,
          { includeLegacyObservations: input.includeLegacyObservations === true },
        ),
      ),
    );

    // REPORT COMPARISON INVARIANT — the ranking population is the assessed sites only. An
    // unassessed candidate stays in siteAnalyses with its status, but cannot be ranked and
    // cannot win.
    const assessed = analyses.filter(isAssessed);
    // U20CDF4 (owner decision (4) point 4): "unassessed" means one thing -- no governed assessment.
    // A site that has one but is not ranked is not_ranked, never "unassessed".
    const notRanked = analyses.filter((a) => !isAssessed(a) && a.executionMotor?.assessment_artifact_id != null);
    const unassessed = analyses.filter((a) => a.executionMotor?.assessment_artifact_id == null);

    const sortedByPermit = [...assessed].sort(
      (a, b) => rankedProbability(b) - rankedProbability(a),
    );
    const bestAlternative = sortedByPermit.length > 0 ? sortedByPermit[0] : null;

    const comparisonStatus: LuComparisonStatus =
      assessed.length === 0 ? 'UNAVAILABLE' : assessed.length === analyses.length ? 'COMPLETE' : 'PARTIAL';

    // U20-C / DP-10: no "tillståndssannolikhet (NN%)" and no count from an unbound read (RAÄ, SLU):
    // the reasoning names the ranked alternative and repeats its governed, qualified statement.
    // U20CDF3 (H2): an assessed site whose probability is withheld is named as assessed and not
    // ranked, never as "ej bedömd" / "LocalizationAssessmentArtifact saknas" (comparisonReasoningSv).
    const reasoning = comparisonReasoningSv(analyses, assessed, bestAlternative);

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
        not_ranked_site_ids: notRanked.map((a) => a.site.id),
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
        // U20-C / OD-K0-1: the description never states the risk level without its coverage.
        `Lokaliseringsutredning genererad med ${input.siteAlternatives.length} alternativ. Bästa: ${bestAlternative?.site.id || 'N/A'}.` +
          (bestAlternative ? ` ${bestAlternative.complianceAnalysis.summary}` : ''),
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
            // U20CDF4 (owner decision (4) point 4): assessed but not ranked -- by status and record
            // state only, never a risk or a probability (same rule as above).
            not_ranked_sites: notRanked.map((a) => ({
              site_id: a.site.id,
              assessment_status: a.executionMotor?.assessment_status ?? 'NOT_ASSESSED',
              assessment_artifact_id: a.executionMotor?.assessment_artifact_id ?? null,
              governed_coverage_state: a.executionMotor?.governed_coverage_state ?? null,
            })),
            ...(bestAlternative
              ? {
                  bestAlternativeId: bestAlternative.site.id,
                  bestAssessmentArtifactId:
                    bestAlternative.executionMotor?.assessment_artifact_id ?? null,
                  bestPermitProbability: bestAlternative.complianceAnalysis.permitProbability,
                  overallRisk: bestAlternative.complianceAnalysis.overallRisk,
                  // U20CDF2 (G1): the count only for a record whose coverage can be established.
                  bestCoverageState: bestAlternative.executionMotor?.governed_coverage_state ?? null,
                  bestCheckCoverage: assessGovernedCoverage(bestAlternative.executionMotor?.governed_layer_checks, {
                    findings: bestAlternative.executionMotor?.findings ?? [],
                  }).coverage,
                }
              : {}),
            warningCount: reportWarnings.length,
            strictMode: isLocalizationStrictMode(),
          },
        },
      );
    } catch (auditErr) {
      logger.warn('Audit trail logging failed for localization report', { err: redactInternalDiagnostic(String(auditErr)) });
    }

    return report;
  }
}
