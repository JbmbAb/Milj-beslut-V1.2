import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Permit } from '../../types';
import { DecisionType } from '../../types';

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: () => ({
    syncPermitToArchive: vi.fn(),
    addArchiveDocument: vi.fn(),
    markModuleReady: vi.fn(),
    runTransportComplianceFlow: vi.fn().mockResolvedValue({
      bookingId: 'BK-001',
      carbonGate: 'PASSED',
      documentGate: 'PASSED',
      preliminary: false,
    }),
    remoteSync: {
      enabled: false,
      projectId: '',
      syncing: false,
      lastLoadedAt: '',
      lastSavedAt: '',
      error: '',
    },
  }),
}));

vi.mock('../../components/StatsOverview', () => ({
  default: ({ stats }: { stats: Record<string, number> }) => (
    <div data-testid="stats-overview">Total: {stats.total}</div>
  ),
}));

vi.mock('../../components/PermitTable', () => ({
  default: () => <div data-testid="permit-table" />,
}));

vi.mock('../../components/MapView', () => ({
  default: () => <div data-testid="map-view" />,
}));

import MarketIntelView from '../../components/MarketIntelView';

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
    full_text: 'Test permit 1',
    processed_at: '2024-01-02',
  },
  {
    id: '2',
    filename: 'permit-002.pdf',
    checksum: 'def456',
    received_date: '2024-06-01',
    property_id: 'PROP-002',
    municipality: 'Göteborg',
    waste_codes: '17 05 04',
    decision_type: DecisionType.AVSLAG,
    full_text: 'Test permit 2',
    processed_at: '2024-06-02',
  },
];

describe('MarketIntelView – archive mode', () => {
  // ── Archive mode (default) ─────────────────────────────────────────────────

  it('renders Data och KPI label in archive mode', () => {
    render(<MarketIntelView permits={samplePermits} onSelectPermit={vi.fn()} />);
    expect(screen.getByText('Data och KPI')).toBeInTheDocument();
  });

  it('renders Beslutsarkiv heading', () => {
    render(<MarketIntelView permits={samplePermits} onSelectPermit={vi.fn()} />);
    expect(screen.getByText(/Beslutsarkiv for logistik/i)).toBeInTheDocument();
  });

  it('renders Synka till projektplan button', () => {
    render(<MarketIntelView permits={samplePermits} onSelectPermit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Synka till projektplan/i })).toBeInTheDocument();
  });

  it('renders StatsOverview with correct total', () => {
    render(<MarketIntelView permits={samplePermits} onSelectPermit={vi.fn()} />);
    expect(screen.getByTestId('stats-overview')).toHaveTextContent('Total: 2');
  });

  it('renders PermitTable', () => {
    render(<MarketIntelView permits={samplePermits} onSelectPermit={vi.fn()} />);
    expect(screen.getByTestId('permit-table')).toBeInTheDocument();
  });

  it('renders Compliance-check section', () => {
    render(<MarketIntelView permits={samplePermits} onSelectPermit={vi.fn()} />);
    expect(screen.getByText('Compliance-check')).toBeInTheDocument();
  });

  it('renders MapView in archive mode', () => {
    render(<MarketIntelView permits={samplePermits} onSelectPermit={vi.fn()} />);
    expect(screen.getByTestId('map-view')).toBeInTheDocument();
  });
});

describe('MarketIntelView – logistics mode', () => {
  it('renders Logistik och schaktmassor label', () => {
    render(<MarketIntelView permits={samplePermits} onSelectPermit={vi.fn()} mode="logistics" />);
    expect(screen.getByText('Logistik och schaktmassor')).toBeInTheDocument();
  });

  it('renders Avfallskod (EWC) select', () => {
    render(<MarketIntelView permits={samplePermits} onSelectPermit={vi.fn()} mode="logistics" />);
    expect(screen.getByText(/Avfallskod.*EWC/i)).toBeInTheDocument();
  });

  it('shows transport flow blocked warning when remoteSync disabled', () => {
    render(<MarketIntelView permits={samplePermits} onSelectPermit={vi.fn()} mode="logistics" />);
    expect(
      screen.getByText(
        /Operativt transportflode ar blockerat tills giltig backend-session och aktivt projekt finns\./i,
      ),
    ).toBeInTheDocument();
  });
});
