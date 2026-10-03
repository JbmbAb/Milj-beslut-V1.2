/**
 * W-UI1-R3 -- owner decision (Jimmy, 2026-10-03): the map's button says "Läs in på nytt" when the workspace's action is
 * reading the assessment again (the map's evidence contradicts the shown assessment), and "Försök igen" only for a
 * failure the server marked retryable; a failure it marked not retryable offers no button (unchanged).
 * Fully mocked: no WebGL, no network, no database.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CesiumMapView from '../../components/CesiumMapView';

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
vi.mock('../../components/cesium/fixtures/l0L1Scene', () => ({ loadCesiumL0L1FixtureScene: vi.fn() }));

const POLYGON = { type: 'Polygon', coordinates: [[[17.73, 59.87], [17.75, 59.87], [17.75, 59.88], [17.73, 59.87]]] };
const baseProps = {
  propertyGeometry: POLYGON,
  propertyCoordinates: [59.87, 17.74] as [number, number],
  productMode: true,
  currentLocationPoint: { lat: 59.87, lng: 17.74 },
  currentLocationLabel: 'Kontrollpunkt',
  searchRadiusMeters: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

describe('W-UI1-R3: the map\'s button follows the workspace\'s action', () => {
  it('the map contradicts the shown assessment (a re-read): "Läs in på nytt", never "Försök igen"', async () => {
    render(<CesiumMapView {...baseProps} productEvidence={{ status: 'error', messageSv: 'm', retryable: true, reread: true }} onProductEvidenceRetry={() => undefined} />);
    const button = await screen.findByTestId('cesium-retry');
    expect(button).toHaveTextContent('Läs in på nytt');
    expect(button).not.toHaveTextContent(/Försök igen/i);
    for (const attribute of ['aria-label', 'title']) {
      const value = button.getAttribute(attribute);
      if (value !== null) expect(value).toBe('Läs in på nytt');
    }
  });

  it('a failure the server marked retryable:true: "Försök igen"', async () => {
    render(<CesiumMapView {...baseProps} productEvidence={{ status: 'error', messageSv: 'm', retryable: true }} onProductEvidenceRetry={() => undefined} />);
    const button = await screen.findByTestId('cesium-retry');
    expect(button).toHaveTextContent('Försök igen');
    expect(button).not.toHaveTextContent(/Läs in på nytt/i);
  });

  it('a failure the server marked retryable:false offers no button, whatever else it says (unchanged)', async () => {
    for (const reread of [undefined, true]) {
      const { unmount } = render(
        <CesiumMapView {...baseProps} productEvidence={{ status: 'error', messageSv: 'm', retryable: false, ...(reread ? { reread } : {}) }} />,
      );
      expect(await screen.findByTestId('cesium-evidence-error')).toBeInTheDocument();
      expect(screen.queryByTestId('cesium-retry')).not.toBeInTheDocument();
      unmount();
    }
  });
});
