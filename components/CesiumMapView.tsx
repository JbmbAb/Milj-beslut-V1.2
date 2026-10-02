import React, { useEffect, useRef, useState } from 'react';
import { CesiumAdapter } from './cesium/CesiumAdapter';
import { loadCesiumL0L1FixtureScene } from './cesium/fixtures/l0L1Scene';
import {
  CESIUM_EVIDENCE_LAYERS,
  type CesiumEvidenceLayerKey,
  type CesiumEvidenceMeta,
  type CesiumEvidenceMode,
} from './cesium/types';

export type { CesiumEvidenceMode };

/**
 * DEMO M2b item 2: in productMode the map does not fetch anything itself. The LU workspace fetches
 * the governed /viewer/evidence ONCE, checks that it belongs to the assessment on screen, and hands
 * the same FeatureCollection (or a plain-Swedish reason why there is none) to both the control panel
 * and this map -- so the two can never show different assessments.
 */
export type CesiumProductEvidence =
  | { readonly status: 'none' }
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly geojson: unknown }
  | {
      readonly status: 'error';
      readonly messageSv: string;
      readonly retryable: boolean;
      /**
       * DEMO M2c item 3: the knowledge-state word the control panel shows for the same failure
       * (e.g. "Ofullständigt underlag" for a governance refusal); defaults to "Tekniskt fel".
       */
      readonly stateLabel?: string;
    };

/** True when the property lookup gave a real boundary (polygon), not just a point or nothing. */
export function hasPolygonBoundary(geojson: unknown): boolean {
  const g = geojson as { type?: unknown; geometry?: unknown; features?: unknown; geometries?: unknown } | null;
  if (!g || typeof g !== 'object') return false;
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return true;
  if (g.type === 'Feature') return hasPolygonBoundary(g.geometry);
  if (g.type === 'FeatureCollection' && Array.isArray(g.features)) return g.features.some(hasPolygonBoundary);
  if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) return g.geometries.some(hasPolygonBoundary);
  return false;
}

interface CesiumMapViewProps {
  propertyGeometry: any;
  propertyCoordinates: [number, number] | null;
  onEvidenceClick?: (properties: any) => void;
  /** Exploration mode only (ignored in productMode) -- UI can toggle; default fixture. */
  evidenceMode?: CesiumEvidenceMode;
  onEvidenceModeChange?: (mode: CesiumEvidenceMode) => void;
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
   * DEMO M2a item 4 (governed LU product view). Hides the fixture toggle, the 'Använd fixture'
   * fallback, the internal overlay labels and the layer toggles (governed evidence carries no
   * object geometry, so they change nothing), and shows a plain legend instead. In productMode
   * there is no fixture path at all and no own fetch: evidence comes only from `productEvidence`.
   */
  productMode?: boolean;
  /** productMode only: the governed evidence the workspace fetched for the displayed assessment. */
  productEvidence?: CesiumProductEvidence;
  /** productMode only: asks the workspace to fetch the governed evidence again. */
  onProductEvidenceRetry?: () => void;
  /** The governed search radius (distance_meters) drawn as a ring around the current point. */
  searchRadiusMeters?: number | null;
  /**
   * productMode only (DEMO M2c item 2): why no ring is drawn although the assessment has a search
   * radius -- e.g. the assessment was made for another point than the one shown. Legend text.
   */
  searchRadiusWithheldNote?: string | null;
  /** How the current point was made, e.g. 'Beräknad mittpunkt (ej inmätt)'. */
  currentLocationLabel?: string;
}

