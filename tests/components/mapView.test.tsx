import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/geminiService', () => ({
  fetchMunicipalityContext: vi.fn(),
}));

vi.mock('../../src/ui/hooks/useGeoLayers', () => ({
  useMapLayerCatalog: vi.fn(() => ({
    data: [
      { key: 'postgis_nvr', label: 'Skyddad natur' },
      { key: 'raa_fornlamning_wfs', label: 'Fornlamningar (RAA WFS)' },
    ],
    isLoading: false,
    isError: false,
  })),
  useSpatialAudit: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue('GIS result'),
  })),
  useOgcFederatedMapLayers: vi.fn(() => ({
    wmsLayers: [],
    catalogLabelById: new Map(),
    warnings: [],
    isLoading: false,
    isError: false,
  })),
}));

import MapView from '../../components/MapView';
import { DecisionType, type Permit, type Receiver } from '../../types';

// ── helpers ───────────────────────────────────────────────────────────────────

const basePermit: Permit = {
  id: '1',
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
  const markers: Array<{
    coords: [number, number];
    options?: unknown;
    handlers: Record<string, (() => void) | undefined>;
    addTo: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    bindPopup: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }> = [];
  const mockMap = {
    setView: vi.fn().mockReturnThis(),
    fitBounds: vi.fn().mockReturnThis(),
    getBounds: vi.fn().mockReturnValue({
      toBBoxString: vi.fn().mockReturnValue('17,59,19,60'),
      isValid: vi.fn().mockReturnValue(true),
      getWest: vi.fn().mockReturnValue(17),
      getSouth: vi.fn().mockReturnValue(59),
      getEast: vi.fn().mockReturnValue(19),
      getNorth: vi.fn().mockReturnValue(60),
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
  const marker = vi.fn((coords: [number, number], options?: unknown) => {
    const handlers: Record<string, (() => void) | undefined> = {};
    const instance = {
      coords,
      options,
      handlers,
      addTo: vi.fn().mockReturnThis(),
      on: vi.fn((event: string, callback: () => void) => {
        handlers[event] = callback;
        return instance;
      }),
      bindPopup: vi.fn().mockReturnThis(),
      remove: vi.fn().mockReturnThis(),
    };
    markers.push(instance);
    return instance;
  });
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
    marker,
    layerGroup: vi.fn().mockReturnValue(mockLayer),
    circleMarker: vi.fn(() => marker([0, 0])),
    _markers: markers,
    _mockMap: mockMap,
  };
}

function renderMapView(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('MapView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset window.L between tests
    (window as unknown as Record<string, unknown>).L = undefined;
  });

  // ── No Leaflet runtime ──────────────────────────────────────────────────────

  it('shows Leaflet missing notice when window.L is absent', () => {
    renderMapView(<MapView />);
    expect(screen.getByText(/Leaflet saknas i runtime/i)).toBeInTheDocument();
  });

  it('renders the layer control panel', () => {
    renderMapView(<MapView />);
    expect(screen.getByText(/Myndighetslager/i)).toBeInTheDocument();
  });

  it('renders grundkarta base-layer controls when Leaflet is available', () => {
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;
    renderMapView(<MapView />);
    expect(screen.getByText(/Grundkarta/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^OSM$/i })).toBeInTheDocument();
  });

  it('configures OSM, topo and ortho base layers when Leaflet is available', () => {
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;
    renderMapView(<MapView />);
    expect(mockL.tileLayer).toHaveBeenCalledWith('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(mockL.tileLayer.wms).toHaveBeenCalledWith(
      'https://api.lantmateriet.se/open/topowebb-ccby/v1/wms',
      expect.objectContaining({ layers: 'topowebb' }),
    );
    expect(mockL.tileLayer.wms).toHaveBeenCalledWith(
      'https://api.lantmateriet.se/open/ortofoto-ccby/v1/wms',
      expect.objectContaining({ layers: expect.stringContaining('Ortofoto') }),
    );
  }, 15000);

  it('renders property boundary overlay label', () => {
    renderMapView(<MapView />);
    expect(screen.getByText(/Fastighetsgränser/i)).toBeInTheDocument();
  });

  it('renders some overlay layer labels', () => {
    renderMapView(<MapView />);
    expect(screen.getByText(/SGU grundlager/i)).toBeInTheDocument();
    expect(screen.getByText(/Skyddad natur/i)).toBeInTheDocument();
    expect(screen.getByText(/Natura 2000/i)).toBeInTheDocument();
    expect(screen.getByText(/Ramsar \/ Varldsarv/i)).toBeInTheDocument();
    expect(screen.getByText(/Oversvamningsrisk/i)).toBeInTheDocument();
  });

  it('renders the RAA fornlamning layer from the backend catalog', () => {
    renderMapView(<MapView />);
    expect(screen.getByRole('button', { name: /Fornlamningar \(RAA WFS\)/i })).toBeInTheDocument();
  });

  it('renders without crashing with permits and receivers', () => {
    renderMapView(<MapView permits={[basePermit]} receivers={[baseReceiver]} />);
    expect(screen.getByText(/Myndighetslager/i)).toBeInTheDocument();
  });

  // ── With Leaflet mock ───────────────────────────────────────────────────────

  it('initialises Leaflet map when window.L is available', () => {
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;
    renderMapView(<MapView />);
    expect(mockL.map).toHaveBeenCalledTimes(1);
    expect(mockL.map).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        zoomControl: false,
        maxZoom: 18,
        zoomDelta: 0.5,
        zoomSnap: 0.5,
        wheelPxPerZoomLevel: 180,
      }),
    );
  });

  it('adds the OSM tile layer by default', () => {
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;
    renderMapView(<MapView />);
    expect(mockL.tileLayer).toHaveBeenCalledWith('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(mockL.tileLayer().addTo).toHaveBeenCalled();
  });

  it('refreshes dynamic layers on both move and zoom end events', () => {
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;

    renderMapView(<MapView />);

    expect(mockL._mockMap.on).toHaveBeenCalledWith('moveend', expect.any(Function));
    expect(mockL._mockMap.on).toHaveBeenCalledWith('zoomend', expect.any(Function));
  });

  it('toggles overlay layer when clicked with Leaflet mock', async () => {
    const user = userEvent.setup({ delay: null });
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;
    renderMapView(<MapView />);
    await user.click(screen.getByRole('button', { name: /Skyddad natur/i }));
    const overlayButton = screen.getByRole('button', { name: /Skyddad natur/i });
    expect(overlayButton.className).toContain('bg-slate-900');
  });

  it('shows backend warning text for SGU kusterosion instead of generic load error', async () => {
    const user = userEvent.setup({ delay: null });
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [],
        meta: {
          warning: 'Vissa delager i SGU Stranderosion kust kunde inte lasas (Strandmaterial).',
        },
      }),
    } as Response);

    renderMapView(<MapView />);
    await user.click(screen.getByRole('button', { name: /SGU kusterosion/i }));

    expect(
      await screen.findByText(/Vissa delager i SGU Stranderosion kust kunde inte lasas/i),
    ).toBeInTheDocument();
  });

  it('renders permit and receiver markers and supports legacy permit coordinates', () => {
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;

    renderMapView(
      <MapView
        permits={[{ ...basePermit, location: { lat: 59.31, lon: 18.07 } } as Permit]}
        receivers={[baseReceiver]}
        selectedReceiverId="R1"
      />,
    );

    expect(mockL.marker).toHaveBeenCalledTimes(2);
    expect(mockL._markers[0]?.coords).toEqual([59.31, 18.07]);
    expect(mockL._markers[1]?.coords).toEqual([59.3, 18]);
    expect(mockL._mockMap.fitBounds).toHaveBeenCalledWith(
      [
        [59.31, 18.07],
        [59.3, 18],
      ],
      expect.objectContaining({ maxZoom: 13 }),
    );
    expect(mockL.divIcon).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('#1d4ed8'),
      }),
    );
  });

  it('recenters to a single marker when only one coordinate exists', () => {
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;

    renderMapView(<MapView receivers={[baseReceiver]} />);

    expect(mockL._mockMap.setView).toHaveBeenCalledWith([61.115, 14.617], 11);
    expect(mockL._mockMap.setView).toHaveBeenCalledWith([59.3, 18], 13);
  });

  it('calls selection callbacks when permit and receiver markers are clicked', async () => {
    const mockL = buildLeafletMock();
    (window as unknown as Record<string, unknown>).L = mockL;
    const handlePermitSelect = vi.fn();
    const handleReceiverSelect = vi.fn();

    renderMapView(
      <MapView
        permits={[{ ...basePermit, lat: 59.31, lng: 18.07 }]}
        receivers={[baseReceiver]}
        onSelectPermit={handlePermitSelect}
        onSelectReceiver={handleReceiverSelect}
      />,
    );

    await act(async () => {
      mockL._markers[0]?.handlers.click?.();
      mockL._markers[1]?.handlers.click?.();
    });

    expect(handlePermitSelect).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    expect(handleReceiverSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'R1' }));
  });
});
