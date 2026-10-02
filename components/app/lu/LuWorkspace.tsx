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
  deriveLuControlChecks,
  knowledgeStateForError,
  parseServerLayerChecks,
  parseViewerEvidence,
  LU_KNOWLEDGE_STATE_LABEL,
  LU_V1_LAYER_COUNT,
  type LuAssessmentPresence,
  type LuCheckRowKey,
  type LuEvidenceLoad,
} from './luControlChecks';
import {
  LuClientError,
  isNoCurrentAssessmentError,
  presentLuError,
  presentLuIncoherence,
  type LuErrorPresentation,
} from './luErrorPresentation';
import { LuControlPanel } from './LuControlPanel';
import { LuErrorNotice } from './LuErrorNotice';
import { LuProgressSteps, type LuProgressStep } from './LuProgressSteps';

const CesiumMapView = lazy(() => import('../../CesiumMapView'));

/**
 * P3-LU-CANONICAL-CHAIN-01 — how an absent LU verdict is shown.
 *
 * Never a dash or a blank: both read as a low-risk finding. The caseworker must be able to tell
 * "not assessed" from "assessed".
 */
const ASSESSMENT_STATUS_LABEL: Record<string, string> = {
  ASSESSED: 'Bedömd',
  NOT_ASSESSED: 'Ej bedömd',
  GOVERNANCE_DENIED: 'Ej bedömd – nekad av styrning',
  EXECUTION_FAILED: 'Ej bedömd – körning misslyckades',
};

/**
 * DEMO M2b item 5: shown only when neither the read-back (`documentCheck`, K0b) nor the run
 * (`governed_layer_checks`) carries the server's document check -- e.g. an older server. The UI never
 * derives the document status itself.
 */
const MISSING_DOCUMENT_CHECK_NOTE = 'Uppgift om dokumentkontrollen saknas i svaret för den här bedömningen.';

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
};

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
  assessment_artifact_id?: string | null;
  assessment_projection_registered?: boolean | null;
  assessment_status?: string;
  findings?: LuFindingView[];
  localization_geometry?: { status?: string; message_sv?: string | null } | null;
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
  /** K0b: the server's governed document check, derived from the assessment's pinned refs. */
  documentCheck?: unknown;
  /**
   * DEMO M1a / D9(a): the point THIS assessment was made for ({ artifact_id, provenance,
   * provenance_label_sv }; artifact_id is the assessment's own localization_geometry_ref).
   */
  localizationGeometry?: unknown;
};

/**
 * DEMO M2a item 2 / M2b item 2 -- the ONE governed result this view renders. An ASSESSED result is
 * ALWAYS read from GET current-assessment, for a fresh run (after checking that the read-back is the
 * assessment the run produced) and for a reopen alike: one data source, one mapping. Only a run
 * that produced no assessment is rendered from the run response itself (there is nothing to read
 * back). Legacy observations (complianceAnalysis, dataSources, warnings) are never part of it.
 */
type GovernedResult = {
  assessmentStatus: string;
  assessmentArtifactId: string | null;
  findings: LuFindingView[];
  statusMessage: string | null;
  /** The displayed assessment's own SPATIAL_EVIDENCE ids -- the viewer evidence must equal these. */
  spatialEvidenceRefs: readonly string[] | null;
  /**
   * Server-stated checks outside the five map layers, for THIS assessment: the read-back's
   * documentCheck (fresh run and reopen alike), plus any other extra layer only a run reports.
   */
  serverLayerChecks: readonly unknown[] | null;
  /**
   * DEMO M2c item 2: the LocalizationGeometry artifact id this assessment was made for, from the
   * read-back; null when the answer does not state it.
   */
  assessedGeometryId: string | null;
};

