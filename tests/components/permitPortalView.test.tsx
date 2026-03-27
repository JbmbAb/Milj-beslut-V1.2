import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock lazy-loaded panels
vi.mock('../../components/PermitPortalApplyPanel', () => ({
  default: ({ permits }: { permits: unknown[] }) => (
    <div data-testid="apply-panel">Apply Panel ({permits.length} permits)</div>
  ),
}));

vi.mock('../../components/PermitPortalMapPanel', () => ({
  default: ({ permits }: { permits: unknown[] }) => (
    <div data-testid="map-panel">Map Panel ({permits.length} permits)</div>
  ),
}));

import PermitPortalView from '../../components/PermitPortalView';
import type { Permit } from '../../types';

const samplePermits: Permit[] = [
  {
    id: 'p1',
    diarienummer: 'DIA-001',
    municipality: 'Stockholm',
    decision_type: 'BIFALL',
    permit_type: 'C-ANMALAN',
    date: '2024-01-01',
    description: 'Test permit',
  },
];

describe('PermitPortalView', () => {
  // ── Map mode (default) ───────────────────────────────────────────────────

  it('renders map panel in default map mode', async () => {
    render(<PermitPortalView permits={samplePermits} />);
    expect(await screen.findByTestId('map-panel')).toBeInTheDocument();
  });

  it('does not render apply panel in map mode', async () => {
    render(<PermitPortalView permits={samplePermits} />);
    await screen.findByTestId('map-panel');
    expect(screen.queryByTestId('apply-panel')).not.toBeInTheDocument();
  });

  it('passes permits to map panel', async () => {
    render(<PermitPortalView permits={samplePermits} />);
    expect(await screen.findByText('Map Panel (1 permits)')).toBeInTheDocument();
  });

  // ── Apply mode ────────────────────────────────────────────────────────────

  it('renders apply panel in apply mode', async () => {
    render(<PermitPortalView permits={samplePermits} mode="apply" />);
    expect(await screen.findByTestId('apply-panel')).toBeInTheDocument();
  });

  it('does not render map panel in apply mode', async () => {
    render(<PermitPortalView permits={samplePermits} mode="apply" />);
    await screen.findByTestId('apply-panel');
    expect(screen.queryByTestId('map-panel')).not.toBeInTheDocument();
  });

  it('passes permits to apply panel', async () => {
    render(<PermitPortalView permits={samplePermits} mode="apply" />);
    expect(await screen.findByText('Apply Panel (1 permits)')).toBeInTheDocument();
  });

  it('renders with empty permits array', async () => {
    render(<PermitPortalView permits={[]} />);
    expect(await screen.findByTestId('map-panel')).toBeInTheDocument();
  });
});
