/**
 * W-M2d item 8 (M2c verification finding 6): a run that produced no assessment ("Senaste körningen:
 * Ej bedömd – nekad av styrning") is remembered in the SHELL's state for as long as the session lives,
 * so switching views (which unmounts the workspace) does not make the older assessment look like the
 * latest run's result. The server keeps no record of a denied run, so a reload cannot show it -- the
 * notice says so. Fully mocked: no network, no database, no WebGL.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MimerProductShell } from '../../components/app/MimerProductShell';
import { LuWorkspace } from '../../components/app/lu/LuWorkspace';
import { governedReadBack } from '../fixtures/luGovernedReadBack';

vi.mock('@miljobeslut/mps-compass', () => ({ MpsCompass: () => <div data-testid="mps-compass" /> }));
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
vi.mock('@miljobeslut/mps-console', () => ({ MpsConsoleApp: () => <div data-testid="mps-console-stub">Console</div> }));
// The property-first entry opens the real workspace for an already chosen property, so a view switch
// unmounts and remounts exactly what a user sees.
vi.mock('../../components/app/lu/PropertyFirstLuEntry', async () => {
  const { LuWorkspace: Workspace } = await vi.importActual<typeof import('../../components/app/lu/LuWorkspace')>(
    '../../components/app/lu/LuWorkspace',
  );
  return { PropertyFirstLuEntry: () => <Workspace initialDesignation="UPPSALA SVIA 1:111" /> };
});
const fetchPropertyInfo = vi.fn();
vi.mock('../../src/ui/api-client/geo.client', () => ({ fetchPropertyInfo: (...args: unknown[]) => fetchPropertyInfo(...args) }));
const callApi = vi.fn();
vi.mock('../../services/coreApiClient', () => ({
  callApi: (...args: unknown[]) => callApi(...args),
  getActiveProjectId: () => 'proj-1',
  setActiveProjectId: vi.fn(),
}));
vi.mock('../../components/CesiumMapView', () => ({ default: () => <div data-testid="cesium-map-view" /> }));

const OLDER = governedReadBack({ id: 'assessment-older' });

function mockApi(run: () => unknown) {
  fetchPropertyInfo.mockResolvedValue({
    id: 'p1', designation: 'UPPSALA SVIA 1:111', municipality: 'Uppsala',
    geometry: { type: 'Point', coordinates: [17.74, 59.87] }, centroid: { lat: 59.87, lng: 17.74 },
  });
  callApi.mockImplementation((url: string) => {
    if (url.includes('/current-assessment')) return Promise.resolve(OLDER);
    if (url.includes('/viewer/evidence')) return Promise.resolve({ type: 'FeatureCollection', features: [] });
    if (url.includes('/geometry')) {
      return Promise.resolve({
        ok: true,
        geometry: { artifact_id: 'loc-geom-1', provenance: 'derived_from_property_boundary', wgs84LngLat: [17.74, 59.87], provisioningStatus: 'COMPLETED' },
      });
    }
    if (url.includes('/generate-report')) return Promise.resolve(run());
    throw new Error(`unexpected callApi call in this test: ${url}`);
  });
}

const deniedRun = () => ({
  ok: true,
  siteAnalyses: [
    {
      executionMotor: {
        admitted: false,
        assessment_status: 'GOVERNANCE_DENIED',
        findings: [],
        localization_geometry: { status: 'FAILED_CLOSED', message_sv: 'Lokaliseringen är tvetydig. Ingen bedömning görs.' },
      },
    },
  ],
});

async function waitForAssessment() {
  await waitFor(() => expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assessment-older'));
}

describe('W-M2d item 8: the denied-run notice lives in the shell for the session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switching views keeps "Senaste körningen: Ej bedömd – nekad av styrning" and the older assessment stays marked as not that run', async () => {
    const user = userEvent.setup();
    mockApi(deniedRun);
    render(<MimerProductShell />);
    await user.click(screen.getByTestId('nav-localization'));
    await waitForAssessment();
    await user.click(screen.getByTestId('lu-run'));
    expect(await screen.findByTestId('lu-run-outcome-status')).toHaveTextContent('Ej bedömd – nekad av styrning');

    // Leave the view (the workspace unmounts) and come back.
    await user.click(screen.getByTestId('nav-home'));
    expect(screen.queryByTestId('lu-workspace')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('nav-localization'));
    await waitForAssessment();
    expect(screen.getByTestId('lu-run-outcome-status')).toHaveTextContent('Ej bedömd – nekad av styrning');
    expect(screen.getByTestId('lu-run-outcome-message')).toHaveTextContent('Lokaliseringen är tvetydig. Ingen bedömning görs.');
    expect(screen.getByTestId('lu-results-not-latest-run')).toHaveTextContent('Den är inte resultatet av den senaste körningen');
    // Honest about what cannot be kept: the server does not store denied runs.
    expect(screen.getByTestId('lu-run-outcome-session-note')).toHaveTextContent(
      'Servern sparar inte nekade körningar, så uppgiften visas inte efter att sidan laddats om.',
    );
    // When the shown assessment's basis was retrieved (the server's retrieved_at), so it can be told apart.
    expect(screen.getByTestId('lu-assessment-retrieved')).toHaveTextContent('Underlaget för bedömningen hämtades');
  });

  it('a later run that produces an assessment replaces the remembered notice', async () => {
    const user = userEvent.setup();
    let runResult: unknown = deniedRun();
    mockApi(() => runResult);
    render(<MimerProductShell />);
    await user.click(screen.getByTestId('nav-localization'));
    await waitForAssessment();
    await user.click(screen.getByTestId('lu-run'));
    await screen.findByTestId('lu-run-outcome');
    runResult = {
      ok: true,
      siteAnalyses: [{ executionMotor: { admitted: true, assessment_status: 'ASSESSED', assessment_artifact_id: 'assessment-older', findings: [] } }],
    };
    await user.click(screen.getByTestId('lu-run'));
    await waitFor(() => expect(screen.queryByTestId('lu-run-outcome')).not.toBeInTheDocument());
    await user.click(screen.getByTestId('nav-home'));
    await user.click(screen.getByTestId('nav-localization'));
    await waitForAssessment();
    expect(screen.queryByTestId('lu-run-outcome')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-results-not-latest-run')).not.toBeInTheDocument();
  });

  it('outside the shell (e.g. a reload, a new session) the workspace has nothing to remember -- and claims nothing', async () => {
    const user = userEvent.setup();
    mockApi(deniedRun);
    render(<LuWorkspace initialDesignation="UPPSALA SVIA 1:111" />);
    await waitForAssessment();
    expect(screen.queryByTestId('lu-run-outcome')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('lu-run'));
    expect(await screen.findByTestId('lu-run-outcome-status')).toHaveTextContent('Ej bedömd – nekad av styrning');
  });
});
