import React, { Suspense, lazy, useEffect, useState } from 'react';
import { designTokens } from '@miljobeslut/mps-identity';
import { callApi, getActiveProjectId } from '../../../services/coreApiClient';
import { fetchPropertyInfo } from '../../../src/ui/api-client/geo.client';
import { getBootstrapStatus } from '../../../src/ui/api-client/localizationProjects.client';
import EvidenceDetailsPanel from '../../cesium/EvidenceDetailsPanel';
import type { CesiumEvidenceMode } from '../../CesiumMapView';
import { presentLuFinding } from './luFindingPresentation';
import { presentLuCoverageStatus } from './luCoverageStatusPresentation';

const CesiumMapView = lazy(() => import('../../CesiumMapView'));

/**
 * P3-LU-CANONICAL-CHAIN-01 — how an absent LU verdict is shown.
 *
 * Never a dash or a blank: in a field labelled "Risk", both read as a low-risk finding. The
 * caseworker must be able to tell "not assessed" from "assessed as low risk".
 */
const NOT_ASSESSED_LABEL: Record<string, string> = {
  ASSESSED: 'Bedömd',
  NOT_ASSESSED: 'Ej bedömd',
  GOVERNANCE_DENIED: 'Ej bedömd – nekad av styrning',
  EXECUTION_FAILED: 'Ej bedömd – körning misslyckades',
};

type SiteInput = {
  id: string;
  name: string;
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
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  explanation: string;
  /**
   * LU-FINDING-MAP-DRILLDOWN-V1. Was already present on the wire from the server on both the
   * fresh-run and Unit 5B restore paths (the real AssessmentFinding shape) -- this type just
   * hadn't declared it yet.
   */
  evidence_refs?: Array<{ artifact_id: string; artifact_type: string }>;
};

type ExecutionMotorMeta = {
  admitted?: boolean;
  reason_codes?: string[];
  attempt_id?: string | null;
  outcome_id?: string | null;
  manifest_id?: string | null;
  ticket_id?: string | null;
  finding_ids?: string[];
  assessment_artifact_id?: string | null;
  property_context_id?: string | null;
  assessment_status?: string;
  findings?: LuFindingView[];
};

type SiteAnalysis = {
  siteId?: string;
  siteName?: string;
  complianceAnalysis?: {
    overallRisk?: string;
    permitProbability?: number;
    requiredActions?: string[];
    notes?: string[];
  };
  dataSources?: Array<{ source: string; status: string; detail?: string }>;
  warnings?: string[];
  executionMotor?: ExecutionMotorMeta;
};

type LocalizationReport = {
  ok?: boolean;
  projectId?: string;
  siteAnalyses?: SiteAnalysis[];
  humanInTheLoop?: string;
  error?: string;
};

/**
 * Clean LU product surface — no LocalizationStudyUI / hub / OperationsCenter.
 */
