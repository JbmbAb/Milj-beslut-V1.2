import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  callApi: vi.fn(),
  getActiveProjectId: vi.fn(() => 'project-1'),
  fetchPropertyInfo: vi.fn(),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="localization-map">{children}</div>,
  TileLayer: () => null,
  GeoJSON: () => null,
  CircleMarker: () => null,
  Tooltip: () => null,
  useMap: () => ({
    getBounds: () => ({
      getWest: () => 18.04,
      getSouth: () => 59.31,
      getEast: () => 18.1,
      getNorth: () => 59.35,
    }),
    fitBounds: vi.fn(),
  }),
  useMapEvents: () => null,
}));

vi.mock('../../services/coreApiClient', () => ({
  callApi: apiMocks.callApi,
  getActiveProjectId: apiMocks.getActiveProjectId,
}));

vi.mock('../../src/ui/api-client/geo.client', () => ({
  fetchPropertyInfo: apiMocks.fetchPropertyInfo,
}));

import { LocalizationStudyUI } from '../../components/LocalizationStudyUI';

const user = userEvent.setup({ delay: null });

function mockGeodataFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/geodata/')) {
      return Promise.resolve(handler(url));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

describe('LocalizationStudyUI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('renders geodata layer panel and fetches enabled layers for bbox', async () => {
    const requested: string[] = [];
    mockGeodataFetch((url) => {
      requested.push(url);
      return {
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [18.05, 59.33] }, properties: {} }],
          meta: { available: true },
        }),
      } as Response;
    });

    render(<LocalizationStudyUI />);

    expect(screen.getByText(/Scout Mode/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(requested.some((url) => url.includes('/api/geodata/soil?bbox='))).toBe(true);
    });
  });

  it('shows unavailable diagnostics when geodata responds with meta.available false', async () => {
    mockGeodataFetch((url) => {
      if (url.includes('/api/geodata/protected-nature')) {
        return {
          ok: true,
          json: async () => ({
            type: 'FeatureCollection',
            features: [],
            meta: { available: false, warning: 'NVR ej indexerad' },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ type: 'FeatureCollection', features: [], meta: { available: true } }),
      } as Response;
    });

    render(<LocalizationStudyUI />);

    expect(await screen.findByText(/Datakälla saknas för: Skyddad natur \(NVR\)/i)).toBeInTheDocument();
  });

  it('calls localization report and PDF export APIs after property lookup', async () => {
    mockGeodataFetch(() => ({
      ok: true,
      json: async () => ({ type: 'FeatureCollection', features: [], meta: { available: true } }),
    } as Response));

    apiMocks.fetchPropertyInfo.mockResolvedValue({
      designation: 'NACKA BOO 1:2',
      municipality: 'Nacka',
      centroid: { lat: 59.33, lng: 18.07 },
    });

    apiMocks.callApi.mockImplementation(async (path: string) => {
      if (path === '/api/localization/generate-report') {
        return {
          ok: true,
          projectId: 'project-1',
          generatedAt: new Date().toISOString(),
          siteAnalyses: [
            {
              site: { id: 'FASTIGHET', lat: 59.33, lng: 18.07 },
              complianceAnalysis: {
                permitProbability: 0.85,
                requiredActions: [],
                notes: []
              }
            }
          ],
          humanInTheLoop: 'Granska rapporten manuellt innan beslut.',
        };
      }
      if (path === '/api/localization/export-pdf') {
        return new Blob(['%PDF'], { type: 'application/pdf' });
      }
      throw new Error(`Unexpected callApi path: ${path}`);
    });

    render(<LocalizationStudyUI />);

    await user.type(screen.getByPlaceholderText(/VÄRMDÖ STACKMORA/i), 'NACKA BOO 1:2');
    await user.click(screen.getByRole('button', { name: /^Hämta$/i }));

    await waitFor(() => {
      expect(apiMocks.fetchPropertyInfo).toHaveBeenCalledWith('NACKA BOO 1:2', 'project-1');
    });

    await user.click(screen.getByRole('button', { name: /Generera underlag/i }));
    await waitFor(() => {
      expect(apiMocks.callApi).toHaveBeenCalledWith(
        '/api/localization/generate-report',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText(/85% Godkänd/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Exportera PDF/i }));
    await waitFor(() => {
      expect(apiMocks.callApi).toHaveBeenCalledWith(
        '/api/localization/export-pdf',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
