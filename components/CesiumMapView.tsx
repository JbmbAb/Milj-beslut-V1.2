import React, { useEffect, useRef, useState } from 'react';
import { CesiumAdapter } from './cesium/CesiumAdapter';
import { loadCesiumL0L1FixtureScene } from './cesium/fixtures/l0L1Scene';
import { callApi } from '../services/coreApiClient';
import {
  CESIUM_EVIDENCE_LAYERS,
  type CesiumEvidenceLayerKey,
  type CesiumEvidenceMeta,
  type CesiumEvidenceMode,
} from './cesium/types';
import './cesium/cesiumMapContainer.css';

export type { CesiumEvidenceMode };

interface CesiumMapViewProps {
  propertyGeometry: any;
  propertyCoordinates: [number, number] | null;
  onEvidenceClick?: (properties: any) => void;
  /** Initial mode — UI can toggle; default fixture while PostGIS rebuild fills. */
  evidenceMode?: CesiumEvidenceMode;
  onEvidenceModeChange?: (mode: CesiumEvidenceMode) => void;
  /**
   * P3-LU-CESIUM-PRESENTATION-WIRING-01. When set, 'live' mode calls the governed LU presentation
   * endpoint (GET /api/localization/:projectId/viewer/evidence -- authenticated, CAS-verified,
   * ViewerKernel-projected) for THIS project's already-governed assessment, instead of the older
   * ungoverned /api/spatial/evidence (raw PostGIS, no auth, arbitrary lat/lng). Omit this prop to
   * keep the prior general-purpose GIS exploration behavior (e.g. GisRiskModule, which has no
   * governed LU project/assessment to show).
   */
  projectId?: string;
  /**
   * PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01. When true, the next LEFT_CLICK picks a WGS84
   * lat/lng off the globe (via onLocationPick) instead of picking an evidence feature.
   */
  pickingLocation?: boolean;
  onLocationPick?: (lat: number, lng: number) => void;
  /** The unconfirmed, not-yet-saved point -- shown as a distinct draft marker. */
  draftLocationPoint?: { lat: number; lng: number } | null;
  /** The persisted, current LocalizationGeometry point. */
  currentLocationPoint?: { lat: number; lng: number } | null;
  /**
   * LU-FINDING-MAP-DRILLDOWN-V1. When set (together with a changed focusEvidenceNonce), locates
   * the already-rendered evidence entity with this cas_artifact_id among what setEvidenceLayers()
   * already loaded via the governed /viewer/evidence path, flies the camera to it, and opens the
   * details panel through the exact same onEvidenceClick callback a manual click would use. Never
   * triggers a new query. onFocusEvidenceMissing fires, honestly, when no matching entity is
   * currently rendered.
   */
  focusEvidenceArtifactId?: string | null;
  focusEvidenceNonce?: number;
  onFocusEvidenceMissing?: () => void;
}

