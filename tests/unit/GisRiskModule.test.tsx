import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { resetCsrfTokenCache } from '../../services/csrfClient';
import GisRiskModule from '../../components/GisRiskModule';

vi.mock('../../services/geminiService', () => ({
  analyzeGeoRisk: vi.fn(),
  fetchRiskLayers: vi.fn(),
}));

vi.mock('../../src/ui/hooks/useGeoLayers', () => ({
  useSpatialAudit: vi.fn(() => ({
    auditGeometry: null,
    auditRisk: { riskLevel: 'LOW' },
  })),
}));

vi.mock('../../components/MapView', () => ({
  default: () => <div data-testid="map-view">Map View</div>,
}));

const mockPlanBase = {
  stageGates: [],
  documentArchive: [],
  carbonSummary: { lastResult: null },
  moduleIntegrations: [],
  samplingPreparation: { checklist: [] },
  auditTrail: [],
  complianceScore: 0,
  location: { propertyId: '', address: '' },
};

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: vi.fn(() => ({
    plan: mockPlanBase,
    gateStats: { blocked: 0, passed: 0 },
    remoteSync: { enabled: false, projectId: null },
    evaluateGate: vi.fn().mockResolvedValue({ status: 'PASSED' }),
    addArchiveDocument: vi.fn(),
    markModuleReady: vi.fn(),
  })),
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentPropsWithoutRef<'div'>) => <div {...props}>{children}</div>,
  },
}));

function createStorageMock(values: Record<string, string>) {
  return {
    getItem: vi.fn((key: string) => values[key] ?? null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
}

describe('GisRiskModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'localStorage',
      createStorageMock({
        miljobeslut_admin_bearer: 'token-123',
        miljobeslut_admin_project: 'project-123',
      }),
    );
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    resetCsrfTokenCache();
    vi.unstubAllGlobals();
  });

  it('should render risk module container', () => {
    const { container } = render(<GisRiskModule />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should display map view', async () => {
    render(<GisRiskModule />);

    await waitFor(() => {
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
    });
  });

  it('shows property details after a successful property lookup', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'csrf-123' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            designation: 'ORSA STACKMORA 3:12>2',
            requestedDesignation: 'ORSA STACKMORA 3:12 (2)',
            normalizedDesignation: 'ORSA STACKMORA 3:12>2',
            source: 'live',
            geometryStatus: 'present',
            fetchedAt: '2026-04-11T10:00:00.000Z',
            geometry: { type: 'Polygon', coordinates: [] },
            boundaries: {
              properties: {
                kommunnamn: 'ORSA',
                trakt: 'STACKMORA',
                objektidentitet: 'obj-123',
              },
            },
            ownership: {
              ownerType: 'PRIVATE',
              share: '1/1',
            },
          },
        }),
      } as Response);

    render(<GisRiskModule />);

    fireEvent.change(screen.getByPlaceholderText('t.ex. NACKA BOO 1:1'), {
      target: { value: 'ORSA STACKMORA 3:12 (2)' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Visa/ }));

    await waitFor(() => {
      expect(screen.getByText(/visas p/i)).toBeInTheDocument();
    });

    expect(screen.getByText('obj-123')).toBeInTheDocument();
    expect(screen.getByText('PRIVATE')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText(/Polygon \(present\)/)).toBeInTheDocument();
    expect(screen.getByText('Visa hela LM-svaret')).toBeInTheDocument();
  });

  it('blocks demo geometry returned from an old lookup flow', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'csrf-123' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            designation: 'DEMO 1:1',
            _demo: true,
            geometry: { type: 'Polygon', coordinates: [] },
          },
        }),
      } as Response);

    render(<GisRiskModule />);

    fireEvent.change(screen.getByPlaceholderText('t.ex. NACKA BOO 1:1'), {
      target: { value: 'ORSA STACKMORA 3:12 (2)' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Visa/ }));

    await waitFor(
      () => {
        expect(screen.getByText(/Icke verifierad geometri blockerades/)).toBeInTheDocument();
      },
      { timeout: 10_000 },
    );

    expect(screen.queryByText('DEMO 1:1')).not.toBeInTheDocument();
  });
});
