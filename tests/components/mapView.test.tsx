import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/geminiService', () => ({
  fetchMunicipalityContext: vi.fn(),
}));

import MapView from '../../components/MapView';
import { DecisionType, type Permit, type Receiver } from '../../types';

// ── helpers ───────────────────────────────────────────────────────────────────

const basePermit: Permit = {
  id: 1,
  filename: 'permit.pdf',
  checksum: 'abc',
  received_date: '2024-01-01',
  property_id: 'PROP-1',
  municipality: 'Stockholm',
  waste_codes: '19 12 12',
  decision_type: DecisionType.BIFALL,
  full_text: 'text',
  processed_at: '2024-01-02',
};

const baseReceiver: Receiver = {
  id: 'R1',
  name: 'Mottagare AB',
  type: 'RECYCLING',
  lat: 59.3,
  lng: 18.0,
  allowedCodes: [],
  isHazardousAllowed: false,
};

function buildLeafletMock() {
  const mockLayer = {
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn().mockReturnThis(),
    clearLayers: vi.fn().mockReturnThis(),
    getLayers: vi.fn().mockReturnValue([]),
    addLayer: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    off: vi.fn().mockReturnThis(),
    bindPopup: vi.fn().mockReturnThis(),
    getBounds: vi.fn().mockReturnValue(null),
    setStyle: vi.fn().mockReturnThis(),
  };
  const mockMarker = {
    addTo: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    bindPopup: vi.fn().mockReturnThis(),
    remove: vi.fn().mockReturnThis(),
  };
  const mockMap = {
    setView: vi.fn().mockReturnThis(),
    getBounds: vi.fn().mockReturnValue({
      toBBoxString: vi.fn().mockReturnValue('17,59,19,60'),
    }),
    removeLayer: vi.fn(),
    hasLayer: vi.fn().mockReturnValue(false),
    addLayer: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    eachLayer: vi.fn(),
    invalidateSize: vi.fn(),
    createPane: vi.fn(),
  };
  return {
    map: vi.fn().mockReturnValue(mockMap),
    control: { zoom: vi.fn().mockReturnValue({ addTo: vi.fn() }) },
    tileLayer: Object.assign(vi.fn().mockReturnValue(mockLayer), {
      wms: vi.fn().mockReturnValue(mockLayer),
    }),
    geoJSON: vi.fn().mockReturnValue(mockLayer),
    popup: vi.fn().mockReturnValue({
      setLatLng: vi.fn().mockReturnThis(),
      setContent: vi.fn().mockReturnThis(),
      openOn: vi.fn().mockReturnThis(),
    }),
    divIcon: vi.fn().mockReturnValue({}),
    marker: vi.fn().mockReturnValue(mockMarker),
    layerGroup: vi.fn().mockReturnValue(mockLayer),
    circleMarker: vi.fn().mockReturnValue(mockMarker),
    _mockMap: mockMap,
  };
}

describe('MapView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset window.L between tests
    (window as unknown as Record<string, unknown>).L = undefined;
  });

  // ── No Leaflet runtime ──────────────────────────────────────────────────────

  it('shows Leaflet missing notice when window.L is absent', () => {
    render(<MapView />);
    expect(
      screen.getByText(/Leaflet saknas i runtime/i),
    ).toBeInTheDocument();
  });

  it('renders the layer control panel (Integrerade myndighetslager)', () => {
    render(<MapView />);
    expect(screen.getByText(/Integrerade myndighetslager/i)).toBeInTheDocument();
  });

  it('renders base layer buttons: Topo, Orto, OSM', () => {
    render(<MapView />);
    expect(screen.getByRole('button', { name: /Topo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Orto/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /OSM/i })).toBeInTheDocument();
  });

  it('renders Importera punktmoln label', () => {
    render(<MapView />);
    expect(screen.getByText(/Importera punktmoln/i)).toBeInTheDocument();
  });

  it('renders some overlay layer labels', () => {
    render(<MapView />);
    expect(screen.getByText(/SGU jordart WMS/i)).toBeInTheDocument();
    expect(screen.getByText(/Natura 2000/i)).toBeInTheDocument();
    expect(screen.getByText(/Oversvamningsrisk/i)).toBeInTheDocument();
  });

  it('renders without crashing with permits and receivers', () => {
    render(<MapView permits={[basePermit]} receivers={[baseReceiver]} />);
    expect(screen.getByText(/Integrerade myndighetslager/i)).toBeInTheDocument();
  });

  // ── With Leaflet mock ───────────────────────────────────────────────────────

  it('initialises Leaflet map when window.L is available', () => {
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;
    render(<MapView />);
    expect(mockL.map).toHaveBeenCalledTimes(1);
  });

  it('Topo is the active base layer by default', () => {
    render(<MapView />);
    const topoBtn = screen.getByRole('button', { name: /Topo/i });
    // Active button gets bg-slate-900 class
    expect(topoBtn.className).toContain('bg-slate-900');
  });

  it('switches active base layer when OSM is clicked (with Leaflet mock)', async () => {
    const user = userEvent.setup({ delay: null });
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;
    render(<MapView />);
    await user.click(screen.getByRole('button', { name: /OSM/i }));
    // After clicking OSM, the OSM button should become active (bg-slate-900)
    const osmBtn = screen.getByRole('button', { name: /OSM/i });
    expect(osmBtn.className).toContain('bg-slate-900');
  });
});
