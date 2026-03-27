import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Permit } from '../../types';

vi.mock('../../components/MapView', () => ({
  default: () => <div data-testid="map-view" />,
}));

vi.mock('../../components/WeatherRisk', () => ({
  default: ({ municipality }: { municipality: string }) => (
    <div data-testid="weather-risk">{municipality}</div>
  ),
}));

import PermitPortalMapPanel from '../../components/PermitPortalMapPanel';

const twoMuniPermits: Permit[] = [
  {
    id: 'p1',
    diarienummer: 'D-001',
    municipality: 'Stockholm',
    decision_type: 'BIFALL',
    permit_type: 'C-ANMALAN',
    date: '2024-01-01',
    description: 'Stockholm permit',
    lat: 59.33,
    lng: 18.06,
  },
  {
    id: 'p2',
    diarienummer: 'D-002',
    municipality: 'Göteborg',
    decision_type: 'AVSLAG',
    permit_type: 'TILLSTAND',
    date: '2024-06-01',
    description: 'Göteborg permit',
  },
];

describe('PermitPortalMapPanel', () => {
  // ── Empty state ───────────────────────────────────────────────────────────

  it('renders without crashing with empty permits', () => {
    render(<PermitPortalMapPanel permits={[]} />);
    expect(screen.getByText(/Kartbaserad insikt/i)).toBeInTheDocument();
  });

  it('shows overview section', () => {
    render(<PermitPortalMapPanel permits={[]} />);
    expect(screen.getByText(/Oversikt/i)).toBeInTheDocument();
  });

  // ── With permits ──────────────────────────────────────────────────────────

  it('renders MapView component', () => {
    render(<PermitPortalMapPanel permits={twoMuniPermits} />);
    expect(screen.getByTestId('map-view')).toBeInTheDocument();
  });

  it('renders WeatherRisk for the active municipality', () => {
    render(<PermitPortalMapPanel permits={twoMuniPermits} />);
    expect(screen.getByTestId('weather-risk')).toBeInTheDocument();
  });

  it('shows municipality names in dropdown', () => {
    render(<PermitPortalMapPanel permits={twoMuniPermits} />);
    expect(screen.getByRole('option', { name: 'Stockholm' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Göteborg' })).toBeInTheDocument();
  });

  it('shows heading text', () => {
    render(<PermitPortalMapPanel permits={twoMuniPermits} />);
    expect(screen.getByText(/Kartbaserad insikt med riskstod/i)).toBeInTheDocument();
  });

  it('renders with single permit', () => {
    render(<PermitPortalMapPanel permits={[twoMuniPermits[0]]} />);
    expect(screen.getByTestId('map-view')).toBeInTheDocument();
  });
});