export const LuWorkspace: React.FC<{ initialDesignation?: string }> = ({ initialDesignation = '' }) => {
  const colors = designTokens.colors;
  const [designation, setDesignation] = useState(initialDesignation);
  const [siteName, setSiteName] = useState('Alternativ A');
  const [site, setSite] = useState<SiteInput | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [report, setReport] = useState<LocalizationReport | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportPdfError, setExportPdfError] = useState('');
  const [verifyingAssessment, setVerifyingAssessment] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [verifyResult, setVerifyResult] = useState<{ outcome: 'PASS' | 'DENY'; mismatches: readonly { code: string; detail: string }[] } | null>(null);
  const [focusEvidenceArtifactId, setFocusEvidenceArtifactId] = useState<string | null>(null);
  const [focusEvidenceNonce, setFocusEvidenceNonce] = useState(0);
  const [focusEvidenceMissing, setFocusEvidenceMissing] = useState(false);
  const [persistedAssessmentLoading, setPersistedAssessmentLoading] = useState(false);
  const [persistedAssessmentError, setPersistedAssessmentError] = useState('');
  const [persistedAssessmentNotFound, setPersistedAssessmentNotFound] = useState(false);
  // PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1: the active product path defaults to live,
  // governed evidence. 'fixture' remains available as an explicit user toggle inside
  // CesiumMapView (dev/comparison use), but must never be this workspace's silent default.
  const [cesiumEvidenceMode, setCesiumEvidenceMode] = useState<CesiumEvidenceMode>('live');
  const [selectedEvidence, setSelectedEvidence] = useState<any | null>(null);

  // PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01.
  const [localizationGeometry, setLocalizationGeometry] = useState<LocalizationGeometryView | null>(null);
  const [geometryLoading, setGeometryLoading] = useState(false);
  const [geometryError, setGeometryError] = useState('');
  const [pickingLocation, setPickingLocation] = useState(false);
  const [draftPoint, setDraftPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const [saveLocationError, setSaveLocationError] = useState('');

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(0,0,0,0.35)',
    border: `1px solid ${colors.coreGraphite.hex}`,
    color: colors.flowLightCyan.hex,
    padding: '0.75rem 1rem',
    borderRadius: 0,
  };

  const lookupProperty = async () => {
    setLookupError('');
    setLookingUp(true);
    setReport(null);
    try {
      const info = await fetchPropertyInfo(designation.trim(), getActiveProjectId() || undefined);
      const lat = Number(info.centroid?.lat);
      const lng = Number(info.centroid?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('Fastighetsuppslag saknar koordinater.');
      }
      const name = info.designation || designation.trim();
      setSite({
        id: `site-${designation.trim().replace(/\s+/g, '-').toLowerCase()}`,
        name: siteName.trim() || name,
        lat,
        lng,
        geometry: info.geometry,
      });
    } catch (err) {
      setSite(null);
      setLookupError(err instanceof Error ? err.message : 'Uppslag misslyckades.');
    } finally {
      setLookingUp(false);
    }
  };

  // PRODUCT-LU-PROPERTY-FIRST-WORKFLOW-01 Phase B: when opened via the property-first entry
  // (PropertyFirstLuEntry), the property was already searched/selected there -- auto-run the same
  // lookup here once so the user never has to search for it a second time. Only fires once, on
  // mount, and only when the caller actually supplied a designation.
  useEffect(() => {
    if (initialDesignation.trim()) {
      void lookupProperty();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01: GET bootstrap-status is the canonical
  // web-server-safe enqueue trigger. Hitting it on workspace open covers every entry path
  // (existing localization, refresh, direct project id) without the viewer process holding a
  // signing key.
  useEffect(() => {
    const projectId = getActiveProjectId();
    if (!projectId) return;
    void Promise.resolve(getBootstrapStatus(projectId)).catch(() => undefined);
  }, []);

  // PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01: load the project's current LocalizationGeometry
  // (an explicit user_defined point, or the transitional derived_from_property_boundary one) as
  // soon as a real site + active project are available -- this is what makes "refresh -> point
  // still visible" and "fresh login -> point still displayed" true: the browser never invents
  // this state locally, it always re-reads it from the server.
  const loadCurrentGeometry = async () => {
    const projectId = getActiveProjectId();
    if (!projectId) return;
    setGeometryError('');
    setGeometryLoading(true);
    try {
      const result = await callApi<{ ok: boolean; geometry: LocalizationGeometryView }>(
        `/api/localization/${encodeURIComponent(projectId)}/geometry`,
        { method: 'GET' },
      );
      setLocalizationGeometry(result.geometry);
    } catch (err) {
      setGeometryError(err instanceof Error ? err.message : 'Kunde inte hämta lokalisering.');
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

  // LU-ASSESSMENT-PERSISTENCE-READ-V1B: read-only -- never runs the kernel, never mints a new
  // assessment. Server-side resolveCurrentLuAssessmentSummary already scopes "current" to the
  // current ProjectContextBinding AND current localization geometry, so a stale assessment for a
  // since-superseded point can never be returned here. This is the exact string
  // resolveCurrentLuAssessmentSummary uses for "no current assessment" (all 3 of its 404 branches
  // share it) -- distinguishing that expected, common case from a genuine server error.
  const NO_CURRENT_ASSESSMENT_MESSAGE = 'No current governed LU assessment is available for this project.';

  const loadCurrentAssessment = async () => {
    const projectId = getActiveProjectId();
    if (!projectId || !site) return;
    // Clear any previously-rendered report FIRST, synchronously before the fetch -- otherwise a
    // prior localization's/geometry's assessment could remain visible while this request is still
    // in flight or resolves to "not found" for the new one.
    setReport(null);
    setPersistedAssessmentError('');
    setPersistedAssessmentNotFound(false);
    setPersistedAssessmentLoading(true);
    setVerifyResult(null);
    setVerifyError('');
    setFocusEvidenceArtifactId(null);
    setFocusEvidenceMissing(false);
    try {
      const result = await callApi<{
        ok: true;
        assessmentArtifactId: string;
        findings: LuFindingView[];
        systemSummary: string;
      }>(`/api/localization/${encodeURIComponent(projectId)}/current-assessment`, { method: 'GET' });
      setReport({
        ok: true,
        projectId,
        siteAnalyses: [
          {
            complianceAnalysis: {},
            executionMotor: {
              admitted: true,
              assessment_status: 'ASSESSED',
              assessment_artifact_id: result.assessmentArtifactId,
              finding_ids: result.findings.map((f) => f.finding_id),
              findings: result.findings,
            },
          },
        ],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kunde inte hämta sparad bedömning.';
      if (message === NO_CURRENT_ASSESSMENT_MESSAGE) {
        setPersistedAssessmentNotFound(true);
      } else {
        setPersistedAssessmentError(message);
      }
    } finally {
      setPersistedAssessmentLoading(false);
    }
  };

  // Re-runs whenever the current localization geometry changes (including from none to a real
  // point, or from one point to another after a move) -- this is what prevents assessment A from
  // ever being shown as if it belonged to localization B: the effect re-fetches (and clears first)
  // on exactly the same signal the server uses to decide "current".
  useEffect(() => {
    if (site) {
      void loadCurrentAssessment();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site?.id, localizationGeometry?.artifact_id, localizationGeometry?.provisioningStatus]);

  // PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01: while the just-saved point's V3 identity is
  // being minted by the separate worker (PENDING/LEASED), re-poll the same GET the user would get
  // from a manual refresh, until it settles at COMPLETED or FAILED. The user never needs to know
  // "ExecutionIdentity V3" exists -- this is surfaced only as "Förbereder LU…" / "Klar att bedöma".
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
      setGeometryError(err instanceof Error ? err.message : 'Kunde inte försöka igen.');
    } finally {
      setRetryingProvisioning(false);
    }
  };

  const startPickingLocation = () => {
    setSaveLocationError('');
    setDraftPoint(null);
    setPickingLocation(true);
  };

  const cancelPickingLocation = () => {
    setPickingLocation(false);
    setDraftPoint(null);
    setSaveLocationError('');
  };

  const saveLocation = async () => {
    const projectId = getActiveProjectId();
    if (!projectId || !draftPoint) return;
    setSavingLocation(true);
    setSaveLocationError('');
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
      setSaveLocationError(err instanceof Error ? err.message : 'Kunde inte spara lokalisering.');
    } finally {
      setSavingLocation(false);
    }
  };

  const runAssessment = async () => {
    if (!site) {
      setRunError('Slå upp en fastighet först.');
      return;
    }
    setRunError('');
    const projectId = getActiveProjectId();
    if (!projectId) {
      // PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1: no synthetic 'lu-workspace' project id.
      // Without a real authenticated active project there is no verified ProjectContextBinding
      // to assess against, so this fails closed rather than running under a fake project.
      setRunError('Inget aktivt projekt valt. Välj ett projekt innan bedömning körs.');
      return;
    }
    setRunning(true);
    setReport(null);
    setPersistedAssessmentNotFound(false);
    setPersistedAssessmentError('');
    setVerifyResult(null);
    setVerifyError('');
    setFocusEvidenceArtifactId(null);
    setFocusEvidenceMissing(false);
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
      setReport(result);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Kunde inte köra bedömning.');
    } finally {
      setRunning(false);
    }
  };

  // LU-REPORT-EXPORT-UI-V1: exports the already-viewed governed assessment, resolved server-side
  // (GET /api/localization/:projectId/export-assessment-pdf). Only projectId is sent -- the
  // client never supplies findings/coordinates/risk as report authority, matching the invariant
  // proven server-side (see exportCurrentLuAssessmentPdf).
  const exportPdf = async () => {
    if (exportingPdf) return; // duplicate-click guard
    const projectId = getActiveProjectId();
    if (!projectId) {
      setExportPdfError('Inget aktivt projekt valt.');
      return;
    }
    setExportPdfError('');
    setExportingPdf(true);
    try {
      const blob = await callApi<Blob>(
        `/api/localization/${encodeURIComponent(projectId)}/export-assessment-pdf`,
        { method: 'GET' },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `lokaliseringsbedomning-${projectId}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportPdfError(err instanceof Error ? err.message : 'Export misslyckades.');
    } finally {
      setExportingPdf(false);
    }
  };

  // LU-REEXECUTION-VERIFY-UI-V1: H15's deterministic re-execution, already PROVEN, exposed as a
  // normal-user action. Only projectId is sent -- the server resolves which assessment is current
  // and re-executes it from its own frozen governed inputs; the client supplies nothing that could
  // influence the comparison.
  const verifyAssessment = async () => {
    if (verifyingAssessment) return; // duplicate-click guard
    const projectId = getActiveProjectId();
    if (!projectId) {
      setVerifyError('Inget aktivt projekt valt.');
      return;
    }
    setVerifyError('');
    setVerifyResult(null);
    setVerifyingAssessment(true);
    try {
      const result = await callApi<{
        ok: true;
        outcome: 'PASS' | 'DENY';
        assessmentArtifactId: string;
        mismatches: readonly { code: string; detail: string }[];
      }>(`/api/localization/${encodeURIComponent(projectId)}/verify-assessment`, { method: 'POST' });
      setVerifyResult({ outcome: result.outcome, mismatches: result.mismatches });
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Verifiering misslyckades.');
    } finally {
      setVerifyingAssessment(false);
    }
  };

  // LU-FINDING-MAP-DRILLDOWN-V1: never queries anything new -- only tells the already-rendered
  // map (loaded via the governed /viewer/evidence path) which already-loaded entity to focus.
  const showFindingOnMap = (finding: LuFindingView) => {
    const spatialRef = finding.evidence_refs?.find((r) => r.artifact_type === 'SPATIAL_EVIDENCE');
    if (!spatialRef) return; // button is gated on this existing, so this is defensive only
    setFocusEvidenceMissing(false);
    setFocusEvidenceArtifactId(spatialRef.artifact_id);
    setFocusEvidenceNonce((n) => n + 1);
  };

  const analysis = report?.siteAnalyses?.[0];
  const compliance = analysis?.complianceAnalysis;
  const motor = analysis?.executionMotor;
  // PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01: "Kör bedömning" must not be reachable until
  // the current point's ExecutionIdentity V3 is COMPLETED -- running earlier would just be denied
  // by the kernel, and this way the user never sees that as a surprise error.
  const isExecutionReady = localizationGeometry?.provisioningStatus === 'COMPLETED';

  return (
    <div
      data-testid="lu-workspace"
      className="max-w-3xl px-8 py-10"
      style={{ color: colors.coreTurquoise.hex, fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      <h1 className="text-3xl font-bold tracking-tight mb-2">Lokaliseringsutredning</h1>
      <p className="text-sm opacity-70 mb-8 leading-relaxed">
        MPS LU-yta — fastighet, bedömning, findings. Ingen legacy-hub eller LocalizationStudyUI.
      </p>

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
            disabled={!site || running || !isExecutionReady}
            title={!isExecutionReady && site ? 'Lokaliseringen förbereds fortfarande.' : undefined}
            onClick={() => void runAssessment()}
            className="px-4 py-2 text-sm font-semibold border disabled:opacity-40"
            style={{
              borderColor: colors.coreTurquoise.hex,
              color: colors.flowLightCyan.hex,
            }}
          >
            {running ? 'Kör bedömning…' : 'Kör bedömning'}
          </button>
        </div>

        {lookupError ? (
          <p data-testid="lu-lookup-error" className="text-sm" style={{ color: '#F87171' }}>
            {lookupError}
          </p>
        ) : null}
        {runError ? (
          <p data-testid="lu-run-error" className="text-sm" style={{ color: '#F87171' }}>
            {runError}
          </p>
        ) : null}

        {site ? (
          <p data-testid="lu-site-ready" className="text-sm opacity-80">
            Plats: {site.name} ({site.lat.toFixed(5)}, {site.lng.toFixed(5)})
          </p>
        ) : null}
      </section>

      {site ? (
        <section data-testid="lu-localization-geometry" className="space-y-3 mb-8">
          <h2 className="text-xs uppercase tracking-widest opacity-70">Lokalisering</h2>

          {geometryLoading ? (
            <p className="text-sm opacity-60">Hämtar lokalisering…</p>
          ) : localizationGeometry ? (
            <div data-testid="lu-geometry-current" className="text-sm space-y-1">
              <p>
                {localizationGeometry.provenance === 'user_defined' ? (
                  <>
                    Lokalisering: <strong>Användardefinierad</strong>
                  </>
                ) : (
                  <>
                    Lokalisering: <strong>Beräknad från fastigheten</strong>
                  </>
                )}
              </p>
              <p className="opacity-70 font-mono text-xs">
                {localizationGeometry.wgs84LngLat[1].toFixed(6)}, {localizationGeometry.wgs84LngLat[0].toFixed(6)}
              </p>
              <p data-testid="lu-geometry-readiness" className="text-xs opacity-80">
                {localizationGeometry.provisioningStatus === 'PENDING' || localizationGeometry.provisioningStatus === 'LEASED' ? (
                  'Förbereder LU…'
                ) : localizationGeometry.provisioningStatus === 'COMPLETED' ? (
                  <span style={{ color: '#34D399' }}>Klar att bedöma</span>
                ) : localizationGeometry.provisioningStatus === 'FAILED' ? (
                  <span style={{ color: '#F87171' }}>
                    Lokaliseringen är sparad men LU kunde inte förberedas.
                  </span>
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
            <p data-testid="lu-geometry-error" className="text-sm" style={{ color: '#F87171' }}>
              {geometryError}
            </p>
          ) : null}

          {!pickingLocation ? (
            <button
              type="button"
              data-testid="lu-start-picking-location"
              onClick={startPickingLocation}
              className="px-4 py-2 text-sm font-semibold border"
              style={{ borderColor: colors.coreTurquoise.hex, color: colors.flowLightCyan.hex }}
            >
              {localizationGeometry?.provenance === 'user_defined' ? 'Ändra lokalisering' : 'Ange lokalisering'}
            </button>
          ) : (
            <div data-testid="lu-picking-location-panel" className="space-y-2 border p-4" style={{ borderColor: colors.coreGraphite.hex }}>
              <p className="text-xs opacity-70">1. Klicka på kartan för att välja punkt.</p>
              {draftPoint ? (
                <>
                  <p data-testid="lu-draft-point" className="text-sm font-mono">
                    Utkast: {draftPoint.lat.toFixed(6)}, {draftPoint.lng.toFixed(6)}
                  </p>
                  {saveLocationError ? (
                    <p data-testid="lu-save-location-error" className="text-sm" style={{ color: '#F87171' }}>
                      {saveLocationError}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      data-testid="lu-save-location"
                      disabled={savingLocation}
                      onClick={() => void saveLocation()}
                      className="px-4 py-2 text-sm font-semibold disabled:opacity-40"
                      style={{ background: colors.coreTurquoise.hex, color: colors.surfaceDarkStone.hex }}
                    >
                      {savingLocation ? 'Sparar lokalisering…' : 'Spara lokalisering'}
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

      {site ? (
        <section
          data-testid="lu-cesium-front"
          className="relative mb-10 min-h-[620px] overflow-hidden border"
          style={{ borderColor: colors.coreGraphite.hex }}
        >
          <Suspense
            fallback={
              <div className="absolute inset-0 flex min-h-[620px] items-center justify-center bg-slate-950 text-sm font-semibold text-cyan-100">
                Laddar Cesium 3D...
              </div>
            }
          >
            <CesiumMapView
              propertyGeometry={site.geometry}
              propertyCoordinates={[site.lat, site.lng]}
              evidenceMode={cesiumEvidenceMode}
              onEvidenceModeChange={(next) => {
                setCesiumEvidenceMode(next);
                setSelectedEvidence(null);
              }}
              onEvidenceClick={(props) => {
                setSelectedEvidence(props);
                setFocusEvidenceMissing(false);
              }}
              projectId={getActiveProjectId() || undefined}
              pickingLocation={pickingLocation}
              onLocationPick={(lat, lng) => setDraftPoint({ lat, lng })}
              draftLocationPoint={draftPoint}
              currentLocationPoint={
                localizationGeometry
                  ? { lat: localizationGeometry.wgs84LngLat[1], lng: localizationGeometry.wgs84LngLat[0] }
                  : null
              }
              focusEvidenceArtifactId={focusEvidenceArtifactId}
              focusEvidenceNonce={focusEvidenceNonce}
              onFocusEvidenceMissing={() => setFocusEvidenceMissing(true)}
            />
          </Suspense>

          {focusEvidenceMissing ? (
            <p data-testid="lu-finding-map-not-found" className="text-sm mt-2" style={{ color: '#F87171' }}>
              Kunde inte hitta beviset på kartan. Underlaget kan fortfarande laddas -- prova igen om en stund.
            </p>
          ) : null}

          {selectedEvidence ? (
            <EvidenceDetailsPanel
              evidence={selectedEvidence}
              evidenceMode={cesiumEvidenceMode}
              onClose={() => setSelectedEvidence(null)}
            />
          ) : null}
        </section>
      ) : null}

      {persistedAssessmentLoading ? (
        <p data-testid="lu-persisted-assessment-loading" className="text-sm opacity-70 mb-4">
          Hämtar sparad bedömning…
        </p>
      ) : null}
      {persistedAssessmentError ? (
        <p data-testid="lu-persisted-assessment-error" className="text-sm mb-4" style={{ color: '#F87171' }}>
          {persistedAssessmentError}
        </p>
      ) : null}
      {!persistedAssessmentLoading && persistedAssessmentNotFound && !report ? (
        <p data-testid="lu-persisted-assessment-not-found" className="text-sm opacity-70 mb-4">
          Ingen sparad bedömning finns ännu för denna lokalisering. Kör en bedömning för att skapa en.
        </p>
      ) : null}

      {compliance ? (
        <section
          data-testid="lu-results"
          className="border p-6 space-y-4"
          style={{ borderColor: colors.coreGraphite.hex }}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Resultat</h2>
            <div className="flex gap-2">
              {motor?.assessment_artifact_id ? (
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
              {motor?.assessment_artifact_id ? (
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
          {exportPdfError ? (
            <p data-testid="lu-export-pdf-error" className="text-sm" style={{ color: '#F87171' }}>
              {exportPdfError}
            </p>
          ) : null}
          {verifyError ? (
            <p data-testid="lu-verify-error" className="text-sm" style={{ color: '#F87171' }}>
              {verifyError}
            </p>
          ) : null}
          {verifyResult ? (
            verifyResult.outcome === 'PASS' ? (
              <p data-testid="lu-verify-result-pass" className="text-sm" style={{ color: '#34D399' }}>
                Bedömningen har verifierats genom deterministisk återexekvering. Resultatet är identiskt.
              </p>
            ) : (
              <div data-testid="lu-verify-result-mismatch" className="text-sm" style={{ color: '#F87171' }}>
                <p>Verifieringen upptäckte avvikelser mot det ursprungliga underlaget. Bedömningen kunde inte bekräftas som identisk.</p>
                <ul className="list-disc pl-5 mt-1 opacity-80">
                  {verifyResult.mismatches.map((m, i) => (
                    <li key={`${m.code}-${i}`}>{m.code}: {m.detail}</li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
          {motor ? (
            <div data-testid="lu-motor-meta" className="text-xs opacity-70 space-y-1">
              <p>
                ExecutionKernel:{' '}
                {motor.admitted ? 'admitted' : 'denied'}
                {motor.attempt_id ? ` · attempt ${motor.attempt_id}` : ''}
                {motor.outcome_id ? ` · outcome ${motor.outcome_id}` : ''}
                {motor.manifest_id ? ` · manifest ${motor.manifest_id}` : ''}
              </p>
              {motor.assessment_artifact_id ? (
                <p data-testid="lu-assessment-id">
                  Assessment: {motor.assessment_artifact_id}
                </p>
              ) : null}
              {motor.property_context_id ? (
                <p data-testid="lu-property-context-id">
                  Property context: {motor.property_context_id}
                </p>
              ) : null}
              {(motor.finding_ids?.length ?? 0) > 0 ? (
                <p data-testid="lu-finding-ids">
                  Findings: {motor.finding_ids!.join(', ')}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="text-sm">
            Risk:{' '}
            <span data-testid="lu-risk" className="font-semibold">
              {/* P3-LU-CANONICAL-CHAIN-01: a dash in a field labelled "Risk" reads as "no
                  risk". An unassessed site must say so explicitly. */}
              {compliance.overallRisk ?? NOT_ASSESSED_LABEL[motor?.assessment_status ?? 'NOT_ASSESSED']}
            </span>
            {typeof compliance.permitProbability === 'number' ? (
              <span className="opacity-70">
                {' '}
                · tillståndssannolikhet {(compliance.permitProbability * 100).toFixed(0)}%
              </span>
            ) : null}
          </p>

          {(analysis?.dataSources?.length ?? 0) > 0 ? (
            <div data-testid="lu-data-sources">
              <h3 className="text-xs uppercase tracking-widest opacity-70 mb-2">Underlag</h3>
              <ul className="space-y-2 text-sm">
                {analysis!.dataSources!.map((ds) => {
                  const coverage = presentLuCoverageStatus(ds.status);
                  return (
                    <li key={ds.source} data-testid={`lu-data-source-${ds.source}`}>
                      <span className="font-semibold">{ds.source}</span>
                      {': '}
                      <span>{coverage.label}</span>
                      {ds.detail ? <span className="opacity-60"> ({ds.detail})</span> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {(analysis?.warnings?.length ?? 0) > 0 ? (
            <div data-testid="lu-warnings">
              <h3 className="text-xs uppercase tracking-widest opacity-70 mb-2">Övrigt att notera</h3>
              <ul className="space-y-1 text-sm opacity-80 list-disc pl-5">
                {analysis!.warnings!.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {(motor?.findings?.length ?? 0) > 0 ? (
            <div data-testid="lu-findings">
              <h3 className="text-xs uppercase tracking-widest opacity-70 mb-2">Findings</h3>
              <ul className="space-y-2 text-sm">
                {motor!.findings!.map((f) => {
                  const presentation = presentLuFinding(f);
                  const spatialRef = f.evidence_refs?.find((r) => r.artifact_type === 'SPATIAL_EVIDENCE');
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
                      <p>{f.explanation}</p>
                      <p className="text-xs opacity-50 mt-1">{f.rule_id}</p>
                      {spatialRef ? (
                        <button
                          type="button"
                          data-testid={`lu-finding-show-on-map-${f.finding_id}`}
                          onClick={() => showFindingOnMap(f)}
                          className="mt-2 text-xs font-semibold underline"
                          style={{ color: colors.coreTurquoise.hex }}
                        >
                          Visa på karta
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {(compliance.requiredActions?.length ?? 0) > 0 ? (
            <div>
              <h3 className="text-xs uppercase tracking-widest opacity-70 mb-2">Åtgärder</h3>
              <ul className="space-y-2 text-sm list-disc pl-5">
                {compliance.requiredActions!.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {(compliance.notes?.length ?? 0) > 0 ? (
            <div>
              <h3 className="text-xs uppercase tracking-widest opacity-70 mb-2">Noteringar</h3>
              <ul className="space-y-2 text-sm list-disc pl-5 opacity-90">
                {compliance.notes!.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {report?.humanInTheLoop ? (
            <p className="text-xs opacity-60 pt-2">{report.humanInTheLoop}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};

export default LuWorkspace;
