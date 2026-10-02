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

// DEMO M2c: each layer's real dataset version (= source_sha256 in LAYER-ID-CONTRACTS-V1.md), as the
// captured live payload carries it.
const LAYER_VERSION: Record<string, string> = {
  water: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc',
  ebh: '02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186',
  protected_area: '983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae',
  natura2000: 'a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02',
  water_protection_area: 'ba6fdd88fa478d9b930a41153d03b84a34b086de8d6c5aa0f6b63c0b4dd6ff18',
};

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
        version: LAYER_VERSION[layer] ?? '0'.repeat(64),
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

// CesiumAdapter/real Cesium cannot run in jsdom (WebGL), matching this codebase's existing
// precedent of mocking CesiumMapView out entirely in component tests. The mock captures the latest
// props so tests can assert the wiring contract between LuWorkspace and the map (DEMO M2b: the map
// gets the workspace's own governed evidence via `productEvidence`, it never fetches), and exposes
// a test-only trigger to simulate a click a real CesiumAdapter would call back with.
let lastCesiumMapViewProps: any = null;
vi.mock('../../components/CesiumMapView', () => ({
  default: (props: any) => {
    lastCesiumMapViewProps = props;
    return (
      <div data-testid="cesium-map-view">
        <button
          type="button"
          data-testid="mock-trigger-evidence-found"
          onClick={() => props.onEvidenceClick?.({ cas_artifact_id: 'evidence-water-test', layer_id: 'water' })}
        />
      </div>
    );
  },
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
    // DEMO M2b item 2: a fresh run is rendered through the same read-back a reopen uses, so the
    // server's current-assessment returns the run's assessment once the run has happened.
    let ran = false;
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return ran
          ? Promise.resolve({
              ok: true,
              assessmentArtifactId: 'assess-site-1-abc',
              findings: [{ finding_id: 'LU-WATER-001', rule_id: 'LU-WATER-001', risk_level: 'MEDIUM', explanation: 'Närhet till vatten kräver analys' }],
              evidenceRefs: [
                { artifact_id: 'evidence-water-test', artifact_type: 'SPATIAL_EVIDENCE' },
                { artifact_id: 'evidence-ebh-test', artifact_type: 'SPATIAL_EVIDENCE' },
              ],
              systemSummary: 's',
            })
          : Promise.reject(new Error(NO_CURRENT_ASSESSMENT_MESSAGE));
      }
      if (url.includes('/generate-report')) ran = true;
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
    expect(screen.getByTestId('lu-check-state-water')).toHaveTextContent('Kontrollerat – träff');
    expect(screen.getByTestId('lu-check-ebh')).toHaveAttribute('data-state', 'NO_HIT');
    expect(screen.getByTestId('lu-check-state-ebh')).toHaveTextContent('Kontrollerat – ingen registrerad träff');
    // Preservation requirement: a negative register result is explained under the row.
    expect(screen.getByTestId('lu-check-register-note-ebh')).toHaveTextContent(
      'Register: inget registrerat objekt inom 500 m i lagret Potentiellt förorenade områden (EBH). Det är en registerkontroll, inte en markundersökning',
    );
    // DEMO M2c item 3: the internal dataset id is not in the main text.
    expect(screen.getByTestId('lu-check-register-note-ebh')).not.toHaveTextContent('(dataset');
    expect(screen.queryByTestId('lu-check-register-note-water')).not.toBeInTheDocument();
    expect(screen.getByTestId('lu-control-out-of-scope')).toHaveTextContent('Inte bedömt: hydrologisk koppling (spridningsväg).');
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
    // DEMO M2c item 3: the run's own outcome is its own notice; "lu-results" is only ever an assessment.
    expect(await screen.findByTestId('lu-run-outcome')).toBeInTheDocument();
    expect(screen.getByTestId('lu-run-outcome-status')).toHaveTextContent('Ej bedömd');
    expect(screen.getByTestId('lu-run-outcome-status')).not.toHaveTextContent('LOW');
    expect(screen.getByTestId('lu-run-outcome-status')).not.toHaveTextContent('MEDIUM');
    expect(screen.getByTestId('lu-run-outcome-status')).not.toHaveTextContent('HIGH');
    expect(await screen.findByTestId('lu-persisted-assessment-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('lu-results')).not.toBeInTheDocument();
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
    // DEMO M2b item 2: once the run has happened, the server's current assessment is the run's own.
    let ran = false;
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return ran
          ? Promise.resolve({ ok: true, assessmentArtifactId: 'assess-export-abc', findings: [], evidenceRefs: [], systemSummary: 's' })
          : Promise.reject(new Error(NO_CURRENT_ASSESSMENT_MESSAGE));
      }
      if (url.includes('/viewer/evidence')) return Promise.resolve(viewerEvidence([]));
      if (url.includes('/generate-report')) ran = true;
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

  it('LU-REPORT-EXPORT-UI-V1: server failure is visible to the user, not silently swallowed (DEMO M2b: in plain Swedish)', async () => {
    const user = userEvent.setup();
    await renderWithAssessedResult(user);
    const base = callApi.getMockImplementation()!;
    callApi.mockImplementation((url: string, o: unknown) =>
      url.includes('/export-assessment-pdf')
        ? Promise.reject(Object.assign(new Error('Export misslyckades på servern.'), { status: 500 }))
        : base(url, o),
    );

    await user.click(screen.getByTestId('lu-export-pdf'));
    expect(await screen.findByTestId('lu-export-pdf-error-message')).toHaveTextContent(
      'Rapporten kunde inte exporteras. Ett tekniskt fel uppstod på servern.',
    );
    expect(screen.getByTestId('lu-export-pdf-error-technical')).toHaveTextContent('Export misslyckades på servern.');
  });

  it('LU-REPORT-EXPORT-UI-V1: duplicate clicks while exporting cannot fire a second request or produce confusing state', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake-url'), revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await renderWithAssessedResult(user);

    let resolveExport: (blob: Blob) => void = () => {};
    const base = callApi.getMockImplementation()!;
    callApi.mockImplementation((url: string, o: unknown) =>
      url.includes('/export-assessment-pdf') ? new Promise((resolve) => { resolveExport = resolve; }) : base(url, o),
    );
    const exportCalls = () => callApi.mock.calls.filter(([url]) => String(url).includes('/export-assessment-pdf')).length;

    const button = screen.getByTestId('lu-export-pdf');
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button); // second click while still pending -- must not fire a second request
    await waitFor(() => expect(exportCalls()).toBe(1));
    expect(exportCalls()).toBe(1);

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
    // DEMO M2b item 3: in plain Swedish; the server's own text only in the collapsed technical part.
    expect(screen.queryByTestId('lu-results')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-assessment-id')).not.toBeInTheDocument();
    expect(await screen.findByTestId('lu-persisted-assessment-error-message')).toHaveTextContent(
      'Den sparade bedömningen klarade inte integritetskontrollen.',
    );
    expect(screen.getByTestId('lu-persisted-assessment-error-message')).not.toHaveTextContent('Governed');
    expect(screen.getByTestId('lu-persisted-assessment-error-technical')).toHaveTextContent(
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
    expect(screen.getByTestId('lu-verify-result-mismatch-summary')).toHaveTextContent('Verifieringen hittade 1 avvikelse');
    expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();
  });

  it('LU-REEXECUTION-VERIFY-UI-V1, proof 8: server/network failure during verification is visible, not silently swallowed', async () => {
    const user = userEvent.setup();
    await renderWithAssessedResult(user);
    callApi.mockImplementationOnce(() => Promise.reject(new Error('Verifiering misslyckades på servern.')));

    await user.click(screen.getByTestId('lu-verify-assessment'));
    // DEMO M2b item 3: plain Swedish; the raw text stays in the collapsed technical section.
    expect(await screen.findByTestId('lu-verify-error-message')).toHaveTextContent('Verifieringen kunde inte genomföras.');
    expect(screen.getByTestId('lu-verify-error-technical')).toHaveTextContent('Verifiering misslyckades på servern.');
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

  const FIVE_LAYER_REFS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'].map((layer) => ({
    artifact_id: `evidence-${layer}-test`,
    artifact_type: 'SPATIAL_EVIDENCE',
  }));

  function mockGovernedApi(opts: { persisted: boolean; evidence?: unknown; evidenceRefs?: unknown[] }) {
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1', designation: 'UPPSALA SVIA 1:111', municipality: 'Uppsala',
      geometry: { type: 'Point', coordinates: [17.74, 59.87] }, centroid: { lat: 59.87, lng: 17.74 },
    });
    // DEMO M2b item 2: the server's current assessment is the persisted one, or -- once a run has
    // happened -- the run's own (a fresh run is rendered through this same read-back).
    let ran = false;
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return opts.persisted || ran
          ? Promise.resolve({
              ok: true,
              assessmentArtifactId: 'assessment-governed-1',
              findings: GOVERNED_FINDINGS,
              evidenceRefs: opts.evidenceRefs ?? FIVE_LAYER_REFS,
              systemSummary: 's',
              // DEMO M2c item 2: the point this assessment was made for (= the displayed one here).
              localizationGeometry: { artifact_id: 'loc-geom-1', provenance: 'derived_from_property_boundary', provenance_label_sv: 'x' },
            })
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
        ran = true;
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

    // DEMO M2b item 2: the fresh run is rendered through the same read-back, so the two are identical.
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
      expect(screen.getByTestId(`lu-check-${key}`)).not.toHaveTextContent(/ingen (registrerad )?träff/i);
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
    // DEMO M2b: retrieved_at exists in the CAS evidence but the viewer projection does not carry it.
    expect(screen.getByTestId('lu-check-detail-Hämtad')).toHaveTextContent('Skickas inte med i kontrollresultatet');
    expect(details).toHaveTextContent('Kräver uppmärksamhet: Potentiellt förorenat område finns inom sökradien.');
    expect(screen.getByTestId('lu-check-technical')).not.toHaveAttribute('open');
    expect(callApi.mock.calls.length).toBe(callsBefore);
  });

  it('DEMO M2a item 5: a checked no-hit layer and a missing layer are distinguishable in the evidence panel', async () => {
    const user = userEvent.setup();
    mockGovernedApi({
      persisted: true,
      evidence: viewerEvidence([{ layer: 'ebh', exists: true, count: 1 }, { layer: 'natura2000', exists: false, count: 0 }]),
      evidenceRefs: [
        { artifact_id: 'evidence-ebh-test', artifact_type: 'SPATIAL_EVIDENCE' },
        { artifact_id: 'evidence-natura2000-test', artifact_type: 'SPATIAL_EVIDENCE' },
      ],
    });
    await openWorkspace(user);
    await screen.findByText('1 objekt inom sökradien 500 m.');

    await user.click(screen.getByTestId('lu-check-select-natura2000'));
    expect(screen.getByTestId('lu-check-details')).toHaveTextContent('Kontrollerat – ingen registrerad träff');
    expect(screen.getByTestId('lu-check-detail-Resultat')).toHaveTextContent('Ingen registrerad träff');

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
    // Item 4: governed product map -- no fixture controls, radius ring from governed distance_meters.
    // DEMO M2b: the map renders the workspace's own (binding-checked) evidence; it gets no project
    // id to fetch with and no fixture mode.
    expect(lastCesiumMapViewProps.productMode).toBe(true);
    expect(lastCesiumMapViewProps.productEvidence.status).toBe('loaded');
    expect(lastCesiumMapViewProps.productEvidence.geojson.features).toHaveLength(5);
    expect(lastCesiumMapViewProps.projectId).toBeUndefined();
    expect(lastCesiumMapViewProps.evidenceMode).toBeUndefined();
    expect(lastCesiumMapViewProps.searchRadiusMeters).toBe(500);
    expect(lastCesiumMapViewProps.currentLocationLabel).toBe('Kontrollpunkt: beräknad mittpunkt av fastigheten (ej inmätt)');
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
    expect(await screen.findByTestId('lu-run-outcome-status')).toHaveTextContent('Ej bedömd – nekad av styrning');
    expect(screen.getByTestId('lu-run-outcome-message')).toHaveTextContent('Lokaliseringen är tvetydig. Ingen bedömning görs.');
    expect(screen.queryByTestId('lu-export-pdf')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'NOT_CHECKED'));
    expect(screen.getByTestId('lu-check-water')).toHaveTextContent('Den senaste körningen gav ingen bedömning – kontrollen är inte gjord.');
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

// -------------------------------------------------------------------------------------------------
// DEMO M2b: verifier findings 1 (technical error as its own state), 2 (one displayed assessment
// id binds panel, map, verify and export), 3 (no raw English server text), 5 (extra server layers).
// Fully mocked: no network, no database. Errors carry the structured fields coreApiClient attaches.
// -------------------------------------------------------------------------------------------------

const LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'] as const;
const RULE_BY_LAYER: Record<(typeof LAYERS)[number], string> = {
  water: 'LU-WATER-001',
  ebh: 'LU-EBH-001',
  protected_area: 'LU-PROTECTED-001',
  natura2000: 'LU-NATURA2000-001',
  water_protection_area: 'LU-WATERPROTECTION-001',
};
const FIVE_FINDINGS = LAYERS.map((layer) => ({
  finding_id: `finding-${layer}`,
  rule_id: RULE_BY_LAYER[layer],
  rule_version: '2.0',
  risk_level: 'MEDIUM',
  explanation: `engine text ${layer}`,
  evidence_refs: [{ artifact_id: `evidence-${layer}-test`, artifact_type: 'SPATIAL_EVIDENCE' }],
}));
const FIVE_SPATIAL_REFS = LAYERS.map((layer) => ({ artifact_id: `evidence-${layer}-test`, artifact_type: 'SPATIAL_EVIDENCE' }));
const FIVE_HIT = viewerEvidence(LAYERS.map((layer) => ({ layer, exists: true, count: 1 })));

function apiError(status: number, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

type M2bOptions = {
  /** What GET current-assessment returns, per call index (0-based); 'missing' = the server's 404. */
  currentAssessment: (call: number, ran: boolean) => unknown | 'missing' | Error;
  evidence?: (call: number) => unknown | Error;
  run?: () => unknown | Error;
  verify?: () => unknown;
};

function mockM2b(opts: M2bOptions) {
  fetchPropertyInfo.mockResolvedValue({
    id: 'p1', designation: 'UPPSALA SVIA 1:111', municipality: 'Uppsala',
    geometry: { type: 'Polygon', coordinates: [[[17.73, 59.87], [17.75, 59.87], [17.75, 59.88], [17.73, 59.87]]] },
    centroid: { lat: 59.87, lng: 17.74 },
  });
  let ran = false;
  let assessmentCalls = 0;
  let evidenceCalls = 0;
  callApi.mockImplementation((url: string) => {
    if (url.includes('/current-assessment')) {
      const value = opts.currentAssessment(assessmentCalls++, ran);
      if (value === 'missing') return Promise.reject(apiError(404, NO_CURRENT_ASSESSMENT_MESSAGE));
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (url.includes('/viewer/evidence')) {
      const value = opts.evidence ? opts.evidence(evidenceCalls++) : FIVE_HIT;
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (url.includes('/geometry')) {
      return Promise.resolve({
        ok: true,
        geometry: { artifact_id: 'loc-geom-1', provenance: 'derived_from_property_boundary', wgs84LngLat: [17.74, 59.87], provisioningStatus: 'COMPLETED' },
      });
    }
    if (url.includes('/generate-report')) {
      ran = true;
      const value = opts.run?.();
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (url.includes('/verify-assessment')) return Promise.resolve(opts.verify?.());
    if (url.includes('/export-assessment-pdf')) return Promise.resolve(new Blob(['pdf'], { type: 'application/pdf' }));
    throw new Error(`unexpected callApi call in this test: ${url}`);
  });
}

/** The read-back's own bound point (server: localizationOrchestrator resolveCurrentLuAssessmentSummary). */
const assessedPoint = (artifactId: string) => ({
  artifact_id: artifactId,
  provenance: 'derived_from_property_boundary',
  provenance_label_sv: 'Härledd från fastighetens centrumpunkt (ingen lokaliseringspunkt har angetts för projektet)',
});

const persisted = (id: string, findings: unknown[] = FIVE_FINDINGS, evidenceRefs: unknown[] = FIVE_SPATIAL_REFS) => ({
  ok: true,
  assessmentArtifactId: id,
  findings,
  evidenceRefs,
  systemSummary: 's',
  localizationGeometry: assessedPoint('loc-geom-1'),
});

const runReport = (motor: Record<string, unknown>) => ({
  ok: true,
  siteAnalyses: [{ complianceAnalysis: { overallRisk: 'HIGH' }, executionMotor: { admitted: true, assessment_status: 'ASSESSED', ...motor } }],
});

async function openM2b(user: ReturnType<typeof userEvent.setup>) {
  render(<LuWorkspace />);
  await user.type(screen.getByTestId('lu-designation'), 'UPPSALA SVIA 1:111');
  await user.click(screen.getByTestId('lu-lookup'));
  expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();
}

describe('LuWorkspace DEMO M2b', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastCesiumMapViewProps = null;
  });

  it('item 1: a viewer-capability failure is "Tekniskt fel" on all five layers -- never "Osäkert/Ofullständigt underlag" -- and can be retried', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: () => persisted('assessment-m2b-1'),
      evidence: (call) => (call === 0 ? apiError(404, 'Governed viewer capability is not configured for this project.') : FIVE_HIT),
    });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'TECHNICAL_ERROR'));
    for (const layer of LAYERS) {
      const row = screen.getByTestId(`lu-check-${layer}`);
      expect(row).toHaveAttribute('data-state', 'TECHNICAL_ERROR');
      expect(screen.getByTestId(`lu-check-state-${layer}`)).toHaveTextContent('Tekniskt fel');
      expect(row).not.toHaveTextContent(/Osäkert underlag|Ofullständigt underlag|ingen (registrerad )?träff/i);
      expect(row).toHaveTextContent('Kartvisningen för projektet är inte förberedd ännu');
      expect(row).toHaveTextContent('Bedömningen har ett fynd för detta lager');
      expect(row).not.toHaveTextContent(/Governed|capability/);
    }
    // The map is told the same thing, in Swedish -- it does not fetch on its own.
    expect(lastCesiumMapViewProps.productEvidence.status).toBe('error');
    expect(lastCesiumMapViewProps.productEvidence.messageSv).toContain('Kartvisningen för projektet är inte förberedd ännu');
    expect(lastCesiumMapViewProps.projectId).toBeUndefined();

    await user.click(screen.getByTestId('lu-control-retry'));
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'HIT'));
    expect(screen.getByTestId('lu-check-state-water')).toHaveTextContent('Kontrollerat – träff');
    expect(lastCesiumMapViewProps.productEvidence.status).toBe('loaded');
    expect(lastCesiumMapViewProps.productEvidence.geojson.features).toHaveLength(5);
  });

  it('item 3: a current-assessment integrity failure is plain Swedish; the server text is only in the collapsed technical section', async () => {
    const user = userEvent.setup();
    mockM2b({ currentAssessment: () => apiError(424, 'Governed LU assessment failed tamper verification.') });
    await openM2b(user);
    const message = await screen.findByTestId('lu-persisted-assessment-error-message');
    expect(message).toHaveTextContent('Den sparade bedömningen klarade inte integritetskontrollen. Den visas, verifieras och exporteras därför inte.');
    expect(message).not.toHaveTextContent(/Governed|tamper/);
    const technical = screen.getByTestId('lu-persisted-assessment-error-technical');
    expect(technical).not.toHaveAttribute('open');
    expect(technical).toHaveTextContent('Governed LU assessment failed tamper verification.');
    expect(technical).toHaveTextContent('424');
    expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'TECHNICAL_ERROR');
    expect(screen.getByTestId('lu-check-water')).not.toHaveTextContent('Det finns ingen bedömning');
    expect(screen.queryByTestId('lu-results')).not.toBeInTheDocument();
  });

  it('item 2: a fresh run whose read-back is a DIFFERENT assessment shows an honest incoherent state and never mixes the two', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: (_call, ran) => (ran ? persisted('assessment-other-Y', [FIVE_FINDINGS[1]]) : 'missing'),
      run: () => runReport({ assessment_artifact_id: 'assessment-run-X', assessment_projection_registered: true, findings: [FIVE_FINDINGS[0]] }),
    });
    await openM2b(user);
    await user.click(await screen.findByTestId('lu-run'));
    const incoherent = await screen.findByTestId('lu-incoherent');
    expect(incoherent).toHaveTextContent('Kan inte visa en sammanhängande bedömning');
    expect(incoherent).toHaveTextContent('assessment-run-X');
    expect(incoherent).toHaveTextContent('assessment-other-Y');
    expect(screen.queryByTestId('lu-results')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-finding-finding-water')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-finding-finding-ebh')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-verify-assessment')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-export-pdf')).not.toBeInTheDocument();
    expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'TECHNICAL_ERROR');
    expect(callApi).not.toHaveBeenCalledWith(expect.stringContaining('/viewer/evidence'), expect.anything());
  });

  it('item 2: an assessment that was not registered as current (read-back 404) is shown as incoherent, with that reason', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: () => 'missing',
      run: () => runReport({ assessment_artifact_id: 'assessment-run-X', assessment_projection_registered: false, findings: [] }),
    });
    await openM2b(user);
    await user.click(await screen.findByTestId('lu-run'));
    const incoherent = await screen.findByTestId('lu-incoherent');
    expect(incoherent).toHaveTextContent('registrerades inte som projektets aktuella bedömning');
    expect(screen.queryByTestId('lu-export-pdf')).not.toBeInTheDocument();
  });

  it('item 2: a confirmed fresh run renders from the SAME source as a reopen (GET current-assessment), not from the run payload', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: (_call, ran) => (ran ? persisted('assessment-run-X') : 'missing'),
      run: () => runReport({ assessment_artifact_id: 'assessment-run-X', assessment_projection_registered: true, findings: [FIVE_FINDINGS[0]] }),
    });
    await openM2b(user);
    await user.click(await screen.findByTestId('lu-run'));
    expect(await screen.findByTestId('lu-finding-finding-ebh')).toBeInTheDocument();
    expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assessment-run-X');
    await waitFor(() => expect(screen.getByTestId('lu-check-natura2000')).toHaveAttribute('data-state', 'HIT'));
  });

  it('item 2: a verification that concerned another assessment is never shown as a PASS for the displayed one', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: () => persisted('assessment-shown'),
      verify: () => ({ ok: true, outcome: 'PASS', assessmentArtifactId: 'assessment-someone-else', mismatches: [] }),
    });
    await openM2b(user);
    await user.click(await screen.findByTestId('lu-verify-assessment'));
    const other = await screen.findByTestId('lu-verify-result-other');
    expect(other).toHaveTextContent('Verifieringen gällde en annan bedömning än den som visas');
    expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();
  });

  it('item 2: export is refused when the project\'s current assessment is no longer the displayed one', async () => {
    const user = userEvent.setup();
    let projectMovedOn = false;
    mockM2b({ currentAssessment: () => persisted(projectMovedOn ? 'assessment-newer' : 'assessment-shown') });
    await openM2b(user);
    const exportButton = await screen.findByTestId('lu-export-pdf');
    await waitFor(() => expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assessment-shown'));
    projectMovedOn = true; // e.g. another session ran a new assessment meanwhile
    await user.click(exportButton);
    expect(await screen.findByTestId('lu-export-pdf-error-message')).toHaveTextContent('inte den som visas');
    expect(callApi).not.toHaveBeenCalledWith(expect.stringContaining('/export-assessment-pdf'), expect.anything());
  });

  it('item 2: viewer evidence that does not belong to the displayed assessment is never shown as its control results', async () => {
    const user = userEvent.setup();
    const foreign = viewerEvidence(LAYERS.map((layer) => ({ layer, exists: false, count: 0 })));
    for (const f of foreign.features) f.properties.cas_artifact_id = `${f.properties.cas_artifact_id}-OTHER`;
    mockM2b({ currentAssessment: () => persisted('assessment-shown'), evidence: () => foreign });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'TECHNICAL_ERROR'));
    expect(screen.getByTestId('lu-check-water')).toHaveTextContent('hör inte till den visade bedömningen');
    expect(screen.getByTestId('lu-check-natura2000')).not.toHaveAttribute('data-state', 'NO_HIT');
    expect(lastCesiumMapViewProps.productEvidence.status).toBe('error');
  });

  it('item 3: a failed run is plain Swedish with the raw text collapsed, and the saved assessment is read again -- never claimed absent', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: () => persisted('assessment-shown'),
      run: () => apiError(500, 'ExecutionKernel exploded: TypeError x', { code: 'INTERNAL' }),
    });
    await openM2b(user);
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    await user.click(screen.getByTestId('lu-run'));
    const message = await screen.findByTestId('lu-run-error-message');
    expect(message).toHaveTextContent('Bedömningen kunde inte köras. Ett tekniskt fel uppstod på servern.');
    expect(message).not.toHaveTextContent('ExecutionKernel');
    expect(screen.getByTestId('lu-run-error-technical')).toHaveTextContent('ExecutionKernel exploded');
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assessment-shown');
    expect(screen.getByTestId('lu-control-panel')).not.toHaveTextContent('Det finns ingen bedömning');
  });

  it('item 3: verify DENY shows a Swedish summary; codes and details stay in the collapsed technical section', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: () => persisted('assessment-shown'),
      verify: () => ({ ok: true, outcome: 'DENY', assessmentArtifactId: 'assessment-shown', mismatches: [{ code: 'FINDINGS_MISMATCH', detail: 're-executed findings do not match' }] }),
    });
    await openM2b(user);
    await user.click(await screen.findByTestId('lu-verify-assessment'));
    const deny = await screen.findByTestId('lu-verify-result-mismatch');
    expect(screen.getByTestId('lu-verify-result-mismatch-summary')).toHaveTextContent('1 avvikelse');
    expect(screen.getByTestId('lu-verify-result-mismatch-summary')).not.toHaveTextContent('FINDINGS_MISMATCH');
    const technical = screen.getByTestId('lu-verify-result-mismatch-technical');
    expect(technical).not.toHaveAttribute('open');
    expect(deny).toContainElement(technical);
    expect(technical).toHaveTextContent('FINDINGS_MISMATCH');
  });

  it('item 5: an extra "document" layer in governed_layer_checks reads "Dokumentbevis – ej analyserat" (NOT_CHECKED); unknown layers/statuses never go green or crash', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: (_call, ran) => (ran ? persisted('assessment-run-X') : 'missing'),
      run: () =>
        runReport({
          assessment_artifact_id: 'assessment-run-X',
          assessment_projection_registered: true,
          findings: FIVE_FINDINGS,
          governed_layer_checks: [
            { layer: 'water', rule_id: 'LU-WATER-001', status: 'CHECKED_HIT', evidence_artifact_id: 'evidence-water-test', reason: null },
            { layer: 'document', rule_id: null, status: 'NOT_CHECKED', evidence_artifact_id: null, reason: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED' },
            { layer: 'sgu_skred', rule_id: null, status: 'SOMETHING_NEW', evidence_artifact_id: null, reason: null },
            'garbage',
          ],
        }),
    });
    await openM2b(user);
    await user.click(await screen.findByTestId('lu-run'));
    const doc = await screen.findByTestId('lu-check-extra-document');
    expect(doc).toHaveAttribute('data-state', 'NOT_CHECKED');
    expect(doc).toHaveTextContent('Dokumentbevis');
    expect(doc).toHaveTextContent('Ej analyserat');
    expect(screen.getByTestId('lu-check-extra-sgu_skred')).toHaveAttribute('data-state', 'UNCERTAIN');
    expect(screen.getByTestId('lu-check-extra-okand-3')).toHaveAttribute('data-state', 'UNCERTAIN');
    for (const row of screen.getAllByTestId(/^lu-check-extra-/)) {
      expect(row).not.toHaveAttribute('data-state', 'NO_HIT');
    }
    // The known layers still come from the governed viewer evidence (no second derivation).
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'HIT'));
    expect(screen.queryByTestId('lu-control-note')).not.toBeInTheDocument();
    // The machine reason stays machine-readable in the technical section.
    await user.click(screen.getByTestId('lu-check-select-extra-document'));
    expect(screen.getByTestId('lu-check-technical')).toHaveTextContent('NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED');
  });

  it('item 5: a malformed governed_layer_checks value never crashes the result', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: (_call, ran) => (ran ? persisted('assessment-run-X') : 'missing'),
      run: () => runReport({ assessment_artifact_id: 'assessment-run-X', assessment_projection_registered: true, governed_layer_checks: { not: 'an array' } }),
    });
    await openM2b(user);
    await user.click(await screen.findByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^lu-check-extra-/)).toHaveLength(0);
  });

  /** K0b's server document check, exactly as server/modules/localization/governedLayerChecks.ts emits it. */
  const DOCUMENT_CHECK = {
    layer: 'document',
    rule_id: 'LU-DOC-BESLUT-001',
    status: 'NOT_CHECKED',
    evidence_artifact_id: null,
    reason: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED',
    message_sv:
      'Dokument och tidigare beslut: inte kontrollerat. Bedömningen innehåller inget verifierat dokumentbevis för fastigheten. ' +
      'Att inga dokumentfynd visas betyder inte att det saknas tidigare beslut.',
  };

  it('item 5: a reopened assessment shows the server\'s documentCheck (K0b) -- the same row a fresh run shows', async () => {
    const user1 = userEvent.setup();
    mockM2b({
      currentAssessment: (_call, ran) => (ran ? { ...persisted('assessment-run-X'), documentCheck: DOCUMENT_CHECK } : 'missing'),
      run: () =>
        runReport({
          assessment_artifact_id: 'assessment-run-X',
          assessment_projection_registered: true,
          governed_layer_checks: [{ layer: 'water', rule_id: 'LU-WATER-001', status: 'CHECKED_HIT' }, DOCUMENT_CHECK],
        }),
    });
    const fresh = render(<LuWorkspace />);
    await user1.type(screen.getByTestId('lu-designation'), 'UPPSALA SVIA 1:111');
    await user1.click(screen.getByTestId('lu-lookup'));
    await user1.click(await screen.findByTestId('lu-run'));
    const freshRow = (await screen.findByTestId('lu-check-extra-document')).textContent;
    fresh.unmount();

    callApi.mockReset();
    const user2 = userEvent.setup();
    mockM2b({ currentAssessment: () => ({ ...persisted('assessment-run-X'), documentCheck: DOCUMENT_CHECK }) });
    await openM2b(user2);
    const row = await screen.findByTestId('lu-check-extra-document');
    expect(row).toHaveAttribute('data-state', 'NOT_CHECKED');
    expect(row).toHaveTextContent('Dokumentbevis');
    expect(row).toHaveTextContent('Ej analyserat.');
    // The server's own Swedish explanation is shown as written -- the UI derives nothing.
    expect(screen.getByTestId('lu-check-server-note-extra-document')).toHaveTextContent(
      'Att inga dokumentfynd visas betyder inte att det saknas tidigare beslut.',
    );
    expect(row.textContent).toBe(freshRow);
    expect(screen.queryByTestId('lu-control-note')).not.toBeInTheDocument();
  });

  it('§11 (coordinator): with a LOW finding and the document check not analysed, the assessment line is qualified in the same box -- never green alone', async () => {
    const user = userEvent.setup();
    const lowFindings = FIVE_FINDINGS.map((f) => ({ ...f, risk_level: 'LOW' }));
    mockM2b({ currentAssessment: () => ({ ...persisted('assessment-low', lowFindings), documentCheck: DOCUMENT_CHECK }) });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'HIT'));
    const summary = screen.getByTestId('lu-assessment-summary');
    const coverage = screen.getByTestId('lu-assessment-coverage');
    expect(summary).toContainElement(screen.getByTestId('lu-assessment-status'));
    expect(summary).toContainElement(coverage);
    expect(coverage).toHaveAttribute('data-complete', 'false');
    // DEMO M2c item 1: the owner's form (OD-K0-1) -- N of M checks carried out.
    expect(screen.getByTestId('lu-assessment-coverage-head')).toHaveTextContent(
      'Bedömningen gäller de kontroller som utfördes; underlaget är ofullständigt: 5 av 6 kontroller genomförda.',
    );
    expect(screen.getByTestId('lu-assessment-coverage-missing')).toHaveTextContent('Utan visat kontrollresultat: Dokumentbevis (ej analyserat).');
    // Machine-readable levels are untouched: the LOW findings still say "Låg risk" for themselves.
    expect(screen.getByTestId('lu-finding-finding-water')).toHaveTextContent('Låg risk');
  });

  it('§11 (coordinator): a technical error on a layer is never counted as a carried-out check in the assessment line', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: () => ({ ...persisted('assessment-x'), documentCheck: DOCUMENT_CHECK }),
      evidence: () => apiError(503, 'upstream down'),
    });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-assessment-coverage')).toHaveTextContent('0 av 6 kontroller genomförda'));
    expect(screen.getByTestId('lu-assessment-coverage-missing')).toHaveTextContent('Brunnar (tekniskt fel)');
    expect(screen.getByTestId('lu-assessment-coverage-missing')).toHaveTextContent('Dokumentbevis (ej analyserat)');
  });

  it('§11 (coordinator): all five map checks done but no document check in the answer is still not "complete"', async () => {
    const user = userEvent.setup();
    mockM2b({ currentAssessment: () => persisted('assessment-x') });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'HIT'));
    expect(screen.getByTestId('lu-assessment-coverage')).toHaveAttribute('data-complete', 'false');
    expect(screen.getByTestId('lu-assessment-coverage-head')).toHaveTextContent('underlaget är ofullständigt: 5 av 6 kontroller genomförda.');
    expect(screen.getByTestId('lu-assessment-coverage-missing')).toHaveTextContent('Dokumentbevis (uppgift saknas i svaret)');
  });

  // -----------------------------------------------------------------------------------------------
  // DEMO M2c item 1 (M2b verifier finding 1, High): a register with known partial coverage is never
  // shown as an unqualified green "ingen registrerad träff", and the assessment line never says
  // "Alla 6 kontroller gav ett kontrollresultat" while a layer has limited coverage.
  // -----------------------------------------------------------------------------------------------
  const FIVE_NO_HIT = viewerEvidence(LAYERS.map((layer) => ({ layer, exists: false, count: 0 })));
  const DOCUMENT_CHECK_HIT = {
    layer: 'document',
    rule_id: 'LU-DOC-BESLUT-001',
    status: 'CHECKED_HIT',
    evidence_artifact_id: 'doc-evidence-1',
    reason: null,
    message_sv:
      'Dokument och tidigare beslut: kontrollerat – träff. Bedömningen innehåller verifierat dokumentbevis (se fynd). ' +
      'Övriga dokument för fastigheten är inte kontrollerade.',
  };

  it('M2c item 1: Natura 2000 and Skyddad natur rows state their limited coverage in the same box, never plain green', async () => {
    const user = userEvent.setup();
    mockM2b({ currentAssessment: () => ({ ...persisted('assessment-x', []), documentCheck: DOCUMENT_CHECK }), evidence: () => FIVE_NO_HIT });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-natura2000')).toHaveAttribute('data-state', 'NO_HIT'));
    for (const layer of ['natura2000', 'protected_area']) {
      expect(screen.getByTestId(`lu-check-${layer}`)).toHaveAttribute('data-coverage', 'limited');
      expect(screen.getByTestId(`lu-check-state-${layer}`)).toHaveTextContent('Kontrollerat – ingen registrerad träff · begränsad täckning');
    }
    expect(screen.getByTestId('lu-check-coverage-note-natura2000')).toHaveTextContent(
      'Täckning: endast fågeldirektivets områden (SPA). Habitatdirektivets områden (SCI/SAC) ingår inte i underlaget och är inte kontrollerade.',
    );
    expect(screen.getByTestId('lu-check-coverage-note-protected_area')).toHaveTextContent('Täckning: endast naturreservat.');
    expect(screen.getByTestId('lu-check-ebh')).not.toHaveAttribute('data-coverage', 'limited');
    expect(screen.getByTestId('lu-control-panel')).not.toHaveTextContent(/utpekade|beslutade/);
  });

  it('M2c item 1: with every check carried out, the assessment line still names the limited coverage -- never "Alla 6 kontroller"', async () => {
    const user = userEvent.setup();
    mockM2b({ currentAssessment: () => ({ ...persisted('assessment-x', []), documentCheck: DOCUMENT_CHECK_HIT }), evidence: () => FIVE_NO_HIT });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-natura2000')).toHaveAttribute('data-state', 'NO_HIT'));
    const coverage = screen.getByTestId('lu-assessment-coverage');
    expect(coverage).not.toHaveTextContent(/Alla \d+ kontroller/);
    expect(coverage).toHaveAttribute('data-complete', 'false');
    expect(screen.getByTestId('lu-assessment-coverage-head')).toHaveTextContent(
      'Bedömningen gäller de kontroller som utfördes; 6 av 6 kontroller genomförda.',
    );
    const limited = screen.getByTestId('lu-assessment-coverage-limited');
    expect(limited).toHaveTextContent('Begränsad täckning:');
    expect(limited).toHaveTextContent('Skyddad natur – endast naturreservat');
    expect(limited).toHaveTextContent('Natura 2000 – endast fågeldirektivets områden (SPA), inte habitatdirektivets (SCI/SAC)');
    expect(screen.getByTestId('lu-assessment-summary')).toHaveStyle({ borderLeft: '3px solid #F97316' });
  });

  it('M2c item 3: a document check with a hit is counted as carried out but named as limited -- the server says other documents are not checked', async () => {
    const user = userEvent.setup();
    mockM2b({ currentAssessment: () => ({ ...persisted('assessment-x', []), documentCheck: DOCUMENT_CHECK_HIT }), evidence: () => FIVE_HIT });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'HIT'));
    expect(screen.getByTestId('lu-check-extra-document')).toHaveAttribute('data-coverage', 'limited');
    expect(screen.getByTestId('lu-check-state-extra-document')).toHaveTextContent('Kontrollerat – träff · begränsad täckning');
    expect(screen.getByTestId('lu-assessment-coverage-head')).toHaveTextContent('6 av 6 kontroller genomförda.');
    expect(screen.getByTestId('lu-assessment-coverage')).toHaveAttribute('data-complete', 'false');
    expect(screen.getByTestId('lu-assessment-coverage-limited')).toHaveTextContent(
      'Dokumentbevis – endast dokumentbevis knutet till bedömningen; övriga dokument för fastigheten är inte kontrollerade',
    );
  });

  it('item 5: when neither the read-back nor a run carries the document check, the panel says the answer lacks it', async () => {
    const user = userEvent.setup();
    mockM2b({ currentAssessment: () => persisted('assessment-shown') });
    await openM2b(user);
    expect(await screen.findByTestId('lu-control-note')).toHaveTextContent('Uppgift om dokumentkontrollen saknas i svaret för den här bedömningen.');
    expect(screen.queryByTestId('lu-check-extra-document')).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------------------------------
  // DEMO M2c item 2 (M2b verifier finding 2, Medium): the control point, the search ring and the
  // property row are bound to the point the DISPLAYED assessment was made for
  // (current-assessment localizationGeometry.artifact_id), not to a separate GET geometry.
  // -----------------------------------------------------------------------------------------------
  it('M2c item 2: a point changed outside the view (e.g. the supersession worker) is said so honestly; no ring is drawn around the other point', async () => {
    const user = userEvent.setup();
    let serverPoint = 'loc-geom-1';
    mockM2b({
      currentAssessment: (_call, ran) =>
        ran ? { ...persisted('assessment-run-X'), localizationGeometry: assessedPoint('loc-geom-2') } : 'missing',
      run: () => runReport({ assessment_artifact_id: 'assessment-run-X', assessment_projection_registered: true }),
    });
    const base = callApi.getMockImplementation()!;
    callApi.mockImplementation((url: string, o: unknown) => {
      if (url.endsWith('/geometry')) {
        return Promise.resolve({
          ok: true,
          geometry: {
            artifact_id: serverPoint,
            provenance: 'derived_from_property_boundary',
            wgs84LngLat: serverPoint === 'loc-geom-1' ? [17.74, 59.87] : [17.75, 59.88],
            provisioningStatus: 'COMPLETED',
          },
        });
      }
      return base(url, o);
    });
    await openM2b(user);
    expect(await screen.findByTestId('lu-geometry-current')).toBeInTheDocument();
    serverPoint = 'loc-geom-2'; // the project's current point moves while the view still shows loc-geom-1
    await user.click(await screen.findByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    const notice = await screen.findByTestId('lu-point-binding');
    expect(notice).toHaveAttribute('data-binding', 'changed');
    expect(notice).toHaveTextContent('Kontrollpunkten har ändrats sedan bedömningen gjordes');
    expect(notice).toHaveTextContent('bedömningen gjordes för en annan kontrollpunkt än den som visas');
    expect(screen.getByTestId('lu-point-binding-technical')).toHaveTextContent('loc-geom-2');
    expect(screen.getByTestId('lu-point-binding-technical')).toHaveTextContent('loc-geom-1');
    // The ring says "where the check searched" -- never drawn around a point the assessment was not made for.
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'HIT'));
    expect(lastCesiumMapViewProps.searchRadiusMeters).toBeNull();
    expect(lastCesiumMapViewProps.searchRadiusWithheldNote).toContain('annan kontrollpunkt');
    expect(screen.getByTestId('lu-check-property')).toHaveTextContent('Den visade bedömningen gjordes för en annan kontrollpunkt än den som visas här.');

    // "Läs in på nytt" re-reads the project's current point; now point and assessment agree again.
    await user.click(screen.getByTestId('lu-point-binding-reload'));
    await waitFor(() => expect(screen.queryByTestId('lu-point-binding')).not.toBeInTheDocument());
    await waitFor(() => expect(lastCesiumMapViewProps.searchRadiusMeters).toBe(500));
    expect(lastCesiumMapViewProps.searchRadiusWithheldNote ?? null).toBeNull();
    expect(lastCesiumMapViewProps.currentLocationPoint).toEqual({ lat: 59.88, lng: 17.75 });
  });

  it('M2c item 2: when the assessment was made for the displayed point, the ring is drawn and nothing is flagged', async () => {
    const user = userEvent.setup();
    mockM2b({ currentAssessment: () => persisted('assessment-shown') });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'HIT'));
    expect(screen.queryByTestId('lu-point-binding')).not.toBeInTheDocument();
    expect(lastCesiumMapViewProps.searchRadiusMeters).toBe(500);
    expect(screen.getByTestId('lu-check-property')).toHaveTextContent('Kontrollerna utgår från en beräknad mittpunkt av fastigheten (ej inmätt).');
  });

  it('M2c item 2: an answer that does not state the assessed point never gets a ring it cannot vouch for', async () => {
    const user = userEvent.setup();
    const { localizationGeometry: _omitted, ...withoutPoint } = persisted('assessment-shown');
    mockM2b({ currentAssessment: () => withoutPoint });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'HIT'));
    const notice = screen.getByTestId('lu-point-binding');
    expect(notice).toHaveAttribute('data-binding', 'unknown');
    expect(notice).toHaveTextContent('Det går inte att bekräfta att bedömningen gjordes för den kontrollpunkt som visas');
    expect(lastCesiumMapViewProps.searchRadiusMeters).toBeNull();
  });

  it('M2c item 3: a 404 from the control results while an assessment is shown is "Tekniskt fel" with "Försök igen" -- never "ingen sparad bedömning"', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: () => persisted('assessment-shown'),
      evidence: (call) => (call === 0 ? apiError(404, NO_CURRENT_ASSESSMENT_MESSAGE) : FIVE_HIT),
    });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'TECHNICAL_ERROR'));
    expect(screen.getByTestId('lu-results')).toBeInTheDocument();
    expect(screen.getByTestId('lu-control-panel')).not.toHaveTextContent(/ingen sparad bedömning/i);
    expect(screen.getByTestId('lu-check-water')).toHaveTextContent('servern anger att projektet inte längre har någon aktuell bedömning');
    const assessmentReads = () => callApi.mock.calls.filter(([url]) => String(url).includes('/current-assessment')).length;
    const readsBefore = assessmentReads();
    await user.click(screen.getByTestId('lu-control-retry'));
    // An incoherence is retried by reading the assessment again (the evidence follows it).
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'HIT'));
    expect(assessmentReads()).toBeGreaterThan(readsBefore);
  });

  it('M2c item 3: a governance refusal reads "Ofullständigt underlag" in the panel AND on the map -- one word per state', async () => {
    const user = userEvent.setup();
    mockM2b({
      currentAssessment: () =>
        apiError(409, 'Projektet har flera möjliga aktuella lokaliseringspunkter. Ingen bedömning görs förrän det är utrett vilken punkt som gäller.', {
          code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
          failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY',
        }),
    });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'UNCERTAIN'));
    expect(screen.getByTestId('lu-check-state-water')).toHaveTextContent('Ofullständigt underlag');
    expect(lastCesiumMapViewProps.productEvidence.status).toBe('error');
    expect(lastCesiumMapViewProps.productEvidence.stateLabel).toBe('Ofullständigt underlag');
  });

  it('M2c item 3: a technical failure reads "Tekniskt fel" in the panel and on the map', async () => {
    const user = userEvent.setup();
    mockM2b({ currentAssessment: () => persisted('assessment-shown'), evidence: () => apiError(503, 'upstream down') });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-check-water')).toHaveAttribute('data-state', 'TECHNICAL_ERROR'));
    expect(lastCesiumMapViewProps.productEvidence.stateLabel).toBe('Tekniskt fel');
  });

  // -----------------------------------------------------------------------------------------------
  // DEMO M2c item 3 (M2b verifier finding 7): a run that produced no assessment is shown as exactly
  // that, and a still-current OLDER assessment is shown as the project's current one -- labelled as
  // not the result of the latest run -- instead of being hidden (and then reappearing on reload).
  // -----------------------------------------------------------------------------------------------
  const deniedRun = () => ({
    ok: true,
    siteAnalyses: [
      {
        complianceAnalysis: { overallRisk: 'HIGH' },
        executionMotor: {
          admitted: false,
          assessment_status: 'GOVERNANCE_DENIED',
          findings: [],
          localization_geometry: { status: 'FAILED_CLOSED', message_sv: 'Lokaliseringen är tvetydig. Ingen bedömning görs.' },
        },
      },
    ],
  });

  it('M2c item 3: a DENIED run is shown as denied, and the still-current older assessment stays visible as "not this run"', async () => {
    const user = userEvent.setup();
    mockM2b({ currentAssessment: () => persisted('assessment-older'), run: deniedRun });
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assessment-older'));
    await user.click(screen.getByTestId('lu-run'));

    const outcome = await screen.findByTestId('lu-run-outcome');
    expect(screen.getByTestId('lu-run-outcome-status')).toHaveTextContent('Ej bedömd – nekad av styrning');
    expect(screen.getByTestId('lu-run-outcome-message')).toHaveTextContent('Lokaliseringen är tvetydig. Ingen bedömning görs.');
    expect(outcome).toHaveTextContent('Körningen gav ingen ny bedömning.');
    // The older assessment is NOT hidden: it is the project's current one, and says it is not this run's.
    await waitFor(() => expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assessment-older'));
    expect(screen.getByTestId('lu-assessment-status')).toHaveTextContent('Bedömd');
    expect(screen.getByTestId('lu-results-not-latest-run')).toHaveTextContent(
      'Detta är projektets aktuella sparade bedömning från en annan körning. Den är inte resultatet av den senaste körningen, som nekades av styrningen.',
    );
    expect(screen.getByTestId('lu-finding-finding-water')).toBeInTheDocument();
  });

  it('M2c item 3: after a denied run and a reload, the same older assessment is shown -- only the run notice is gone', async () => {
    const user1 = userEvent.setup();
    mockM2b({ currentAssessment: () => persisted('assessment-older'), run: deniedRun });
    const fresh = render(<LuWorkspace />);
    await user1.type(screen.getByTestId('lu-designation'), 'UPPSALA SVIA 1:111');
    await user1.click(screen.getByTestId('lu-lookup'));
    await waitFor(() => expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assessment-older'));
    await user1.click(screen.getByTestId('lu-run'));
    await screen.findByTestId('lu-run-outcome');
    await waitFor(() => expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assessment-older'));
    const freshFindings = screen.getByTestId('lu-findings').textContent;
    fresh.unmount();

    callApi.mockReset();
    const user2 = userEvent.setup();
    mockM2b({ currentAssessment: () => persisted('assessment-older') });
    await openM2b(user2);
    await waitFor(() => expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assessment-older'));
    expect(screen.getByTestId('lu-assessment-status')).toHaveTextContent('Bedömd');
    expect(screen.getByTestId('lu-findings').textContent).toBe(freshFindings);
    // The denial itself is not in the server's read model: a reload cannot show it (server change needed).
    expect(screen.queryByTestId('lu-run-outcome')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-results-not-latest-run')).not.toBeInTheDocument();
  });

  it('item 2: "Kör bedömning" is disabled while the saved assessment is still being read', async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    mockM2b({ currentAssessment: () => persisted('assessment-shown') });
    const base = callApi.getMockImplementation()!;
    callApi.mockImplementation((url: string, o: unknown) =>
      url.includes('/current-assessment') ? new Promise((resolve) => { release = resolve; }) : base(url, o),
    );
    await openM2b(user);
    await waitFor(() => expect(screen.getByTestId('lu-persisted-assessment-loading')).toBeInTheDocument());
    expect(screen.getByTestId('lu-run')).toBeDisabled();
    release(persisted('assessment-shown'));
    await waitFor(() => expect(screen.getByTestId('lu-run')).not.toBeDisabled());
  });
});
