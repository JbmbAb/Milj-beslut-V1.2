import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LuWorkspace } from '../../components/app/lu/LuWorkspace';

vi.mock('@miljobeslut/mps-identity', () => ({
  designTokens: {
    colors: {
      surfaceDarkStone: { hex: '#1C1C1E' },
      coreTurquoise: { hex: '#40E0D0' },
      flowLightCyan: { hex: '#E0FFFF' },
      coreGraphite: { hex: '#2C2C2E' },
      statusAudit: { hex: '#F0E68C' },
    },
  },
}));

const fetchPropertyInfo = vi.fn();
const callApi = vi.fn();
const getActiveProjectId = vi.fn(() => 'proj-1');
// The exact string all 3 of resolveCurrentLuAssessmentSummary's 404 branches share -- this is
// what the component matches on to distinguish "no persisted assessment yet" from a genuine error.
const NO_CURRENT_ASSESSMENT_MESSAGE = 'No current governed LU assessment is available for this project.';

// DEMO M2a: a governed /viewer/evidence FeatureCollection in the real wire shape
// (demo-runtime/m1a/uppsala-svia-1-111/09-viewer-evidence.json), built per test.
function viewerEvidence(layers: Array<{ layer: string; exists: boolean; count: number }>) {
  return {
    type: 'FeatureCollection',
    features: layers.map(({ layer, exists, count }) => ({
      type: 'Feature',
      geometry: null,
      properties: {
        cas_artifact_id: `evidence-${layer}-test`,
        cas_content_hash: 'aaaaaaaabbbbbbbbccccccccdddddddd',
        dataset: layer,
        version: '02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186',
        engine: 'PostGIS',
        algorithm: 'spatial.dwithin_existence',
        result_semantics_kind: 'EXISTENCE_WITHIN_DISTANCE',
        exists,
        distance_meters: 500,
        match_count_observed: count,
        max_features_per_layer: 50,
        layer_id: layer,
        governance_status: 'VERIFIED_OBSERVATION',
      },
    })),
  };
}
vi.mock('../../src/ui/api-client/geo.client', () => ({
  fetchPropertyInfo: (...args: unknown[]) => fetchPropertyInfo(...args),
}));

vi.mock('../../services/coreApiClient', () => ({
  callApi: (...args: unknown[]) => callApi(...args),
  getActiveProjectId: () => getActiveProjectId(),
}));

// LU-FINDING-MAP-DRILLDOWN-V1: CesiumAdapter/real Cesium cannot run in jsdom (WebGL), matching
// this codebase's existing precedent of mocking CesiumMapView out entirely in component tests.
// The mock captures the latest props so tests can assert the exact wiring contract between
// LuWorkspace and the map (focusEvidenceArtifactId/Nonce changing correctly on "Visa på karta"),
// and exposes test-only triggers to simulate what a real CesiumAdapter would call back with.
let lastCesiumMapViewProps: any = null;
vi.mock('../../components/CesiumMapView', () => ({
  default: (props: any) => {
    lastCesiumMapViewProps = props;
    return (
      <div data-testid="cesium-map-view">
        <button
          type="button"
          data-testid="mock-trigger-evidence-found"
          onClick={() => props.onEvidenceClick?.({ cas_artifact_id: props.focusEvidenceArtifactId, layer_id: 'water' })}
        />
        <button
          type="button"
          data-testid="mock-trigger-evidence-missing"
          onClick={() => props.onFocusEvidenceMissing?.()}
        />
      </div>
    );
  },
}));

vi.mock('../../components/cesium/EvidenceDetailsPanel', () => ({
  default: () => <div data-testid="evidence-details-panel" />,
}));

