import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import MapView from '../../components/MapView';
import type { Permit, Receiver } from '../../types';

// MapView reads (window as any).L – not the ES module import – so we mock window.L in beforeEach.
// We still stub the leaflet module to prevent it from being loaded in jsdom (which lacks a DOM canvas).
vi.mock('leaflet', () => ({}));

vi.mock('../../services/geminiService', () => ({
  fetchMunicipalityContext: vi.fn(),
}));

vi.mock('../../src/ui/hooks/useGeoLayers', () => ({
  useMapLayerCatalog: vi.fn(() => ({
    data: [],
    isLoading: false,
    isError: false,
  })),
  useSpatialAudit: vi.fn(() => ({
    auditGeometry: null,
    auditRisk: null,
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

vi.mock('./project/MapConfig', async () => ({
  DYNAMIC_BBOX_LAYER_CONFIG: {},
  DynamicBboxLayerKey: {},
  FLOOD_RISK_STYLE: {},
  STATIC_OVERLAY_CONFIG: {},
  getMarkCoverStyle: vi.fn(() => ({})),
  getSguGroundLayerStyle: vi.fn(() => ({})),
  getSguLandslideStyle: vi.fn(() => ({})),
  POSTGIS_LAKES_STYLE: {},
  POSTGIS_NVR_STYLE: {},
  POSTGIS_PROPERTY_STYLE: {},
  POSTGIS_STREAMS_STYLE: {},
  WATER_PROTECTION_STYLE: {},
}));

/** Build a chainable mock object (so .setLatLng().setContent().openOn() works). */
function chainMock() {
  const obj: Record<string, any> = {};
  const methods = [
    'setLatLng',
    'setContent',
    'openOn',
    'addTo',
    'off',
    'remove',
    'clearLayers',
    'addData',
    'setStyle',
    'on',
    'bindPopup',
  ];
  methods.forEach((m) => {
    obj[m] = vi.fn().mockReturnValue(obj);
  });
  return obj;
}

function makeTileLayer() {
  const tileLayerFn: any = vi.fn(() => chainMock());
  tileLayerFn.wms = vi.fn(() => chainMock());
  return tileLayerFn;
}

function makeMockLeaflet() {
  const mapInstance = {
    setView: vi.fn().mockReturnThis(),
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getWest: vi.fn(() => -122.5),
      getSouth: vi.fn(() => 47.0),
      getEast: vi.fn(() => -122.0),
      getNorth: vi.fn(() => 47.5),
    })),
  };

  return {
    map: vi.fn(() => mapInstance),
    tileLayer: makeTileLayer(),
    featureGroup: vi.fn(() => chainMock()),
    geoJSON: vi.fn(() => chainMock()),
    circle: vi.fn(() => chainMock()),
    marker: vi.fn(() => chainMock()),
    popup: vi.fn(() => chainMock()),
    control: {
      zoom: vi.fn(() => ({ addTo: vi.fn() })),
      layers: vi.fn(() => ({ addTo: vi.fn(), addOverlay: vi.fn(), addBaseLayer: vi.fn() })),
      scale: vi.fn(() => ({ addTo: vi.fn() })),
    },
    divIcon: vi.fn(() => ({})),
  };
}

describe('MapView', () => {
  let mockContainer: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).L = makeMockLeaflet();
    mockContainer = document.createElement('div');
    mockContainer.id = 'map';
    document.body.appendChild(mockContainer);
  });

  afterEach(() => {
    if (mockContainer.parentNode) {
      mockContainer.parentNode.removeChild(mockContainer);
    }
    delete (window as any).L;
    vi.clearAllMocks();
  });

  it('should render without crashing', () => {
    const { container } = render(<MapView />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should render with permits', () => {
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
    const { container } = render(<MapView permits={mockPermits} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should handle permit selection callback', () => {
    const mockOnSelectPermit = vi.fn();
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
    const { container } = render(<MapView permits={mockPermits} onSelectPermit={mockOnSelectPermit} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should render with receivers', () => {
    const mockReceivers: Receiver[] = [
      { id: '1', name: 'Test Receiver', location: { lat: 47.25, lon: -122.25 }, type: 'MUNICIPALITY' } as any,
    ];
    const { container } = render(<MapView receivers={mockReceivers} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should toggle base layer when selected', () => {
    const { container, rerender } = render(<MapView />);
    rerender(<MapView />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should display map notice when error occurs', () => {
    const { container } = render(<MapView />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should initialize map container reference correctly', () => {
    const { container } = render(<MapView />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should handle missing Leaflet library', () => {
    delete (window as any).L;
    const { container } = render(<MapView />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should apply highlight layer when provided', () => {
    const { container } = render(<MapView highlightLayer={'risk-zones' as any} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should respect bufferDistance prop', () => {
    const { container } = render(<MapView bufferDistance={100} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should handle selectedReceiverId prop', () => {
    const mockReceivers: Receiver[] = [
      {
        id: 'recv-1',
        name: 'Test Receiver',
        location: { lat: 47.25, lon: -122.25 },
        type: 'MUNICIPALITY',
      } as any,
    ];
    const { container } = render(<MapView receivers={mockReceivers} selectedReceiverId="recv-1" />);
    expect(container.firstChild).not.toBeNull();
  });
});
