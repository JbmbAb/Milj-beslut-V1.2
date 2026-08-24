import React from 'react';
import { render, screen } from '@testing-library/react';
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

vi.mock('../../src/ui/api-client/geo.client', () => ({
  fetchPropertyInfo: (...args: unknown[]) => fetchPropertyInfo(...args),
}));

vi.mock('../../services/coreApiClient', () => ({
  callApi: (...args: unknown[]) => callApi(...args),
  getActiveProjectId: () => getActiveProjectId(),
}));

vi.mock('../../components/CesiumMapView', () => ({
  default: () => <div data-testid="cesium-map-view" />,
}));

vi.mock('../../components/cesium/EvidenceDetailsPanel', () => ({
  default: () => <div data-testid="evidence-details-panel" />,
}));

describe('LuWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expect.objectContaining({ method: 'POST' }),
    );
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
  });
});