describe('LuWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastCesiumMapViewProps = null;
  });

  it('looks up property and runs assessment without LocalizationStudyUI', async () => {
    const user = userEvent.setup();
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1',
      designation: 'GÄVLE BRYNÄS 1:1',
      municipality: 'Gävle',
      geometry: { type: 'Point', coordinates: [17.14, 60.67] },
      centroid: { lat: 60.67, lng: 17.14 },
    });
    // CESIUM-LU-PRESENTATION-RECOVERY-01: LuWorkspace now gates "Kör bedömning" on a governed
    // LocalizationGeometry (PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01, landed after this test's
    // original WIP) -- a single blanket callApi mock answers every call identically, which left
    // isExecutionReady permanently false and the button permanently disabled. callApi is called
    // with more than one endpoint now, so the mock must branch by URL.
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return Promise.reject(new Error(NO_CURRENT_ASSESSMENT_MESSAGE));
      }
      if (url.includes('/viewer/evidence')) {
        return Promise.resolve(viewerEvidence([{ layer: 'water', exists: true, count: 1 }, { layer: 'ebh', exists: false, count: 0 }]));
      }
      if (url.includes('/geometry')) {
        return Promise.resolve({
          ok: true,
          geometry: {
            artifact_id: 'loc-geom-1',
            provenance: 'user_defined',
            wgs84LngLat: [17.14, 60.67],
            provisioningStatus: 'COMPLETED',
          },
        });
      }
      return Promise.resolve({
        ok: true,
        projectId: 'proj-1',
        siteAnalyses: [
          {
            complianceAnalysis: {
              overallRisk: 'MEDIUM',
              permitProbability: 0.5,
              requiredActions: ['Kontrollera brunn'],
              notes: ['Nära vatten'],
            },
            dataSources: [
              { source: 'NVR API', status: 'ok', detail: '2 träffar' },
              { source: 'PostGIS spatial', status: 'degraded', detail: 'delvis underlag' },
              { source: 'VISS', status: 'unavailable', detail: 'tidsgräns nådd' },
            ],
            warnings: ['VISS otillgänglig: tidsgräns nådd'],
            executionMotor: {
              admitted: true,
              attempt_id: 'att-1',
              outcome_id: 'out-1',
              manifest_id: 'man-1',
              assessment_artifact_id: 'assess-site-1-abc',
              property_context_id: 'prop-site-1',
              finding_ids: ['LU-WATER-001'],
              findings: [
                {
                  finding_id: 'LU-WATER-001',
                  rule_id: 'LU-WATER-001',
                  risk_level: 'MEDIUM',
                  explanation: 'Närhet till vatten kräver analys',
                },
              ],
              // DEMO M1a / U12: governed per-layer coverage from the server.
              governed_layer_checks: [
                { layer: 'water', rule_id: 'LU-WATER-001', status: 'CHECKED_HIT' },
                { layer: 'ebh', rule_id: 'LU-EBH-001', status: 'CHECKED_NO_HIT' },
                { layer: 'protected_area', rule_id: 'LU-PROTECTED-001', status: 'NOT_CHECKED' },
              ],
            },
          },
        ],
        humanInTheLoop: 'Human in the loop',
      });
    });

    render(<LuWorkspace />);
    expect(screen.getByTestId('lu-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('localization-study-ui')).not.toBeInTheDocument();

    await user.type(screen.getByTestId('lu-designation'), 'GÄVLE BRYNÄS 1:1');
    await user.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();
    expect(await screen.findByTestId('lu-cesium-front')).toBeInTheDocument();
    expect(await screen.findByTestId('cesium-map-view')).toBeInTheDocument();
    expect(fetchPropertyInfo).toHaveBeenCalledWith('GÄVLE BRYNÄS 1:1', 'proj-1');

    await user.click(screen.getByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    // DEMO M2a item 2: the fresh view shows ONLY the governed result. The legacy overallRisk
    // ('MEDIUM'), permitProbability, dataSources, warnings, requiredActions, notes and the
    // humanInTheLoop string from generate-report are not rendered, so a fresh run and a reopen of
    // the same assessment look the same.
    expect(screen.getByTestId('lu-assessment-status')).toHaveTextContent('Bedömd');
    expect(screen.queryByTestId('lu-risk')).not.toBeInTheDocument();
    expect(screen.queryByText(/tillståndssannolikhet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/50\s*%/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-data-sources')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-warnings')).not.toBeInTheDocument();
    expect(screen.queryByText(/VISS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NVR API/)).not.toBeInTheDocument();
    expect(screen.queryByText('Kontrollera brunn')).not.toBeInTheDocument();
    expect(screen.queryByText('Nära vatten')).not.toBeInTheDocument();
    expect(screen.queryByText('Human in the loop')).not.toBeInTheDocument();
    expect(screen.queryByText(/ExecutionKernel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/MPS LU-yta|LocalizationStudyUI/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-property-context-id')).not.toBeInTheDocument();
    // Ids live in the collapsed "Teknisk information" section only.
    expect(screen.getByTestId('lu-technical-info')).not.toHaveAttribute('open');
    expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assess-site-1-abc');
    expect(screen.getByTestId('lu-finding-ids')).toHaveTextContent('LU-WATER-001');
    // Item 6: the governed `water` layer is wells -- "Brunnar", never "Närhet till vatten" in the
    // visible finding (the engine's original text is kept only in the technical section).
    const finding = screen.getByTestId('lu-finding-LU-WATER-001');
    expect(finding).toHaveTextContent('Brunnar');
    expect(finding).toHaveTextContent('Bör utredas vidare');
    expect(finding).toHaveTextContent('Brunnar finns inom sökradien.');
    expect(finding).not.toHaveTextContent('Närhet till vatten');
    expect(finding).not.toHaveTextContent('LU-WATER-001');
    expect(screen.getByTestId('lu-finding-technical-LU-WATER-001')).toHaveTextContent('Närhet till vatten kräver analys');

    // Item 3: the control panel is fed by the governed viewer evidence, re-fetched after the run.
    expect(await screen.findByText('1 objekt inom sökradien 500 m.')).toBeInTheDocument();
    expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'HIT');
    expect(screen.getByTestId('lu-check-state-water')).toHaveTextContent('Träff');
    expect(screen.getByTestId('lu-check-ebh')).toHaveAttribute('data-state', 'NO_HIT');
    expect(screen.getByTestId('lu-check-state-ebh')).toHaveTextContent('Kontrollerat – ingen träff');
    // A layer with no evidence in the governed payload reads "Inte kontrollerat", never "ingen träff".
    expect(screen.getByTestId('lu-check-protected_area')).toHaveAttribute('data-state', 'NOT_CHECKED');
    expect(screen.getByTestId('lu-check-state-protected_area')).toHaveTextContent('Inte kontrollerat');
    expect(callApi).toHaveBeenCalledWith('/api/localization/proj-1/viewer/evidence', expect.objectContaining({ method: 'GET' }));

    expect(callApi).toHaveBeenCalledWith(
      '/api/localization/generate-report',
      expect.objectContaining({ method: 'POST' }),
    );

    // LU-REPORT-EXPORT-UI-V1: the export action only appears once a real governed assessment
    // exists, and existing Unit 2/3 presentation (asserted above) is unaffected by its presence.
    expect(screen.getByTestId('lu-export-pdf')).toBeInTheDocument();
    expect(screen.getByTestId('lu-export-pdf')).not.toBeDisabled();
    // LU-REEXECUTION-VERIFY-UI-V1, proof 9+10: verify action appears alongside export, neither
    // unit's presentation is disturbed by the other's presence.
    expect(screen.getByTestId('lu-verify-assessment')).toBeInTheDocument();
    expect(screen.getByTestId('lu-verify-assessment')).not.toBeDisabled();
  });

  it('LU-UNKNOWN-MISSING-DISPLAY-V1, proof 4: NOT_ASSESSED renders an explicit not-assessed state, never a blank or green risk', async () => {
    const user = userEvent.setup();
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1',
      designation: 'GÄVLE BRYNÄS 1:1',
      municipality: 'Gävle',
      geometry: { type: 'Point', coordinates: [17.14, 60.67] },
      centroid: { lat: 60.67, lng: 17.14 },
    });
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return Promise.reject(new Error(NO_CURRENT_ASSESSMENT_MESSAGE));
      }
      if (url.includes('/geometry')) {
        return Promise.resolve({
          ok: true,
          geometry: {
            artifact_id: 'loc-geom-1',
            provenance: 'user_defined',
            wgs84LngLat: [17.14, 60.67],
            provisioningStatus: 'COMPLETED',
          },
        });
      }
      return Promise.resolve({
        ok: true,
        projectId: 'proj-1',
        siteAnalyses: [
          {
            complianceAnalysis: {},
            executionMotor: {
              admitted: false,
              assessment_status: 'NOT_ASSESSED',
              finding_ids: [],
            },
          },
        ],
        humanInTheLoop: 'Human in the loop',
      });
    });

    render(<LuWorkspace />);
    await user.type(screen.getByTestId('lu-designation'), 'GÄVLE BRYNÄS 1:1');
    await user.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();

    await user.click(screen.getByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(screen.getByTestId('lu-assessment-status')).toHaveTextContent('Ej bedömd');
    expect(screen.getByTestId('lu-assessment-status')).not.toHaveTextContent('LOW');
    expect(screen.getByTestId('lu-assessment-status')).not.toHaveTextContent('MEDIUM');
    expect(screen.getByTestId('lu-assessment-status')).not.toHaveTextContent('HIGH');
    // No governed assessment_artifact_id -- nothing to export.
    expect(screen.queryByTestId('lu-export-pdf')).not.toBeInTheDocument();
  });

  async function renderWithAssessedResult(user: ReturnType<typeof userEvent.setup>) {
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1',
      designation: 'GÄVLE BRYNÄS 1:1',
      municipality: 'Gävle',
      geometry: { type: 'Point', coordinates: [17.14, 60.67] },
      centroid: { lat: 60.67, lng: 17.14 },
    });
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return Promise.reject(new Error(NO_CURRENT_ASSESSMENT_MESSAGE));
      }
      if (url.includes('/geometry')) {
        return Promise.resolve({
          ok: true,
          geometry: { artifact_id: 'loc-geom-1', provenance: 'user_defined', wgs84LngLat: [17.14, 60.67], provisioningStatus: 'COMPLETED' },
        });
      }
      if (url.includes('/export-assessment-pdf')) {
        return Promise.resolve(new Blob(['pdf-bytes'], { type: 'application/pdf' }));
      }
      if (url.includes('/verify-assessment')) {
        return Promise.resolve({ ok: true, outcome: 'PASS', assessmentArtifactId: 'assess-export-abc', mismatches: [] });
      }
      return Promise.resolve({
        ok: true,
        projectId: 'proj-1',
        siteAnalyses: [
          {
            complianceAnalysis: { overallRisk: 'MEDIUM', permitProbability: 0.5 },
            executionMotor: { admitted: true, assessment_artifact_id: 'assess-export-abc', finding_ids: [] },
          },
        ],
        humanInTheLoop: 'Human in the loop',
      });
    });

    render(<LuWorkspace />);
    await user.type(screen.getByTestId('lu-designation'), 'GÄVLE BRYNÄS 1:1');
    await user.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();
    await user.click(screen.getByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
  }

  it('LU-REPORT-EXPORT-UI-V1: clicking export calls the canonical GET endpoint for the current project and triggers a download', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:fake-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await renderWithAssessedResult(user);
    await user.click(screen.getByTestId('lu-export-pdf'));

    expect(callApi).toHaveBeenCalledWith(
      '/api/localization/proj-1/export-assessment-pdf',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    expect(screen.queryByTestId('lu-export-pdf-error')).not.toBeInTheDocument();

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('LU-REPORT-EXPORT-UI-V1: server failure is visible to the user, not silently swallowed', async () => {
    const user = userEvent.setup();
    await renderWithAssessedResult(user);
    callApi.mockImplementationOnce(() => Promise.reject(new Error('Export misslyckades på servern.')));

    await user.click(screen.getByTestId('lu-export-pdf'));
    expect(await screen.findByTestId('lu-export-pdf-error')).toHaveTextContent('Export misslyckades på servern.');
  });

  it('LU-REPORT-EXPORT-UI-V1: duplicate clicks while exporting cannot fire a second request or produce confusing state', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake-url'), revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await renderWithAssessedResult(user);

    let resolveExport: (blob: Blob) => void = () => {};
    callApi.mockImplementationOnce(() => new Promise((resolve) => { resolveExport = resolve; }));
    const callsBeforeExportClicks = callApi.mock.calls.length;

    const button = screen.getByTestId('lu-export-pdf');
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button); // second click while still pending -- must not fire a second request
    expect(callApi.mock.calls.length - callsBeforeExportClicks).toBe(1);

    resolveExport(new Blob(['pdf-bytes'], { type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByTestId('lu-export-pdf')).not.toBeDisabled());

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('LU-ASSESSMENT-PERSISTENCE-READ-V1B: restores a persisted assessment on mount without calling runAssessment(), with identical findings and export available', async () => {
    const user = userEvent.setup();
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1', designation: 'GÄVLE BRYNÄS 1:1', municipality: 'Gävle',
      geometry: { type: 'Point', coordinates: [17.14, 60.67] }, centroid: { lat: 60.67, lng: 17.14 },
    });
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return Promise.resolve({
          ok: true,
          assessmentArtifactId: 'assess-restored-abc',
          findings: [
            { finding_id: 'LU-WATER-001', rule_id: 'LU-WATER-001', rule_version: '1.0', risk_level: 'MEDIUM', explanation: 'Närhet till vatten kräver analys' },
          ],
          systemSummary: 'restored summary',
        });
      }
      if (url.includes('/geometry')) {
        return Promise.resolve({
          ok: true,
          geometry: { artifact_id: 'loc-geom-1', provenance: 'user_defined', wgs84LngLat: [17.14, 60.67], provisioningStatus: 'COMPLETED' },
        });
      }
      throw new Error(`unexpected callApi call in this test: ${url}`);
    });

    render(<LuWorkspace />);
    await user.type(screen.getByTestId('lu-designation'), 'GÄVLE BRYNÄS 1:1');
    await user.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();

    // Proof 1+2: the persisted assessment appears WITHOUT clicking "Kör bedömning" at all.
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith(
      '/api/localization/proj-1/current-assessment',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(callApi).not.toHaveBeenCalledWith('/api/localization/generate-report', expect.anything());

    // Proof 4: restored findings are identical to what the server persisted.
    expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assess-restored-abc');
    expect(screen.getByTestId('lu-finding-LU-WATER-001')).toHaveTextContent('Brunnar');
    expect(screen.getByTestId('lu-finding-technical-LU-WATER-001')).toHaveTextContent('Närhet till vatten kräver analys');

    // Proof 5: export remains available for the restored assessment.
    expect(screen.getByTestId('lu-export-pdf')).toBeInTheDocument();
    expect(screen.getByTestId('lu-export-pdf')).not.toBeDisabled();
  });

  it('LU-ASSESSMENT-PERSISTENCE-READ-V1B, proof 6: no persisted assessment yet -> honest empty state, not an error', async () => {
    const user = userEvent.setup();
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1', designation: 'GÄVLE BRYNÄS 1:1', municipality: 'Gävle',
      geometry: { type: 'Point', coordinates: [17.14, 60.67] }, centroid: { lat: 60.67, lng: 17.14 },
    });
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return Promise.reject(new Error(NO_CURRENT_ASSESSMENT_MESSAGE));
      }
      if (url.includes('/geometry')) {
        return Promise.resolve({
          ok: true,
          geometry: { artifact_id: 'loc-geom-1', provenance: 'user_defined', wgs84LngLat: [17.14, 60.67], provisioningStatus: 'COMPLETED' },
        });
      }
      throw new Error(`unexpected callApi call in this test: ${url}`);
    });

    render(<LuWorkspace />);
    await user.type(screen.getByTestId('lu-designation'), 'GÄVLE BRYNÄS 1:1');
    await user.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();

    expect(await screen.findByTestId('lu-persisted-assessment-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('lu-persisted-assessment-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-results')).not.toBeInTheDocument();
  });

  it('LU-ASSESSMENT-PERSISTENCE-READ-V1B, proofs 7+8: a different current-geometry/binding state never shows the previous assessment, and a genuine error never leaves stale state visible', async () => {
    // The mocked CesiumMapView has no real location-picking capability, so "the user moves to a
    // different localization point" is exercised the way it actually manifests to LuWorkspace: a
    // fresh load (mount) observing a different current-geometry/current-assessment server state --
    // exactly what happens on reopen/refresh for a project whose current point has changed since
    // last viewed. This is proof 8's real mechanism (server-scoped "current"), not a UI gesture.
    const user1 = userEvent.setup();
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1', designation: 'GÄVLE BRYNÄS 1:1', municipality: 'Gävle',
      geometry: { type: 'Point', coordinates: [17.14, 60.67] }, centroid: { lat: 60.67, lng: 17.14 },
    });
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return Promise.resolve({
          ok: true,
          assessmentArtifactId: 'assess-for-point-A',
          findings: [{ finding_id: 'LU-WATER-001', rule_id: 'LU-WATER-001', rule_version: '1.0', risk_level: 'MEDIUM', explanation: 'A' }],
          systemSummary: 'point A summary',
        });
      }
      if (url.includes('/geometry')) {
        return Promise.resolve({
          ok: true,
          geometry: { artifact_id: 'loc-geom-A', provenance: 'user_defined', wgs84LngLat: [17.14, 60.67], provisioningStatus: 'COMPLETED' },
        });
      }
      throw new Error(`unexpected callApi call in this test: ${url}`);
    });

    const first = render(<LuWorkspace />);
    await user1.type(screen.getByTestId('lu-designation'), 'GÄVLE BRYNÄS 1:1');
    await user1.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assess-for-point-A');
    first.unmount();

    // Now the project's current point/binding has moved on (point B) and its current-assessment
    // lookup fails verification -- a realistic "current state changed since last viewed" case.
    callApi.mockReset();
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return Promise.reject(new Error('Governed LU assessment failed tamper verification.'));
      }
      if (url.includes('/geometry')) {
        return Promise.resolve({
          ok: true,
          geometry: { artifact_id: 'loc-geom-B', provenance: 'user_defined', wgs84LngLat: [17.20, 60.70], provisioningStatus: 'COMPLETED' },
        });
      }
      throw new Error(`unexpected callApi call in this test: ${url}`);
    });

    const user2 = userEvent.setup();
    render(<LuWorkspace />);
    await user2.type(screen.getByTestId('lu-designation'), 'GÄVLE BRYNÄS 1:1');
    await user2.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();

    // Proof 7+8: point A's assessment never appears in this fresh instance -- there is no stale
    // carryover, and the genuine error surfaces honestly instead of falling back to anything.
    expect(screen.queryByTestId('lu-results')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-assessment-id')).not.toBeInTheDocument();
    expect(await screen.findByTestId('lu-persisted-assessment-error')).toHaveTextContent(
      'Governed LU assessment failed tamper verification.',
    );
  });

  it('LU-REEXECUTION-VERIFY-UI-V1, proofs 1+2+11: clicking Verifiera calls the canonical endpoint and shows the identical-result message; assessment stays visible', async () => {
    const user = userEvent.setup();
    await renderWithAssessedResult(user);

    await user.click(screen.getByTestId('lu-verify-assessment'));

    expect(callApi).toHaveBeenCalledWith(
      '/api/localization/proj-1/verify-assessment',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByTestId('lu-verify-result-pass')).toHaveTextContent(
      'Bedömningen har verifierats genom deterministisk återexekvering. Resultatet är identiskt.',
    );
    // Proof 11: the assessment itself remains visible after verification.
    expect(screen.getByTestId('lu-results')).toBeInTheDocument();
    expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assess-export-abc');
  });

  it('LU-REEXECUTION-VERIFY-UI-V1, proof 3: a mismatch/DENY result is shown as a failure, never as success', async () => {
    const user = userEvent.setup();
    await renderWithAssessedResult(user);
    callApi.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        outcome: 'DENY',
        assessmentArtifactId: 'assess-export-abc',
        mismatches: [{ code: 'FINDINGS_MISMATCH', detail: 're-executed findings do not match' }],
      }),
    );

    await user.click(screen.getByTestId('lu-verify-assessment'));

    expect(await screen.findByTestId('lu-verify-result-mismatch')).toHaveTextContent('FINDINGS_MISMATCH');
    expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();
  });

  it('LU-REEXECUTION-VERIFY-UI-V1, proof 8: server/network failure during verification is visible, not silently swallowed', async () => {
    const user = userEvent.setup();
    await renderWithAssessedResult(user);
    callApi.mockImplementationOnce(() => Promise.reject(new Error('Verifiering misslyckades på servern.')));

    await user.click(screen.getByTestId('lu-verify-assessment'));
    expect(await screen.findByTestId('lu-verify-error')).toHaveTextContent('Verifiering misslyckades på servern.');
    expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();
  });

  it('LU-REEXECUTION-VERIFY-UI-V1, proof 7: duplicate clicks while verifying cannot fire a second request', async () => {
    const user = userEvent.setup();
    await renderWithAssessedResult(user);

    let resolveVerify: (value: unknown) => void = () => {};
    callApi.mockImplementationOnce(() => new Promise((resolve) => { resolveVerify = resolve; }));
    const callsBeforeVerifyClicks = callApi.mock.calls.length;

    const button = screen.getByTestId('lu-verify-assessment');
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button); // second click while still pending -- must not fire a second request
    expect(callApi.mock.calls.length - callsBeforeVerifyClicks).toBe(1);

    resolveVerify({ ok: true, outcome: 'PASS', assessmentArtifactId: 'assess-export-abc', mismatches: [] });
    await waitFor(() => expect(screen.getByTestId('lu-verify-assessment')).not.toBeDisabled());
  });

  it('LU-REEXECUTION-VERIFY-UI-V1, proof 6: a restored (Unit 5B) persisted assessment can be verified without running a new assessment first', async () => {
    const user = userEvent.setup();
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1', designation: 'GÄVLE BRYNÄS 1:1', municipality: 'Gävle',
      geometry: { type: 'Point', coordinates: [17.14, 60.67] }, centroid: { lat: 60.67, lng: 17.14 },
    });
    callApi.mockImplementation((url: string) => {
      if (url.includes('/verify-assessment')) {
        return Promise.resolve({ ok: true, outcome: 'PASS', assessmentArtifactId: 'assess-restored-verify', mismatches: [] });
      }
      if (url.includes('/current-assessment')) {
        return Promise.resolve({
          ok: true,
          assessmentArtifactId: 'assess-restored-verify',
          findings: [{ finding_id: 'LU-WATER-001', rule_id: 'LU-WATER-001', rule_version: '1.0', risk_level: 'MEDIUM', explanation: 'Restored finding' }],
          systemSummary: 'restored summary',
        });
      }
      if (url.includes('/geometry')) {
        return Promise.resolve({
          ok: true,
          geometry: { artifact_id: 'loc-geom-1', provenance: 'user_defined', wgs84LngLat: [17.14, 60.67], provisioningStatus: 'COMPLETED' },
        });
      }
      throw new Error(`unexpected callApi call in this test: ${url}`);
    });

    render(<LuWorkspace />);
    await user.type(screen.getByTestId('lu-designation'), 'GÄVLE BRYNÄS 1:1');
    await user.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(callApi).not.toHaveBeenCalledWith('/api/localization/generate-report', expect.anything());

    await user.click(screen.getByTestId('lu-verify-assessment'));
    expect(await screen.findByTestId('lu-verify-result-pass')).toBeInTheDocument();
    expect(callApi).not.toHaveBeenCalledWith('/api/localization/generate-report', expect.anything());
  });

  // ---------------------------------------------------------------------------------------------
  // DEMO M2a items 2, 3, 5: governed-only result, control panel, evidence panel.
  // "Visa på karta" is replaced by "Visa underlag": every governed spatial evidence feature has
  // geometry:null (frozen semantics), so there is nothing on the map to fly to; the underlag is
  // shown in the evidence panel instead. Selection is client-side only and never queries anything.
  // ---------------------------------------------------------------------------------------------

  const GOVERNED_FINDINGS = [
    {
      finding_id: 'finding-water-1',
      rule_id: 'LU-WATER-001',
      rule_version: '2.0',
      risk_level: 'MEDIUM',
      explanation: 'Närhet till vatten kräver analys',
      evidence_refs: [{ artifact_id: 'evidence-water-test', artifact_type: 'SPATIAL_EVIDENCE' }],
    },
    {
      finding_id: 'finding-ebh-1',
      rule_id: 'LU-EBH-001',
      rule_version: '2.0',
      risk_level: 'HIGH',
      explanation: 'Potentiellt förorenat område inom sökradie',
      evidence_refs: [{ artifact_id: 'evidence-ebh-test', artifact_type: 'SPATIAL_EVIDENCE' }],
    },
  ];
  const FIVE_LAYERS = viewerEvidence([
    { layer: 'water', exists: true, count: 50 },
    { layer: 'ebh', exists: true, count: 1 },
    { layer: 'protected_area', exists: false, count: 0 },
    { layer: 'natura2000', exists: false, count: 0 },
    { layer: 'water_protection_area', exists: false, count: 0 },
  ]);

  function mockGovernedApi(opts: { persisted: boolean; evidence?: unknown }) {
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1', designation: 'UPPSALA SVIA 1:111', municipality: 'Uppsala',
      geometry: { type: 'Point', coordinates: [17.74, 59.87] }, centroid: { lat: 59.87, lng: 17.74 },
    });
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return opts.persisted
          ? Promise.resolve({ ok: true, assessmentArtifactId: 'assessment-governed-1', findings: GOVERNED_FINDINGS, systemSummary: 's' })
          : Promise.reject(new Error(NO_CURRENT_ASSESSMENT_MESSAGE));
      }
      if (url.includes('/viewer/evidence')) return Promise.resolve(opts.evidence ?? FIVE_LAYERS);
      if (url.includes('/geometry')) {
        return Promise.resolve({
          ok: true,
          geometry: { artifact_id: 'loc-geom-1', provenance: 'derived_from_property_boundary', wgs84LngLat: [17.74, 59.87], provisioningStatus: 'COMPLETED' },
        });
      }
      if (url.includes('/verify-assessment')) {
        return Promise.resolve({ ok: true, outcome: 'PASS', assessmentArtifactId: 'assessment-governed-1', mismatches: [] });
      }
      if (url.includes('/generate-report')) {
        // The real fresh-run payload carries legacy blocks next to the governed motor.
        return Promise.resolve({
          ok: true,
          projectId: 'proj-1',
          siteAnalyses: [
            {
              complianceAnalysis: { overallRisk: 'HIGH', permitProbability: 0.2 },
              dataSources: [{ source: 'PostGIS spatial', status: 'unavailable', detail: 'column "nvr_id" does not exist' }],
              warnings: ['VISS_API_KEY saknas i .env', 'Skyddad natur kunde inte verifieras i lokal databas'],
              executionMotor: {
                admitted: true,
                assessment_status: 'ASSESSED',
                assessment_artifact_id: 'assessment-governed-1',
                attempt_id: 'attempt-x',
                manifest_id: 'manifest-x',
                property_context_id: 'lu_property_context-x',
                // Fresh order differs from the persisted order on purpose.
                findings: [GOVERNED_FINDINGS[0], GOVERNED_FINDINGS[1]],
                governed_layer_checks: [{ layer: 'water', rule_id: 'LU-WATER-001', status: 'CHECKED_HIT' }],
              },
            },
          ],
          humanInTheLoop: 'Human in the loop',
        });
      }
      throw new Error(`unexpected callApi call in this test: ${url}`);
    });
  }

  async function openWorkspace(user: ReturnType<typeof userEvent.setup>) {
    render(<LuWorkspace />);
    await user.type(screen.getByTestId('lu-designation'), 'UPPSALA SVIA 1:111');
    await user.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();
  }

  /** What a viewer sees of the governed result and the six checks (ids excluded on purpose). */
  async function governedSnapshot() {
    await screen.findByText('1 objekt inom sökradien 500 m.');
    const results = screen.getByTestId('lu-results').textContent ?? '';
    const panel = screen.getByTestId('lu-control-panel').textContent ?? '';
    return { results, panel };
  }

  it('DEMO M2a item 2: a fresh run and a reopen of the same assessment render the SAME governed content, with no legacy text', async () => {
    const user1 = userEvent.setup();
    mockGovernedApi({ persisted: false });
    const fresh = render(<LuWorkspace />);
    await user1.type(screen.getByTestId('lu-designation'), 'UPPSALA SVIA 1:111');
    await user1.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-persisted-assessment-not-found')).toBeInTheDocument();
    await user1.click(screen.getByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    const freshView = await governedSnapshot();
    // (the governed finding level may appear inside the collapsed technical section; the legacy
    // 'Risk: HIGH' overallRisk line must not appear anywhere)
    for (const legacy of [/Risk/, /nvr_id/, /VISS_API_KEY/, /kunde inte verifieras/, /Human in the loop/, /attempt-x/, /manifest-x/, /lu_property_context-x/]) {
      expect(freshView.results).not.toMatch(legacy);
      expect(freshView.panel).not.toMatch(legacy);
    }
    fresh.unmount();

    callApi.mockReset();
    const user2 = userEvent.setup();
    mockGovernedApi({ persisted: true });
    await openWorkspace(user2);
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    const reopenView = await governedSnapshot();
    expect(callApi).not.toHaveBeenCalledWith('/api/localization/generate-report', expect.anything());

    expect(reopenView).toEqual(freshView);
    expect(reopenView.results).toContain('Bedömd');
    expect(reopenView.panel).toContain('minst 50 objekt (räkningen stannar vid 50) inom sökradien 500 m.');
  });

  it('DEMO M2a item 3: before any assessment exists all five layers read "Inte kontrollerat" and no evidence is fetched', async () => {
    const user = userEvent.setup();
    mockGovernedApi({ persisted: false });
    await openWorkspace(user);
    expect(await screen.findByTestId('lu-persisted-assessment-not-found')).toBeInTheDocument();
    for (const key of ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area']) {
      expect(screen.getByTestId(`lu-check-${key}`)).toHaveAttribute('data-state', 'NOT_CHECKED');
      expect(screen.getByTestId(`lu-check-${key}`)).not.toHaveTextContent(/ingen träff/i);
    }
    expect(screen.getByTestId('lu-check-property')).toHaveTextContent('beräknad mittpunkt av fastigheten (ej inmätt)');
    expect(callApi).not.toHaveBeenCalledWith(expect.stringContaining('/viewer/evidence'), expect.anything());
  });

  it('DEMO M2a item 5: "Visa underlag" opens the evidence panel with result, count, radius, method, version, status and retrieved_at -- no network call', async () => {
    const user = userEvent.setup();
    mockGovernedApi({ persisted: true });
    await openWorkspace(user);
    await screen.findByText('1 objekt inom sökradien 500 m.');
    const callsBefore = callApi.mock.calls.length;

    await user.click(screen.getByTestId('lu-finding-show-evidence-finding-ebh-1'));
    const details = screen.getByTestId('lu-check-details');
    expect(details).toHaveTextContent('Potentiellt förorenade områden (EBH)');
    expect(screen.getByTestId('lu-check-detail-Resultat')).toHaveTextContent('Träff');
    expect(screen.getByTestId('lu-check-detail-Antal')).toHaveTextContent('1 objekt');
    expect(screen.getByTestId('lu-check-detail-Sökradie')).toHaveTextContent('500 m (sökradie – inte ett uppmätt avstånd)');
    expect(screen.getByTestId('lu-check-detail-Metod')).toHaveTextContent('Förekomst inom sökradie (PostGIS)');
    expect(screen.getByTestId('lu-check-detail-Datasetversion')).toHaveTextContent('02fccffc…');
    expect(screen.getByTestId('lu-check-detail-Status')).toHaveTextContent('Verifierad observation');
    expect(screen.getByTestId('lu-check-detail-Hämtad')).toHaveTextContent('Saknas i underlaget');
    expect(details).toHaveTextContent('Kräver uppmärksamhet: Potentiellt förorenat område finns inom sökradien.');
    expect(screen.getByTestId('lu-check-technical')).not.toHaveAttribute('open');
    expect(callApi.mock.calls.length).toBe(callsBefore);
  });

  it('DEMO M2a item 5: a checked no-hit layer and a missing layer are distinguishable in the evidence panel', async () => {
    const user = userEvent.setup();
    mockGovernedApi({ persisted: true, evidence: viewerEvidence([{ layer: 'ebh', exists: true, count: 1 }, { layer: 'natura2000', exists: false, count: 0 }]) });
    await openWorkspace(user);
    await screen.findByText('1 objekt inom sökradien 500 m.');

    await user.click(screen.getByTestId('lu-check-select-natura2000'));
    expect(screen.getByTestId('lu-check-details')).toHaveTextContent('Kontrollerat – ingen träff');
    expect(screen.getByTestId('lu-check-detail-Resultat')).toHaveTextContent('Ingen träff');

    await user.click(screen.getByTestId('lu-check-select-water'));
    expect(screen.getByTestId('lu-check-details')).toHaveTextContent('Inte kontrollerat');
    expect(screen.getByTestId('lu-check-detail-Resultat')).toHaveTextContent('Ej kontrollerad');
  });

  it('DEMO M2a: a map click on governed evidence selects the same check; verification state is unaffected by selection', async () => {
    const user = userEvent.setup();
    mockGovernedApi({ persisted: true });
    await openWorkspace(user);
    await screen.findByText('1 objekt inom sökradien 500 m.');

    await user.click(screen.getByTestId('lu-verify-assessment'));
    expect(await screen.findByTestId('lu-verify-result-pass')).toBeInTheDocument();
    await user.click(screen.getByTestId('mock-trigger-evidence-found')); // the mock reports layer_id 'water'
    expect(screen.getByTestId('lu-check-details')).toHaveTextContent('Brunnar');
    expect(screen.getByTestId('lu-verify-result-pass')).toBeInTheDocument();
    expect(lastCesiumMapViewProps.evidenceMode).toBe('live');
  });

  it('DEMO M2a: a finding with no spatial evidence (e.g. document-only) exposes no "Visa underlag" action', async () => {
    const user = userEvent.setup();
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1', designation: 'GÄVLE BRYNÄS 1:1', municipality: 'Gävle',
      geometry: { type: 'Point', coordinates: [17.14, 60.67] }, centroid: { lat: 60.67, lng: 17.14 },
    });
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return Promise.resolve({
          ok: true,
          assessmentArtifactId: 'assess-doc-only',
          findings: [
            {
              finding_id: 'LU-DOC-BESLUT-001', rule_id: 'LU-DOC-BESLUT-001', risk_level: 'MEDIUM',
              explanation: 'Tidigare beslut föreligger', evidence_refs: [{ artifact_id: 'doc-evidence-1', artifact_type: 'DOCUMENT_EVIDENCE' }],
            },
          ],
          systemSummary: 's',
        });
      }
      if (url.includes('/viewer/evidence')) return Promise.resolve(viewerEvidence([]));
      if (url.includes('/geometry')) {
        return Promise.resolve({
          ok: true,
          geometry: { artifact_id: 'loc-geom-1', provenance: 'user_defined', wgs84LngLat: [17.14, 60.67], provisioningStatus: 'COMPLETED' },
        });
      }
      throw new Error(`unexpected callApi call in this test: ${url}`);
    });
    render(<LuWorkspace />);
    await user.type(screen.getByTestId('lu-designation'), 'GÄVLE BRYNÄS 1:1');
    await user.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(screen.getByTestId('lu-finding-LU-DOC-BESLUT-001')).toHaveTextContent('Tidigare beslut föreligger');
    expect(screen.queryByTestId('lu-finding-show-evidence-LU-DOC-BESLUT-001')).not.toBeInTheDocument();
  });

  it('DEMO M2a: a fail-closed run shows the governed Swedish reason and no assessment, never a risk word', async () => {
    const user = userEvent.setup();
    mockGovernedApi({ persisted: false });
    const base = callApi.getMockImplementation()!;
    callApi.mockImplementation((url: string, opts: unknown) => {
      if (url.includes('/generate-report')) {
        return Promise.resolve({
          ok: true,
          siteAnalyses: [
            {
              complianceAnalysis: {},
              executionMotor: {
                admitted: false,
                assessment_status: 'GOVERNANCE_DENIED',
                findings: [],
                localization_geometry: { status: 'FAILED_CLOSED', message_sv: 'Lokaliseringen är tvetydig. Ingen bedömning görs.' },
              },
            },
          ],
        });
      }
      return base(url, opts);
    });
    await openWorkspace(user);
    await user.click(await screen.findByTestId('lu-run'));
    expect(await screen.findByTestId('lu-assessment-status')).toHaveTextContent('Ej bedömd – nekad av styrning');
    expect(screen.getByTestId('lu-assessment-status-message')).toHaveTextContent('Lokaliseringen är tvetydig. Ingen bedömning görs.');
    expect(screen.queryByTestId('lu-export-pdf')).not.toBeInTheDocument();
    expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'NOT_CHECKED');
  });

  it('DEMO M2a item 7: progress steps come from real state -- the run step is active only while the request is in flight', async () => {
    const user = userEvent.setup();
    mockGovernedApi({ persisted: false });
    const base = callApi.getMockImplementation()!;
    let resolveRun: (v: unknown) => void = () => {};
    callApi.mockImplementation((url: string, opts: unknown) => {
      if (url.includes('/generate-report')) return new Promise((resolve) => { resolveRun = resolve; });
      return base(url, opts);
    });
    await openWorkspace(user);
    expect(screen.queryByTestId('lu-progress')).not.toBeInTheDocument();
    await user.click(await screen.findByTestId('lu-run'));
    expect(screen.getByTestId('lu-progress-run')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('lu-progress-prepare')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('lu-progress-evidence')).toHaveAttribute('data-state', 'pending');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    resolveRun(await base('/api/localization/generate-report', {}));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('lu-progress')).not.toBeInTheDocument());
  });
});
