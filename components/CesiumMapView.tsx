import React, { useEffect, useRef, useState } from 'react';
import { CesiumAdapter } from './cesium/CesiumAdapter';
import { loadCesiumL0L1FixtureScene } from './cesium/fixtures/l0L1Scene';
import type { CesiumEvidenceMode } from './cesium/types';

export type { CesiumEvidenceMode };

interface CesiumMapViewProps {
  propertyGeometry: any;
  propertyCoordinates: [number, number] | null;
  onEvidenceClick?: (properties: any) => void;
  /** Initial mode — UI can toggle; default fixture while PostGIS rebuild fills. */
  evidenceMode?: CesiumEvidenceMode;
  onEvidenceModeChange?: (mode: CesiumEvidenceMode) => void;
}

const CesiumMapView: React.FC<CesiumMapViewProps> = ({
  propertyGeometry,
  propertyCoordinates,
  onEvidenceClick,
  evidenceMode: evidenceModeProp = 'fixture',
  onEvidenceModeChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<CesiumAdapter | null>(null);
  const [mode, setMode] = useState<CesiumEvidenceMode>(evidenceModeProp);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceCount, setEvidenceCount] = useState<number | null>(null);
  const [emptyEvidence, setEmptyEvidence] = useState(false);

  const [visibleLayers, setVisibleLayers] = useState({
    water: true,
    ebh: true,
    protected_area: true,
  });

  useEffect(() => {
    setMode(evidenceModeProp);
  }, [evidenceModeProp]);

  const applyMode = (next: CesiumEvidenceMode) => {
    setMode(next);
    onEvidenceModeChange?.(next);
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const adapter = new CesiumAdapter({
      container: containerRef.current,
      onFeatureClick: (props) => {
        onEvidenceClick?.(props);
      },
    });

    adapterRef.current = adapter;

    return () => {
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [onEvidenceClick]);

  useEffect(() => {
    if (!adapterRef.current) return;

    let cancelled = false;
    setLoadingEvidence(true);
    setEvidenceError(null);
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
          if (!cancelled) {
            setEvidenceCount(count);
            setEmptyEvidence(count === 0);
          }
          return;
        }

        if (!propertyCoordinates) {
          throw new Error('Live-läge kräver fastighetskoordinater (lat/lng). Byt till fixture eller sök fastighet.');
        }

        await adapterRef.current.setPropertyGeometry(propertyGeometry, propertyCoordinates);

        const [lat, lng] = propertyCoordinates;
        const res = await fetch(`/api/spatial/evidence?lat=${lat}&lng=${lng}`);
        if (!res.ok) {
          throw new Error(`Live evidence misslyckades (HTTP ${res.status}). PostGIS kanske inte är klar.`);
        }
        const geojson = await res.json();
        if (cancelled || !adapterRef.current) return;

        const count = await adapterRef.current.setEvidenceLayers(geojson);
        adapterRef.current.setLayerVisibility(visibleLayers);
        if (!cancelled) {
          setEvidenceCount(count);
          setEmptyEvidence(count === 0);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[CesiumMapView] Error loading spatial evidence:', err);
          adapterRef.current?.clearEvidenceLayers();
          setEvidenceCount(0);
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
  }, [propertyGeometry, propertyCoordinates, mode, reloadToken]);

  useEffect(() => {
    adapterRef.current?.setLayerVisibility(visibleLayers);
  }, [visibleLayers]);

  const handleLayerToggle = (layerKey: keyof typeof visibleLayers) => {
    setVisibleLayers((prev) => ({
      ...prev,
      [layerKey]: !prev[layerKey],
    }));
  };

  const badgeText =
    mode === 'fixture' ? 'FIXTURE · inte live PostGIS' : 'LIVE · GeoPresentationAdapter';

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
          {(
            [
              ['water', 'Vattenbrunn (SGU)', 'bg-cyan-400', 'bg-cyan-500'],
              ['ebh', 'EBH-områden', 'bg-rose-500', 'bg-rose-500'],
              ['protected_area', 'Natura / skydd', 'bg-emerald-500', 'bg-emerald-500'],
            ] as const
          ).map(([key, label, dot, onBg]) => (
            <button
              key={key}
              type="button"
              onClick={() => handleLayerToggle(key)}
              className="flex items-center justify-between text-left group hover:bg-white/5 p-1 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                <span className="text-[10px] font-bold text-slate-300 group-hover:text-white transition-colors">
                  {label}
                </span>
              </div>
              <div
                className={`h-4 w-8 rounded-full transition-all relative ${
                  visibleLayers[key] ? onBg : 'bg-slate-700'
                }`}
              >
                <div
                  className={`h-2.5 w-2.5 rounded-full bg-white absolute top-0.5 transition-all ${
                    visibleLayers[key] ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </div>
            </button>
          ))}
        </div>
      </div>

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
            {mode === 'live' && (
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

      <div ref={containerRef} className="w-full h-full flex-1" />
    </div>
  );
};

export default CesiumMapView;
