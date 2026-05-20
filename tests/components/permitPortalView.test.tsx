import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/MapView', () => ({
  default: ({ permits }: { permits: unknown[] }) => (
    <div data-testid="map-view">Map View ({permits.length} permits)</div>
  ),
}));

vi.mock('../../components/WeatherRisk', () => ({
  default: ({ municipality }: { municipality: string }) => (
    <div data-testid="weather-risk">Weather Risk ({municipality})</div>
  ),
}));

vi.mock('../../components/RequirementChecklist', () => ({
  default: ({ code }: { code: { code: string } }) => (
    <div data-testid="requirement-checklist">Requirement Checklist ({code.code})</div>
  ),
}));

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: () => ({
    plan: {
      mapLayerSelection: { enabled: [] },
    },
    setPlan: vi.fn(),
    addArchiveDocument: vi.fn(),
    evaluateGate: vi.fn().mockResolvedValue({ status: 'READY', changed: false }),
    markModuleReady: vi.fn(),
  }),
}));

vi.mock('../../services/coreApiClient', () => ({
  callApi: vi.fn().mockResolvedValue({
    ok: true,
    state: 'ready',
    codes: [
      { code: '17 05 04', name: 'Jord och sten', type: 'EWC' },
      { code: '90.131', name: 'Miljöfarlig verksamhet', type: 'SNI' },
    ],
  }),
  getActiveProjectId: vi.fn().mockReturnValue('project-1'),
}));

import PermitPortalView from '../../components/PermitPortalView';
import { type Permit, DecisionType } from '../../types';

const samplePermits: Permit[] = [
  {
    id: '1',
    filename: 'permit-001.pdf',
    checksum: 'abc123',
    received_date: '2024-01-01',
    property_id: 'PROP-001',
    municipality: 'Stockholm',
    waste_codes: '17 05 04',
    decision_type: DecisionType.BIFALL,
    full_text: 'Test permit',
    processed_at: '2024-01-02',
  },
];

describe('PermitPortalView', () => {
  it('renders map view in default map mode', async () => {
    render(<PermitPortalView permits={samplePermits} />);
    expect(await screen.findByTestId('map-view')).toBeInTheDocument();
  });

  it('does not render apply content in map mode', async () => {
    render(<PermitPortalView permits={samplePermits} />);
    await screen.findByTestId('map-view');
    expect(screen.queryByText(/Juridiskt säker ansökan med smart kodväljare/i)).not.toBeInTheDocument();
  });

  it('passes permits to the map view', async () => {
    render(<PermitPortalView permits={samplePermits} />);
    expect(await screen.findByText('Map View (1 permits)')).toBeInTheDocument();
  });

  it('renders apply mode content', async () => {
    render(<PermitPortalView permits={samplePermits} mode="apply" />);
    expect(await screen.findByText(/Juridiskt säker ansökan med smart kodväljare/i)).toBeInTheDocument();
  });

  it('does not render map view in apply mode', async () => {
    render(<PermitPortalView permits={samplePermits} mode="apply" />);
    await screen.findByText(/Juridiskt säker ansökan med smart kodväljare/i);
    expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
  });

  it('shows the code selector in apply mode', async () => {
    render(<PermitPortalView permits={samplePermits} mode="apply" />);
    expect(await screen.findByText(/Kodväljare \(SNI & EWC\)/i)).toBeInTheDocument();
  });

  it('renders with empty permits array', async () => {
    render(<PermitPortalView permits={[]} />);
    expect(await screen.findByText('Map View (0 permits)')).toBeInTheDocument();
  });
});
