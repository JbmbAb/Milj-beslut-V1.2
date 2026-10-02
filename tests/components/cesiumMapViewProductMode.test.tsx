import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CesiumMapView from '../../components/CesiumMapView';

// Fully mocked: no WebGL, no network, no database.
const adapter = {
  setPropertyGeometry: vi.fn(async () => undefined),
  setEvidenceLayers: vi.fn(async (geojson: { features?: unknown[] }) => geojson?.features?.length ?? 0),
  setLayerVisibility: vi.fn(),
  clearEvidenceLayers: vi.fn(),
  setCurrentLocationPoint: vi.fn(),
  clearCurrentLocationPoint: vi.fn(),
  setDraftLocationPoint: vi.fn(),
  clearDraftLocationPoint: vi.fn(),
  setSearchRadiusRing: vi.fn(),
  clearSearchRadiusRing: vi.fn(),
  enableLocationPicking: vi.fn(),
  disableLocationPicking: vi.fn(),
  focusEvidenceByArtifactId: vi.fn(() => null),
  resetCameraOverview: vi.fn(),
  destroy: vi.fn(),
};
vi.mock('../../components/cesium/CesiumAdapter', () => ({
  CesiumAdapter: vi.fn(function CesiumAdapterMock() {
    return adapter;
  }),
}));
const loadFixture = vi.fn();
vi.mock('../../components/cesium/fixtures/l0L1Scene', () => ({
  loadCesiumL0L1FixtureScene: () => loadFixture(),
}));
const callApi = vi.fn();
vi.mock('../../services/coreApiClient', () => ({
  callApi: (...args: unknown[]) => callApi(...args),
}));

const GOVERNED = {
  type: 'FeatureCollection',
  features: ['ebh', 'water'].map((layer) => ({
    type: 'Feature',
    geometry: null,
    properties: { layer_id: layer, exists: true, distance_meters: 500, governance_status: 'VERIFIED_OBSERVATION' },
  })),
};

const baseProps = {
  propertyGeometry: { type: 'Polygon', coordinates: [] },
  propertyCoordinates: [59.87, 17.74] as [number, number],
  evidenceMode: 'live' as const,
  projectId: 'proj-1',
  productMode: true,
  currentLocationPoint: { lat: 59.87, lng: 17.74 },
  currentLocationLabel: 'Kontrollpunkt: beräknad mittpunkt av fastigheten (ej inmätt)',
};

describe('DEMO M2a item 4: CesiumMapView in product mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows no fixture toggle, no internal labels and no layer toggles', async () => {
    callApi.mockResolvedValue(GOVERNED);
    render(<CesiumMapView {...baseProps} assessmentAvailable searchRadiusMeters={500} />);
    await waitFor(() => expect(callApi).toHaveBeenCalled());
    expect(screen.getByTestId('cesium-product-legend')).toBeInTheDocument();
    expect(screen.queryByTestId('cesium-mode-fixture')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cesium-mode-live')).not.toBeInTheDocument();
    for (const internal of [/Cesium L0\/L1/, /GeoPresentationAdapter/, /VERIFIED_OBSERVATION/, /SpatialEvidence/, /Evidenslager/, /Fixture/]) {
      expect(screen.queryByText(internal)).not.toBeInTheDocument();
    }
    expect(loadFixture).not.toHaveBeenCalled();
  });

  it('before an assessment exists it fetches nothing and never reads the empty map as "no hits"', async () => {
    render(<CesiumMapView {...baseProps} assessmentAvailable={false} searchRadiusMeters={null} />);
    expect(await screen.findByTestId('cesium-awaiting-assessment')).toHaveTextContent('Inga kontrollresultat att visa ännu');
    expect(callApi).not.toHaveBeenCalled();
    expect(screen.queryByText(/utan träffar/)).not.toBeInTheDocument();
    expect(adapter.clearSearchRadiusRing).toHaveBeenCalled();
    expect(adapter.setSearchRadiusRing).not.toHaveBeenCalled();
  });

  it('draws the governed search radius as a ring and labels it a radius, never a distance', async () => {
    callApi.mockResolvedValue(GOVERNED);
    render(<CesiumMapView {...baseProps} assessmentAvailable searchRadiusMeters={500} />);
    await waitFor(() => expect(adapter.setSearchRadiusRing).toHaveBeenCalledWith(59.87, 17.74, 500));
    const legend = screen.getByTestId('cesium-search-radius-legend');
    expect(legend).toHaveTextContent('Sökradie 500 m – visar var kontrollen sökte, inte var några objekt ligger.');
    expect(legend).not.toHaveTextContent(/avstånd/i);
    expect(adapter.setCurrentLocationPoint).toHaveBeenCalledWith(59.87, 17.74, 'Kontrollpunkt: beräknad mittpunkt av fastigheten (ej inmätt)');
    expect(await screen.findByTestId('cesium-geometryless-note')).toBeInTheDocument();
  });

  it('an evidence error offers retry but never the fixture fallback', async () => {
    callApi.mockRejectedValue(new Error('HTTP 409'));
    render(<CesiumMapView {...baseProps} assessmentAvailable searchRadiusMeters={null} />);
    expect(await screen.findByTestId('cesium-evidence-error')).toHaveTextContent('Kontrollresultaten kunde inte hämtas');
    expect(screen.getByTestId('cesium-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('cesium-fallback-fixture')).not.toBeInTheDocument();
  });

  it('re-fetches the governed evidence when the reload nonce changes (after a new run)', async () => {
    callApi.mockResolvedValue(GOVERNED);
    const view = render(<CesiumMapView {...baseProps} assessmentAvailable evidenceReloadNonce={0} searchRadiusMeters={500} />);
    await waitFor(() => expect(callApi).toHaveBeenCalledTimes(1));
    view.rerender(<CesiumMapView {...baseProps} assessmentAvailable evidenceReloadNonce={1} searchRadiusMeters={500} />);
    await waitFor(() => expect(callApi).toHaveBeenCalledTimes(2));
    expect(callApi).toHaveBeenLastCalledWith('/api/localization/proj-1/viewer/evidence', { method: 'GET' });
  });

  it('outside product mode the existing exploration UI is unchanged (fixture toggle still present)', async () => {
    callApi.mockResolvedValue(GOVERNED);
    render(<CesiumMapView {...baseProps} productMode={false} />);
    expect(await screen.findByTestId('cesium-mode-fixture')).toBeInTheDocument();
  });
});
