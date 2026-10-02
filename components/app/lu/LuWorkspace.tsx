import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { designTokens } from '@miljobeslut/mps-identity';
import { callApi, getActiveProjectId } from '../../../services/coreApiClient';
import { fetchPropertyInfo } from '../../../src/ui/api-client/geo.client';
import type { CesiumProductEvidence } from '../../CesiumMapView';
import { presentLuFinding, presentLuFindingSummary } from './luFindingPresentation';
import {
  checkDefinitionForLayer,
  checkDefinitionForRule,
  checkEvidenceBinding,
  knowledgeStateForError,
  limitedCoverageLayersOf,
  parseServerArray,
  parseViewerEvidence,
  presentLuControlChecks,
  LU_KNOWLEDGE_STATE_LABEL,
  LU_V1_LAYER_COUNT,
  type LuAssessmentPresence,
  type LuCheckRowKey,
  type LuViewerEvidenceProps,
} from './luControlChecks';
import {
  LuClientError,
  isNoCurrentAssessmentError,
  presentCurrentnessFailureClass,
  presentLuAssessmentStatus,
  presentLuError,
  presentLuRunReason,
  presentLuIncoherence,
  type LuErrorPresentation,
} from './luErrorPresentation';
import { LuControlPanel } from './LuControlPanel';
import { LuErrorNotice } from './LuErrorNotice';
import { presentLuOverallStatement, type LuOverallTone } from './luOverallStatement';
import { useLuRunOutcome, type LuRunOutcomeRecord } from './luSessionMemory';
import { presentLuVerifyNotice, type LuVerifyNotice } from './luVerifyNotice';
import { LuProgressSteps, type LuProgressStep } from './LuProgressSteps';

/** W-M2d item 2: the assessment line is never green -- complete is neutral, anything else is marked. */
const OVERALL_TONE_STYLE: Readonly<Record<LuOverallTone, { color: string; border: string }>> = {
  complete: { color: 'inherit', border: 'transparent' },
  qualified: { color: '#FDBA74', border: '#F97316' },
  technical: { color: '#F0ABFC', border: '#C026D3' },
};

const CesiumMapView = lazy(() => import('../../CesiumMapView'));

/**
 * P3-LU-CANONICAL-CHAIN-01 — how an absent LU verdict is shown.
 *
 * Never a dash or a blank: both read as a low-risk finding. The caseworker must be able to tell
 * "not assessed" from "assessed".
 */
// W-M2e item 2: the run/assessment status labels live in luErrorPresentation.ts (presentLuAssessmentStatus).

/**
 * W-M2d item 1: shown only when the read-back carries no `governedLayerChecks` (e.g. an older
 * server). The UI never derives a check's status itself.
 */
const MISSING_LAYER_CHECKS_NOTE = 'Uppgift om lagerkontrollerna saknas i svaret för den här bedömningen.';

/**
 * The governed /viewer/evidence for the MAP only (W-M2d item 1: the control panel no longer reads it).
 * Accepted only when its evidence ids are exactly the displayed assessment's spatial evidence refs.
 */
type MapEvidenceLoad =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly features: readonly LuViewerEvidenceProps[] }
  | { readonly status: 'error'; readonly error: LuErrorPresentation };

type SiteInput = {
  id: string;
  name: string;
  designation: string;
  lat: number;
  lng: number;
  geometry?: unknown;
};

type LocalizationIdentityProvisioningStatus = 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED' | null;

type LocalizationGeometryView = {
  artifact_id: string;
  provenance: 'user_defined' | 'derived_from_property_boundary';
  wgs84LngLat: [number, number];
  provisioningStatus: LocalizationIdentityProvisioningStatus;
  provisioningFailureDetail?: string | null;
  /**
   * W-M2d item 7 (localizationGeometryService.ts LocalizationGeometryView): set by POST geometry.
   * PENDING/LEASED: the predecessor->successor edge is not confirmed yet, and GET keeps answering with
   * the PREVIOUS point until it is. SUPERSEDED: a faster concurrent save moved current elsewhere.
   * FAILED: the point is saved, but the change of current point did not go through.
   */
  supersessionStatus?: 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED' | 'SUPERSEDED' | null;
};

/** W-M2d item 7: how long a just-saved point is polled for before the view stops waiting (2 s each). */
const PENDING_SAVE_MAX_POLLS = 60;

type LuFindingView = {
  finding_id: string;
  rule_id: string;
  rule_version?: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'NOT_CHECKED';
  explanation: string;
  evidence_refs?: Array<{ artifact_id: string; artifact_type: string }>;
};

/** The subset of generate-report's executionMotor this view reads (governed fields only). */
type ExecutionMotorMeta = {
  admitted?: boolean;
  /** W-M2e item 1: why the run produced no assessment (e.g. [REJECT_SPATIAL_EVIDENCE_FORM, <violation>]). */
  reason_codes?: unknown;
  assessment_artifact_id?: string | null;
  assessment_projection_registered?: boolean | null;
  assessment_status?: string;
  findings?: LuFindingView[];
  localization_geometry?: { status?: string; message_sv?: string | null; failure_class?: string | null; retryable?: boolean } | null;
  governed_layer_checks?: unknown;
};

type LocalizationReport = {
  ok?: boolean;
  siteAnalyses?: Array<{ executionMotor?: ExecutionMotorMeta }>;
};

/** GET /api/localization/:projectId/current-assessment (server/routes/localization.routes.ts). */
type CurrentAssessmentResponse = {
  ok?: boolean;
  assessmentArtifactId?: unknown;
  findings?: LuFindingView[];
  evidenceRefs?: unknown;
  systemSummary?: string;
  /**
   * U20-D, W-M2d item 1: the server's per-check states for THIS assessment (five map layers + the
   * document check; coverage_state, message_sv, coverage_limitation_sv, known_coverage_gaps) -- the
   * single source of the control panel. (K0's `documentCheck` equals its document row.)
   */
  governedLayerChecks?: unknown;
  /** U20-D, W-M2d item 1: per pinned evidence, resolved from CAS (dataset version, radius, result, ...). */
  evidenceDetails?: unknown;
  /** U20-D, W-M2d item 1: the property root's provenance and assurance. */
  propertyRoot?: unknown;
  /**
   * DEMO M1a / D9(a): the point THIS assessment was made for ({ artifact_id, provenance,
   * provenance_label_sv }; artifact_id is the assessment's own localization_geometry_ref).
   */
  localizationGeometry?: unknown;
  /**
   * U20-D/U20CDF2, W-M2d item 2: the server's coverage-qualified overall statement
   * ({ risk_level, coverage_state, coverage_basis, coverage, pinned_evidence?, statement_sv }).
   * Shown verbatim -- the UI composes no assessment line of its own.
   */
  overallStatement?: unknown;
};

/**
 * DEMO M2a item 2 / M2b item 2 / M2c item 3 -- the ONE governed result this view renders. It is
 * ALWAYS read from GET current-assessment, for a fresh run (after checking that the read-back is the
 * assessment the run produced) and for a reopen alike: one data source, one mapping. A run that
 * produced no assessment is NOT a result: it is a RunOutcome notice, and the project's current
 * assessment (if any) is still read back and shown as such. Legacy observations
 * (complianceAnalysis, dataSources, warnings) are never part of it.
 */
type GovernedResult = {
  assessmentStatus: string;
  assessmentArtifactId: string | null;
  findings: LuFindingView[];
  /** The displayed assessment's own SPATIAL_EVIDENCE ids -- the viewer evidence must equal these. */
  spatialEvidenceRefs: readonly string[] | null;
  /** W-M2d item 1: the read-back's governedLayerChecks (null when the answer lacks them). */
  layerChecks: readonly unknown[] | null;
  /** W-M2d item 1: the read-back's evidenceDetails (null when absent). */
  evidenceDetails: readonly unknown[] | null;
  /** W-M2d item 1: the read-back's propertyRoot, unparsed. */
  propertyRoot: unknown;
  /**
   * DEMO M2c item 2: the LocalizationGeometry artifact id this assessment was made for, from the
   * read-back; null when the answer does not state it.
   */
  assessedGeometryId: string | null;
  /**
   * W-M2d item 7 (U20-D c41fd77d): the coordinates of the point THIS assessment is bound to, read and
   * verified by the server from the assessment's own localization_geometry_ref; null unless VERIFIED.
   */
  assessedPoint: { lat: number; lng: number } | null;
  /** W-M2d item 2: the read-back's overallStatement, unparsed (presentLuOverallStatement reads it). */
  overallStatement: unknown;
};

/**
 * DEMO M2c item 3 (M2b verifier finding 7), W-M2d item 8: the latest run of the project produced no
 * assessment (GOVERNANCE_DENIED, NOT_ASSESSED, EXECUTION_FAILED). The server keeps no record of it in
 * the read model; it is remembered in the product shell's state for the session (luSessionMemory.tsx),
 * so a view switch keeps it, and a reload cannot -- the notice says so. Fields: status; messageSv (for
 * a known currentness failure class this UI's text for it, W-M2d items 5 and 9, otherwise the server's
 * own message_sv); retryable (the server's flag of a FAILED_CLOSED record, null when it says nothing);
 * endedAt (this browser's clock).
 */
type RunOutcome = LuRunOutcomeRecord;

/** W-M2d item 4: one machine notice of a verification (LuReExecutionResult.notices). */
type VerifyNotice = LuVerifyNotice;

function parseVerifyNotices(raw: unknown): VerifyNotice[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): VerifyNotice[] => {
    const n = entry && typeof entry === 'object' ? (entry as { code?: unknown; finding_ids?: unknown }) : null;
    if (!n || typeof n.code !== 'string' || !n.code) return [];
    const ids = Array.isArray(n.finding_ids) ? n.finding_ids.filter((id): id is string => typeof id === 'string') : [];
    return [{ code: n.code, finding_ids: ids }];
  });
}

