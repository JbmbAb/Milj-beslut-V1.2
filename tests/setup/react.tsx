import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Fix for JSDOM missing matchMedia
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Fix for JSDOM missing scrollIntoView
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

// Fix for ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Leaflet mock
if (typeof window !== 'undefined') {
  (window as any).L = {
    map: vi.fn().mockReturnValue({
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      setView: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      fitBounds: vi.fn(),
      invalidateSize: vi.fn(),
      getZoom: vi.fn().mockReturnValue(13),
      getCenter: vi.fn().mockReturnValue({ lat: 59.3293, lng: 18.0686 }),
    }),
    tileLayer: vi.fn().mockReturnValue({
      addTo: vi.fn(),
      remove: vi.fn(),
    }),
    marker: vi.fn().mockReturnValue({
      addTo: vi.fn(),
      bindPopup: vi.fn(),
      remove: vi.fn(),
      on: vi.fn(),
    }),
    circle: vi.fn().mockReturnValue({
      addTo: vi.fn(),
      remove: vi.fn(),
    }),
    geoJSON: vi.fn().mockReturnValue({
      addTo: vi.fn(),
      remove: vi.fn(),
    }),
    control: {
      zoom: vi.fn().mockReturnValue({
        addTo: vi.fn(),
      }),
      layers: vi.fn().mockReturnValue({
        addTo: vi.fn(),
      }),
    },
    divIcon: vi.fn(),
    latLng: vi.fn((lat, lng) => ({ lat, lng })),
    latLngBounds: vi.fn(() => ({
      extend: vi.fn(),
      getSouthWest: vi.fn(),
      getNorthEast: vi.fn(),
    })),
  };
}

// Mock for ProjectStructureContext if needed
// This might be better handled per test, but a basic one here can help
vi.mock('../../components/ProjectStructureContext', async () => {
  const actual = await vi.importActual('../../components/ProjectStructureContext');
  return {
    ...(actual as any),
    useProjectStructure: () => ({
      plan: {
        id: 'test-project',
        title: 'Test Project',
        description: 'Test Description',
        status: 'ACTIVE',
        modules: [],
        archive: [],
        gates: [],
      },
      setPlan: vi.fn(),
      updatePlan: vi.fn(),
      addArchiveDocument: vi.fn(),
      syncPermitToArchive: vi.fn(),
      applyTemplatePack: vi.fn(),
      evaluateGate: vi.fn().mockResolvedValue({ changed: false, status: 'READY' }),
      runCarbonCalculation: vi.fn(),
      runTransportComplianceFlow: vi.fn(),
      applyMapLayerRecommendation: vi.fn(),
      markModuleReady: vi.fn(),
      loadPlanFromServer: vi.fn(),
      savePlanToServer: vi.fn(),
      remoteSync: {
        enabled: false,
        projectId: 'test-project',
        syncing: false,
        lastLoadedAt: '',
        lastSavedAt: '',
        error: '',
      },
      gateStats: {
        blocked: 0,
        passed: 0,
      },
    }),
  };
});

// We can wrap the render function if we really want to, but it's often cleaner to do it in tests.
// However, many existing tests don't have it, so we might need a more global approach.