const CesiumMapView: React.FC<CesiumMapViewProps> = ({
  propertyGeometry,
  propertyCoordinates,
  onEvidenceClick,
  evidenceMode: evidenceModeProp = 'fixture',
  onEvidenceModeChange,
  projectId,
  pickingLocation = false,
  onLocationPick,
  draftLocationPoint = null,
  currentLocationPoint = null,
  focusEvidenceArtifactId = null,
  focusEvidenceNonce = 0,
  onFocusEvidenceMissing,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<CesiumAdapter | null>(null);
  const [mode, setMode] = useState<CesiumEvidenceMode>(evidenceModeProp);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceCount, setEvidenceCount] = useState<number | null>(null);
  const [evidenceMeta, setEvidenceMeta] = useState<CesiumEvidenceMeta | null>(null);
  const [emptyEvidence, setEmptyEvidence] = useState(false);

  const [visibleLayers, setVisibleLayers] = useState<Record<CesiumEvidenceLayerKey, boolean>>({
    water: true,
    ebh: true,
    protected_area: true,
    natura2000: true,
    water_protection_area: true,
  });

  useEffect(() => {
    setMode(evidenceModeProp);
  }, [evidenceModeProp]);

  const applyMode = (next: CesiumEvidenceMode) => {
    setMode(next);
    onEvidenceModeChange?.(next);
  };

  // LU-CESIUM-PROPERTY-GEOMETRY-LIFECYCLE-01: onEvidenceClick is passed as a fresh inline
  // closure by callers (e.g. LuWorkspace's `(props) => setSelectedEvidence(props)`), so its
  // identity changes on every parent render. Depending on it directly here meant an ordinary
  // re-render -- unrelated to the property/mode this effect actually cares about -- destroyed
  // and recreated the whole Cesium adapter every time, which is exactly the kind of churn that
  // can race an in-flight setPropertyGeometry()/setEvidenceLayers() call against destroy()
  // (see CesiumAdapter's `destroyed` guard for the other half of this fix). A ref always reads
  // the latest callback without needing the adapter-construction effect to depend on it.
  const onEvidenceClickRef = useRef(onEvidenceClick);
  useEffect(() => {
    onEvidenceClickRef.current = onEvidenceClick;
  }, [onEvidenceClick]);

  // PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01: same stable-ref reasoning as onEvidenceClickRef
  // above -- onLocationPick is a fresh inline closure per parent render.
  const onLocationPickRef = useRef(onLocationPick);
  useEffect(() => {
    onLocationPickRef.current = onLocationPick;
  }, [onLocationPick]);

  const onFocusEvidenceMissingRef = useRef(onFocusEvidenceMissing);
  useEffect(() => {
    onFocusEvidenceMissingRef.current = onFocusEvidenceMissing;
  }, [onFocusEvidenceMissing]);

  // LU-FINDING-MAP-DRILLDOWN-V1: fires only on an actual (artifactId, nonce) change -- the nonce
  // lets the caller re-trigger a focus on the SAME artifact twice in a row (e.g. clicking "Visa
  // på karta" again after panning away). Never issues a new query: focusEvidenceByArtifactId only
  // searches entities setEvidenceLayers() already loaded via the governed /viewer/evidence path.
  useEffect(() => {
    if (!focusEvidenceArtifactId || !adapterRef.current) return;
    const props = adapterRef.current.focusEvidenceByArtifactId(focusEvidenceArtifactId);
    if (props) {
      onEvidenceClickRef.current?.(props);
    } else {
      onFocusEvidenceMissingRef.current?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEvidenceArtifactId, focusEvidenceNonce]);

  useEffect(() => {
    if (!containerRef.current) return;

    const adapter = new CesiumAdapter({
      container: containerRef.current,
      onFeatureClick: (props) => {
        onEvidenceClickRef.current?.(props);
      },
    });

    adapterRef.current = adapter;
    adapter.resizeToContainer();

    return () => {
      adapter.destroy();
      adapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!adapterRef.current) return;
    if (pickingLocation) {
      adapterRef.current.enableLocationPicking((lat, lng) => onLocationPickRef.current?.(lat, lng));
    } else {
      adapterRef.current.disableLocationPicking();
    }
  }, [pickingLocation]);

  useEffect(() => {
    if (!adapterRef.current) return;
    if (draftLocationPoint) {
      adapterRef.current.setDraftLocationPoint(draftLocationPoint.lat, draftLocationPoint.lng);
    } else {
      adapterRef.current.clearDraftLocationPoint();
    }
  }, [draftLocationPoint]);

  useEffect(() => {
    if (!adapterRef.current) return;
    if (currentLocationPoint) {
      adapterRef.current.setCurrentLocationPoint(currentLocationPoint.lat, currentLocationPoint.lng);
    } else {
      adapterRef.current.clearCurrentLocationPoint();
    }
  }, [currentLocationPoint]);

  useEffect(() => {
    if (!adapterRef.current) return;

    let cancelled = false;
    setLoadingEvidence(true);
    setEvidenceError(null);
    setEvidenceMeta(null);
    setEmptyEvidence(false);

    const run = async () => {
      try {
        if (mode === 'fixture') {
          const scene = await loadCesiumL0L1FixtureScene();
          if (cancelled || !adapterRef.current) return;

          const propGeom = propertyGeometry ?? scene.property;
          const fallback: [number, number] = propertyCoordinates ?? [
            scene.center.lat,
            scene.center.lng,
          ];
          await adapterRef.current.setPropertyGeometry(propGeom, fallback);
          const count = await adapterRef.current.setEvidenceLayers(scene.evidence);
          adapterRef.current.setLayerVisibility(visibleLayers);
          adapterRef.current.resizeToContainer();
          if (!cancelled) {
            setEvidenceCount(count);
            setEvidenceMeta({
              presentation: 'cesium-l0-l1',
              source: 'fixture',
              scene_id: scene.scene_id,
              srid: scene.srid,
              governance_status: scene.governance_status,
              feature_count: count,
              center: scene.center,
            });
            setEmptyEvidence(count === 0);
          }
          return;
        }

        if (!propertyCoordinates) {
          throw new Error('Live-läge kräver fastighetskoordinater (lat/lng). Byt till fixture eller sök fastighet.');
        }

        await adapterRef.current.setPropertyGeometry(propertyGeometry, propertyCoordinates);

        // P3-LU-CESIUM-PRESENTATION-WIRING-01: a governed LU project shows its own already-CAS-
        // verified assessment via the governed presentation endpoint, never a fresh, ungoverned
        // PostGIS query. Only when no projectId is given (general-purpose GIS exploration, e.g.
        // GisRiskModule) does the old arbitrary lat/lng endpoint remain in use.
        const geojson = projectId
          ? await callApi(`/api/localization/${encodeURIComponent(projectId)}/viewer/evidence`, {
              method: 'GET',
            })
          : await (async () => {
              const [lat, lng] = propertyCoordinates;
              const res = await fetch(`/api/spatial/evidence?lat=${lat}&lng=${lng}`);
              if (!res.ok) {
                throw new Error(`Live evidence misslyckades (HTTP ${res.status}). PostGIS kanske inte är klar.`);
              }
              return res.json();
            })();
        if (cancelled || !adapterRef.current) return;

        const count = await adapterRef.current.setEvidenceLayers(geojson);
        adapterRef.current.setLayerVisibility(visibleLayers);
        adapterRef.current.resizeToContainer();
        if (!cancelled) {
          setEvidenceCount(count);
          setEvidenceMeta({
            ...(geojson.meta || {}),
            source: 'live',
            feature_count: typeof geojson.meta?.feature_count === 'number' ? geojson.meta.feature_count : count,
          });
          setEmptyEvidence(count === 0);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[CesiumMapView] Error loading spatial evidence:', err);
          adapterRef.current?.clearEvidenceLayers();
          setEvidenceCount(0);
          setEvidenceMeta(null);
          setEvidenceError(err instanceof Error ? err.message : 'Fel vid hämtning av evidens.');
        }
      } finally {
        if (!cancelled) setLoadingEvidence(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyGeometry, propertyCoordinates, mode, reloadToken, projectId]);

  useEffect(() => {
    adapterRef.current?.setLayerVisibility(visibleLayers);
  }, [visibleLayers]);

  const handleLayerToggle = (layerKey: CesiumEvidenceLayerKey) => {
    setVisibleLayers((prev) => ({
      ...prev,
      [layerKey]: !prev[layerKey],
    }));
  };

  const badgeText =
    mode === 'fixture' ? 'FIXTURE · inte live PostGIS' : 'LIVE · GeoPresentationAdapter';
  const governanceLabel =
    evidenceMeta?.governance_status ||
    (mode === 'fixture' ? 'FIXTURE_OBSERVATION' : 'VERIFIED_OBSERVATION');
  const sridLabel = evidenceMeta?.srid ? `EPSG:${evidenceMeta.srid}` : 'EPSG:4326';
  const sourceLabel = evidenceMeta?.source === 'fixture' ? 'Fixture' : mode === 'live' ? 'Live' : 'Fixture';

  return (
    <div
      className="relative w-full h-full rounded-2xl overflow-hidden border border-slate-200 shadow-inner flex flex-col"
      style={{ minHeight: '550px' }}
      data-testid="cesium-map-view"
      data-evidence-mode={mode}
    >
      <div className="absolute top-4 left-4 z-10 bg-slate-900/90 text-white p-3 rounded-xl shadow-lg border border-slate-700/50 backdrop-blur-md flex flex-col gap-2 w-[250px]">
        <div className="flex items-center gap-2 pointer-events-none">
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-[11px] font-black uppercase tracking-wider text-slate-300">
            Cesium L0/L1 3D Tvilling
          </span>
        </div>
        <p className="text-[10px] text-slate-400 pointer-events-none">{badgeText}</p>
        <div
          data-testid="cesium-evidence-meta"
          className="rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-[10px] text-slate-400"
        >
          <div>
            Status: <span className="font-bold text-slate-200">{governanceLabel}</span>
          </div>
          <div>
            Källa: <span className="font-bold text-slate-200">{sourceLabel}</span> ·{' '}
            <span className="font-bold text-slate-200">{sridLabel}</span>
          </div>
          {typeof evidenceMeta?.search_radius_meters === 'number' && (
            <div>
              Radie:{' '}
              <span className="font-bold text-slate-200">
                {evidenceMeta.search_radius_meters} m
              </span>
            </div>
          )}
          {evidenceMeta?.property_id && (
            <div className="truncate">
              Fastighet:{' '}
              <span className="font-mono font-bold text-slate-200">{evidenceMeta.property_id}</span>
            </div>
          )}
        </div>

        <div className="flex rounded-lg overflow-hidden border border-slate-700 text-[10px] font-black uppercase tracking-wider">
          <button
            type="button"
            data-testid="cesium-mode-fixture"
            onClick={() => applyMode('fixture')}
            className={`flex-1 px-2 py-1.5 transition-colors ${
              mode === 'fixture' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            Fixture
          </button>
          <button
            type="button"
            data-testid="cesium-mode-live"
            onClick={() => applyMode('live')}
            className={`flex-1 px-2 py-1.5 transition-colors ${
              mode === 'live' ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            Live
          </button>
        </div>

        <button
          type="button"
          onClick={() => adapterRef.current?.resetCameraOverview()}
          className="text-[10px] font-bold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1.5 text-left transition-colors"
        >
          Återställ kamera (Sverige)
        </button>

        {evidenceCount !== null && !evidenceError && (
          <p className="text-[10px] text-slate-500 pointer-events-none">
            Evidensobjekt: <span className="text-slate-300 font-bold">{evidenceCount}</span>
          </p>
        )}
      </div>

      <div className="absolute top-16 right-4 z-10 bg-slate-900/90 text-white p-4 rounded-xl shadow-lg border border-slate-700/50 backdrop-blur-md w-52 flex flex-col gap-2.5">
        <h6 className="text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
          <i className="fas fa-layer-group text-cyan-400" />
          Evidenslager (3D)
        </h6>
        <div className="flex flex-col gap-2">
          {CESIUM_EVIDENCE_LAYERS.map((layer) => (
            <button
              key={layer.key}
              type="button"
              onClick={() => handleLayerToggle(layer.key)}
              className="flex items-center justify-between text-left group hover:bg-white/5 p-1 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: layer.color }} />
                <span className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-300 group-hover:text-white transition-colors">
                    {layer.label}
                  </span>
                  <span className="text-[9px] text-slate-500">{layer.provider}</span>
                </span>
              </div>
              <div
                className={`h-4 w-8 rounded-full transition-all relative ${
                  visibleLayers[layer.key] ? 'bg-cyan-500' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`h-2.5 w-2.5 rounded-full bg-white absolute top-0.5 transition-all ${
                    visibleLayers[layer.key] ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </div>
            </button>
          ))}
        </div>
      </div>

      {pickingLocation && (
        <div
          data-testid="cesium-picking-location-banner"
          className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-amber-500 text-slate-950 px-4 py-2 rounded-lg shadow text-[11px] font-black uppercase tracking-wider"
        >
          Klicka på kartan för att välja lokalisering
        </div>
      )}

      {loadingEvidence && (
        <div className="absolute bottom-4 right-4 z-10 bg-indigo-600 text-white px-3 py-1.5 rounded-lg shadow text-[11px] font-bold tracking-tight animate-pulse pointer-events-none">
          Hämtar SpatialEvidence...
        </div>
      )}

      {emptyEvidence && !loadingEvidence && !evidenceError && (
        <div
          data-testid="cesium-empty-evidence"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-slate-900/95 text-white px-4 py-3 rounded-xl shadow border border-slate-700 max-w-md text-center"
        >
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-300">Ingen evidens</p>
          <p className="text-[10px] text-slate-400 mt-1">
            Tom FeatureCollection — observation utan träffar nära fastigheten.
          </p>
        </div>
      )}

      {evidenceError && (
        <div
          data-testid="cesium-evidence-error"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-rose-950/95 text-white px-4 py-3 rounded-xl shadow border border-rose-700/50 max-w-lg w-[min(92%,28rem)]"
        >
          <p className="text-[11px] font-black uppercase tracking-wider text-rose-200">Evidensfel</p>
          <p className="text-[10px] text-rose-100/90 mt-1">{evidenceError}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              data-testid="cesium-retry"
              onClick={() => setReloadToken((n) => n + 1)}
              className="text-[10px] font-black uppercase bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg"
            >
              Försök igen
            </button>
            {/* Governed LU (projectId set) must fail closed -- never offer fixture as a product workaround. */}
            {mode === 'live' && !projectId && (
              <button
                type="button"
                data-testid="cesium-fallback-fixture"
                onClick={() => applyMode('fixture')}
                className="text-[10px] font-black uppercase bg-amber-500 text-slate-950 hover:bg-amber-400 px-3 py-1.5 rounded-lg"
              >
                Använd fixture
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={containerRef} className="w-full h-full min-h-0 flex-1 cesium-map-container" />
    </div>
  );
};

export default CesiumMapView;