/** W-M2d item 4 / W-M2e item 2: the notice's Swedish line (luVerifyNotice.ts). */
const verifyNoticeSv = presentLuVerifyNotice;

/** How the run that produced no assessment ended, as the end of a sentence. */
function runOutcomeClause(status: string): string {
  if (status === 'GOVERNANCE_DENIED') return 'nekades av styrningen';
  if (status === 'EXECUTION_FAILED') return 'misslyckades';
  return 'inte gav någon bedömning';
}

/** DEMO M2c item 2: the read-back's own bound point id, or null when the answer does not state one. */
function assessedGeometryIdOf(result: CurrentAssessmentResponse): string | null {
  const g = result.localizationGeometry;
  const id = g && typeof g === 'object' ? (g as { artifact_id?: unknown }).artifact_id : null;
  return typeof id === 'string' && id ? id : null;
}

/** W-M2d item 7: the read-back's verified bound point ([lng, lat] WGS84), or null. */
function assessedPointOf(result: CurrentAssessmentResponse): { lat: number; lng: number } | null {
  const g = result.localizationGeometry && typeof result.localizationGeometry === 'object'
    ? (result.localizationGeometry as { bound_geometry_status?: unknown; coordinates_wgs84?: unknown })
    : null;
  if (!g || g.bound_geometry_status !== 'VERIFIED' || !Array.isArray(g.coordinates_wgs84)) return null;
  const [lng, lat] = g.coordinates_wgs84 as unknown[];
  return typeof lng === 'number' && Number.isFinite(lng) && typeof lat === 'number' && Number.isFinite(lat) ? { lat, lng } : null;
}

/**
 * DEMO M2c item 2: is the displayed control point the one the displayed assessment was made for?
 *   none     -- no assessment (or no point) is shown, nothing to bind
 *   bound    -- same LocalizationGeometry artifact id
 *   changed  -- different ids: the point changed outside this view (another tab/session, or the
 *               lu-geometry-supersession worker) after the assessment was made or read
 *   unknown  -- the answer does not say which point the assessment was made for
 */
type PointBinding = 'none' | 'bound' | 'changed' | 'unknown';

/**
 * What a fresh run produced, kept until its read-back is confirmed or found to disagree. W-M2d item 1:
 * the run's own governed_layer_checks are not used -- the read-back carries the same checks, so a fresh
 * run and a reopen render from one source.
 */
type RunExpectation = {
  assessmentId: string;
  projectionRegistered: boolean | null;
};

/** DEMO M2b item 2: the run's assessment and the project's current assessment disagree. */
type Incoherence = {
  expectedId: string;
  currentId: string | null;
  projectionRegistered: boolean | null;
};

const RISK_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, NOT_CHECKED: 3 };

/** Deterministic order so the same assessment always lists its findings in the same order. */
function sortFindings(findings: readonly LuFindingView[]): LuFindingView[] {
  return [...findings].sort(
    (a, b) => (RISK_ORDER[a.risk_level] ?? 9) - (RISK_ORDER[b.risk_level] ?? 9) || a.finding_id.localeCompare(b.finding_id),
  );
}

function spatialRefsOf(evidenceRefs: unknown): string[] | null {
  if (!Array.isArray(evidenceRefs)) return null;
  return evidenceRefs
    .filter((r): r is { artifact_id: string; artifact_type: string } =>
      Boolean(r) && typeof (r as { artifact_id?: unknown }).artifact_id === 'string' && (r as { artifact_type?: unknown }).artifact_type === 'SPATIAL_EVIDENCE',
    )
    .map((r) => r.artifact_id);
}

function governedFromCurrentAssessment(result: CurrentAssessmentResponse, assessmentId: string): GovernedResult {
  return {
    assessmentStatus: 'ASSESSED',
    assessmentArtifactId: assessmentId,
    findings: sortFindings(Array.isArray(result.findings) ? result.findings : []),
    spatialEvidenceRefs: spatialRefsOf(result.evidenceRefs),
    layerChecks: parseServerArray(result.governedLayerChecks),
    evidenceDetails: parseServerArray(result.evidenceDetails),
    propertyRoot: result.propertyRoot,
    assessedGeometryId: assessedGeometryIdOf(result),
    assessedPoint: assessedPointOf(result),
    overallStatement: result.overallStatement,
  };
}

function incoherenceReason(i: Incoherence): string {
  if (i.currentId === null && i.projectionRegistered === false) {
    return 'Bedömningen gjordes och sparades, men registrerades inte som projektets aktuella bedömning. Den kan därför ännu inte läsas tillbaka, kontrolleras eller exporteras.';
  }
  if (i.currentId === null) {
    return 'Bedömningen gjordes, men projektet har ingen aktuell bedömning att läsa tillbaka. Den kan därför inte visas, kontrolleras eller exporteras.';
  }
  return 'Den nyss gjorda bedömningen är inte den som projektet nu anger som aktuell. Mimer visar inte en blandning av två bedömningar.';
}

function incoherenceTechnical(i: Incoherence) {
  return [
    { label: 'Bedömning från körningen', value: i.expectedId },
    { label: 'Projektets aktuella bedömning', value: i.currentId ?? 'ingen' },
    {
      label: 'Registrerad som aktuell',
      value: i.projectionRegistered === true ? 'ja' : i.projectionRegistered === false ? 'nej' : 'okänt',
    },
  ];
}

/** W-M2d item 8: "14:32" from an ISO time, or null. */
function formatClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * W-M2d item 8: when the displayed assessment's basis was retrieved -- the latest `retrieved_at` of its
 * evidence details (server, U20-D) -- so an older assessment can be told apart; null when not stated.
 */
function retrievedAtOf(evidenceDetails: readonly unknown[] | null): string | null {
  const times = (evidenceDetails ?? [])
    .map((d) => (d && typeof d === 'object' ? (d as { retrieved_at?: unknown }).retrieved_at : null))
    .filter((t): t is string => typeof t === 'string' && !Number.isNaN(new Date(t).getTime()))
    .sort();
  return times.length > 0 ? times[times.length - 1]! : null;
}

function fileSlug(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'fastighet';
}

/**
 * The LU workspace: property, control point, the six checks, the governed assessment, the map.
 */
