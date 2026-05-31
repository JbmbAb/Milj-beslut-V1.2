import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MapView from '../../components/MapView';

vi.mock('../../src/ui/hooks/useGeoLayers', () => ({
  useSpatialAudit: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue('GIS result'),
    auditGeometry: null,
    auditRisk: null,
  })),
  useMapLayerCatalog: vi.fn(() => ({
    data: [],
    layers: [],
    isLoading: false,
  })),
  useOgcFederatedMapLayers: vi.fn(() => ({
    wmsLayers: [],
    catalogLabelById: new Map(),
    warnings: [],
    isLoading: false,
    isError: false,
  })),
  useMapOverlays: vi.fn(() => []),
}));

vi.mock('leaflet', () => ({}));

vi.mock('../../services/geminiService', () => ({
  fetchMunicipalityContext: vi.fn(),
}));

function makeLeaflet() {
  const chain = () => {
    const o: Record<string, any> = {};
    [
      'setView',
      'addTo',
      'off',
      'remove',
      'on',
      'setContent',
      'setLatLng',
      'openOn',
      'clearLayers',
      'addData',
      'setStyle',
      'bindPopup',
    ].forEach((m) => {
      o[m] = vi.fn(() => o);
    });
    return o;
  };
  const tileLayer: any = vi.fn(() => chain());
  tileLayer.wms = vi.fn(() => chain());
  return {
    map: vi.fn(() => ({
      ...chain(),
      getBounds: vi.fn(() => ({
        isValid: () => true,
        getWest: () => -1,
        getSouth: () => -1,
        getEast: () => 1,
        getNorth: () => 1,
      })),
    })),
    tileLayer,
    featureGroup: vi.fn(() => chain()),
    geoJSON: vi.fn(() => chain()),
    circle: vi.fn(() => chain()),
    marker: vi.fn(() => chain()),
    popup: vi.fn(() => chain()),
    divIcon: vi.fn(() => ({})),
    control: {
      zoom: vi.fn(() => ({ addTo: vi.fn() })),
      layers: vi.fn(() => ({ addTo: vi.fn(), addOverlay: vi.fn(), addBaseLayer: vi.fn() })),
      scale: vi.fn(() => ({ addTo: vi.fn() })),
    },
  };
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

function renderMapView() {
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MapView)),
  );
}

describe('MapView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).L = makeLeaflet();
  });

  afterEach(() => {
    delete (window as any).L;
  });

  it('renders all key myndighetslager toggles in the UI shell', () => {
    const { container } = renderMapView();
    const html = container.innerHTML;

    const expectedLabels = [
      'Brunnar',
      'Grundvattensarbarhet',
      'Marktacke',
      'Vattenskydd',
      'Brunnar (PostGIS)',
      'Genomslapplighet',
      'Grundvattenmagasin',
      'Grundvattenforekomster',
      'Avrinningsomraden',
      'SGU grundlager',
      'Fastighetsgr',
    ];

    for (const label of expectedLabels) {
      expect(html).toContain(label);
    }
  });
});
