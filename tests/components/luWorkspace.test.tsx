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

vi.mock('../../src/ui/api-client/geo.client', () => ({
  fetchPropertyInfo: (...args: unknown[]) => fetchPropertyInfo(...args),
}));

vi.mock('../../src/ui/api-client/localizationProjects.client', () => ({
  getBootstrapStatus: vi.fn(async () => ({
    status: {
      id: 'bootstrap-1',
      projectId: 'proj-1',
      propertyDesignation: 'GÄVLE BRYNÄS 1:1',
      status: 'COMPLETED',
      contextBindingArtifactId: 'project-context-binding-1',
      failureCode: null,
      failureDetail: null,
    },
    diagnostics: null,
  })),
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
    expect(lastCesiumMapViewProps.evidenceMode).toBe('live');
    expect(lastCesiumMapViewProps.projectId).toBe('proj-1');
    expect(fetchPropertyInfo).toHaveBeenCalledWith('GÄVLE BRYNÄS 1:1', 'proj-1');

    await user.click(screen.getByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(screen.getByTestId('lu-risk')).toHaveTextContent('MEDIUM');
    expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assess-site-1-abc');
    expect(screen.getByTestId('lu-property-context-id')).toHaveTextContent('prop-site-1');
    expect(screen.getByTestId('lu-finding-ids')).toHaveTextContent('LU-WATER-001');
    expect(screen.getByTestId('lu-finding-LU-WATER-001')).toHaveTextContent('Vatten');
    expect(screen.getByTestId('lu-finding-LU-WATER-001')).toHaveTextContent('Bör utredas vidare');
    expect(screen.getByTestId('lu-finding-LU-WATER-001')).toHaveTextContent('Närhet till vatten kräver analys');

    // LU-UNKNOWN-MISSING-DISPLAY-V1, proof 1: assessed source + no conflict -> clearly "no
    // identified conflict", never rendered as generic "OK"/green with no explanation.
    expect(screen.getByTestId('lu-data-source-NVR API')).toHaveTextContent(
      'Inga avvikelser identifierade i denna källa',
    );
    // proof 2: a degraded/insufficient source is never shown with the same label as "ok" --
    // must not read as green/no-risk.
    expect(screen.getByTestId('lu-data-source-PostGIS spatial')).toHaveTextContent('Ofullständigt underlag');
    expect(screen.getByTestId('lu-data-source-PostGIS spatial')).not.toHaveTextContent(
      'Inga avvikelser identifierade i denna källa',
    );
    // proof 3: an unavailable source gets its own explicit state, distinct from both of the above.
    expect(screen.getByTestId('lu-data-source-VISS')).toHaveTextContent('Källan är otillgänglig');
    expect(screen.getByTestId('lu-data-source-VISS')).not.toHaveTextContent('Inga avvikelser identifierade i denna källa');
    expect(screen.getByTestId('lu-warnings')).toHaveTextContent('VISS otillgänglig: tidsgräns nådd');

    expect(callApi).toHaveBeenCalledWith(
      '/api/localization/generate-report',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          projectId: 'proj-1',
          siteAlternatives: [
            expect.objectContaining({
              lat: expect.any(Number),
              lng: expect.any(Number),
            }),
          ],
        }),
      }),
    );
    const generateCall = callApi.mock.calls.find((entry) => entry[0] === '/api/localization/generate-report');
    expect(generateCall?.[1]?.body?.siteAlternatives?.[0]?.documentEvidenceRefs).toBeUndefined();

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
    expect(screen.getByTestId('lu-risk')).toHaveTextContent('Ej bedömd');
    expect(screen.getByTestId('lu-risk')).not.toHaveTextContent('LOW');
    expect(screen.getByTestId('lu-risk')).not.toHaveTextContent('MEDIUM');
    expect(screen.getByTestId('lu-risk')).not.toHaveTextContent('HIGH');
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
    expect(screen.getByTestId('lu-finding-LU-WATER-001')).toHaveTextContent('Vatten');
    expect(screen.getByTestId('lu-finding-LU-WATER-001')).toHaveTextContent('Närhet till vatten kräver analys');

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

  async function renderWithFindingWithEvidence(user: ReturnType<typeof userEvent.setup>) {
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
      if (url.includes('/verify-assessment')) {
        return Promise.resolve({ ok: true, outcome: 'PASS', assessmentArtifactId: 'assess-drilldown-abc', mismatches: [] });
      }
      return Promise.resolve({
        ok: true,
        projectId: 'proj-1',
        siteAnalyses: [
          {
            complianceAnalysis: { overallRisk: 'MEDIUM', permitProbability: 0.5 },
            executionMotor: {
              admitted: true,
              assessment_artifact_id: 'assess-drilldown-abc',
              finding_ids: ['LU-WATER-001'],
              findings: [
                {
                  finding_id: 'LU-WATER-001',
                  rule_id: 'LU-WATER-001',
                  risk_level: 'MEDIUM',
                  explanation: 'Närhet till vatten kräver analys',
                  evidence_refs: [{ artifact_id: 'spatial-evidence-drilldown-1', artifact_type: 'SPATIAL_EVIDENCE' }],
                },
              ],
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
  }

  it('LU-FINDING-MAP-DRILLDOWN-V1, proofs 1+3+4: a finding with governed spatial evidence exposes "Visa på karta"; clicking it never calls any network endpoint (no direct GIS query, no new assessment execution)', async () => {
    const user = userEvent.setup();
    await renderWithFindingWithEvidence(user);

    const button = screen.getByTestId('lu-finding-show-on-map-LU-WATER-001');
    expect(button).toBeInTheDocument();
    const callsBeforeClick = callApi.mock.calls.length;

    await user.click(button);

    // Proof 3+4: purely client-side map focus -- zero new network calls, no /api/spatial/evidence,
    // no re-run of generate-report.
    expect(callApi.mock.calls.length).toBe(callsBeforeClick);
    // Proof 2: the only thing LuWorkspace tells the map is which already-governed artifact_id to
    // focus -- it never supplies evidence content, coordinates, or a geometry itself.
    expect(lastCesiumMapViewProps.focusEvidenceArtifactId).toBe('spatial-evidence-drilldown-1');
  });

  it('LU-FINDING-MAP-DRILLDOWN-V1: clicking "Visa på karta" again re-triggers focus via the nonce (not just the artifact id)', async () => {
    const user = userEvent.setup();
    await renderWithFindingWithEvidence(user);
    const button = screen.getByTestId('lu-finding-show-on-map-LU-WATER-001');

    await user.click(button);
    const firstNonce = lastCesiumMapViewProps.focusEvidenceNonce;
    await user.click(button);
    expect(lastCesiumMapViewProps.focusEvidenceNonce).not.toBe(firstNonce);
    expect(lastCesiumMapViewProps.focusEvidenceArtifactId).toBe('spatial-evidence-drilldown-1');
  });

  it('LU-FINDING-MAP-DRILLDOWN-V1, proof 6: missing evidence gives an honest unavailable state, not silence or a fabricated match', async () => {
    const user = userEvent.setup();
    await renderWithFindingWithEvidence(user);

    await user.click(screen.getByTestId('lu-finding-show-on-map-LU-WATER-001'));
    // Simulates what the real CesiumAdapter reports when the artifact isn't currently rendered.
    await user.click(screen.getByTestId('mock-trigger-evidence-missing'));

    expect(await screen.findByTestId('lu-finding-map-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('evidence-details-panel')).not.toBeInTheDocument();
  });

  it('LU-FINDING-MAP-DRILLDOWN-V1, proof 2: a successful map focus opens EvidenceDetailsPanel through the existing onEvidenceClick path, and clears any prior not-found state', async () => {
    const user = userEvent.setup();
    await renderWithFindingWithEvidence(user);

    await user.click(screen.getByTestId('lu-finding-show-on-map-LU-WATER-001'));
    await user.click(screen.getByTestId('mock-trigger-evidence-missing'));
    expect(await screen.findByTestId('lu-finding-map-not-found')).toBeInTheDocument();

    await user.click(screen.getByTestId('mock-trigger-evidence-found'));
    expect(await screen.findByTestId('evidence-details-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('lu-finding-map-not-found')).not.toBeInTheDocument();
  });

  it('LU-FINDING-MAP-DRILLDOWN-V1, proof 8: Unit 6 verification state is unaffected by map selection', async () => {
    const user = userEvent.setup();
    await renderWithFindingWithEvidence(user);

    await user.click(screen.getByTestId('lu-verify-assessment'));
    expect(await screen.findByTestId('lu-verify-result-pass')).toBeInTheDocument();

    await user.click(screen.getByTestId('lu-finding-show-on-map-LU-WATER-001'));
    await user.click(screen.getByTestId('mock-trigger-evidence-found'));

    // Verification result must still be showing -- selecting a finding on the map is a display
    // action, not a state reset for an unrelated concern.
    expect(screen.getByTestId('lu-verify-result-pass')).toBeInTheDocument();
  });

  it('LU-FINDING-MAP-DRILLDOWN-V1, proof 7: a restored (Unit 5B) persisted assessment can drill down to the map without running a new assessment', async () => {
    const user = userEvent.setup();
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1', designation: 'GÄVLE BRYNÄS 1:1', municipality: 'Gävle',
      geometry: { type: 'Point', coordinates: [17.14, 60.67] }, centroid: { lat: 60.67, lng: 17.14 },
    });
    callApi.mockImplementation((url: string) => {
      if (url.includes('/current-assessment')) {
        return Promise.resolve({
          ok: true,
          assessmentArtifactId: 'assess-restored-drilldown',
          findings: [
            {
              finding_id: 'LU-WATER-001', rule_id: 'LU-WATER-001', rule_version: '1.0', risk_level: 'MEDIUM',
              explanation: 'Restored finding', evidence_refs: [{ artifact_id: 'spatial-evidence-restored-1', artifact_type: 'SPATIAL_EVIDENCE' }],
            },
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
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(callApi).not.toHaveBeenCalledWith('/api/localization/generate-report', expect.anything());

    const button = screen.getByTestId('lu-finding-show-on-map-LU-WATER-001');
    const callsBeforeClick = callApi.mock.calls.length;
    await user.click(button);

    expect(lastCesiumMapViewProps.focusEvidenceArtifactId).toBe('spatial-evidence-restored-1');
    expect(callApi.mock.calls.length).toBe(callsBeforeClick);
    expect(callApi).not.toHaveBeenCalledWith('/api/localization/generate-report', expect.anything());
  });

  it('LU-FINDING-MAP-DRILLDOWN-V1: a finding with no spatial evidence (e.g. document-only) exposes no "Visa på karta" action', async () => {
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
      return Promise.resolve({
        ok: true,
        projectId: 'proj-1',
        siteAnalyses: [
          {
            complianceAnalysis: {},
            executionMotor: {
              admitted: true,
              assessment_artifact_id: 'assess-doc-only',
              finding_ids: ['LU-DOC-BESLUT-001'],
              findings: [
                {
                  finding_id: 'LU-DOC-BESLUT-001', rule_id: 'LU-DOC-BESLUT-001', risk_level: 'MEDIUM',
                  explanation: 'Tidigare beslut föreligger', evidence_refs: [{ artifact_id: 'doc-evidence-1', artifact_type: 'DOCUMENT_EVIDENCE' }],
                },
              ],
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

    expect(screen.getByTestId('lu-finding-LU-DOC-BESLUT-001')).toBeInTheDocument();
    expect(screen.queryByTestId('lu-finding-show-on-map-LU-DOC-BESLUT-001')).not.toBeInTheDocument();
  });
});
