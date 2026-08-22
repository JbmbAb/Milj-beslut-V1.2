import React, { Suspense, lazy, useEffect, useState } from 'react';
import { designTokens } from '@miljobeslut/mps-identity';
import { callApi, getActiveProjectId } from '../../../services/coreApiClient';
import { fetchPropertyInfo } from '../../../src/ui/api-client/geo.client';
import EvidenceDetailsPanel from '../../cesium/EvidenceDetailsPanel';
import type { CesiumEvidenceMode } from '../../CesiumMapView';

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
  dataSources?: Array<{ source: string; status: string }>;
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
  // PRODUCT-LU-CONTEXT-AND-EVIDENCE-BINDING-V1: the active product path defaults to live,
  // governed evidence. 'fixture' remains available as an explicit user toggle inside
  // CesiumMapView (dev/comparison use), but must never be this workspace's silent default.
  const [cesiumEvidenceMode, setCesiumEvidenceMode] = useState<CesiumEvidenceMode>('live');
  const [selectedEvidence, setSelectedEvidence] = useState<any | null>(null);

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

  const analysis = report?.siteAnalyses?.[0];
  const compliance = analysis?.complianceAnalysis;
  const motor = analysis?.executionMotor;

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
            disabled={!site || running}
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
              onEvidenceClick={(props) => setSelectedEvidence(props)}
              projectId={getActiveProjectId() || undefined}
            />
          </Suspense>

          {selectedEvidence ? (
            <EvidenceDetailsPanel
              evidence={selectedEvidence}
              evidenceMode={cesiumEvidenceMode}
              onClose={() => setSelectedEvidence(null)}
            />
          ) : null}
        </section>
      ) : null}

      {compliance ? (
        <section
          data-testid="lu-results"
          className="border p-6 space-y-4"
          style={{ borderColor: colors.coreGraphite.hex }}
        >
          <h2 className="text-xl font-bold">Resultat</h2>
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
