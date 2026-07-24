import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  callApi: vi.fn(),
  getActiveProjectId: vi.fn(() => 'project-1'),
  runGisAnalysis: vi.fn(),
  isAnalyzingGis: false,
}));

vi.mock('../../services/coreApiClient', () => ({
  callApi: apiMocks.callApi,
  getActiveProjectId: apiMocks.getActiveProjectId,
}));

vi.mock('../../components/admin/hooks/useMassGisAnalysis', () => ({
  useMassGisAnalysis: (options?: {
    onSuccess?: (data: {
      analysis: {
        propertyDesignation: string;
        centroid: { lat: number; lng: number };
        overallRiskScore: number;
        logisticsSuitability: string;
        siteConstraints: [];
        warnings: [];
        reasoning: [];
        timestamp: string;
      };
      siteProfile: {
        propertyDesignation: string;
        centroid: { lat: number; lng: number };
        recommendedZones: Array<{ id: string; label: string; operationType: string; offsetM: number }>;
        source: string;
      };
      propertySource: string;
    }) => void;
  }) => ({
    mutate: (payload: unknown) => {
      apiMocks.runGisAnalysis(payload);
      options?.onSuccess?.({
        analysis: {
          propertyDesignation: 'STOCKHOLM 1:1',
          timestamp: new Date().toISOString(),
          centroid: { lat: 59.33, lng: 18.07 },
          overallRiskScore: 35,
          logisticsSuitability: 'SUITABLE',
          siteConstraints: [],
          warnings: [],
          reasoning: [],
        },
        siteProfile: {
          propertyDesignation: 'STOCKHOLM 1:1',
          centroid: { lat: 59.33, lng: 18.07 },
          recommendedZones: [
            { id: 'z1', label: 'Mellanlagring A', operationType: 'MELLANLAGRING', offsetM: 40 },
          ],
          source: 'test',
        },
        propertySource: 'postgis',
      });
    },
    isPending: apiMocks.isAnalyzingGis,
    error: null,
  }),
}));

vi.mock('../../components/admin/modules/c-notification-mass/MassMapView', () => ({
  default: ({ requiredMapLayers }: { requiredMapLayers?: string[] }) => (
    <div data-testid="mass-map-view">MPF-lager: {(requiredMapLayers ?? []).join(', ')}</div>
  ),
}));

import { CNotificationMassUI } from '../../components/admin/modules/c-notification-mass/CNotificationMassUI';
import type { MassGISAnalysis, MassSiteProfile } from '../../types';

const user = userEvent.setup({ delay: null });

const analysis: MassGISAnalysis = {
  propertyDesignation: 'STOCKHOLM 1:1',
  timestamp: new Date().toISOString(),
  centroid: { lat: 59.33, lng: 18.07 },
  siteConstraints: [{ code: 'NVR', label: 'Skyddad natur', severity: 'MEDIUM' }],
  overallRiskScore: 42,
  logisticsSuitability: 'REVIEW_REQUIRED',
  warnings: [],
  reasoning: [],
};

const siteProfile: MassSiteProfile = {
  propertyDesignation: 'STOCKHOLM 1:1',
  centroid: { lat: 59.33, lng: 18.07 },
  source: 'test',
  recommendedZones: [{ id: 'z1', label: 'Mellanlagring A', operationType: 'MELLANLAGRING', offsetM: 40 }],
};

describe('CNotificationMassUI', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders mass module header and step navigation', () => {
    render(<CNotificationMassUI />);
    expect(
      screen.getByText(/Anmälan om mellanlagring, sortering och återvinning av schaktmassor/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Spara delbeslut/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportera PDF/i })).toBeInTheDocument();
  });

  it('runs GIS analysis from property step', async () => {
    render(<CNotificationMassUI />);

    const input = screen.getByPlaceholderText(/Fastighetsbeteckning\.\.\./i);
    await user.type(input, 'STOCKHOLM 1:1');

    await user.click(screen.getByRole('button', { name: /Kör ny GIS-analys/i }));

    await waitFor(() => {
      expect(apiMocks.runGisAnalysis).toHaveBeenCalled();
      expect(screen.getByText(/GIS-analys klar/i)).toBeInTheDocument();
    });
  });

  it('calls validate-codes when validating operation draft', async () => {
    apiMocks.callApi.mockResolvedValue({
      ok: true,
      mpfDecision: {
        gateDecision: 'EXEMPT',
        primaryCodeType: 'EWC',
        activityCode: null,
        notes: 'Staging-validering klar.',
        advisorySignals: [],
        ewcEvaluation: { code: '17 05 04', gateDecision: 'EXEMPT', notes: 'OK' },
        sniEvaluation: null,
        primaryPermitProfile: null,
        requiredMapLayers: ['postgis_nvr'],
        geofenceLayers: [{ key: 'postgis_nvr', label: 'Skyddad natur', reason: 'NVR' }],
        isSensitiveArea: false,
        registryVersion: 'test',
      },
    });

    render(<CNotificationMassUI />);

    const input = screen.getByPlaceholderText(/Fastighetsbeteckning\.\.\./i);
    await user.type(input, 'STOCKHOLM 1:1');
    await user.click(screen.getByRole('button', { name: /Kör ny GIS-analys/i }));

    const validateButtons = screen.getAllByRole('button', { name: /Slutför MPF-screening/i });
    await user.click(validateButtons[0]!);

    await waitFor(() => {
      expect(apiMocks.callApi).toHaveBeenCalledWith(
        '/api/c-notification/mass/validate-codes',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
