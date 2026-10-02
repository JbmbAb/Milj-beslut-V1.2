import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { designTokens } from '@miljobeslut/mps-identity';
import { callApi, getActiveProjectId } from '../../../services/coreApiClient';
import { fetchPropertyInfo } from '../../../src/ui/api-client/geo.client';
import type { CesiumEvidenceMode } from '../../CesiumMapView';
import { presentLuFinding, presentLuFindingSummary } from './luFindingPresentation';
import {
  checkDefinitionForLayer,
  checkDefinitionForRule,
  deriveLuControlChecks,
  parseViewerEvidence,
  LU_V1_CHECKS,
  type LuAssessmentPresence,
  type LuCheckKey,
  type LuEvidenceLoad,
} from './luControlChecks';
import { LuControlPanel } from './LuControlPanel';
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
  assessment_status?: string;
  findings?: LuFindingView[];
  localization_geometry?: { status?: string; message_sv?: string | null } | null;
};

type LocalizationReport = {
  ok?: boolean;
  siteAnalyses?: Array<{ executionMotor?: ExecutionMotorMeta }>;
};

/**
 * DEMO M2a item 2 -- the ONE governed result this view renders, whether it comes from a fresh run
 * (generate-report's executionMotor) or from a reopen (GET current-assessment). Only fields both
 * paths carry are kept, so fresh and reopened views render the same content. Legacy observations
 * (complianceAnalysis.overallRisk, dataSources, warnings, spatialAudit) are deliberately NOT part of
 * it: they are not the governed assessment.
 */
type GovernedResult = {
  assessmentStatus: string;
  assessmentArtifactId: string | null;
  findings: LuFindingView[];
  statusMessage: string | null;
};

const RISK_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, NOT_CHECKED: 3 };

/** Deterministic order so a fresh run and a reopen list the same findings in the same order. */
function sortFindings(findings: readonly LuFindingView[]): LuFindingView[] {
  return [...findings].sort(
    (a, b) => (RISK_ORDER[a.risk_level] ?? 9) - (RISK_ORDER[b.risk_level] ?? 9) || a.finding_id.localeCompare(b.finding_id),
  );
}

