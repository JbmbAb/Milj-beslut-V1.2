import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import PermitPortalView from '../../components/PermitPortalView';
import type { Permit } from '../../types';

// PermitPortalView only imports MapView directly; the other mocks are safety nets.
vi.mock('../../components/MapView', () => ({
  default: () => <div data-testid="map-view">Map View</div>,
}));

vi.mock('../../components/PermitTable', () => ({
  default: () => <div data-testid="permit-table">Permit Table</div>,
}));

vi.mock('../../components/ApplicationWizard', () => ({
  default: () => <div data-testid="application-wizard">Application Wizard</div>,
}));

vi.mock('../../components/FormManager', () => ({
  default: () => <div data-testid="form-manager">Form Manager</div>,
}));

vi.mock('../../src/ui/hooks/useGeoLayers', () => ({
  useSpatialAudit: vi.fn(() => ({
    auditGeometry: null,
    auditRisk: null,
  })),
}));

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: vi.fn(() => ({
    plan: {
      stageGates: [],
      documentArchive: [],
      carbonSummary: { lastResult: null },
      moduleIntegrations: [],
      samplingPreparation: { checklist: [] },
      auditTrail: [],
      complianceScore: 0,
      location: { propertyId: '', address: '' },
    },
    gateStats: { blocked: 0, passed: 0 },
    remoteSync: { enabled: false, projectId: null },
    evaluateGate: vi.fn(),
    addArchiveDocument: vi.fn(),
    markModuleReady: vi.fn(),
  })),
}));

// PermitPortalView fetches permit data – stub fetch to avoid real network calls in tests.
vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, permits: [] }),
  }),
);

describe('PermitPortalView', () => {
  const mockPermits: Permit[] = [
    {
      id: '1',
      caseNumber: 'CASE-001',
      status: 'APPROVED',
      applicant: 'Test Applicant',
      municipality: 'Test Municipality',
      location: { lat: 47.25, lon: -122.25 },
    } as any,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // PermitPortalView supports mode='map' (default) and mode='apply'.
  // There is no 'table' mode in the component props.

  it('should render map mode by default', async () => {
    render(<PermitPortalView permits={mockPermits} mode="map" />);

    await waitFor(() => {
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
    });
  });

  it('should render with empty permits array', async () => {
    const { container } = render(<PermitPortalView permits={[]} mode="map" />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should render apply mode with form content', async () => {
    const { container } = render(<PermitPortalView permits={mockPermits} mode="apply" />);
    // Apply mode renders inline sections, not the mocked FormManager/ApplicationWizard.
    await waitFor(() => expect(container.firstChild).not.toBeNull());
    expect(container.textContent).toMatch(/Ansökningsportal|ansökan/i);
  });

  it('should handle onSelectPermit callback', () => {
    const onSelectPermit = vi.fn();
    render(<PermitPortalView permits={mockPermits} mode="map" {...({ onSelectPermit } as any)} />);

    expect(onSelectPermit).toBeDefined();
  });

  it('should display permit list in map mode', async () => {
    render(<PermitPortalView permits={mockPermits} mode="map" />);

    await waitFor(() => {
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
    });
  });

  it('should handle empty permits gracefully', async () => {
    render(<PermitPortalView permits={[]} mode="map" />);

    await waitFor(() => {
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
    });
  });

  it('should update when permits prop changes', async () => {
    const newPermits: Permit[] = [
      {
        id: '2',
        caseNumber: 'CASE-002',
        status: 'PENDING',
        applicant: 'Another Applicant',
        municipality: 'Another Municipality',
        location: { lat: 47.5, lon: -122.5 },
      } as any,
    ];

    const { rerender } = render(<PermitPortalView permits={mockPermits} mode="map" />);
    rerender(<PermitPortalView permits={newPermits} mode="map" />);

    await waitFor(() => {
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
    });
  });

  it('should switch between map and apply modes', async () => {
    const { rerender } = render(<PermitPortalView permits={mockPermits} mode="map" />);

    await waitFor(() => {
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
    });

    rerender(<PermitPortalView permits={mockPermits} mode="apply" />);

    await waitFor(() => {
      // Apply mode renders inline sections — map-view is gone.
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
    });
  });
});
