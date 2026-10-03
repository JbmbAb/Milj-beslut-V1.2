/**
 * W-UI1-R3 -- owner decision (Jimmy, 2026-10-03): the buttons that READ THE ASSESSMENT AGAIN say "Läs in på nytt",
 * not "Försök igen": at the property root's read error (ROOT_READ_ERROR) and at the map's contradiction (its evidence
 * contradicts the shown assessment). There a re-read happens, not a retry of a failure the server classified. The help
 * text follows the label. "Försök igen" stays ONLY where a failure the server marked retryable:true is repeated (and
 * where no server answered at all, the documented exception). The conditions for showing the buttons are unchanged.
 * Fully mocked: no network, no database (the map is mocked here; its own label is tested in luRereadLabelMapR3).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LuWorkspace } from '../../components/app/lu/LuWorkspace';
import { LuErrorNotice } from '../../components/app/lu/LuErrorNotice';
import { LU_REREAD_LABEL_SV, LU_RETRY_LABEL_SV, presentLuError, presentLuIncoherence } from '../../components/app/lu/luErrorPresentation';
import { governedReadBack } from '../fixtures/luGovernedReadBack';

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
vi.mock('../../src/ui/api-client/geo.client', () => ({ fetchPropertyInfo: (...args: unknown[]) => fetchPropertyInfo(...args) }));
vi.mock('../../services/coreApiClient', () => ({
  callApi: (...args: unknown[]) => callApi(...args),
  getActiveProjectId: () => 'proj-1',
}));
let lastMapProps: any = null;
vi.mock('../../components/CesiumMapView', () => ({
  default: (props: any) => {
    lastMapProps = props;
    return <div data-testid="cesium-map-view" />;
  },
}));

const apiError = (status: number, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { status, ...extra });
const ROOT_READ_ERROR = { status: 'TECHNICAL_ERROR', technical_error_class: 'ROOT_READ_ERROR', message_sv: 'x' };

function mockApi(opts: { currentAssessment: () => unknown; evidence?: () => unknown }) {
  fetchPropertyInfo.mockResolvedValue({
    id: 'p1', designation: 'UPPSALA SVIA 1:111', municipality: 'Uppsala',
    geometry: { type: 'Point', coordinates: [17.74, 59.87] }, centroid: { lat: 59.87, lng: 17.74 },
  });
  callApi.mockImplementation((url: string) => {
    if (url.includes('/current-assessment')) {
      const value = opts.currentAssessment();
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (url.includes('/viewer/evidence')) {
      const value = opts.evidence ? opts.evidence() : { type: 'FeatureCollection', features: [] };
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (url.includes('/geometry')) {
      return Promise.resolve({
        ok: true,
        geometry: { artifact_id: 'loc-geom-1', provenance: 'derived_from_property_boundary', wgs84LngLat: [17.74, 59.87], provisioningStatus: 'COMPLETED' },
      });
    }
    throw new Error(`unexpected callApi call in this test: ${url}`);
  });
}

async function open() {
  const user = userEvent.setup();
  render(<LuWorkspace />);
  await user.type(screen.getByTestId('lu-designation'), 'UPPSALA SVIA 1:111');
  await user.click(screen.getByTestId('lu-lookup'));
  expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();
  return user;
}

beforeEach(() => {
  fetchPropertyInfo.mockReset();
  callApi.mockReset();
  lastMapProps = null;
});

describe('W-UI1-R3: the property root\'s read error is re-read -- "Läs in på nytt", and the help text says so', () => {
  it('only the root\'s read error: the panel button says "Läs in på nytt", never "Försök igen"', async () => {
    mockApi({ currentAssessment: () => ({ ...governedReadBack({ id: 'assess-root' }), propertyRoot: ROOT_READ_ERROR }) });
    await open();
    const button = await screen.findByTestId('lu-control-retry');
    expect(button).toHaveTextContent(LU_REREAD_LABEL_SV);
    expect(button).not.toHaveTextContent(/Försök igen/i);
    const row = screen.getByTestId('lu-check-property');
    expect(row).toHaveTextContent('Fastighetsrotens proveniens kunde inte läsas just nu (tekniskt fel); läs in på nytt.');
    expect(row).not.toHaveTextContent(/försök igen/i);
    for (const attribute of ['aria-label', 'title']) {
      const value = button.getAttribute(attribute);
      if (value !== null) expect(value).toBe(LU_REREAD_LABEL_SV);
    }
  });

  it.each([
    ['a sound root', undefined],
    ['a root read error beside it', ROOT_READ_ERROR],
  ])('a failure the server marked retryable:true among the reasons (the pinned read error of the overall line), %s: "Försök igen"', async (_name, root) => {
    const base = governedReadBack({ id: 'assess-server', layers: { water: { kind: 'unreadable', readError: true } } });
    expect(base.overallStatement.coverage_state).toBe('PINNED_EVIDENCE_UNREADABLE');
    mockApi({ currentAssessment: () => (root ? { ...base, propertyRoot: root } : base) });
    await open();
    const button = await screen.findByTestId('lu-control-retry');
    expect(button).toHaveTextContent(LU_RETRY_LABEL_SV);
    expect(button).not.toHaveTextContent(LU_REREAD_LABEL_SV);
  });

  it('a lasting failure the server marked retryable:false: no button at all (unchanged)', async () => {
    mockApi({ currentAssessment: () => governedReadBack({ id: 'assess-lost', layers: { water: { kind: 'unreadable' } } }) });
    await open();
    await screen.findByTestId('lu-assessment-overall');
    expect(screen.queryByTestId('lu-control-retry')).not.toBeInTheDocument();
  });
});

describe('W-UI1-R3: the map\'s contradiction is re-read -- the workspace tells the map so; a server-retryable map failure stays "Försök igen"', () => {
  it('a 404 for the shown assessment\'s evidence (the map contradicts the view): re-read, with a help text that says "Läs in bedömningen på nytt"', async () => {
    mockApi({ currentAssessment: () => governedReadBack({ id: 'assess-map' }), evidence: () => apiError(404, 'Resource not found') });
    await open();
    await waitFor(() => expect(lastMapProps?.productEvidence?.status).toBe('error'));
    expect(lastMapProps.productEvidence.retryable).toBe(true);
    expect(lastMapProps.productEvidence.reread).toBe(true);
    expect(lastMapProps.productEvidence.messageSv).toMatch(/Läs in bedömningen på nytt\.$/);
    expect(lastMapProps.productEvidence.messageSv).not.toMatch(/Försök igen/i);
  });

  it.each([
    [true, true],
    [false, false],
  ])('a 503 the server marks retryable:%s: no re-read (a server-classified failure), retryable %s', async (flag, retryable) => {
    mockApi({
      currentAssessment: () => governedReadBack({ id: 'assess-map2' }),
      evidence: () => apiError(503, 'x', { code: 'VIEWER_PRESENTATION_UNRESOLVED', failureClass: 'READ_ERROR', retryable: flag }),
    });
    await open();
    await waitFor(() => expect(lastMapProps?.productEvidence?.status).toBe('error'));
    expect(lastMapProps.productEvidence.retryable).toBe(retryable);
    expect(lastMapProps.productEvidence.reread).toBeUndefined();
  });
});

describe('W-UI1-R3: the error notice -- "Läs in på nytt" for a re-read, "Försök igen" only for a server retryable:true (or no answer)', () => {
  const button = (error: ReturnType<typeof presentLuError>) => {
    const { container, unmount } = render(<LuErrorNotice error={error} testId="n" onRetry={() => undefined} />);
    const found = container.querySelector('[data-testid="n-retry"]');
    const text = found ? found.textContent : null;
    unmount();
    return text;
  };

  it('labels follow the action', () => {
    expect(button(presentLuError(apiError(404, 'Resource not found'), 'viewer-evidence'))).toBe(LU_REREAD_LABEL_SV);
    expect(button(presentLuIncoherence('x', []))).toBe(LU_REREAD_LABEL_SV);
    expect(button(presentLuError(apiError(503, 'x', { code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR', retryable: true }), 'current-assessment'))).toBe(LU_RETRY_LABEL_SV);
    expect(button(presentLuError(apiError(503, 'x', { code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR', retryable: false }), 'current-assessment'))).toBeNull();
    expect(button(presentLuError(apiError(503, 'x', { code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR' }), 'current-assessment'))).toBeNull();
    // No server answered at all (the documented exception): a retry of the same call.
    expect(button(presentLuError(new TypeError('Failed to fetch'), 'current-assessment'))).toBe(LU_RETRY_LABEL_SV);
  });

  it('a re-read is marked as such; a server-classified failure is not', () => {
    expect(presentLuError(apiError(404, 'Resource not found'), 'viewer-evidence').reread).toBe(true);
    expect(presentLuError(apiError(404, 'No current governed LU assessment is available for this project.'), 'viewer-evidence').reread).toBe(true);
    expect(presentLuIncoherence('x', []).reread).toBe(true);
    expect(presentLuError(apiError(503, 'x', { code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR', retryable: true }), 'current-assessment').reread).toBeUndefined();
    expect(presentLuError(apiError(409, 'x', { code: 'ASSESSMENT_ID_MISMATCH' }), 'verify').reread).toBeUndefined();
  });
});