const CesiumMapView: React.FC<CesiumMapViewProps> = ({
  propertyGeometry,
  propertyCoordinates,
  onEvidenceClick,
  evidenceMode: evidenceModeProp = 'fixture',
  onEvidenceModeChange,
  pickingLocation = false,
  onLocationPick,
  draftLocationPoint = null,
  currentLocationPoint = null,
  productMode = false,
  productEvidence,
  onProductEvidenceRetry,
  searchRadiusMeters = null,
  searchRadiusWithheldNote = null,
  currentLocationLabel,
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
  const [awaitingAssessment, setAwaitingAssessment] = useState(false);
  const [geometrylessEvidence, setGeometrylessEvidence] = useState(false);

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

  const onProductEvidenceRetryRef = useRef(onProductEvidenceRetry);
  useEffect(() => {
    onProductEvidenceRetryRef.current = onProductEvidenceRetry;
  }, [onProductEvidenceRetry]);

  // Primitive deps: callers commonly pass a fresh [lat, lng] array per render.
  const propertyLat = propertyCoordinates ? propertyCoordinates[0] : null;
  const propertyLng = propertyCoordinates ? propertyCoordinates[1] : null;

  useEffect(() => {
    if (!containerRef.current) return;

    const adapter = new CesiumAdapter({
      container: containerRef.current,
      onFeatureClick: (props) => {
        onEvidenceClickRef.current?.(props);
      },
    });

    adapterRef.current = adapter;

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
      adapterRef.current.setCurrentLocationPoint(currentLocationPoint.lat, currentLocationPoint.lng, currentLocationLabel);
    } else {
      adapterRef.current.clearCurrentLocationPoint();
    }
  }, [currentLocationPoint, currentLocationLabel]);

  useEffect(() => {
    if (!adapterRef.current) return;
    if (currentLocationPoint && typeof searchRadiusMeters === 'number' && searchRadiusMeters > 0) {
      adapterRef.current.setSearchRadiusRing(currentLocationPoint.lat, currentLocationPoint.lng, searchRadiusMeters);
    } else {
      adapterRef.current.clearSearchRadiusRing();
    }
  }, [currentLocationPoint, searchRadiusMeters]);

  // ---- productMode: property geometry (independent of the evidence, so a new evidence result never
  // re-flies the camera).
  useEffect(() => {
    if (!productMode) return;
    const adapter = adapterRef.current;
    if (!adapter) return;
    void adapter.setPropertyGeometry(
      propertyGeometry,
      propertyLat !== null && propertyLng !== null ? [propertyLat, propertyLng] : null,
    );
  }, [productMode, propertyGeometry, propertyLat, propertyLng]);

  // ---- productMode: governed evidence handed down by the workspace. No fetch, no fixture.
  useEffect(() => {
    if (!productMode) return;
    const adapter = adapterRef.current;
    if (!adapter) return;
    let cancelled = false;
    const evidence: CesiumProductEvidence = productEvidence ?? { status: 'none' };
    setEvidenceError(null);
    setEvidenceMeta(null);
    setEmptyEvidence(false);
    setGeometrylessEvidence(false);
    setAwaitingAssessment(evidence.status === 'none');
    if (evidence.status !== 'loaded') {
      adapter.clearEvidenceLayers();
      setEvidenceCount(null);
      setLoadingEvidence(evidence.status === 'loading');
      if (evidence.status === 'error') setEvidenceError(evidence.messageSv);
      return;
    }
    setLoadingEvidence(true);
    void (async () => {
      try {
        const count = await adapter.setEvidenceLayers(evidence.geojson);
        if (cancelled) return;
        const fc = evidence.geojson as { features?: unknown };
        const features = Array.isArray(fc?.features) ? (fc.features as Array<{ geometry?: unknown } | null>) : [];
        setEvidenceCount(count);
        setEmptyEvidence(count === 0);
        setGeometrylessEvidence(features.length > 0 && features.every((f) => !f?.geometry));
      } catch (err) {
        if (cancelled) return;
        console.error('[CesiumMapView] Error rendering governed evidence:', err);
        adapterRef.current?.clearEvidenceLayers();
        setEvidenceCount(0);
        setEvidenceError('Kontrollresultaten kunde inte visas på kartan.');
      } finally {
        if (!cancelled) setLoadingEvidence(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productMode, productEvidence, reloadToken]);

  // ---- Exploration mode (e.g. GisRiskModule): fixture or the general-purpose /api/spatial/evidence.
  useEffect(() => {
    if (productMode || !adapterRef.current) return;

    let cancelled = false;
    setLoadingEvidence(true);
    setEvidenceError(null);
    setEvidenceMeta(null);
    setEmptyEvidence(false);
    setAwaitingAssessment(false);
    setGeometrylessEvidence(false);
    const propertyCoordinatesNow: [number, number] | null =
      propertyLat !== null && propertyLng !== null ? [propertyLat, propertyLng] : null;

    const run = async () => {
      try {
        const adapter = adapterRef.current;
        if (!adapter) return;
        if (mode === 'fixture') {
          const scene = await loadCesiumL0L1FixtureScene();
          if (cancelled || !adapterRef.current) return;

          const propGeom = propertyGeometry ?? scene.property;
          const fallback: [number, number] = propertyCoordinatesNow ?? [
            scene.center.lat,
            scene.center.lng,
          ];
          await adapterRef.current.setPropertyGeometry(propGeom, fallback);
          if (cancelled || !adapterRef.current) return;
          const count = await adapterRef.current.setEvidenceLayers(scene.evidence);
          adapterRef.current?.setLayerVisibility(visibleLayers);
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

        if (!propertyCoordinatesNow) {
          throw new Error('Live-läge kräver fastighetskoordinater (lat/lng). Byt till fixture eller sök fastighet.');
        }

        await adapter.setPropertyGeometry(propertyGeometry, propertyCoordinatesNow);

        // General-purpose GIS exploration (e.g. GisRiskModule) only. The governed LU product view
        // never reaches this branch: it runs in productMode, where the LU workspace fetches the
        // governed /viewer/evidence itself and hands it down (see CesiumProductEvidence).
        const geojson = await (async () => {
          const [lat, lng] = propertyCoordinatesNow;
          const res = await fetch(`/api/spatial/evidence?lat=${lat}&lng=${lng}`);
          if (!res.ok) {
            throw new Error(`Live evidence misslyckades (HTTP ${res.status}). PostGIS kanske inte är klar.`);
          }
          return res.json();
        })();
        if (cancelled || !adapterRef.current) return;

        const count = await adapterRef.current.setEvidenceLayers(geojson);
        adapterRef.current?.setLayerVisibility(visibleLayers);
        if (!cancelled) {
          setEvidenceCount(count);
          setEvidenceMeta({
            ...(geojson.meta || {}),
            source: 'live',
            feature_count: typeof geojson.meta?.feature_count === 'number' ? geojson.meta.feature_count : count,
          });
          setEmptyEvidence(count === 0);
          const features = Array.isArray(geojson?.features) ? geojson.features : [];
          setGeometrylessEvidence(features.length > 0 && features.every((f: { geometry?: unknown }) => !f?.geometry));
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
  }, [productMode, propertyGeometry, propertyLat, propertyLng, mode, reloadToken]);

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
  const propertyHasBoundary = hasPolygonBoundary(propertyGeometry);
  // productMode: the retry either asks the workspace to fetch again (data error) or re-renders (render error).
  const retryEvidence = () => {
    if (productMode && productEvidence?.status === 'error') {
      onProductEvidenceRetryRef.current?.();
      return;
    }
    setReloadToken((n) => n + 1);
  };
  const canRetryEvidence = !productMode || productEvidence?.status !== 'error' || productEvidence.retryable;

  return (
    <div
      className="relative w-full h-full rounded-2xl overflow-hidden border border-slate-200 shadow-inner flex flex-col"
      style={{ minHeight: '550px' }}
      data-testid="cesium-map-view"
      data-evidence-mode={productMode ? 'governed' : mode}
    >
      {productMode ? (
        <div
          data-testid="cesium-product-legend"
          className="absolute top-4 left-4 z-10 bg-slate-900/90 text-white p-3 rounded-xl shadow-lg border border-slate-700/50 backdrop-blur-md flex flex-col gap-1.5 w-[270px] text-[11px]"
        >
          <p className="font-black uppercase tracking-wider text-slate-300">Karta</p>
          {propertyHasBoundary ? (
            <p data-testid="cesium-property-legend" className="text-slate-300">
              <span style={{ color: '#00FFFF' }}>▭</span> Fastighetsgränsen från fastighetsuppslaget.
            </p>
          ) : propertyGeometry || propertyCoordinates ? (
            <p data-testid="cesium-property-legend" className="text-slate-300">
              <span style={{ color: '#FFD700' }}>●</span> Fastighetens ungefärliga läge – fastighetsuppslaget innehåller ingen gräns.
            </p>
          ) : null}
          {currentLocationPoint ? (
            <p className="text-slate-300">
              <span style={{ color: '#00FF00' }}>●</span> {currentLocationLabel ?? 'Kontrollpunkt'}
            </p>
          ) : null}
          {typeof searchRadiusMeters === 'number' && searchRadiusMeters > 0 && currentLocationPoint ? (
            <p data-testid="cesium-search-radius-legend" className="text-slate-300">
              <span style={{ color: '#FFFFFF' }}>◯</span> Sökradie {searchRadiusMeters} m – visar var kontrollen sökte, inte var
              några objekt ligger.
            </p>
          ) : null}
          {searchRadiusWithheldNote ? (
            <p data-testid="cesium-search-radius-withheld" className="text-amber-300">
              {searchRadiusWithheldNote}
            </p>
          ) : null}
          {geometrylessEvidence ? (
            <p data-testid="cesium-geometryless-note" className="text-slate-400">
              Kontrollresultaten saknar objektgeometri och visas därför inte som objekt på kartan. Se listan Kontroller.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => adapterRef.current?.resetCameraOverview()}
            className="mt-1 text-[10px] font-bold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1.5 text-left transition-colors"
          >
            Återställ kamera (Sverige)
          </button>
        </div>
      ) : (
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
      )}

      {!productMode && (
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
      )}

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
          {productMode ? 'Hämtar kontrollresultat…' : 'Hämtar SpatialEvidence...'}
        </div>
      )}

      {productMode && awaitingAssessment && !loadingEvidence && (
        <div
          data-testid="cesium-awaiting-assessment"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-slate-900/95 text-white px-4 py-3 rounded-xl shadow border border-slate-700 max-w-md text-center"
        >
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-300">Inga kontrollresultat att visa ännu</p>
          <p className="text-[10px] text-slate-400 mt-1">Kontrollresultat visas när det finns en bedömning för kontrollpunkten.</p>
        </div>
      )}

      {productMode && emptyEvidence && !loadingEvidence && !evidenceError && (
        <div
          data-testid="cesium-empty-evidence"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-slate-900/95 text-white px-4 py-3 rounded-xl shadow border border-slate-700 max-w-md text-center"
        >
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-300">Inga kontrollresultat i underlaget</p>
          <p className="text-[10px] text-slate-400 mt-1">Det betyder inte att inga objekt finns – kontrollerna har inte gett något resultat att visa.</p>
        </div>
      )}

      {!productMode && emptyEvidence && !loadingEvidence && !evidenceError && (
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
          <p className="text-[11px] font-black uppercase tracking-wider text-rose-200">
            {productMode
              ? `${(productEvidence?.status === 'error' && productEvidence.stateLabel) || 'Tekniskt fel'} – kontrollresultat kan inte visas på kartan`
              : 'Evidensfel'}
          </p>
          {/* productMode: always the workspace's plain-Swedish text, never a raw server message. */}
          <p data-testid="cesium-evidence-error-message" className="text-[10px] text-rose-100/90 mt-1">{evidenceError}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            {canRetryEvidence ? (
              <button
                type="button"
                data-testid="cesium-retry"
                onClick={retryEvidence}
                className="text-[10px] font-black uppercase bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg"
              >
                Försök igen
              </button>
            ) : null}
            {mode === 'live' && !productMode && (
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