function governedFromRun(report: LocalizationReport): GovernedResult {
  const motor = report.siteAnalyses?.[0]?.executionMotor ?? {};
  return {
    assessmentStatus: motor.assessment_status ?? (motor.assessment_artifact_id ? 'ASSESSED' : 'NOT_ASSESSED'),
    assessmentArtifactId: motor.assessment_artifact_id ?? null,
    findings: sortFindings(motor.findings ?? []),
    statusMessage: motor.localization_geometry?.message_sv ?? null,
  };
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
  const [lookupError, setLookupError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [governed, setGoverned] = useState<GovernedResult | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportPdfError, setExportPdfError] = useState('');
  const [verifyingAssessment, setVerifyingAssessment] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [verifyResult, setVerifyResult] = useState<{ outcome: 'PASS' | 'DENY'; mismatches: readonly { code: string; detail: string }[] } | null>(null);
  const [persistedAssessmentLoading, setPersistedAssessmentLoading] = useState(false);
  const [persistedAssessmentError, setPersistedAssessmentError] = useState('');
  const [persistedAssessmentNotFound, setPersistedAssessmentNotFound] = useState(false);
  // The product LU view only ever shows live, governed evidence; there is no fixture mode here.
  const cesiumEvidenceMode: CesiumEvidenceMode = 'live';
  const [selectedCheck, setSelectedCheck] = useState<LuCheckKey | null>(null);
  const [evidenceLoad, setEvidenceLoad] = useState<LuEvidenceLoad>({ status: 'idle' });
  const [evidenceNonce, setEvidenceNonce] = useState(0);
  const evidenceRequestRef = useRef(0);

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

  const clearResultState = () => {
    setGoverned(null);
    setVerifyResult(null);
    setVerifyError('');
    setSelectedCheck(null);
  };

  const lookupProperty = async () => {
    setLookupError('');
    setLookingUp(true);
    clearResultState();
    try {
      const info = await fetchPropertyInfo(designation.trim(), getActiveProjectId() || undefined);
      const lat = Number(info.centroid?.lat);
      const lng = Number(info.centroid?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('Fastighetsuppslaget saknar koordinater.');
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
      setLookupError(err instanceof Error ? err.message : 'Uppslaget misslyckades.');
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
      setGeometryError(err instanceof Error ? err.message : 'Kunde inte hämta lokaliseringspunkten.');
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

  // LU-ASSESSMENT-PERSISTENCE-READ-V1B: read-only -- never runs the kernel. This is the exact string
  // resolveCurrentLuAssessmentSummary uses for "no current assessment".
  const NO_CURRENT_ASSESSMENT_MESSAGE = 'No current governed LU assessment is available for this project.';

  const loadCurrentAssessment = async () => {
    const projectId = getActiveProjectId();
    if (!projectId || !site) return;
    // Clear FIRST, so a previous localization's assessment can never stay visible.
    clearResultState();
    setPersistedAssessmentError('');
    setPersistedAssessmentNotFound(false);
    setPersistedAssessmentLoading(true);
    try {
      const result = await callApi<{
        ok: true;
        assessmentArtifactId: string;
        findings: LuFindingView[];
        systemSummary: string;
      }>(`/api/localization/${encodeURIComponent(projectId)}/current-assessment`, { method: 'GET' });
      setGoverned({
        assessmentStatus: 'ASSESSED',
        assessmentArtifactId: result.assessmentArtifactId,
        findings: sortFindings(result.findings ?? []),
        statusMessage: null,
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

  useEffect(() => {
    if (site) {
      void loadCurrentAssessment();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site?.id, localizationGeometry?.artifact_id, localizationGeometry?.provisioningStatus]);

  // DEMO M2a item 3: the per-layer check results come from the governed viewer evidence of the
  // CURRENT assessment -- fetched only when an assessment exists, re-fetched after every run.
  const assessmentArtifactId = governed?.assessmentArtifactId ?? null;
  useEffect(() => {
    const projectId = getActiveProjectId();
    const requestId = ++evidenceRequestRef.current;
    if (!projectId || !assessmentArtifactId) {
      setEvidenceLoad({ status: 'idle' });
      return;
    }
    setEvidenceLoad({ status: 'loading' });
    void (async () => {
      try {
        const payload = await callApi<unknown>(`/api/localization/${encodeURIComponent(projectId)}/viewer/evidence`, {
          method: 'GET',
        });
        const features = parseViewerEvidence(payload);
        if (evidenceRequestRef.current === requestId) setEvidenceLoad({ status: 'loaded', features });
      } catch (err) {
        if (evidenceRequestRef.current === requestId) {
          setEvidenceLoad({ status: 'error', message: err instanceof Error ? err.message : 'Okänt fel.' });
        }
      }
    })();
  }, [assessmentArtifactId, evidenceNonce]);

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
      setSaveLocationError(err instanceof Error ? err.message : 'Kunde inte spara lokaliseringspunkten.');
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
      // No synthetic project id: without a real active project there is nothing governed to assess.
      setRunError('Inget aktivt projekt valt. Välj ett projekt innan bedömning körs.');
      return;
    }
    setRunning(true);
    clearResultState();
    setPersistedAssessmentNotFound(false);
    setPersistedAssessmentError('');
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
      // Item 2: only the governed fields are kept -- the same shape a reopen renders.
      setGoverned(governedFromRun(result));
      setEvidenceNonce((n) => n + 1);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Kunde inte köra bedömningen.');
    } finally {
      setRunning(false);
    }
  };

  // LU-REPORT-EXPORT-UI-V1: exports the governed assessment resolved server-side; only projectId
  // is sent.
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
      anchor.download = `lokaliseringsbedomning-${fileSlug(site?.designation ?? designation)}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportPdfError(err instanceof Error ? err.message : 'Exporten misslyckades.');
    } finally {
      setExportingPdf(false);
    }
  };

  // LU-REEXECUTION-VERIFY-UI-V1: deterministic re-execution; only projectId is sent.
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
      setVerifyError(err instanceof Error ? err.message : 'Verifieringen misslyckades.');
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
  const assessmentPresence: LuAssessmentPresence = persistedAssessmentLoading
    ? 'loading'
    : governed?.assessmentStatus === 'ASSESSED' && governed.assessmentArtifactId
      ? 'present'
      : persistedAssessmentError
        ? 'error'
        : 'none';

  const checks = useMemo(
    () =>
      deriveLuControlChecks({
        property: {
          lookedUp: Boolean(site),
          lookupError: lookupError || undefined,
          geometryLoading,
          geometryError: geometryError || undefined,
          geometry: localizationGeometry,
        },
        assessment: assessmentPresence,
        evidence: evidenceLoad,
        findings: governed?.findings ?? [],
      }),
    [site, lookupError, geometryLoading, geometryError, localizationGeometry, assessmentPresence, evidenceLoad, governed],
  );

  // DEMO M2a item 7: progress derived only from real, polled state -- no timers, no fake bars.
  const provisioning = localizationGeometry?.provisioningStatus ?? null;
  const progressSteps: LuProgressStep[] = [
    { key: 'property', label: 'Fastigheten uppslagen', state: site ? 'done' : lookingUp ? 'active' : 'pending' },
    {
      key: 'point',
      label:
        localizationGeometry?.provenance === 'derived_from_property_boundary'
          ? 'Kontrollpunkt beräknad från fastigheten'
          : 'Kontrollpunkt sparad',
      state: geometryError ? 'failed' : localizationGeometry ? 'done' : site ? 'active' : 'pending',
    },
    {
      key: 'prepare',
      label: provisioning === 'FAILED' ? 'Analysen kunde inte förberedas' : 'Analysen förberedd',
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
        ? `Bedömningen körs – ${LU_V1_CHECKS.length - 1} kartlager kontrolleras`
        : governed && governed.assessmentStatus !== 'ASSESSED'
          ? 'Ingen bedömning gjordes'
          : 'Bedömning sparad',
      state: running ? 'active' : governed ? (governed.assessmentStatus === 'ASSESSED' ? 'done' : 'failed') : 'pending',
    },
    {
      key: 'evidence',
      label: evidenceLoad.status === 'error' ? 'Kontrollresultaten kunde inte hämtas' : 'Kontrollresultat hämtade',
      state:
        evidenceLoad.status === 'loaded'
          ? 'done'
          : evidenceLoad.status === 'loading'
            ? 'active'
            : evidenceLoad.status === 'error'
              ? 'failed'
              : 'pending',
    },
  ];
  const showProgress =
    Boolean(site) && (running || provisioning === 'PENDING' || provisioning === 'LEASED' || evidenceLoad.status === 'loading');

  // Item 4: one ring only when every checked layer used the same governed search radius.
  const distinctRadii = [...new Set(checks.map((c) => c.searchRadiusMeters).filter((r): r is number => r !== null))];
  const searchRadiusMeters = distinctRadii.length === 1 ? distinctRadii[0]! : null;

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
            disabled={!site || running || !isExecutionReady}
            title={!isExecutionReady && site ? 'Analysen förbereds fortfarande.' : undefined}
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
          ruleIdFor={(key) => LU_V1_CHECKS.find((c) => c.key === key)?.ruleId ?? null}
        />
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
      {!persistedAssessmentLoading && persistedAssessmentNotFound && !governed ? (
        <p data-testid="lu-persisted-assessment-not-found" className="text-sm opacity-70 mb-4">
          Ingen sparad bedömning finns ännu för denna kontrollpunkt. Kör en bedömning för att skapa en.
        </p>
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

          <p className="text-sm">
            Status:{' '}
            <span data-testid="lu-assessment-status" className="font-semibold">
              {ASSESSMENT_STATUS_LABEL[governed.assessmentStatus] ?? 'Okänd status'}
            </span>
          </p>
          {governed.statusMessage ? (
            <p data-testid="lu-assessment-status-message" className="text-sm" style={{ color: '#FDBA74' }}>
              {governed.statusMessage}
            </p>
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
              propertyCoordinates={[site.lat, site.lng]}
              evidenceMode={cesiumEvidenceMode}
              onEvidenceClick={(props) => {
                const def = checkDefinitionForLayer(props?.layer_id);
                if (def) setSelectedCheck(def.key);
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
              productMode
              assessmentAvailable={assessmentPresence === 'present'}
              evidenceReloadNonce={evidenceNonce}
              searchRadiusMeters={searchRadiusMeters}
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