/** DEMO M2c item 2: the read-back's own bound point id, or null when the answer does not state one. */
function assessedGeometryIdOf(result: CurrentAssessmentResponse): string | null {
  const g = result.localizationGeometry;
  const id = g && typeof g === 'object' ? (g as { artifact_id?: unknown }).artifact_id : null;
  return typeof id === 'string' && id ? id : null;
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

function layerOf(entry: unknown): string | null {
  const layer = entry && typeof entry === 'object' ? (entry as { layer?: unknown }).layer : null;
  return typeof layer === 'string' && layer ? layer : null;
}

/** Read-back first (the same source for fresh and reopen); a run adds only layers the read-back lacks. */
function mergeServerChecks(readBackDocumentCheck: unknown, runChecks: readonly unknown[] | null): unknown[] {
  const readBack = readBackDocumentCheck && typeof readBackDocumentCheck === 'object' ? [readBackDocumentCheck] : [];
  const readBackLayers = new Set(readBack.map(layerOf));
  return [...readBack, ...(runChecks ?? []).filter((e) => !readBackLayers.has(layerOf(e)))];
}

/** What a fresh run produced, kept until its read-back is confirmed or found to disagree. */
type RunExpectation = {
  assessmentId: string;
  projectionRegistered: boolean | null;
  serverLayerChecks: readonly unknown[] | null;
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

function governedFromCurrentAssessment(result: CurrentAssessmentResponse, assessmentId: string, serverLayerChecks: readonly unknown[] | null): GovernedResult {
  return {
    assessmentStatus: 'ASSESSED',
    assessmentArtifactId: assessmentId,
    findings: sortFindings(Array.isArray(result.findings) ? result.findings : []),
    statusMessage: null,
    spatialEvidenceRefs: spatialRefsOf(result.evidenceRefs),
    serverLayerChecks: mergeServerChecks(result.documentCheck, serverLayerChecks),
    assessedGeometryId: assessedGeometryIdOf(result),
  };
}

function incoherenceReason(i: Incoherence): string {
  if (i.currentId === null && i.projectionRegistered === false) {
    return 'Bedömningen gjordes och sparades, men registrerades inte som projektets aktuella bedömning. Den kan därför inte läsas tillbaka, verifieras eller exporteras ännu.';
  }
  if (i.currentId === null) {
    return 'Bedömningen gjordes, men projektet har ingen aktuell bedömning att läsa tillbaka. Den kan därför inte visas, verifieras eller exporteras.';
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
  const [incoherence, setIncoherence] = useState<Incoherence | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<LuErrorPresentation | null>(null);
  const [verifyingAssessment, setVerifyingAssessment] = useState(false);
  const [verifyError, setVerifyError] = useState<LuErrorPresentation | null>(null);
  const [verifyResult, setVerifyResult] = useState<{
    outcome: 'PASS' | 'DENY' | 'OTHER_ASSESSMENT' | 'UNKNOWN';
    verifiedId: string | null;
    mismatches: readonly { code: string; detail: string }[];
  } | null>(null);
  const [persistedAssessmentLoading, setPersistedAssessmentLoading] = useState(false);
  const [persistedAssessmentError, setPersistedAssessmentError] = useState<LuErrorPresentation | null>(null);
  const [persistedAssessmentNotFound, setPersistedAssessmentNotFound] = useState(false);
  const [selectedCheck, setSelectedCheck] = useState<LuCheckRowKey | null>(null);
  const [evidence, setEvidence] = useState<{ load: LuEvidenceLoad; geojson: unknown }>({ load: { status: 'idle' }, geojson: null });
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
      setGoverned(governedFromCurrentAssessment(result, currentId, expected ? expected.serverLayerChecks : null));
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
      // A new property/point is a new context: a previous run's expectation no longer applies.
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
  useEffect(() => {
    const status = localizationGeometry?.provisioningStatus;
    if (status !== 'PENDING' && status !== 'LEASED') return;
    const timer = setTimeout(() => {
      void loadCurrentGeometry();
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localizationGeometry?.artifact_id, localizationGeometry?.provisioningStatus]);

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
      setLocalizationGeometry(result.geometry);
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
      setLocalizationGeometry(result.geometry);
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
          serverLayerChecks: parseServerLayerChecks(motor.governed_layer_checks),
        };
        await loadCurrentAssessment();
      } else {
        // No assessment was produced: there is nothing to read back. Show the governed status and
        // the server's Swedish reason (localization_geometry.message_sv) only.
        setGoverned({
          assessmentStatus: status === 'ASSESSED' ? 'NOT_ASSESSED' : status,
          assessmentArtifactId: null,
          findings: [],
          statusMessage: motor.localization_geometry?.message_sv ?? null,
          spatialEvidenceRefs: [],
          serverLayerChecks: null,
          assessedGeometryId: null,
        });
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

  // LU-REPORT-EXPORT-UI-V1 / DEMO M2b item 2: the export endpoint takes only the project and returns
  // no assessment id, so right before exporting the project's current assessment is checked to
  // still be the displayed one. (A residual window between the check and the export remains until
  // the endpoint accepts or returns the assessment id -- a server change.)
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
      const blob = await callApi<Blob>(
        `/api/localization/${encodeURIComponent(projectId)}/export-assessment-pdf`,
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
  const verifyAssessment = async () => {
    if (verifyingAssessment) return; // duplicate-click guard
    const projectId = getActiveProjectId();
    const shownId = governed?.assessmentArtifactId ?? null;
    if (!projectId || !shownId) {
      setVerifyError(presentLuError(new LuClientError('Det finns ingen visad bedömning att verifiera.'), 'verify'));
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
      }>(`/api/localization/${encodeURIComponent(projectId)}/verify-assessment`, { method: 'POST' });
      const verifiedId = typeof result?.assessmentArtifactId === 'string' ? result.assessmentArtifactId : null;
      const mismatches = Array.isArray(result?.mismatches) ? result.mismatches : [];
      if (verifiedId !== shownId) {
        setVerifyResult({ outcome: 'OTHER_ASSESSMENT', verifiedId, mismatches: [] });
      } else if (result.outcome === 'PASS' || result.outcome === 'DENY') {
        setVerifyResult({ outcome: result.outcome, verifiedId, mismatches });
      } else {
        setVerifyResult({ outcome: 'UNKNOWN', verifiedId, mismatches });
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

  const isExecutionReady = localizationGeometry?.provisioningStatus === 'COMPLETED';
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
    if (persistedAssessmentNotFound || !site || !projectReady) return { status: 'none' };
    return { status: 'loading' };
  }, [persistedAssessmentLoading, incoherencePresentation, governed, persistedAssessmentError, persistedAssessmentNotFound, site, projectReady]);

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

  const checks = useMemo(
    () =>
      deriveLuControlChecks({
        property: {
          lookedUp: Boolean(site),
          lookupError,
          geometryLoading,
          geometryError,
          geometry: localizationGeometry,
          assessedPoint: pointBinding,
          assessedGeometryId: governed?.assessedGeometryId ?? null,
        },
        assessment: assessmentPresence,
        evidence: evidence.load,
        findings: governed?.findings ?? [],
        serverLayerChecks: governed?.serverLayerChecks ?? null,
      }),
    [site, lookupError, geometryLoading, geometryError, localizationGeometry, assessmentPresence, evidence.load, governed, pointBinding],
  );

  // DEMO M2b item 1: one "Försök igen" for whatever failed technically.
  const retryChecks = () => {
    if (incoherence || persistedAssessmentError) {
      void loadCurrentAssessment();
    } else if (evidence.load.status === 'error' && evidence.load.error.kind === 'INCOHERENT') {
      // DEMO M2c item 3: the control results contradict the shown assessment (a 404 for it, or ids
      // that are not its own): read the assessment again; the evidence is then fetched for it.
      void loadCurrentAssessment();
    } else if (evidence.load.status === 'error') {
      setEvidenceNonce((n) => n + 1);
    }
    if (geometryError) void loadCurrentGeometry();
    if (lookupError) void lookupProperty();
  };
  const retryAvailable =
    Boolean(incoherence) ||
    Boolean(persistedAssessmentError?.retryable) ||
    (evidence.load.status === 'error' && evidence.load.error.retryable) ||
    Boolean(geometryError?.retryable) ||
    Boolean(lookupError?.retryable);

  // DEMO M2b item 2: the map shows exactly what the panel shows -- same fetch, same binding check.
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
            : assessmentPresence.status === 'not_assessed'
              ? 'Ingen bedömning gjordes'
              : assessedAndShown
                ? 'Bedömning sparad'
                : 'Bedömning',
      state: running
        ? 'active'
        : runError || incoherence || assessmentPresence.status === 'not_assessed'
          ? 'failed'
          : assessedAndShown
            ? 'done'
            : 'pending',
    },
    {
      key: 'evidence',
      label:
        evidence.load.status === 'error'
          ? 'Kontrollresultaten kunde inte hämtas'
          : evidence.load.status === 'loaded'
            ? 'Kontrollresultat hämtade'
            : evidence.load.status === 'loading'
              ? 'Kontrollresultat hämtas'
              : 'Kontrollresultat',
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

  // DEMO M2b/M2c (§11, owner decision OD-K0-1): the assessment line never stands alone while any check
  // is not done or any register has a known limited coverage. Owner's form: "... i de kontroller som
  // utfördes; underlaget är ofullständigt: N av M kontroller genomförda." -- the governed assessment
  // the UI reads carries no overall risk level, so the line opens with "Bedömningen gäller" instead
  // of a risk word (none is invented). Counted from the SAME rows the control panel shows -- no new
  // derivation, and the machine-readable states and risk levels are untouched.
  const coverage = useMemo((): { complete: boolean; head: string; missing: string | null; limited: string | null } => {
    const rows = checks.filter((c) => c.key !== 'property');
    if (rows.some((c) => c.state === 'LOADING')) {
      return {
        complete: false,
        head: 'Kontrollresultaten hämtas – underlagets fullständighet visas när de är hämtade.',
        missing: null,
        limited: null,
      };
    }
    const shortState = (c: (typeof rows)[number]): string =>
      c.key === 'extra-document' && c.state === 'NOT_CHECKED'
        ? 'ej analyserat'
        : c.state === 'NOT_CHECKED'
          ? 'inte kontrollerat'
          : c.state === 'SOURCE_UNAVAILABLE'
            ? 'källa otillgänglig'
            : c.state === 'UNCERTAIN'
              ? 'ofullständigt underlag'
              : 'tekniskt fel';
    // The document check is part of DoD v1 (K-8): a missing server answer about it is a check without
    // a result, never a smaller set.
    const documentCheckMissing = !rows.some((c) => c.key === 'extra-document');
    const total = rows.length + (documentCheckMissing ? 1 : 0);
    const done = rows.filter((c) => c.state === 'HIT' || c.state === 'NO_HIT');
    const withoutResult = [
      ...rows.filter((c) => c.state !== 'HIT' && c.state !== 'NO_HIT').map((c) => `${c.label} (${shortState(c)})`),
      ...(documentCheckMissing ? ['Dokumentbevis (uppgift saknas i svaret)'] : []),
    ];
    const limited = done.filter((c) => c.coverageLimited && c.limitedCoverageShort).map((c) => `${c.label} – ${c.limitedCoverageShort}`);
    const head =
      done.length < total
        ? `Bedömningen gäller de kontroller som utfördes; underlaget är ofullständigt: ${done.length} av ${total} kontroller genomförda.`
        : `Bedömningen gäller de kontroller som utfördes; ${done.length} av ${total} kontroller genomförda.`;
    return {
      complete: done.length === total && limited.length === 0,
      head,
      missing: withoutResult.length > 0 ? `Utan visat kontrollresultat: ${withoutResult.join('; ')}.` : null,
      limited: limited.length > 0 ? `Begränsad täckning: ${limited.join('; ')}.` : null,
    };
  }, [checks]);

  // Item 4: one ring only when every checked layer used the same governed search radius.
  // DEMO M2c item 2: and only around the point the displayed assessment was made for -- the ring
  // says "where the check searched", so it is never drawn around another point.
  const distinctRadii = [...new Set(checks.map((c) => c.searchRadiusMeters).filter((r): r is number => r !== null))];
  const governedRadius = distinctRadii.length === 1 ? distinctRadii[0]! : null;
  const searchRadiusMeters = pointBinding === 'bound' ? governedRadius : null;
  const searchRadiusWithheldNote =
    governedRadius === null
      ? null
      : pointBinding === 'changed'
        ? 'Sökradien visas inte: bedömningen gjordes för en annan kontrollpunkt än den som visas.'
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
              !isExecutionReady && site
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
                {localizationGeometry.provisioningStatus === 'PENDING' || localizationGeometry.provisioningStatus === 'LEASED' ? (
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
            </div>
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
          retrying={persistedAssessmentLoading || evidence.load.status === 'loading'}
          note={
            assessmentPresence.status === 'present' && governed && !(governed.serverLayerChecks ?? []).some((e) => layerOf(e) === 'document')
              ? MISSING_DOCUMENT_CHECK_NOTE
              : null
          }
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
            Fynd, kontrollresultat, karta, verifiering och export visas inte förrän bedömningen kan läsas tillbaka som projektets
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
                  {verifyingAssessment ? 'Verifierar…' : 'Verifiera bedömningen'}
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
              <p data-testid="lu-verify-result-pass" className="text-sm" style={{ color: '#34D399' }}>
                Bedömningen har verifierats genom deterministisk återexekvering. Resultatet är identiskt.
              </p>
            ) : verifyResult.outcome === 'OTHER_ASSESSMENT' ? (
              <div data-testid="lu-verify-result-other" className="text-sm space-y-1" style={{ color: '#F0ABFC' }}>
                <p>
                  Verifieringen gällde en annan bedömning än den som visas, så den räknas inte som en verifiering av den här
                  bedömningen. Läs in bedömningen på nytt.
                </p>
                <details className="text-xs opacity-80">
                  <summary className="cursor-pointer">Teknisk information</summary>
                  <p className="font-mono break-all">Visad bedömning: {governed.assessmentArtifactId}</p>
                  <p className="font-mono break-all">Verifierad bedömning: {verifyResult.verifiedId ?? 'okänd'}</p>
                </details>
              </div>
            ) : (
              <div data-testid="lu-verify-result-mismatch" className="text-sm space-y-1" style={{ color: '#F87171' }}>
                <p data-testid="lu-verify-result-mismatch-summary">
                  {verifyResult.outcome === 'UNKNOWN'
                    ? 'Verifieringen gav ett okänt utfall. Bedömningen kunde inte bekräftas som identisk.'
                    : verifyMismatchCount > 0
                      ? `Verifieringen hittade ${verifyMismatchCount} ${verifyMismatchCount === 1 ? 'avvikelse' : 'avvikelser'} mot det ursprungliga underlaget. Bedömningen kunde inte bekräftas som identisk.`
                      : 'Verifieringen kunde inte bekräfta bedömningen som identisk.'}
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
              governed.assessmentStatus === 'ASSESSED' && !coverage.complete
                ? { borderLeft: '3px solid #F97316', paddingLeft: '0.75rem' }
                : undefined
            }
          >
            <p className="text-sm">
              Status:{' '}
              <span data-testid="lu-assessment-status" className="font-semibold">
                {ASSESSMENT_STATUS_LABEL[governed.assessmentStatus] ?? 'Okänd status'}
              </span>
            </p>
            {governed.assessmentStatus === 'ASSESSED' ? (
              <div
                data-testid="lu-assessment-coverage"
                data-complete={coverage.complete ? 'true' : 'false'}
                className="text-sm space-y-1"
                style={{ color: coverage.complete ? 'inherit' : '#FDBA74' }}
              >
                <p data-testid="lu-assessment-coverage-head" className="font-semibold">
                  {coverage.head}
                </p>
                {coverage.missing ? <p data-testid="lu-assessment-coverage-missing">{coverage.missing}</p> : null}
                {coverage.limited ? <p data-testid="lu-assessment-coverage-limited">{coverage.limited}</p> : null}
              </div>
            ) : null}
          </div>
          {governed.statusMessage ? (
            <p data-testid="lu-assessment-status-message" className="text-sm" style={{ color: '#FDBA74' }}>
              {governed.statusMessage}
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
                  ? 'Kontrollpunkten har ändrats sedan bedömningen gjordes: bedömningen gjordes för en annan kontrollpunkt än den som visas. Sökradien ritas därför inte på kartan. Läs in på nytt för att visa projektets aktuella kontrollpunkt och bedömning tillsammans.'
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
              onProductEvidenceRetry={retryChecks}
              searchRadiusMeters={searchRadiusMeters}
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
