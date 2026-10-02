import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CesiumMapView, { hasPolygonBoundary } from '../../components/CesiumMapView';

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
const fetchSpy = vi.fn();

const GOVERNED = {
  type: 'FeatureCollection',
  features: ['ebh', 'water'].map((layer) => ({
    type: 'Feature',
    geometry: null,
    properties: { layer_id: layer, exists: true, distance_meters: 500, governance_status: 'VERIFIED_OBSERVATION' },
  })),
};
const POLYGON = { type: 'Polygon', coordinates: [[[17.73, 59.87], [17.75, 59.87], [17.75, 59.88], [17.73, 59.87]]] };

const baseProps = {
  propertyGeometry: POLYGON,
  propertyCoordinates: [59.87, 17.74] as [number, number],
  productMode: true,
  currentLocationPoint: { lat: 59.87, lng: 17.74 },
  currentLocationLabel: 'Kontrollpunkt: beräknad mittpunkt av fastigheten (ej inmätt)',
};
const LOADED = { status: 'loaded' as const, geojson: GOVERNED };

describe('DEMO M2a item 4 / M2b: CesiumMapView in product mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('shows no fixture toggle, no internal labels and no layer toggles; renders the evidence it is given', async () => {
    render(<CesiumMapView {...baseProps} productEvidence={LOADED} searchRadiusMeters={500} />);
    await waitFor(() => expect(adapter.setEvidenceLayers).toHaveBeenCalledWith(GOVERNED));
    expect(screen.getByTestId('cesium-product-legend')).toBeInTheDocument();
    expect(screen.queryByTestId('cesium-mode-fixture')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cesium-mode-live')).not.toBeInTheDocument();
    for (const internal of [/Cesium L0\/L1/, /GeoPresentationAdapter/, /VERIFIED_OBSERVATION/, /SpatialEvidence/, /Evidenslager/, /Fixture/]) {
      expect(screen.queryByText(internal)).not.toBeInTheDocument();
    }
    expect(loadFixture).not.toHaveBeenCalled();
    // M2b item 2: the map never fetches on its own in product mode.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('cesium-map-view')).toHaveAttribute('data-evidence-mode', 'governed');
  });

  it('M2b item 4: product mode can never show fixture data, even with the default (fixture) evidence mode', async () => {
    render(<CesiumMapView {...baseProps} productEvidence={{ status: 'none' }} />);
    expect(await screen.findByTestId('cesium-awaiting-assessment')).toBeInTheDocument();
    expect(loadFixture).not.toHaveBeenCalled();
    expect(screen.queryByText(/FIXTURE|Fixture/)).not.toBeInTheDocument();
  });

  it('before an assessment exists it fetches nothing and never reads the empty map as "no hits"', async () => {
    render(<CesiumMapView {...baseProps} productEvidence={{ status: 'none' }} searchRadiusMeters={null} />);
    expect(await screen.findByTestId('cesium-awaiting-assessment')).toHaveTextContent('Inga kontrollresultat att visa ännu');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/utan träffar/)).not.toBeInTheDocument();
    expect(adapter.clearSearchRadiusRing).toHaveBeenCalled();
    expect(adapter.setSearchRadiusRing).not.toHaveBeenCalled();
    expect(adapter.setEvidenceLayers).not.toHaveBeenCalled();
  });

  it('draws the governed search radius as a ring and labels it a radius, never a distance', async () => {
    render(<CesiumMapView {...baseProps} productEvidence={LOADED} searchRadiusMeters={500} />);
    await waitFor(() => expect(adapter.setSearchRadiusRing).toHaveBeenCalledWith(59.87, 17.74, 500));
    const legend = screen.getByTestId('cesium-search-radius-legend');
    expect(legend).toHaveTextContent('Sökradie 500 m – visar var kontrollen sökte, inte var några objekt ligger.');
    expect(legend).not.toHaveTextContent(/avstånd/i);
    expect(adapter.setCurrentLocationPoint).toHaveBeenCalledWith(59.87, 17.74, 'Kontrollpunkt: beräknad mittpunkt av fastigheten (ej inmätt)');
    expect(await screen.findByTestId('cesium-geometryless-note')).toBeInTheDocument();
  });

  it('M2c item 2: when the workspace withholds the ring (assessment made for another point) the legend says why', async () => {
    render(
      <CesiumMapView
        {...baseProps}
        productEvidence={LOADED}
        searchRadiusMeters={null}
        searchRadiusWithheldNote="Sökradien visas inte: bedömningen gjordes för en annan kontrollpunkt än den som visas."
      />,
    );
    expect(await screen.findByTestId('cesium-search-radius-withheld')).toHaveTextContent(
      'Sökradien visas inte: bedömningen gjordes för en annan kontrollpunkt än den som visas.',
    );
    expect(screen.queryByTestId('cesium-search-radius-legend')).not.toBeInTheDocument();
  });

  it('M2b items 1+3: an evidence error shows the workspace\'s Swedish text, offers retry through the workspace, never the fixture fallback', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <CesiumMapView
        {...baseProps}
        productEvidence={{ status: 'error', messageSv: 'Kartvisningen för projektet är inte förberedd ännu.', retryable: true }}
        onProductEvidenceRetry={onRetry}
        searchRadiusMeters={null}
      />,
    );
    const box = await screen.findByTestId('cesium-evidence-error');
    expect(box).toHaveTextContent('Tekniskt fel – kontrollresultat kan inte visas');
    expect(screen.getByTestId('cesium-evidence-error-message')).toHaveTextContent('Kartvisningen för projektet är inte förberedd ännu.');
    expect(screen.queryByTestId('cesium-fallback-fixture')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('cesium-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('M2b: a non-retryable evidence error (e.g. integrity) offers no retry', async () => {
    render(
      <CesiumMapView
        {...baseProps}
        productEvidence={{ status: 'error', messageSv: 'Kontrollunderlaget klarade inte integritetskontrollen och visas därför inte.', retryable: false }}
      />,
    );
    expect(await screen.findByTestId('cesium-evidence-error')).toBeInTheDocument();
    expect(screen.queryByTestId('cesium-retry')).not.toBeInTheDocument();
  });

  it('M2b: new evidence re-renders the layers without re-flying to the property', async () => {
    const view = render(<CesiumMapView {...baseProps} productEvidence={{ status: 'loading' }} searchRadiusMeters={500} />);
    await waitFor(() => expect(adapter.setPropertyGeometry).toHaveBeenCalledTimes(1));
    view.rerender(<CesiumMapView {...baseProps} propertyCoordinates={[59.87, 17.74]} productEvidence={LOADED} searchRadiusMeters={500} />);
    await waitFor(() => expect(adapter.setEvidenceLayers).toHaveBeenCalledTimes(1));
    expect(adapter.setPropertyGeometry).toHaveBeenCalledTimes(1);
  });

  it('M2b item 4: the legend names the property boundary only when the lookup gave one', async () => {
    const view = render(<CesiumMapView {...baseProps} productEvidence={{ status: 'none' }} />);
    expect(await screen.findByTestId('cesium-property-legend')).toHaveTextContent('Fastighetsgränsen från fastighetsuppslaget.');
    view.rerender(<CesiumMapView {...baseProps} propertyGeometry={null} productEvidence={{ status: 'none' }} />);
    expect(screen.getByTestId('cesium-property-legend')).toHaveTextContent('Fastighetens ungefärliga läge – fastighetsuppslaget innehåller ingen gräns.');
    expect(screen.getByTestId('cesium-product-legend')).not.toHaveTextContent('Fastighetsgränsen');
    view.rerender(<CesiumMapView {...baseProps} propertyGeometry={{ type: 'Point', coordinates: [17.74, 59.87] }} productEvidence={{ status: 'none' }} />);
    expect(screen.getByTestId('cesium-product-legend')).not.toHaveTextContent('Fastighetsgränsen');
  });

  it('hasPolygonBoundary recognises polygons in all GeoJSON wrappers and nothing else', () => {
    expect(hasPolygonBoundary(POLYGON)).toBe(true);
    expect(hasPolygonBoundary({ type: 'MultiPolygon', coordinates: [] })).toBe(true);
    expect(hasPolygonBoundary({ type: 'Feature', geometry: POLYGON })).toBe(true);
    expect(hasPolygonBoundary({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: POLYGON }] })).toBe(true);
    expect(hasPolygonBoundary({ type: 'Point', coordinates: [0, 0] })).toBe(false);
    expect(hasPolygonBoundary(null)).toBe(false);
  });

  it('outside product mode the existing exploration UI is unchanged (fixture toggle still present)', async () => {
    loadFixture.mockResolvedValue({ property: null, center: { lat: 59.87, lng: 17.74 }, evidence: GOVERNED, scene_id: 's', srid: 4326, governance_status: 'FIXTURE_OBSERVATION' });
    render(<CesiumMapView {...baseProps} productMode={false} />);
    expect(await screen.findByTestId('cesium-mode-fixture')).toBeInTheDocument();
    await waitFor(() => expect(loadFixture).toHaveBeenCalled());
  });
});
