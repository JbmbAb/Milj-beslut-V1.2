import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type Permit, DecisionType } from '../../types';

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
    id: '1',
    filename: 'permit-001.pdf',
    checksum: 'abc123',
    received_date: '2024-01-01',
    property_id: 'PROP-001',
    municipality: 'Stockholm',
    waste_codes: '17 05 04',
    decision_type: DecisionType.BIFALL,
    full_text: 'Stockholm permit',
    processed_at: '2024-01-02',
    lat: 59.33,
    lng: 18.06,
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
    full_text: 'Göteborg permit',
    processed_at: '2024-06-02',
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