export const LuWorkspace: React.FC<{ initialDesignation?: string }> = ({ initialDesignation = '' }) => {
  const colors = designTokens.colors;
  const [designation, setDesignation] = useState(initialDesignation);
  const [siteName, setSiteName] = useState('Alternativ A');
  const [site, setSite] = useState<SiteInput | null>(null);
  const [lookupError, setLookupError] = useState<LuErrorPresentation | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<LuErrorPresentation | null>(null);
  const [governed, setGoverned] = useState<GovernedResult | null>(null);
  const [runOutcome, setRunOutcome, runOutcomeInShell] = useLuRunOutcome(getActiveProjectId() || null);
  const [incoherence, setIncoherence] = useState<Incoherence | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<LuErrorPresentation | null>(null);
  const [verifyingAssessment, setVerifyingAssessment] = useState(false);
  const [verifyError, setVerifyError] = useState<LuErrorPresentation | null>(null);
  const [verifyResult, setVerifyResult] = useState<{
    outcome: 'PASS' | 'DENY' | 'OTHER_ASSESSMENT' | 'UNKNOWN';
    verifiedId: string | null;
    mismatches: readonly { code: string; detail: string }[];
    /** W-M2d item 4: the server's machine notices (e.g. NOT_CHECKED_CAUSE_NOT_PINNED), unchanged. */
    notices: readonly VerifyNotice[];
    /** The server's own Swedish outcome text -- technical section only (it may claim more than replay). */
    serverOutcomeSv: string | null;
  } | null>(null);
  const [persistedAssessmentLoading, setPersistedAssessmentLoading] = useState(false);
  const [persistedAssessmentError, setPersistedAssessmentError] = useState<LuErrorPresentation | null>(null);
  const [persistedAssessmentNotFound, setPersistedAssessmentNotFound] = useState(false);
  const [selectedCheck, setSelectedCheck] = useState<LuCheckRowKey | null>(null);
  const [evidence, setEvidence] = useState<{ load: MapEvidenceLoad; geojson: unknown }>({ load: { status: 'idle' }, geojson: null });
  const [evidenceNonce, setEvidenceNonce] = useState(0);
  const evidenceRequestRef = useRef(0);
  const assessmentRequestRef = useRef(0);
  const expectedRunRef = useRef<RunExpectation | null>(null);

  // PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01.
  const [localizationGeometry, setLocalizationGeometry] = useState<LocalizationGeometryView | null>(null);
  const [geometryLoading, setGeometryLoading] = useState(false);
  const [geometryError, setGeometryError] = useState<LuErrorPresentation | null>(null);
  const [pickingLocation, setPickingLocation] = useState(false);
  const [draftPoint, setDraftPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const [saveLocationError, setSaveLocationError] = useState<LuErrorPresentation | null>(null);
  /**
   * W-M2d item 7 (M2c verification finding 5): a point the user just saved whose change of current
   * point the server has not confirmed yet (POST supersessionStatus PENDING/LEASED). GET geometry
   * keeps answering with the PREVIOUS point until then, so a poll must never overwrite the saved one.
   */
  const [pendingSave, setPendingSave] = useState<LocalizationGeometryView | null>(null);
  const pendingSaveRef = useRef<LocalizationGeometryView | null>(null);
  const [pendingPolls, setPendingPolls] = useState(0);
  /** W-M2d item 7: what happened to a save whose change of current point did not go through. */
  const [saveOutcomeNote, setSaveOutcomeNote] = useState<string | null>(null);

  const setPending = (view: LocalizationGeometryView | null) => {
    pendingSaveRef.current = view;
    setPendingSave(view);
    setPendingPolls(0);
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(0,0,0,0.35)',
    border: `1px solid ${colors.coreGraphite.hex}`,
    color: colors.flowLightCyan.hex,
    padding: '0.75rem 1rem',
    borderRadius: 0,
  };

  const clearResultState = () => {
    setGoverned(null);
    setIncoherence(null);
    setVerifyResult(null);
    setVerifyError(null);
    setExportPdfError(null);
    setSelectedCheck(null);
  };

  const lookupProperty = async () => {
    setLookupError(null);
    setLookingUp(true);
    clearResultState();
    setPending(null);
    setSaveOutcomeNote(null);
    expectedRunRef.current = null;
    try {
      const info = await fetchPropertyInfo(designation.trim(), getActiveProjectId() || undefined);
      const lat = Number(info.centroid?.lat);
      const lng = Number(info.centroid?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new LuClientError('Fastighetsuppslaget saknar koordinater, så fastigheten kan inte visas.');
      }
      const name = info.designation || designation.trim();
      setSite({
        id: `site-${designation.trim().replace(/\s+/g, '-').toLowerCase()}`,
        name: siteName.trim() || name,
        designation: name,
        lat,
        lng,
        geometry: info.geometry,
      });
    } catch (err) {
      setSite(null);
      setLookupError(presentLuError(err, 'property-lookup'));
    } finally {
      setLookingUp(false);
    }
  };

  // PRODUCT-LU-PROPERTY-FIRST-WORKFLOW-01 Phase B: auto-run the lookup once when opened from the
  // property-first entry, so the user never searches twice.
  useEffect(() => {
    if (initialDesignation.trim()) {
      void lookupProperty();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The current LocalizationGeometry is always re-read from the server, never invented locally.
  const loadCurrentGeometry = async (): Promise<LocalizationGeometryView | null> => {
    const projectId = getActiveProjectId();
    if (!projectId) return null;
    setGeometryError(null);
    setGeometryLoading(true);
    try {
      const result = await callApi<{ ok: boolean; geometry: LocalizationGeometryView }>(
        `/api/localization/${encodeURIComponent(projectId)}/geometry`,
        { method: 'GET' },
      );
      // W-M2d item 7: while a just-saved point waits for the server's confirmation, GET answers with
      // the previous point -- that answer never replaces the saved point on screen.
      const pending = pendingSaveRef.current;
      if (pending && result.geometry?.artifact_id !== pending.artifact_id) return pending;
      if (pending) setPending(null);
      setLocalizationGeometry(result.geometry);
      return result.geometry;
    } catch (err) {
      setGeometryError(presentLuError(err, 'geometry-load'));
      return null;
    } finally {
      setGeometryLoading(false);
    }
  };

  useEffect(() => {
    if (site) {
      void loadCurrentGeometry();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site?.id]);

  /**
   * LU-ASSESSMENT-PERSISTENCE-READ-V1B, DEMO M2b item 2: read-only -- never runs the kernel. The
   * single source of an ASSESSED result. After a fresh run, the read-back must be the assessment
   * the run produced; otherwise the view says so instead of showing either one.
   */
  const loadCurrentAssessment = async () => {
    const projectId = getActiveProjectId();
    if (!projectId || !site) return;
    const requestId = ++assessmentRequestRef.current;
    // Clear FIRST, so a previous localization's assessment can never stay visible.
    clearResultState();
    setPersistedAssessmentError(null);
    setPersistedAssessmentNotFound(false);
    setPersistedAssessmentLoading(true);
    try {
      const result = await callApi<CurrentAssessmentResponse>(
        `/api/localization/${encodeURIComponent(projectId)}/current-assessment`,
        { method: 'GET' },
      );
      if (assessmentRequestRef.current !== requestId) return; // a newer read owns the view
      const currentId = typeof result?.assessmentArtifactId === 'string' && result.assessmentArtifactId ? result.assessmentArtifactId : null;
      const expected = expectedRunRef.current;
      if (!currentId) {
        setPersistedAssessmentError(
          presentLuError(new LuClientError('Den sparade bedömningen kunde inte läsas: svaret saknar bedömnings-id.'), 'current-assessment'),
        );
        return;
      }
      if (expected && expected.assessmentId !== currentId) {
        setIncoherence({ expectedId: expected.assessmentId, currentId, projectionRegistered: expected.projectionRegistered });
        return;
      }
      setGoverned(governedFromCurrentAssessment(result, currentId));
    } catch (err) {
      if (assessmentRequestRef.current !== requestId) return;
      const expected = expectedRunRef.current;
      if (isNoCurrentAssessmentError(err)) {
        if (expected) {
          setIncoherence({ expectedId: expected.assessmentId, currentId: null, projectionRegistered: expected.projectionRegistered });
        } else {
          setPersistedAssessmentNotFound(true);
        }
      } else {
        setPersistedAssessmentError(presentLuError(err, 'current-assessment'));
      }
    } finally {
      if (assessmentRequestRef.current === requestId) setPersistedAssessmentLoading(false);
    }
  };

  useEffect(() => {
    if (site) {
      // A new property/point is a new context: a previous run's expectation no longer applies. W-M2d
      // item 8: the latest run's outcome is kept (per project, in the shell) -- it is still the latest
      // run, also after a remount, until a new run replaces it.
      expectedRunRef.current = null;
      void loadCurrentAssessment();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site?.id, localizationGeometry?.artifact_id, localizationGeometry?.provisioningStatus]);

  // DEMO M2a item 3 / M2b item 2: the per-layer check results come from the governed viewer evidence,
  // fetched ONCE for the DISPLAYED assessment and accepted only if its evidence ids are exactly that
  // assessment's spatial evidence refs. The same FeatureCollection then feeds the panel and the map.
  const displayedAssessmentId = governed?.assessmentStatus === 'ASSESSED' ? governed.assessmentArtifactId : null;
  const spatialRefsKey = governed?.spatialEvidenceRefs ? JSON.stringify(governed.spatialEvidenceRefs) : null;
  useEffect(() => {
    const projectId = getActiveProjectId();
    const requestId = ++evidenceRequestRef.current;
    if (!projectId || !displayedAssessmentId) {
      setEvidence({ load: { status: 'idle' }, geojson: null });
      return;
    }
    setEvidence({ load: { status: 'loading' }, geojson: null });
    const refs: string[] | null = spatialRefsKey === null ? null : (JSON.parse(spatialRefsKey) as string[]);
    void (async () => {
      try {
        const payload = await callApi<unknown>(`/api/localization/${encodeURIComponent(projectId)}/viewer/evidence`, {
          method: 'GET',
        });
        const features = parseViewerEvidence(payload);
        if (evidenceRequestRef.current !== requestId) return;
        const binding = checkEvidenceBinding(features, refs);
        if ('messageSv' in binding) {
          setEvidence({ load: { status: 'error', error: presentLuIncoherence(binding.messageSv, binding.technical) }, geojson: null });
          return;
        }
        setEvidence({ load: { status: 'loaded', features }, geojson: payload });
      } catch (err) {
        if (evidenceRequestRef.current === requestId) {
          setEvidence({ load: { status: 'error', error: presentLuError(err, 'viewer-evidence') }, geojson: null });
        }
      }
    })();
  }, [displayedAssessmentId, spatialRefsKey, evidenceNonce]);

  // While the point's execution identity is being prepared by the worker, re-poll the same GET.
  // (Not while a just-saved point waits for confirmation: the effect below polls then.)
  useEffect(() => {
    if (pendingSave) return;
    const status = localizationGeometry?.provisioningStatus;
    if (status !== 'PENDING' && status !== 'LEASED') return;
    const timer = setTimeout(() => {
      void loadCurrentGeometry();
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localizationGeometry?.artifact_id, localizationGeometry?.provisioningStatus, pendingSave]);

  // W-M2d item 7: a just-saved point is polled until GET answers with it (the server has confirmed
  // the change of current point) -- every 2 s, at most PENDING_SAVE_MAX_POLLS times; it is never
  // replaced by the previous point meanwhile (loadCurrentGeometry above).
  useEffect(() => {
    if (!pendingSave || pendingPolls >= PENDING_SAVE_MAX_POLLS) return;
    const timer = setTimeout(() => {
      void loadCurrentGeometry().finally(() => setPendingPolls((n) => n + 1));
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSave, pendingPolls]);

  /** W-M2d item 7: stop waiting for a saved point and show what the project's current point is. */
  const showServerCurrentPoint = async () => {
    setPending(null);
    await loadCurrentGeometry();
  };

  const [retryingProvisioning, setRetryingProvisioning] = useState(false);
  const retryProvisioning = async () => {
    const projectId = getActiveProjectId();
    if (!projectId) return;
    setRetryingProvisioning(true);
    try {
      const result = await callApi<{ ok: boolean; geometry: LocalizationGeometryView }>(
        `/api/localization/${encodeURIComponent(projectId)}/geometry-identity-retry`,
        { method: 'POST' },
      );
      // W-M2d item 7: the retry answers with the project's CURRENT point; it never replaces a
      // just-saved point that is still waiting for confirmation.
      if (!pendingSaveRef.current || pendingSaveRef.current.artifact_id === result.geometry?.artifact_id) {
        setLocalizationGeometry(result.geometry);
      }
    } catch (err) {
      setGeometryError(presentLuError(err, 'geometry-retry'));
    } finally {
      setRetryingProvisioning(false);
    }
  };

  const startPickingLocation = () => {
    setSaveLocationError(null);
    setDraftPoint(null);
    setPickingLocation(true);
  };

  const cancelPickingLocation = () => {
    setPickingLocation(false);
    setDraftPoint(null);
    setSaveLocationError(null);
  };

  const saveLocation = async () => {
    const projectId = getActiveProjectId();
    if (!projectId || !draftPoint) return;
    setSavingLocation(true);
    setSaveLocationError(null);
    try {
      const result = await callApi<{ ok: boolean; geometry: LocalizationGeometryView }>(
        `/api/localization/${encodeURIComponent(projectId)}/geometry`,
        {
          method: 'POST',
          body: {
            geometry_type: 'POINT',
            coordinates: [draftPoint.lng, draftPoint.lat],
            srid: 4326,
          },
        },
      );
      const saved = result.geometry;
      const supersession = saved?.supersessionStatus ?? null;
      setSaveOutcomeNote(null);
      if (supersession === 'PENDING' || supersession === 'LEASED') {
        // W-M2d item 7: shown as saved, marked as not yet confirmed, and protected from polling.
        setPending(saved);
        setLocalizationGeometry(saved);
      } else if (supersession === 'SUPERSEDED' || supersession === 'FAILED') {
        // The point is saved, but it will not become the current one: show what IS current.
        setPending(null);
        setSaveOutcomeNote(
          supersession === 'SUPERSEDED'
            ? 'Kontrollpunkten sparades, men en annan ändring av kontrollpunkten hann före. Projektets aktuella kontrollpunkt visas.'
            : 'Kontrollpunkten sparades, men bytet till den nya punkten kunde inte genomföras. Projektets aktuella kontrollpunkt visas.',
        );
        await loadCurrentGeometry();
      } else {
        setPending(null);
        setLocalizationGeometry(saved);
      }
      setPickingLocation(false);
      setDraftPoint(null);
    } catch (err) {
      setSaveLocationError(presentLuError(err, 'geometry-save'));
    } finally {
      setSavingLocation(false);
    }
  };

  const runAssessment = async () => {
    if (!site) {
      setRunError(presentLuError(new LuClientError('Slå upp en fastighet först.'), 'run'));
      return;
    }
    setRunError(null);
    const projectId = getActiveProjectId();
    if (!projectId) {
      // No synthetic project id: without a real active project there is nothing governed to assess.
      setRunError(presentLuError(new LuClientError('Inget aktivt projekt valt. Välj ett projekt innan bedömning körs.'), 'run'));
      return;
    }
    setRunning(true);
    assessmentRequestRef.current++; // any read still in flight no longer owns the view
    expectedRunRef.current = null;
    clearResultState();
    setRunOutcome(null);
    setPersistedAssessmentNotFound(false);
    setPersistedAssessmentError(null);
    try {
      const result = await callApi<LocalizationReport>('/api/localization/generate-report', {
        method: 'POST',
        body: {
          projectId,
          siteAlternatives: [
            {
              id: site.id,
              name: siteName.trim() || site.name,
              lat: site.lat,
              lng: site.lng,
            },
          ],
        },
      });
      const motor = result.siteAnalyses?.[0]?.executionMotor ?? {};
      const assessmentId = typeof motor.assessment_artifact_id === 'string' && motor.assessment_artifact_id ? motor.assessment_artifact_id : null;
      const status = motor.assessment_status ?? (assessmentId ? 'ASSESSED' : 'NOT_ASSESSED');
      if (status === 'ASSESSED' && assessmentId) {
        // Item 2: render the run's assessment only through the same read-back a reopen uses, and
        // only if the read-back IS that assessment.
        expectedRunRef.current = {
          assessmentId,
          projectionRegistered: typeof motor.assessment_projection_registered === 'boolean' ? motor.assessment_projection_registered : null,
        };
        await loadCurrentAssessment();
      } else {
        // DEMO M2c item 3: no assessment was produced. Say so (governed status + the server's
        // Swedish reason) -- and read back what IS current, so a still-current older assessment is
        // shown as such instead of being hidden until the next reload.
        const geometryRecord = motor.localization_geometry ?? null;
        const classText = presentCurrentnessFailureClass(geometryRecord?.failure_class, geometryRecord?.retryable);
        // W-M2e item 1: a reason the run record names itself (e.g. REJECT_SPATIAL_EVIDENCE_FORM).
        const reasonCodes = Array.isArray(motor.reason_codes)
          ? motor.reason_codes.filter((code): code is string => typeof code === 'string' && code.length > 0)
          : [];
        const reasonText = presentLuRunReason(reasonCodes);
        setRunOutcome({
          status: status === 'ASSESSED' ? 'NOT_ASSESSED' : status,
          messageSv: classText?.messageSv ?? reasonText?.messageSv ?? geometryRecord?.message_sv ?? null,
          retryable: classText ? classText.retryable : typeof geometryRecord?.retryable === 'boolean' ? geometryRecord.retryable : null,
          endedAt: new Date().toISOString(),
          reasonCodes,
        });
        await loadCurrentAssessment();
      }
    } catch (err) {
      setRunError(presentLuError(err, 'run'));
      // The failed run changed nothing the user can see: show what is actually current again,
      // instead of claiming there is no assessment.
      void loadCurrentAssessment();
    } finally {
      setRunning(false);
    }
  };

  // LU-REPORT-EXPORT-UI-V1 / DEMO M2b item 2: right before exporting, the project's current assessment
  // is checked to still be the displayed one (a plain-Swedish answer without a request). W-M2d item 9:
  // the export itself also names the displayed assessment (U20-D `?assessmentArtifactId=`), so the
  // former window between that check and the export is closed by the server (409 on a mismatch).
  const exportPdf = async () => {
    if (exportingPdf) return; // duplicate-click guard
    const projectId = getActiveProjectId();
    const shownId = governed?.assessmentArtifactId ?? null;
    if (!projectId || !shownId) {
      setExportPdfError(presentLuError(new LuClientError('Det finns ingen visad bedömning att exportera.'), 'export'));
      return;
    }
    setExportPdfError(null);
    setExportingPdf(true);
    try {
      const current = await callApi<CurrentAssessmentResponse>(
        `/api/localization/${encodeURIComponent(projectId)}/current-assessment`,
        { method: 'GET' },
      );
      const currentId = typeof current?.assessmentArtifactId === 'string' ? current.assessmentArtifactId : null;
      if (currentId !== shownId) {
        setExportPdfError(
          presentLuIncoherence(
            'Rapporten exporteras inte: projektets aktuella bedömning är inte den som visas. Läs in bedömningen på nytt.',
            [
              { label: 'Visad bedömning', value: shownId },
              { label: 'Projektets aktuella bedömning', value: currentId ?? 'ingen' },
            ],
          ),
        );
        return;
      }
      // W-M2d item 9 (U20-D): the export is bound to the DISPLAYED assessment id; the server refuses
      // (409 ASSESSMENT_ID_MISMATCH) instead of exporting any other assessment.
      const blob = await callApi<Blob>(
        `/api/localization/${encodeURIComponent(projectId)}/export-assessment-pdf?assessmentArtifactId=${encodeURIComponent(shownId)}`,
        { method: 'GET' },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `lokaliseringsbedomning-${fileSlug(site?.designation ?? designation)}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportPdfError(presentLuError(err, 'export'));
    } finally {
      setExportingPdf(false);
    }
  };

  // LU-REEXECUTION-VERIFY-UI-V1 / DEMO M2b item 2: deterministic re-execution of the project's
  // current assessment; the result counts only if it names the DISPLAYED assessment.
  // W-M2d item 4: what this proves is REPLAY CONSISTENCY against the pinned artifacts -- never
  // authenticity (no signature or attestation is checked at verify; U30R3-REPORT section 7).
  const verifyAssessment = async () => {
    if (verifyingAssessment) return; // duplicate-click guard
    const projectId = getActiveProjectId();
    const shownId = governed?.assessmentArtifactId ?? null;
    if (!projectId || !shownId) {
      setVerifyError(presentLuError(new LuClientError('Det finns ingen visad bedömning att kontrollera.'), 'verify'));
      return;
    }
    setVerifyError(null);
    setVerifyResult(null);
    setVerifyingAssessment(true);
    try {
      const result = await callApi<{
        ok: true;
        outcome: string;
        assessmentArtifactId: string;
        mismatches?: readonly { code: string; detail: string }[];
        notices?: unknown;
        outcome_sv?: unknown;
      }>(`/api/localization/${encodeURIComponent(projectId)}/verify-assessment`, {
        method: 'POST',
        // W-M2d item 9 (U20-D): bound to the DISPLAYED assessment; any other current one is refused (409).
        body: { assessmentArtifactId: shownId },
      });
      const verifiedId = typeof result?.assessmentArtifactId === 'string' ? result.assessmentArtifactId : null;
      const mismatches = Array.isArray(result?.mismatches) ? result.mismatches : [];
      const notices = parseVerifyNotices(result?.notices);
      const serverOutcomeSv = typeof result?.outcome_sv === 'string' && result.outcome_sv ? result.outcome_sv : null;
      if (verifiedId !== shownId) {
        setVerifyResult({ outcome: 'OTHER_ASSESSMENT', verifiedId, mismatches: [], notices: [], serverOutcomeSv: null });
      } else if (result.outcome === 'PASS' || result.outcome === 'DENY') {
        setVerifyResult({ outcome: result.outcome, verifiedId, mismatches, notices, serverOutcomeSv });
      } else {
        setVerifyResult({ outcome: 'UNKNOWN', verifiedId, mismatches, notices, serverOutcomeSv });
      }
    } catch (err) {
      setVerifyError(presentLuError(err, 'verify'));
    } finally {
      setVerifyingAssessment(false);
    }
  };

  /** "Visa underlag" on a finding: a pure client-side selection -- never a new query. */
  const showFindingEvidence = (finding: LuFindingView) => {
    const def = checkDefinitionForRule(finding.rule_id);
    if (def) setSelectedCheck(def.key);
  };

  // W-M2d item 7: a run uses the project's CURRENT point -- never while a saved point is unconfirmed.
  const isExecutionReady = localizationGeometry?.provisioningStatus === 'COMPLETED' && !pendingSave;
  const projectReady = Boolean(getActiveProjectId());
  const incoherencePresentation = useMemo(
    () =>
      incoherence
        ? presentLuIncoherence('Kontrollresultaten visas inte: det går inte att visa en sammanhängande bedömning (se ovan).', incoherenceTechnical(incoherence))
        : null,
    [incoherence],
  );
  const assessmentPresence: LuAssessmentPresence = useMemo(() => {
    if (persistedAssessmentLoading) return { status: 'loading' };
    if (incoherencePresentation) return { status: 'error', error: incoherencePresentation };
    if (governed) {
      return governed.assessmentStatus === 'ASSESSED' && governed.assessmentArtifactId ? { status: 'present' } : { status: 'not_assessed' };
    }
    if (persistedAssessmentError) return { status: 'error', error: persistedAssessmentError };
    // DEMO M2c item 3: the latest run produced no assessment and none is current.
    if (runOutcome && persistedAssessmentNotFound) return { status: 'not_assessed' };
    if (persistedAssessmentNotFound || !site || !projectReady) return { status: 'none' };
    return { status: 'loading' };
  }, [persistedAssessmentLoading, incoherencePresentation, governed, persistedAssessmentError, persistedAssessmentNotFound, runOutcome, site, projectReady]);

  // DEMO M2c item 2: the displayed point is bound to the displayed assessment by artifact id.
  const pointBinding: PointBinding = useMemo(() => {
    if (assessmentPresence.status !== 'present' || !governed || !localizationGeometry) return 'none';
    if (!governed.assessedGeometryId) return 'unknown';
    return governed.assessedGeometryId === localizationGeometry.artifact_id ? 'bound' : 'changed';
  }, [assessmentPresence.status, governed, localizationGeometry]);

  // Re-reads the project's current point; a changed point re-reads the assessment through the
  // effect above, an unchanged one is re-read here -- so point and assessment are read together.
  const reloadPointAndAssessment = async () => {
    const before = localizationGeometry?.artifact_id ?? null;
    const next = await loadCurrentGeometry();
    if (next && next.artifact_id === before) void loadCurrentAssessment();
  };

  // W-M2d item 2 (§11, owner decision OD-K0-1 and the 2026-10-02 night specifications): the
  // assessment line is the SERVER's overallStatement, word for word -- the UI composes, counts and
  // names no risk level of its own. Notices under it come from the server's own machine fields.
  const overall = useMemo(() => (governed ? presentLuOverallStatement(governed.overallStatement) : null), [governed]);

  // W-M2d item 1: every check row as the server states it in the read-back -- no client derivation.
  const checks = useMemo(
    () =>
      presentLuControlChecks({
        property: {
          lookedUp: Boolean(site),
          lookupError,
          geometryLoading,
          geometryError,
          geometry: localizationGeometry,
          assessedPoint: pointBinding,
          assessedGeometryId: governed?.assessedGeometryId ?? null,
          propertyRoot: assessmentPresence.status === 'present' ? governed?.propertyRoot : undefined,
        },
        assessment: assessmentPresence,
        server: governed
          ? {
              layerChecks: governed.layerChecks,
              evidenceDetails: governed.evidenceDetails,
              limitedCoverageLayers: limitedCoverageLayersOf(governed.overallStatement),
            }
          : null,
      }),
    [site, lookupError, geometryLoading, geometryError, localizationGeometry, assessmentPresence, governed, pointBinding],
  );

  // DEMO M2b item 1 / W-M2d item 1: one "Försök igen" for whatever failed technically in the PANEL.
  // The panel no longer reads the map's viewer evidence, so a map failure is retried on the map.
  const retryChecks = () => {
    if (incoherence || persistedAssessmentError || overall?.retryable) void loadCurrentAssessment();
    if (geometryError) void loadCurrentGeometry();
    if (lookupError) void lookupProperty();
  };
  const retryAvailable =
    Boolean(incoherence) ||
    Boolean(persistedAssessmentError?.retryable) ||
    Boolean(overall?.retryable) ||
    Boolean(geometryError?.retryable) ||
    Boolean(lookupError?.retryable);

  // The map's own retry: its viewer evidence contradicts the shown assessment (a 404 for it, ids that
  // are not its own) -> read the assessment again; otherwise fetch the map evidence again.
  const retryMapEvidence = () => {
    if (incoherence || persistedAssessmentError) {
      void loadCurrentAssessment();
    } else if (evidence.load.status === 'error' && evidence.load.error.kind === 'INCOHERENT') {
      void loadCurrentAssessment();
    } else {
      setEvidenceNonce((n) => n + 1);
    }
  };

  // DEMO M2b item 2: the map shows the evidence of the displayed assessment only (binding-checked).
  const productEvidence: CesiumProductEvidence = useMemo(() => {
    switch (assessmentPresence.status) {
      case 'loading':
        return { status: 'loading' };
      case 'none':
      case 'not_assessed':
        return { status: 'none' };
      case 'error':
        return {
          status: 'error',
          messageSv: assessmentPresence.error.messageSv,
          retryable: assessmentPresence.error.retryable,
          // DEMO M2c item 3: the same state word the control panel shows for this failure.
          stateLabel: LU_KNOWLEDGE_STATE_LABEL[knowledgeStateForError(assessmentPresence.error)],
        };
      case 'present':
        break;
    }
    switch (evidence.load.status) {
      case 'idle':
      case 'loading':
        return { status: 'loading' };
      case 'error':
        return {
          status: 'error',
          messageSv: evidence.load.error.messageSv,
          retryable: evidence.load.error.retryable,
          stateLabel: LU_KNOWLEDGE_STATE_LABEL[knowledgeStateForError(evidence.load.error)],
        };
      case 'loaded':
        return { status: 'loaded', geojson: evidence.geojson };
    }
  }, [assessmentPresence, evidence]);

  const propertyCoordinates = useMemo<[number, number] | null>(() => (site ? [site.lat, site.lng] : null), [site?.lat, site?.lng]);
  const currentLocationPoint = useMemo(
    () => (localizationGeometry ? { lat: localizationGeometry.wgs84LngLat[1], lng: localizationGeometry.wgs84LngLat[0] } : null),
    [localizationGeometry?.wgs84LngLat[0], localizationGeometry?.wgs84LngLat[1]],
  );

  // DEMO M2a item 7 / M2b: progress derived only from real, polled state -- no timers, no fake bars;
  // every label says what is true in that state (nothing reads "klart" before it is).
  const provisioning = localizationGeometry?.provisioningStatus ?? null;
  const assessedAndShown = assessmentPresence.status === 'present';
  const progressSteps: LuProgressStep[] = [
    {
      key: 'property',
      label: site ? 'Fastigheten uppslagen' : lookupError ? 'Fastigheten kunde inte slås upp' : 'Fastigheten slås upp',
      state: site ? 'done' : lookingUp ? 'active' : lookupError ? 'failed' : 'pending',
    },
    {
      key: 'point',
      label: geometryError
        ? 'Kontrollpunkten kunde inte hämtas'
        : localizationGeometry
          ? localizationGeometry.provenance === 'derived_from_property_boundary'
            ? 'Kontrollpunkt beräknad från fastigheten'
            : 'Kontrollpunkt sparad'
          : 'Kontrollpunkten hämtas',
      state: geometryError ? 'failed' : localizationGeometry ? 'done' : site ? 'active' : 'pending',
    },
    {
      key: 'prepare',
      label: provisioning === 'FAILED' ? 'Analysen kunde inte förberedas' : provisioning === 'COMPLETED' ? 'Analysen förberedd' : 'Analysen förbereds',
      state:
        provisioning === 'COMPLETED'
          ? 'done'
          : provisioning === 'FAILED'
            ? 'failed'
            : provisioning === 'PENDING' || provisioning === 'LEASED'
              ? 'active'
              : 'pending',
    },
    {
      key: 'run',
      label: running
        ? `Bedömningen körs – ${LU_V1_LAYER_COUNT} kartlager kontrolleras`
        : runError
          ? 'Bedömningen kunde inte köras'
          : incoherence
            ? 'Bedömningen kunde inte läsas tillbaka'
            : runOutcome
              ? 'Körningen gav ingen ny bedömning'
              : assessedAndShown
                ? 'Bedömning sparad'
                : 'Bedömning',
      state: running
        ? 'active'
        : runError || incoherence || runOutcome
          ? 'failed'
          : assessedAndShown
            ? 'done'
            : 'pending',
    },
    {
      key: 'evidence',
      // W-M2d item 1: this step is the MAP's viewer evidence; the control panel reads the assessment.
      label:
        evidence.load.status === 'error'
          ? 'Kontrollresultaten kunde inte hämtas till kartan'
          : evidence.load.status === 'loaded'
            ? 'Kontrollresultat hämtade till kartan'
            : evidence.load.status === 'loading'
              ? 'Kontrollresultat hämtas till kartan'
              : 'Kontrollresultat till kartan',
      state:
        evidence.load.status === 'loaded'
          ? 'done'
          : evidence.load.status === 'loading'
            ? 'active'
            : evidence.load.status === 'error'
              ? 'failed'
              : 'pending',
    },
  ];
  const showProgress =
    Boolean(site) && (running || provisioning === 'PENDING' || provisioning === 'LEASED' || evidence.load.status === 'loading');

  // Item 4: one ring only when every checked layer used the same governed search radius.
  // DEMO M2c item 2: and only around the point the displayed assessment was made for -- the ring
  // says "where the check searched", so it is never drawn around another point.
  const distinctRadii = [...new Set(checks.map((c) => c.searchRadiusMeters).filter((r): r is number => r !== null))];
  const governedRadius = distinctRadii.length === 1 ? distinctRadii[0]! : null;
  // W-M2d item 7: the ring is drawn around the point the assessment was made for -- the read-back's
  // own verified bound point (U20-D c41fd77d). Without those coordinates it is drawn only when the
  // shown point IS the assessed one (same artifact id), and withheld otherwise.
  const assessedPoint = governed?.assessedPoint ?? null;
  const searchRadiusCenter =
    pointBinding === 'none' || pointBinding === 'unknown'
      ? null
      : assessedPoint ?? (pointBinding === 'bound' && localizationGeometry ? { lat: localizationGeometry.wgs84LngLat[1], lng: localizationGeometry.wgs84LngLat[0] } : null);
  const searchRadiusMeters = searchRadiusCenter ? governedRadius : null;
  const searchRadiusWithheldNote =
    governedRadius === null || searchRadiusCenter
      ? null
      : pointBinding === 'changed'
        ? 'Sökradien visas inte: bedömningen gjordes för en annan kontrollpunkt än den som visas, och dess punkt anges inte i svaret.'
        : pointBinding === 'unknown'
          ? 'Sökradien visas inte: det går inte att bekräfta vilken kontrollpunkt bedömningen gjordes för.'
          : null;

  const verifyMismatchCount = verifyResult?.mismatches.length ?? 0;

  return (
    <div
      data-testid="lu-workspace"
      className="max-w-3xl px-8 py-10"
      style={{ color: colors.coreTurquoise.hex, fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      <h1 className="text-3xl font-bold tracking-tight mb-2">Lokaliseringsutredning</h1>
      <p className="text-sm opacity-70 mb-8 leading-relaxed">Fastighet, kontroller och bedömningsunderlag.</p>

      <section className="space-y-4 mb-10">
        <label className="block text-xs uppercase tracking-widest opacity-70">
          Fastighetsbeteckning
          <input
            data-testid="lu-designation"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            placeholder="t.ex. GÄVLE BRYNÄS 1:1"
            className="mt-2"
            style={fieldStyle}
          />
        </label>

        <label className="block text-xs uppercase tracking-widest opacity-70">
          Alternativnamn
          <input
            data-testid="lu-site-name"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            className="mt-2"
            style={fieldStyle}
          />
        </label>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            data-testid="lu-lookup"
            disabled={!designation.trim() || lookingUp}
            onClick={() => void lookupProperty()}
            className="px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{
              background: colors.coreTurquoise.hex,
              color: colors.surfaceDarkStone.hex,
            }}
          >
            {lookingUp ? 'Slår upp…' : 'Slå upp fastighet'}
          </button>
          <button
            type="button"
            data-testid="lu-run"
            disabled={!site || running || !isExecutionReady || persistedAssessmentLoading}
            title={
              pendingSave && site
                ? 'Den nya kontrollpunkten bekräftas fortfarande.'
                : !isExecutionReady && site
                ? 'Analysen förbereds fortfarande.'
                : persistedAssessmentLoading
                  ? 'Den sparade bedömningen läses in.'
                  : undefined
            }
            onClick={() => void runAssessment()}
            className="px-4 py-2 text-sm font-semibold border disabled:opacity-40"
            style={{
              borderColor: colors.coreTurquoise.hex,
              color: colors.flowLightCyan.hex,
            }}
          >
            {running ? 'Bedömningen körs…' : 'Kör bedömning'}
          </button>
        </div>

        {lookupError ? <LuErrorNotice testId="lu-lookup-error" error={lookupError} className="" /> : null}
        {runError ? <LuErrorNotice testId="lu-run-error" error={runError} className="" /> : null}
        {runOutcome ? (
          <div
            data-testid="lu-run-outcome"
            className="text-sm space-y-1 border p-3"
            style={{ borderColor: '#F97316', color: '#FDBA74' }}
          >
            <p>
              Senaste körningen{formatClock(runOutcome.endedAt) ? ` (kl. ${formatClock(runOutcome.endedAt)})` : ''}:{' '}
              <span data-testid="lu-run-outcome-status" className="font-semibold">
                {presentLuAssessmentStatus(runOutcome.status)}
              </span>
            </p>
            {runOutcome.messageSv ? <p data-testid="lu-run-outcome-message">{runOutcome.messageSv}</p> : null}
            {runOutcome.retryable === false ? (
              <p data-testid="lu-run-outcome-not-retryable">Ett nytt försök ger samma utfall så länge orsaken finns kvar.</p>
            ) : null}
            <p>
              Körningen gav ingen ny bedömning.
              {governed ? ' Bedömningen som visas nedan är projektets aktuella sparade bedömning från en annan körning.' : ''}
            </p>
            {runOutcome.reasonCodes && runOutcome.reasonCodes.length > 0 ? (
              // W-M2e item 1: the run record's machine codes, collapsed -- never in the main text.
              <details data-testid="lu-run-outcome-technical" className="text-xs opacity-80">
                <summary className="cursor-pointer">Teknisk information</summary>
                <p>Orsakskoder: {runOutcome.reasonCodes.join(', ')}</p>
              </details>
            ) : null}
            {/* W-M2d item 8: honest about what is kept -- the server stores no denied runs. */}
            <p data-testid="lu-run-outcome-session-note" className="text-xs opacity-80">
              {runOutcomeInShell
                ? 'Uppgiften finns kvar så länge du är inloggad i den här fliken. Servern sparar inte nekade körningar, så uppgiften visas inte efter att sidan laddats om.'
                : 'Servern sparar inte nekade körningar, så uppgiften visas inte efter att sidan laddats om.'}
            </p>
          </div>
        ) : null}

        {site ? (
          <p data-testid="lu-site-ready" className="text-sm opacity-80">
            Fastighet: {site.designation}
            {site.name !== site.designation ? ` · ${site.name}` : ''}
          </p>
        ) : null}
      </section>

      {site ? (
        <section data-testid="lu-localization-geometry" className="space-y-3 mb-8">
          <h2 className="text-xs uppercase tracking-widest opacity-70" style={{ color: 'inherit' }}>Kontrollpunkt</h2>

          {geometryLoading && !localizationGeometry ? (
            <p className="text-sm opacity-60">Hämtar kontrollpunkt…</p>
          ) : localizationGeometry ? (
            <div data-testid="lu-geometry-current" className="text-sm space-y-1">
              <p>
                {localizationGeometry.provenance === 'user_defined' ? (
                  <strong>Angiven av användaren</strong>
                ) : (
                  <strong>Beräknad mittpunkt av fastigheten (ej inmätt)</strong>
                )}
              </p>
              <p className="opacity-70 font-mono text-xs">
                {localizationGeometry.wgs84LngLat[1].toFixed(6)}, {localizationGeometry.wgs84LngLat[0].toFixed(6)}
              </p>
              <p data-testid="lu-geometry-readiness" className="text-xs opacity-80">
                {pendingSave ? (
                  'Väntar på att den nya kontrollpunkten bekräftas…'
                ) : localizationGeometry.provisioningStatus === 'PENDING' || localizationGeometry.provisioningStatus === 'LEASED' ? (
                  'Förbereder analysen…'
                ) : localizationGeometry.provisioningStatus === 'COMPLETED' ? (
                  <span style={{ color: '#34D399' }}>Klar att bedöma</span>
                ) : localizationGeometry.provisioningStatus === 'FAILED' ? (
                  <span style={{ color: '#F87171' }}>Kontrollpunkten är sparad men analysen kunde inte förberedas.</span>
                ) : null}
              </p>
              {localizationGeometry.provisioningStatus === 'FAILED' ? (
                <button
                  type="button"
                  data-testid="lu-retry-provisioning"
                  disabled={retryingProvisioning}
                  onClick={() => void retryProvisioning()}
                  className="px-3 py-1.5 text-xs font-semibold border disabled:opacity-40"
                  style={{ borderColor: colors.coreGraphite.hex, color: colors.flowLightCyan.hex }}
                >
                  {retryingProvisioning ? 'Försöker igen…' : 'Försök igen'}
                </button>
              ) : null}
              {pendingSave ? (
                // W-M2d item 7: the saved point is shown as saved, and honestly as not yet current.
                <div data-testid="lu-geometry-pending" className="text-xs space-y-1 border p-2" style={{ borderColor: '#F97316', color: '#FDBA74' }}>
                  {/* W-M2e item 3 (M2d verification probe L1): while waiting, the UI does not know WHICH point is
                      current (another session may have saved a third) -- it says only that the server's applies. */}
                  <p>
                    Den nya kontrollpunkten är sparad men ännu inte bekräftad som projektets aktuella punkt. Tills bytet är
                    bekräftat gäller den kontrollpunkt som servern anger som aktuell, och ingen bedömning körs.
                  </p>
                  {pendingPolls >= PENDING_SAVE_MAX_POLLS ? (
                    <p data-testid="lu-geometry-pending-stale">Bytet har inte bekräftats ännu.</p>
                  ) : null}
                  <button
                    type="button"
                    data-testid="lu-geometry-pending-show-current"
                    disabled={geometryLoading}
                    onClick={() => void showServerCurrentPoint()}
                    className="px-2 py-1 text-xs font-semibold border disabled:opacity-40"
                    style={{ borderColor: '#F97316' }}
                  >
                    Visa projektets aktuella kontrollpunkt
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {saveOutcomeNote ? (
            <p data-testid="lu-geometry-save-outcome" className="text-xs" style={{ color: '#FDBA74' }}>
              {saveOutcomeNote}
            </p>
          ) : null}

          {geometryError ? (
            <LuErrorNotice testId="lu-geometry-error" error={geometryError} onRetry={() => void loadCurrentGeometry()} retrying={geometryLoading} className="" />
          ) : null}

          {!pickingLocation ? (
            <button
              type="button"
              data-testid="lu-start-picking-location"
              onClick={startPickingLocation}
              className="px-4 py-2 text-sm font-semibold border"
              style={{ borderColor: colors.coreTurquoise.hex, color: colors.flowLightCyan.hex }}
            >
              {localizationGeometry?.provenance === 'user_defined' ? 'Ändra kontrollpunkt' : 'Ange kontrollpunkt'}
            </button>
          ) : (
            <div data-testid="lu-picking-location-panel" className="space-y-2 border p-4" style={{ borderColor: colors.coreGraphite.hex }}>
              <p className="text-xs opacity-70">1. Klicka på kartan för att välja punkt.</p>
              {draftPoint ? (
                <>
                  <p data-testid="lu-draft-point" className="text-sm font-mono">
                    Utkast: {draftPoint.lat.toFixed(6)}, {draftPoint.lng.toFixed(6)}
                  </p>
                  {saveLocationError ? <LuErrorNotice testId="lu-save-location-error" error={saveLocationError} className="" /> : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      data-testid="lu-save-location"
                      disabled={savingLocation}
                      onClick={() => void saveLocation()}
                      className="px-4 py-2 text-sm font-semibold disabled:opacity-40"
                      style={{ background: colors.coreTurquoise.hex, color: colors.surfaceDarkStone.hex }}
                    >
                      {savingLocation ? 'Sparar kontrollpunkt…' : 'Spara kontrollpunkt'}
                    </button>
                    <button
                      type="button"
                      data-testid="lu-cancel-location"
                      disabled={savingLocation}
                      onClick={cancelPickingLocation}
                      className="px-4 py-2 text-sm font-semibold border disabled:opacity-40"
                      style={{ borderColor: colors.coreGraphite.hex, color: colors.flowLightCyan.hex }}
                    >
                      Avbryt
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  data-testid="lu-cancel-location"
                  onClick={cancelPickingLocation}
                  className="px-4 py-2 text-sm font-semibold border"
                  style={{ borderColor: colors.coreGraphite.hex, color: colors.flowLightCyan.hex }}
                >
                  Avbryt
                </button>
              )}
            </div>
          )}
        </section>
      ) : null}

      {showProgress ? <LuProgressSteps steps={progressSteps} /> : null}

      {site ? (
        <LuControlPanel
          checks={checks}
          findings={governed?.findings ?? []}
          selectedKey={selectedCheck}
          onSelect={setSelectedCheck}
          onRetry={retryAvailable ? retryChecks : null}
          retrying={persistedAssessmentLoading || geometryLoading || lookingUp}
          note={assessmentPresence.status === 'present' && governed && !governed.layerChecks ? MISSING_LAYER_CHECKS_NOTE : null}
        />
      ) : null}

      {persistedAssessmentLoading ? (
        <p data-testid="lu-persisted-assessment-loading" className="text-sm opacity-70 mb-4">
          Hämtar sparad bedömning…
        </p>
      ) : null}
      {persistedAssessmentError ? (
        <LuErrorNotice
          testId="lu-persisted-assessment-error"
          error={persistedAssessmentError}
          onRetry={() => void loadCurrentAssessment()}
          retrying={persistedAssessmentLoading}
        />
      ) : null}
      {!persistedAssessmentLoading && persistedAssessmentNotFound && !governed ? (
        <p data-testid="lu-persisted-assessment-not-found" className="text-sm opacity-70 mb-4">
          Ingen sparad bedömning finns ännu för denna kontrollpunkt. Kör en bedömning för att skapa en.
        </p>
      ) : null}

      {incoherence ? (
        <section
          data-testid="lu-incoherent"
          className="border p-6 space-y-3 mb-10"
          style={{ borderColor: '#C026D3' }}
        >
          <h2 className="text-xl font-bold" style={{ color: 'inherit' }}>Kan inte visa en sammanhängande bedömning</h2>
          <p className="text-sm">{incoherenceReason(incoherence)}</p>
          <p className="text-sm opacity-80">
            Fynd, kontrollresultat, karta, reproducerbarhetskontroll och export visas inte förrän bedömningen kan läsas tillbaka som projektets
            aktuella bedömning.
          </p>
          <button
            type="button"
            data-testid="lu-incoherent-retry"
            disabled={persistedAssessmentLoading}
            onClick={() => void loadCurrentAssessment()}
            className="px-3 py-1.5 text-xs font-semibold border disabled:opacity-40"
            style={{ borderColor: '#C026D3' }}
          >
            Läs in på nytt
          </button>
          <details data-testid="lu-incoherent-technical" className="text-xs opacity-80">
            <summary className="cursor-pointer">Teknisk information</summary>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono break-all">
              {incoherenceTechnical(incoherence).map((row) => (
                <React.Fragment key={row.label}>
                  <dt className="opacity-60 font-sans">{row.label}</dt>
                  <dd>{row.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          </details>
        </section>
      ) : null}

      {governed ? (
        <section
          data-testid="lu-results"
          className="border p-6 space-y-4 mb-10"
          style={{ borderColor: colors.coreGraphite.hex }}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold" style={{ color: 'inherit' }}>Bedömning</h2>
            <div className="flex gap-2">
              {governed.assessmentArtifactId ? (
                <button
                  type="button"
                  data-testid="lu-verify-assessment"
                  disabled={verifyingAssessment}
                  onClick={() => void verifyAssessment()}
                  className="px-4 py-2 text-sm font-semibold border disabled:opacity-40"
                  style={{ borderColor: colors.coreTurquoise.hex, color: colors.flowLightCyan.hex }}
                >
                  {verifyingAssessment ? 'Kontrollerar…' : 'Kontrollera reproducerbarhet'}
                </button>
              ) : null}
              {governed.assessmentArtifactId ? (
                <button
                  type="button"
                  data-testid="lu-export-pdf"
                  disabled={exportingPdf}
                  onClick={() => void exportPdf()}
                  className="px-4 py-2 text-sm font-semibold border disabled:opacity-40"
                  style={{ borderColor: colors.coreTurquoise.hex, color: colors.flowLightCyan.hex }}
                >
                  {exportingPdf ? 'Exporterar…' : 'Exportera rapport'}
                </button>
              ) : null}
            </div>
          </div>
          {exportPdfError ? <LuErrorNotice testId="lu-export-pdf-error" error={exportPdfError} className="" /> : null}
          {verifyError ? <LuErrorNotice testId="lu-verify-error" error={verifyError} className="" /> : null}
          {verifyResult ? (
            verifyResult.outcome === 'PASS' ? (
              // W-M2d item 4: consistency/replay against the pinned artifacts -- never "identical", never
              // authenticity; the server's notices directly under the claim.
              <div data-testid="lu-verify-result-pass" className="text-sm space-y-1" style={{ color: '#A5F3FC' }}>
                <p data-testid="lu-verify-result-pass-head" className="font-semibold">
                  Reproducerbarheten verifierad – resultatet matchar de pinnade artefakterna.
                </p>
                {verifyResult.notices.length > 0 ? (
                  <ul data-testid="lu-verify-result-notices" className="space-y-0.5" style={{ color: '#FDBA74' }}>
                    {verifyResult.notices.map((notice, i) => (
                      <li key={`${notice.code}-${i}`}>{verifyNoticeSv(notice)}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-xs opacity-80">
                  Kontrollen visar att bedömningen kan återskapas ur sitt sparade underlag. Den intygar inte vem som har skapat
                  underlaget.
                </p>
                <details data-testid="lu-verify-result-technical" className="text-xs opacity-80">
                  <summary className="cursor-pointer">Teknisk information</summary>
                  <p className="font-mono break-all">Kontrollerad bedömning: {verifyResult.verifiedId ?? 'okänd'}</p>
                  {verifyResult.notices.map((notice, i) => (
                    <p key={`tech-${notice.code}-${i}`} className="font-mono break-all">
                      Notis: {notice.code}
                      {notice.finding_ids.length > 0 ? ` (${notice.finding_ids.join(', ')})` : ''}
                    </p>
                  ))}
                  {verifyResult.serverOutcomeSv ? <p className="break-all">Serverns text: {verifyResult.serverOutcomeSv}</p> : null}
                </details>
              </div>
            ) : verifyResult.outcome === 'OTHER_ASSESSMENT' ? (
              <div data-testid="lu-verify-result-other" className="text-sm space-y-1" style={{ color: '#F0ABFC' }}>
                <p>Kontrollen gällde en annan bedömning än den som visas och räknas inte för den här. Läs in bedömningen på nytt.</p>
                <details className="text-xs opacity-80">
                  <summary className="cursor-pointer">Teknisk information</summary>
                  <p className="font-mono break-all">Visad bedömning: {governed.assessmentArtifactId}</p>
                  <p className="font-mono break-all">Kontrollerad bedömning: {verifyResult.verifiedId ?? 'okänd'}</p>
                </details>
              </div>
            ) : (
              <div data-testid="lu-verify-result-mismatch" className="text-sm space-y-1" style={{ color: '#F87171' }}>
                <p data-testid="lu-verify-result-mismatch-summary">
                  {verifyResult.outcome === 'UNKNOWN'
                    ? 'Kontrollen gav ett okänt utfall. Reproducerbarheten kunde inte bekräftas.'
                    : verifyMismatchCount > 0
                      ? `Kontrollen hittade ${verifyMismatchCount} ${verifyMismatchCount === 1 ? 'avvikelse' : 'avvikelser'} mot de pinnade artefakterna. Reproducerbarheten kunde inte bekräftas.`
                      : 'Reproducerbarheten kunde inte bekräftas – återexekveringen matchar inte de pinnade artefakterna.'}
                </p>
                {verifyMismatchCount > 0 ? (
                  <details data-testid="lu-verify-result-mismatch-technical" className="text-xs opacity-80">
                    <summary className="cursor-pointer">Teknisk information</summary>
                    <ul className="list-disc pl-5 mt-1 font-mono break-all">
                      {verifyResult.mismatches.map((m, i) => (
                        <li key={`${m.code}-${i}`}>
                          {m.code}: {m.detail}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            )
          ) : null}

          <div
            data-testid="lu-assessment-summary"
            className="space-y-1"
            style={
              governed.assessmentStatus === 'ASSESSED' && overall && overall.tone !== 'complete'
                ? { borderLeft: `3px solid ${OVERALL_TONE_STYLE[overall.tone].border}`, paddingLeft: '0.75rem' }
                : undefined
            }
          >
            <p className="text-sm">
              Status:{' '}
              <span data-testid="lu-assessment-status" className="font-semibold">
                {presentLuAssessmentStatus(governed.assessmentStatus)}
              </span>
            </p>
            {retrievedAtOf(governed.evidenceDetails) ? (
              <p data-testid="lu-assessment-retrieved" className="text-xs opacity-80">
                Underlaget för bedömningen hämtades {new Date(retrievedAtOf(governed.evidenceDetails)!).toLocaleString('sv-SE')}.
              </p>
            ) : null}
            {governed.assessmentStatus === 'ASSESSED' && overall ? (
              <div
                data-testid="lu-assessment-overall"
                data-coverage-state={overall.coverageState}
                data-tone={overall.tone}
                className="text-sm space-y-1"
                style={{ color: OVERALL_TONE_STYLE[overall.tone].color }}
              >
                {overall.stateLabelSv ? (
                  <p data-testid="lu-assessment-overall-state" className="text-xs uppercase tracking-widest">
                    {overall.stateLabelSv}
                  </p>
                ) : null}
                <p data-testid="lu-assessment-overall-statement" className="font-semibold">
                  {overall.statementSv}
                </p>
                {overall.notices.length > 0 ? (
                  <ul data-testid="lu-assessment-overall-notices" className="space-y-0.5">
                    {overall.notices.map((notice) => (
                      <li key={notice}>{notice}</li>
                    ))}
                  </ul>
                ) : null}
                {overall.retryable ? (
                  <button
                    type="button"
                    data-testid="lu-assessment-overall-retry"
                    disabled={persistedAssessmentLoading}
                    onClick={() => void loadCurrentAssessment()}
                    className="px-3 py-1 text-xs font-semibold border disabled:opacity-40"
                    style={{ borderColor: OVERALL_TONE_STYLE[overall.tone].border }}
                  >
                    Läs in bedömningen på nytt
                  </button>
                ) : null}
                {overall.technical.length > 0 ? (
                  <details data-testid="lu-assessment-overall-technical" className="text-xs opacity-80">
                    <summary className="cursor-pointer">Teknisk information</summary>
                    <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono break-all">
                      {overall.technical.map((row) => (
                        <React.Fragment key={row.label}>
                          <dt className="opacity-60 font-sans">{row.label}</dt>
                          <dd>{row.value}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
          {runOutcome ? (
            <p data-testid="lu-results-not-latest-run" className="text-sm" style={{ color: '#FDBA74' }}>
              Detta är projektets aktuella sparade bedömning från en annan körning. Den är inte resultatet av den senaste
              körningen, som {runOutcomeClause(runOutcome.status)}.
            </p>
          ) : null}

          {pointBinding === 'changed' || pointBinding === 'unknown' ? (
            <div
              data-testid="lu-point-binding"
              data-binding={pointBinding}
              className="text-sm space-y-2 border p-3"
              style={{ borderColor: '#F97316', color: '#FDBA74' }}
            >
              <p>
                {pointBinding === 'changed'
                  ? `Kontrollpunkten har ändrats sedan bedömningen gjordes: bedömningen gjordes för en annan kontrollpunkt än den som visas. ${
                      searchRadiusCenter
                        ? 'Sökradien på kartan visar var bedömningen sökte – kring bedömningens egen kontrollpunkt.'
                        : 'Sökradien ritas därför inte på kartan.'
                    } Läs in på nytt för att visa projektets aktuella kontrollpunkt och bedömning tillsammans.`
                  : 'Det går inte att bekräfta att bedömningen gjordes för den kontrollpunkt som visas – svaret anger inte bedömningens kontrollpunkt. Sökradien ritas därför inte på kartan.'}
              </p>
              {pointBinding === 'changed' ? (
                <button
                  type="button"
                  data-testid="lu-point-binding-reload"
                  disabled={geometryLoading || persistedAssessmentLoading}
                  onClick={() => void reloadPointAndAssessment()}
                  className="px-3 py-1.5 text-xs font-semibold border disabled:opacity-40"
                  style={{ borderColor: '#F97316' }}
                >
                  Läs in på nytt
                </button>
              ) : null}
              <details data-testid="lu-point-binding-technical" className="text-xs opacity-80">
                <summary className="cursor-pointer">Teknisk information</summary>
                <p className="font-mono break-all">Bedömningens kontrollpunkt: {governed.assessedGeometryId ?? 'anges inte i svaret'}</p>
                <p className="font-mono break-all">Visad kontrollpunkt: {localizationGeometry?.artifact_id ?? 'ingen'}</p>
              </details>
            </div>
          ) : null}

          {governed.findings.length > 0 ? (
            <div data-testid="lu-findings">
              <h3 className="text-xs uppercase tracking-widest opacity-70 mb-2" style={{ color: 'inherit' }}>Fynd</h3>
              <ul className="space-y-2 text-sm">
                {governed.findings.map((f) => {
                  const presentation = presentLuFinding(f);
                  const spatialRef = f.evidence_refs?.find((r) => r.artifact_type === 'SPATIAL_EVIDENCE');
                  const hasCheck = Boolean(checkDefinitionForRule(f.rule_id));
                  return (
                    <li
                      key={f.finding_id}
                      data-testid={`lu-finding-${f.finding_id}`}
                      className="border p-3"
                      style={{ borderColor: colors.coreGraphite.hex }}
                    >
                      <p className="text-xs uppercase tracking-widest opacity-70">
                        {presentation.categoryLabel} · {presentation.attentionLabel}
                      </p>
                      <p>{presentLuFindingSummary(f)}</p>
                      {spatialRef && hasCheck ? (
                        <button
                          type="button"
                          data-testid={`lu-finding-show-evidence-${f.finding_id}`}
                          onClick={() => showFindingEvidence(f)}
                          className="mt-2 text-xs font-semibold underline"
                          style={{ color: colors.coreTurquoise.hex }}
                        >
                          Visa underlag
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : governed.assessmentStatus === 'ASSESSED' ? (
            <p data-testid="lu-no-findings" className="text-sm opacity-80">
              Bedömningen gav inga fynd. Se kontrollerna ovan för vad som faktiskt kontrollerades.
            </p>
          ) : null}

          <p className="text-xs opacity-60 pt-2">
            Bedömningen är ett underlag för handläggning. Den ersätter inte en prövning av handläggare.
          </p>

          <details data-testid="lu-technical-info" className="text-xs opacity-80">
            <summary className="cursor-pointer">Teknisk information</summary>
            <div className="mt-2 space-y-1 font-mono break-all">
              {governed.assessmentArtifactId ? (
                <p data-testid="lu-assessment-id">Bedömnings-id: {governed.assessmentArtifactId}</p>
              ) : null}
              {governed.findings.length > 0 ? (
                <p data-testid="lu-finding-ids">Fynd-id: {governed.findings.map((f) => f.finding_id).join(', ')}</p>
              ) : null}
              {governed.findings.map((f) => (
                <p key={`tech-${f.finding_id}`} data-testid={`lu-finding-technical-${f.finding_id}`}>
                  {f.rule_id}
                  {f.rule_version ? ` v${f.rule_version}` : ''} · nivå {f.risk_level} · regelns originaltext: {f.explanation}
                </p>
              ))}
            </div>
          </details>
        </section>
      ) : null}

      {site ? (
        <section
          data-testid="lu-cesium-front"
          className="relative mb-10 min-h-[620px] overflow-hidden border"
          style={{ borderColor: colors.coreGraphite.hex }}
        >
          <Suspense
            fallback={
              <div className="absolute inset-0 flex min-h-[620px] items-center justify-center bg-slate-950 text-sm font-semibold text-cyan-100">
                Laddar kartan…
              </div>
            }
          >
            <CesiumMapView
              propertyGeometry={site.geometry}
              propertyCoordinates={propertyCoordinates}
              onEvidenceClick={(props) => {
                const def = checkDefinitionForLayer(props?.layer_id);
                if (def) setSelectedCheck(def.key);
              }}
              pickingLocation={pickingLocation}
              onLocationPick={(lat, lng) => setDraftPoint({ lat, lng })}
              draftLocationPoint={draftPoint}
              currentLocationPoint={currentLocationPoint}
              productMode
              productEvidence={productEvidence}
              onProductEvidenceRetry={retryMapEvidence}
              searchRadiusMeters={searchRadiusMeters}
              searchRadiusCenter={searchRadiusCenter}
              searchRadiusWithheldNote={searchRadiusWithheldNote}
              currentLocationLabel={
                localizationGeometry?.provenance === 'user_defined'
                  ? 'Kontrollpunkt: angiven av användaren'
                  : 'Kontrollpunkt: beräknad mittpunkt av fastigheten (ej inmätt)'
              }
            />
          </Suspense>
        </section>
      ) : null}
    </div>
  );
};

export default LuWorkspace;
