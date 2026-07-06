import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppWorkspace } from './app/providers/AppWorkspaceProvider';
import { DecisionType, Permit, Receiver } from '../types';
import { fetchMunicipalityContext } from '../services/geminiService';
import { useMapLayerCatalog, useOgcFederatedMapLayers, useSpatialAudit } from '../src/ui/hooks/useGeoLayers';
import type { MapLayerCatalogEntry } from '../src/ui/api-client/geo.client';
import {
  DYNAMIC_BBOX_LAYER_CONFIG,
  FLOOD_RISK_STYLE,
  getMarkCoverStyle,
  getSguCoastalErosionStyle,
  getSguGroundLayerStyle,
  getSguHighestCoastlineStyle,
  getSguLandslideStyle,
  getSguPermeabilityStyle,
  POSTGIS_LAKES_STYLE,
  POSTGIS_NVR_STYLE,
  POSTGIS_PROPERTY_STYLE,
  POSTGIS_STREAMS_STYLE,
  NATURA2000_STYLE,
  INTERNATIONAL_PROTECTION_STYLE,
  SGU_GROUNDWATER_BODY_STYLE,
  SGU_GROUNDWATER_MAGAZINE_STYLE,
  SGU_COASTAL_EROSION_POINT_STYLE,
  SGU_HIGHEST_COASTLINE_POINT_STYLE,
  SGU_WELL_POINT_STYLE,
  STATIC_OVERLAY_CONFIG,
  WATER_CATCHMENT_STYLE,
  MAIN_CATCHMENT_STYLE,
  getDatasetLeafletStyleBundle,
  type CatalogLayerStyleHint,
  WATER_PROTECTION_STYLE,
  TOPO10_BUILDINGS_STYLE,
  TOPO10_MARK_STYLE,
  TOPO10_VAG_STYLE,
  TOPO10_VATTEN_STYLE,
  TOPO10_JARNVAG_STYLE,
} from './project/MapConfig';

type BaseLayerKey = 'osm' | 'topo' | 'orto' | 'local' | 'orsa_true_ortho';

type LocalBasemapConfig =
  | { kind: 'xyz'; url: string; attribution: string }
  | { kind: 'wms'; url: string; layers: string; attribution: string };

/** Lantmäteriet open WMS kräver subscription-key i klienten; annars risk för tom basemap. */
function getLantmaterietOpenKey(): string {
  return String(import.meta.env.VITE_LANTMATERIET_OPEN_SUBSCRIPTION_KEY ?? '').trim();
}

function hasLantmaterietOpenKey(): boolean {
  return getLantmaterietOpenKey().length > 0;
}

function withLantmaterietOpenSubscription(url: string): string {
  const key = getLantmaterietOpenKey();
  if (!key) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}subscription-key=${encodeURIComponent(key)}`;
}

const LANTMATERIET_KEY_NOTICE =
  'Lantmäteriet-prenumerationsnyckel saknas (VITE_LANTMATERIET_OPEN_SUBSCRIPTION_KEY) — Topo/Ortofoto kan visas som tom karta. Använd OSM eller sätt nyckeln i .env.';

/**
 * Lager som kan ge stora payloads vid låg zoom (hela landet). Vi avstår från
 * att hämta data under tröskeln och visar i stället ett notice — på så sätt
 * undviks långsam GeoJSON-rendering som uppfattas som "kartlagret hänger".
 */
const HEAVY_LAYER_MIN_ZOOM: Partial<Record<string, number>> = {
  topo10_buildings: 13,
  topo10_mark: 12,
  topo10_vag: 12,
  topo10_vatten: 12,
  topo10_jarnvag: 12,
  postgis_property: 13,
};

/** Hur många gånger vi tål att bbox inte är giltigt innan vi ger upp. */
const MAX_BBOX_RETRIES = 4;
const BBOX_RETRY_DELAY_MS = 600;

function readLocalBasemapConfig(): LocalBasemapConfig | null {
  const attribution = String(import.meta.env.VITE_LOCAL_BASEMAP_ATTRIBUTION ?? '').trim() || 'Lokal källa';
  const xyz = String(import.meta.env.VITE_LOCAL_BASEMAP_XYZ_URL ?? '').trim();
  if (xyz) return { kind: 'xyz', url: xyz, attribution };
  const wmsUrl = String(import.meta.env.VITE_LOCAL_BASEMAP_WMS_URL ?? '').trim();
  const wmsLayers = String(import.meta.env.VITE_LOCAL_BASEMAP_WMS_LAYERS ?? '').trim();
  if (wmsUrl && wmsLayers) return { kind: 'wms', url: wmsUrl, layers: wmsLayers, attribution };
  return null;
}

function localBasemapButtonLabel(): string {
  return String(import.meta.env.VITE_LOCAL_BASEMAP_LABEL ?? '').trim() || 'Lokal grundkarta';
}

function readLegacyLocation(value: unknown): { lat?: number; lng?: number } | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { lat?: unknown; lng?: unknown; lon?: unknown };
  const lat = typeof candidate.lat === 'number' ? candidate.lat : undefined;
  const lng =
    typeof candidate.lng === 'number'
      ? candidate.lng
      : typeof candidate.lon === 'number'
        ? candidate.lon
        : undefined;
  return lat !== undefined || lng !== undefined ? { lat, lng } : null;
}

function getPermitCoordinates(permit: Permit): { lat: number; lng: number } | null {
  const legacy = readLegacyLocation((permit as Permit & { location?: unknown }).location);
  const lat = typeof permit.lat === 'number' ? permit.lat : legacy?.lat;
  const lng = typeof permit.lng === 'number' ? permit.lng : legacy?.lng;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: lat as number, lng: lng as number } : null;
}

function getReceiverCoordinates(receiver: Receiver): { lat: number; lng: number } | null {
  const legacy = readLegacyLocation((receiver as Receiver & { location?: unknown }).location);
  const lat = typeof receiver.lat === 'number' ? receiver.lat : legacy?.lat;
  const lng = typeof receiver.lng === 'number' ? receiver.lng : legacy?.lng;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: lat as number, lng: lng as number } : null;
}

interface MapViewProps {
  permits?: Permit[];
  receivers?: Receiver[];
  onSelectPermit?: (permit: Permit) => void;
  onSelectReceiver?: (receiver: Receiver) => void;
  selectedReceiverId?: string;
  geoJsonData?: unknown;
  bufferDistance?: number;
  highlightLayer?: string;
}

/**
 * Konflikter från GisRiskModule använder ibland nycklar som inte finns som
 * kartlager — mappa till närmaste overlay. Inkluderar både GisRiskModules
 * faktiska conflict.layer-värden och vanliga synonymer som AI-genererade
 * konflikter eller framtida moduler kan skicka.
 */
const HIGHLIGHT_LAYER_ALIASES: Record<string, string> = {
  smhi_flood: 'climate_flood_risk',
  flood_risk: 'climate_flood_risk',
  climate_flood: 'climate_flood_risk',
  msb_flood: 'climate_flood_risk',
  sgu_jordart: 'sgu_grundlager',
  sgu_jordarter: 'sgu_grundlager',
  sgu_brunnar: 'sgu_brunnar_postgis',
  sgu_permeability: 'sgu_genomslapplighet',
  sgu_genomslapplighet: 'sgu_genomslapplighet',
  sgu_landslide: 'sgu_jordskred_raviner',
  sgu_jordskred: 'sgu_jordskred_raviner',
  sgu_kusterosion: 'sgu_coastal_erosion',
  sgu_hogsta_kustlinjen: 'sgu_highest_coastline',
  groundwater_magazine: 'sgu_groundwater_magazine',
  groundwater_body: 'sgu_groundwater_body',
  protected_area: 'postgis_nvr',
  protected_nature: 'postgis_nvr',
  nvr: 'postgis_nvr',
  nv_nvr: 'postgis_nvr',
  natura2000: 'natura2000_area',
  nv_natura2000: 'natura2000_area',
  ramsar: 'international_protection',
  varldsarv: 'international_protection',
  water_protection_area: 'water_protection',
  vattenskydd: 'water_protection',
  raa_fornlamning: 'raa_fornsok',
  raa_fornlamning_wfs: 'raa_fornsok',
  fornlamning: 'raa_fornsok',
  marktacke: 'mark_cover',
  markanvandning: 'mark_cover',
  fastighet: 'postgis_property',
  fastighetsgranser: 'postgis_property',
};

function isRenderableGeoJson(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const o = data as Record<string, unknown>;
  if (o.type === 'FeatureCollection') {
    return Array.isArray(o.features) && o.features.length > 0;
  }
  if (o.type === 'Feature' && o.geometry && typeof o.geometry === 'object') return true;
  if (o.type === 'GeometryCollection') {
    return Array.isArray(o.geometries) && o.geometries.length > 0;
  }
  const geomTypes = new Set([
    'Polygon',
    'MultiPolygon',
    'LineString',
    'MultiLineString',
    'Point',
    'MultiPoint',
  ]);
  return (
    typeof o.type === 'string' &&
    geomTypes.has(o.type as string) &&
    Array.isArray((o as { coordinates?: unknown }).coordinates)
  );
}

const PROPERTY_OVERLAY_STYLE = {
  color: '#2563eb',
  weight: 2,
  opacity: 0.95,
  fillColor: '#3b82f6',
  fillOpacity: 0.22,
} as const;

type MunicipalityContext = {
  municipality: string;
  audit: string;
  fact: string;
  sources: Array<{ web?: { uri: string; title?: string } }>;
};

type LayerStatus = 'loading' | 'loaded' | 'empty' | 'error' | 'not_configured';

type OverlayDescriptor = {
  key: string;
  label: string;
};

const SERVER_TO_UI_LAYER_KEY: Partial<Record<string, string>> = {
  raa_fornlamning_wfs: 'raa_fornsok',
};

const MapView: React.FC<MapViewProps> = ({
  permits = [],
  receivers = [],
  onSelectPermit,
  onSelectReceiver,
  selectedReceiverId,
  geoJsonData,
  bufferDistance,
  highlightLayer,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const layersRef = useRef<Record<string, any>>({});
  const geoJsonLayerRef = useRef<any>(null);
  const bufferLayerRef = useRef<any>(null);
  const dynamicLayerRequestRef = useRef<Record<string, number>>({});
  const activeOverlaysRef = useRef<string[]>([]);
  /** Lager som väntar på att kartan ska få giltigt bbox (#1/#2) */
  const pendingBboxRetryRef = useRef<Map<string, number>>(new Map());

  // Context retrieval inside try-catch to avoid breaking unit tests
  let workspace: any = null;
  try {
    workspace = useAppWorkspace();
  } catch (e) {
    // ignore
  }

  const activeProjectLabel = workspace?.activeProjectLabel;
  const municipality = workspace?.selectedPermit?.municipality;

  const isOrsa = useMemo(() => {
    const labelStr = (activeProjectLabel || '').toLowerCase();
    const muniStr = (municipality || '').toLowerCase();
    return labelStr.includes('orsa') || muniStr.includes('orsa');
  }, [activeProjectLabel, municipality]);

  const trueOrthoFailedRef = useRef(false);
  const applyBaseLayerRef = useRef<any>(null);

  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    hydrology: true,
    nature: true,
    property: true,
    external: true,
  });

  const [baseLayer, setBaseLayer] = useState<BaseLayerKey>('osm');
  const showLocalBasemapOption = readLocalBasemapConfig() !== null;
  const localBasemapLabel = localBasemapButtonLabel();
  const [activeOverlays, setActiveOverlays] = useState<string[]>([]);
  const [overlayStatuses, setOverlayStatuses] = useState<Record<string, LayerStatus>>({});
  const [selectedContext, setSelectedContext] = useState<MunicipalityContext | null>(null);
  const [_isLoadingContext, setIsLoadingContext] = useState(false);
  const [mapNotice, setMapNotice] = useState('');

  const spatialAudit = useSpatialAudit();
  const mapLayerCatalog = useMapLayerCatalog();
  const ogcFederated = useOgcFederatedMapLayers();
  const federatedWmsConfigRef = useRef<Map<string, { baseUrl: string; layers: string; version: string }>>(
    new Map(),
  );

  const layerFetchConfig = useMemo(() => {
    const config: Record<string, { endpoint: string; emptyMessage: string; label: string }> = {
      ...(Object.fromEntries(
        Object.entries(DYNAMIC_BBOX_LAYER_CONFIG).map(([key, cfg]) => [key, cfg]),
      ) as Record<string, { endpoint: string; emptyMessage: string; label: string }>),
    };
    const catalogEntries = Array.isArray(mapLayerCatalog.data) ? mapLayerCatalog.data : [];
    for (const entry of catalogEntries) {
      const key = SERVER_TO_UI_LAYER_KEY[entry.key] ?? entry.key;
      if (!config[key] && entry.endpoint) {
        config[key] = {
          endpoint: entry.endpoint,
          label: entry.label,
          emptyMessage: `Inga ${entry.label} i aktuell kartvy.`,
        };
      }
    }
    return config;
  }, [mapLayerCatalog.data]);

  const catalogMinZoom = useMemo(() => {
    const zooms: Record<string, number> = { ...HEAVY_LAYER_MIN_ZOOM };
    const catalogEntries = Array.isArray(mapLayerCatalog.data) ? mapLayerCatalog.data : [];
    for (const entry of catalogEntries) {
      const key = SERVER_TO_UI_LAYER_KEY[entry.key] ?? entry.key;
      if (typeof entry.minZoom === 'number') {
        zooms[key] = entry.minZoom;
      }
    }
    return zooms;
  }, [mapLayerCatalog.data]);

  const overlayDescriptors = useMemo<OverlayDescriptor[]>(() => {
    const resolved = new Map<string, OverlayDescriptor>();
    const add = (key: string, label: string) => {
      if (!resolved.has(key)) {
        resolved.set(key, { key, label });
      }
    };

    const catalogEntries = Array.isArray(mapLayerCatalog.data) ? mapLayerCatalog.data : [];
    for (const entry of catalogEntries) {
      const resolvedKey = SERVER_TO_UI_LAYER_KEY[entry.key] ?? entry.key;
      add(resolvedKey, entry.label);
    }

    (Object.entries(STATIC_OVERLAY_CONFIG) as Array<[string, { label: string }]>).forEach(([key, cfg]) => {
      add(key, cfg.label);
    });

    (
      Object.entries(DYNAMIC_BBOX_LAYER_CONFIG) as Array<
        [string, { endpoint: string; emptyMessage: string; label: string }]
      >
    ).forEach(([key, cfg]) => {
      add(key, cfg.label);
    });

    return Array.from(resolved.values());
  }, [mapLayerCatalog.data]);

  const classifiedOverlays = useMemo(() => {
    const categories: Record<string, { label: string; items: OverlayDescriptor[] }> = {
      hydrology: { label: 'Hydrologi & Geologi', items: [] },
      nature: { label: 'Natur & Miljöskydd', items: [] },
      property: { label: 'Fastighet & Byggnad', items: [] },
      external: { label: 'Externa WMS & Övrigt', items: [] },
    };

    overlayDescriptors.forEach((desc) => {
      const { key } = desc;
      if (
        key.startsWith('sgu_') ||
        key === 'postgis_lakes' ||
        key === 'postgis_streams' ||
        key.startsWith('hydro_')
      ) {
        categories.hydrology.items.push(desc);
      } else if (
        key === 'nv_natura' ||
        key === 'natura2000_area' ||
        key === 'climate_flood_risk' ||
        key === 'mark_cover' ||
        key === 'water_protection' ||
        key === 'international_protection' ||
        key === 'postgis_nvr'
      ) {
        categories.nature.items.push(desc);
      } else if (key === 'postgis_property' || key.startsWith('topo10_')) {
        categories.property.items.push(desc);
      } else {
        categories.external.items.push(desc);
      }
    });

    return categories;
  }, [overlayDescriptors]);

  useEffect(() => {
    const next = new Map<string, { baseUrl: string; layers: string; version: string }>();
    for (const layer of ogcFederated.wmsLayers) {
      if (layer.wms) {
        next.set(layer.layerKey, layer.wms);
      }
    }
    federatedWmsConfigRef.current = next;
  }, [ogcFederated.wmsLayers]);

  const federatedOverlayDescriptors = useMemo<OverlayDescriptor[]>(() => {
    return ogcFederated.wmsLayers.map((layer) => {
      const catalogId = /^ogc_wms:([^:]+):/.exec(layer.layerKey)?.[1] ?? '';
      const catalogLabel = ogcFederated.catalogLabelById.get(catalogId) ?? 'WMS';
      const shortLabel = (layer.title?.trim() || layer.name).slice(0, 48);
      return {
        key: layer.layerKey,
        label: `${catalogLabel.replace(/\s*\(WMS\)\s*/i, '').slice(0, 14)} · ${shortLabel}`,
      };
    });
  }, [ogcFederated.wmsLayers, ogcFederated.catalogLabelById]);

  const ensureOgcWmsLayer = useCallback((layerKey: string) => {
    if (layersRef.current[layerKey]) return;
    const cfg = federatedWmsConfigRef.current.get(layerKey);
    const L = (window as { L?: { tileLayer: { wms: (...args: unknown[]) => unknown } } }).L;
    if (!cfg || !L) return;
    layersRef.current[layerKey] = L.tileLayer.wms(cfg.baseUrl, {
      layers: cfg.layers,
      format: 'image/png',
      transparent: true,
      opacity: 0.65,
      version: cfg.version || '1.3.0',
    });
  }, []);

  const markerCoordinates = useMemo(() => {
    const permitCoords = permits
      .map((permit) => getPermitCoordinates(permit))
      .filter((value): value is { lat: number; lng: number } => value !== null);
    const receiverCoords = receivers
      .map((receiver) => getReceiverCoordinates(receiver))
      .filter((value): value is { lat: number; lng: number } => value !== null);

    return [...permitCoords, ...receiverCoords];
  }, [permits, receivers]);

  useEffect(() => {
    activeOverlaysRef.current = activeOverlays;
  }, [activeOverlays]);

  const toBboxParam = (map: any): string | null => {
    const bounds = map?.getBounds?.();
    if (!bounds?.isValid?.()) return null;
    const west = Number(bounds.getWest?.());
    const south = Number(bounds.getSouth?.());
    const east = Number(bounds.getEast?.());
    const north = Number(bounds.getNorth?.());
    if (![west, south, east, north].every(Number.isFinite)) return null;
    if (Math.abs(east - west) < 1e-6 || Math.abs(north - south) < 1e-6) return null;
    return [west, south, east, north].join(',');
  };

  const refreshDynamicBboxLayer = useCallback(
    async function refreshDynamicBboxLayerInternal(layerKey: string) {
      const map = mapRef.current;
      const layer = layersRef.current[layerKey];
      const config = layerFetchConfig[layerKey];
      if (!map || !layer || !config) {
        setOverlayStatuses((prev) => ({ ...prev, [layerKey]: 'not_configured' }));
        return;
      }

      // (#9) Tunga lager: stoppa fetch när användaren är för utzoomad så att
      // klienten inte försöker rendera hundratusentals features. Tröskeln rensar
      // också tidigare data så lagret inte ligger kvar som "loaded" felaktigt.
      const minZoom = catalogMinZoom[layerKey];
      if (typeof minZoom === 'number') {
        const zoom = typeof map.getZoom === 'function' ? Number(map.getZoom()) : NaN;
        if (Number.isFinite(zoom) && zoom < minZoom) {
          try {
            layer.clearLayers?.();
          } catch {
            /* mock-säker */
          }
          setOverlayStatuses((prev) => ({ ...prev, [layerKey]: 'empty' }));
          setMapNotice(`Zooma in (≥ ${minZoom}) för att ladda ${config.label}.`);
          return;
        }
      }

      let bbox = toBboxParam(map);
      if (!bbox) {
        map.invalidateSize?.(false);
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        bbox = toBboxParam(map);
      }
      if (!bbox) {
        // (#1) Tysta tidigare gjorde att lagret aktiverades utan feedback. Nu
        // visar vi tydlig status + notice, och (#2) schemalägger en automatisk
        // retry så snart kartan får giltigt bounds — med en hård gräns för att
        // undvika oändliga loopar om containern aldrig dimensioneras.
        const attempts = (pendingBboxRetryRef.current.get(layerKey) ?? 0) + 1;
        pendingBboxRetryRef.current.set(layerKey, attempts);

        if (attempts > MAX_BBOX_RETRIES) {
          pendingBboxRetryRef.current.delete(layerKey);
          setOverlayStatuses((prev) => ({ ...prev, [layerKey]: 'error' }));
          setMapNotice(
            `Kartan kunde inte initieras. ${config.label} kunde inte hämtas. Försök ladda om sidan.`,
          );
          return;
        }

        setOverlayStatuses((prev) => ({ ...prev, [layerKey]: 'loading' }));
        setMapNotice(`Kartan inte redo — försöker hämta ${config.label} igen…`);
        window.setTimeout(() => {
          if (activeOverlaysRef.current.includes(layerKey)) {
            void refreshDynamicBboxLayerInternal(layerKey);
          } else {
            pendingBboxRetryRef.current.delete(layerKey);
          }
        }, BBOX_RETRY_DELAY_MS);
        return;
      }
      pendingBboxRetryRef.current.delete(layerKey);

      const requestId = (dynamicLayerRequestRef.current[layerKey] || 0) + 1;
      dynamicLayerRequestRef.current[layerKey] = requestId;
      setOverlayStatuses((prev) => ({ ...prev, [layerKey]: 'loading' }));

      try {
        const response = await fetch(`${config.endpoint}?bbox=${encodeURIComponent(bbox)}`, {
          credentials: 'same-origin',
        });
        const data = await response.json().catch(() => ({}) as Record<string, unknown>);
        if (dynamicLayerRequestRef.current[layerKey] !== requestId) return;

        if (!response.ok) {
          // Plocka först meta.warning (kontextrikt servermeddelande), sedan
          // top-level error, sedan generisk HTTP-statustext.
          const detail =
            (typeof (data as any)?.meta?.warning === 'string' && (data as any).meta.warning) ||
            (typeof (data as any)?.error === 'string' && (data as any).error) ||
            `HTTP ${response.status}`;
          throw new Error(detail);
        }

        layer.clearLayers();
        if (Array.isArray((data as any)?.features) && (data as any).features.length > 0) {
          layer.addData(data);
        }
        const status: LayerStatus =
          Array.isArray((data as any)?.features) && (data as any).features.length === 0 ? 'empty' : 'loaded';
        const warning = typeof (data as any)?.meta?.warning === 'string' ? (data as any).meta.warning : '';
        setOverlayStatuses((prev) => ({ ...prev, [layerKey]: status }));
        setMapNotice(warning || (status === 'empty' ? config.emptyMessage : ''));
      } catch (err) {
        if (dynamicLayerRequestRef.current[layerKey] !== requestId) return;
        setOverlayStatuses((prev) => ({ ...prev, [layerKey]: 'error' }));
        const message =
          err instanceof Error && err.message ? err.message : `Kunde inte ladda ${config.label}.`;
        setMapNotice(message);
      }
    },
    [catalogMinZoom, layerFetchConfig],
  );

  const refreshVisibleDynamicLayers = useCallback(() => {
    activeOverlaysRef.current.forEach((key) => {
      if (layerFetchConfig[key]) {
        void refreshDynamicBboxLayer(key);
      }
    });
  }, [refreshDynamicBboxLayer, layerFetchConfig]);

  const applyBaseLayer = useCallback((key: BaseLayerKey) => {
    const map = mapRef.current;
    if (!map) return;
    const layer = layersRef.current[key];
    if (!layer) return;

    const candidates: BaseLayerKey[] = ['osm', 'topo', 'orto', 'orsa_true_ortho'];
    if (layersRef.current.local) candidates.push('local');

    for (const k of candidates) {
      const l = layersRef.current[k];
      if (l && map.hasLayer(l)) map.removeLayer(l);
    }
    layer.addTo(map);
    setBaseLayer(key);

    // (#6) Lantmäteriet open WMS svarar med tom karta utan giltig
    // prenumerationsnyckel. Tidigare blev det tyst — nu informeras användaren
    // omedelbart att de behöver byta tillbaka till OSM eller sätta nyckeln.
    if ((key === 'topo' || key === 'orto') && !hasLantmaterietOpenKey()) {
      setMapNotice(LANTMATERIET_KEY_NOTICE);
    } else {
      setMapNotice((current) => (current === LANTMATERIET_KEY_NOTICE ? '' : current));
    }
  }, []);

  useEffect(() => {
    applyBaseLayerRef.current = applyBaseLayer;
  }, [applyBaseLayer]);

  useEffect(() => {
    if (!isOrsa && baseLayer === 'orsa_true_ortho') {
      applyBaseLayer('osm');
    }
  }, [isOrsa, baseLayer, applyBaseLayer]);

  // --- INITIALIZATION ---
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const L = (window as any).L;
    if (!L) {
      setMapNotice('Leaflet saknas i runtime.');
      return;
    }

    const localCfg = readLocalBasemapConfig();

    mapRef.current = L.map(mapContainerRef.current, {
      zoomControl: false,
      maxZoom: 18,
      zoomDelta: 0.5,
      zoomSnap: 0.5,
      wheelPxPerZoomLevel: 180,
    }).setView([61.115, 14.617], 11);
    L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);

    // Base Layers
    layersRef.current.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    layersRef.current.topo = L.tileLayer.wms(
      withLantmaterietOpenSubscription('https://api.lantmateriet.se/open/topowebb-ccby/v1/wms'),
      {
        layers: 'topowebb',
        format: 'image/png',
        version: '1.3.0',
      },
    );
    layersRef.current.orto = L.tileLayer.wms(
      withLantmaterietOpenSubscription('https://api.lantmateriet.se/open/ortofoto-ccby/v1/wms'),
      {
        layers: 'Ortofoto_0.5,Ortofoto_0.4,Ortofoto_0.25,Ortofoto_0.16',
        format: 'image/png',
        version: '1.3.0',
      },
    );

    if (localCfg) {
      if (localCfg.kind === 'xyz') {
        layersRef.current.local = L.tileLayer(localCfg.url, {
          maxZoom: 18,
          attribution: localCfg.attribution,
        });
      } else {
        layersRef.current.local = L.tileLayer.wms(localCfg.url, {
          layers: localCfg.layers,
          format: 'image/png',
          version: '1.3.0',
        });
      }
    }

    layersRef.current.orsa_true_ortho = L.tileLayer('/tiles/orsa_ortho/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 15,
      tms: true, // gdal2tiles mercator default
      attribution: '&copy; Lantmateriet TrueOrtho 2024',
    });

    layersRef.current.orsa_true_ortho.on('tileerror', () => {
      if (!trueOrthoFailedRef.current) {
        trueOrthoFailedRef.current = true;
        setMapNotice('Lokala TrueOrtho-bilder saknas på servern. Återgår till OSM.');
        applyBaseLayerRef.current?.('osm');
      }
    });

    // OpenStreetMap som standard — fungerar utan API-nyckel. Lantmäteriet WMS kan ge tom karta utan giltig prenumeration.
    layersRef.current.osm.addTo(mapRef.current);

    // Overlays
    layersRef.current.raa_fornsok = L.tileLayer.wms('https://pub.raa.se/visning/lamningar_v1/wms', {
      layers: 'fornlamning',
      format: 'image/png',
      transparent: true,
      opacity: 0.7,
    });
    layersRef.current.nv_natura = L.tileLayer.wms('https://nvpub.naturvardsverket.se/geoservices/wms', {
      layers: 'Natura2000',
      format: 'image/png',
      transparent: true,
      opacity: 0.6,
    });
    layersRef.current.sgu_brunnar = L.tileLayer.wms(
      'https://maps3.sgu.se/geoserver/grundvatten/ows?SERVICE=WMS&',
      {
        layers: 'SE.GOV.SGU.BRUNNAR.250K',
        format: 'image/png',
        transparent: true,
        opacity: 0.8,
      },
    );
    layersRef.current.sgu_groundwater_vulnerability = L.tileLayer.wms(
      'https://maps3.sgu.se/geoserver/grundvatten/ows?SERVICE=WMS&',
      {
        layers: 'SE.GOV.SGU.GRUNDVATTEN.SARBARHET_3KL',
        format: 'image/png',
        transparent: true,
        opacity: 0.6,
      },
    );
    layersRef.current.climate_flood_risk = L.geoJSON(undefined, { style: FLOOD_RISK_STYLE });
    layersRef.current.mark_cover = L.geoJSON(undefined, { style: getMarkCoverStyle });
    layersRef.current.water_protection = L.geoJSON(undefined, { style: WATER_PROTECTION_STYLE });
    layersRef.current.natura2000_area = L.geoJSON(undefined, { style: NATURA2000_STYLE });
    layersRef.current.international_protection = L.geoJSON(undefined, {
      style: INTERNATIONAL_PROTECTION_STYLE,
    });
    layersRef.current.sgu_brunnar_postgis = L.geoJSON(undefined, {
      pointToLayer: (_feature: unknown, latlng: unknown) => L.circleMarker(latlng, SGU_WELL_POINT_STYLE),
    });
    layersRef.current.sgu_grundlager = L.geoJSON(undefined, { style: getSguGroundLayerStyle });
    layersRef.current.sgu_genomslapplighet = L.geoJSON(undefined, { style: getSguPermeabilityStyle });
    layersRef.current.sgu_groundwater_magazine = L.geoJSON(undefined, {
      style: SGU_GROUNDWATER_MAGAZINE_STYLE,
    });
    layersRef.current.sgu_groundwater_body = L.geoJSON(undefined, { style: SGU_GROUNDWATER_BODY_STYLE });
    layersRef.current.sgu_jordskred_raviner = L.geoJSON(undefined, { style: getSguLandslideStyle });
    layersRef.current.sgu_coastal_erosion = L.geoJSON(undefined, {
      style: getSguCoastalErosionStyle,
      pointToLayer: (_feature: unknown, latlng: unknown) =>
        L.circleMarker(latlng, SGU_COASTAL_EROSION_POINT_STYLE),
    });
    layersRef.current.sgu_highest_coastline = L.geoJSON(undefined, {
      style: getSguHighestCoastlineStyle,
      pointToLayer: (_feature: unknown, latlng: unknown) =>
        L.circleMarker(latlng, SGU_HIGHEST_COASTLINE_POINT_STYLE),
    });
    layersRef.current.postgis_nvr = L.geoJSON(undefined, { style: POSTGIS_NVR_STYLE });
    layersRef.current.postgis_lakes = L.geoJSON(undefined, { style: POSTGIS_LAKES_STYLE });
    layersRef.current.postgis_streams = L.geoJSON(undefined, { style: POSTGIS_STREAMS_STYLE });
    layersRef.current.hydro_water_catchment = L.geoJSON(undefined, { style: WATER_CATCHMENT_STYLE });
    layersRef.current.hydro_main_catchment = L.geoJSON(undefined, { style: MAIN_CATCHMENT_STYLE });
    layersRef.current.postgis_property = L.geoJSON(undefined, { style: POSTGIS_PROPERTY_STYLE });
    layersRef.current.topo10_buildings = L.geoJSON(undefined, { style: TOPO10_BUILDINGS_STYLE });
    layersRef.current.topo10_mark = L.geoJSON(undefined, { style: TOPO10_MARK_STYLE });
    layersRef.current.topo10_vag = L.geoJSON(undefined, { style: TOPO10_VAG_STYLE });
    layersRef.current.topo10_vatten = L.geoJSON(undefined, { style: TOPO10_VATTEN_STYLE });
    layersRef.current.topo10_jarnvag = L.geoJSON(undefined, { style: TOPO10_JARNVAG_STYLE });

    mapRef.current.on('moveend', refreshVisibleDynamicLayers);
    mapRef.current.on('zoomend', refreshVisibleDynamicLayers);

    const containerEl = mapContainerRef.current;
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && containerEl
        ? new ResizeObserver(() => {
            mapRef.current?.invalidateSize?.(false);
            // (#2) När containern äntligen får giltig storlek kan tidigare
            // misslyckade bbox-hämtningar lyckas — kör om alla aktiva lager.
            if (activeOverlaysRef.current.length > 0) {
              window.setTimeout(() => refreshVisibleDynamicLayers(), 50);
            }
          })
        : null;
    resizeObserver?.observe(containerEl);

    window.setTimeout(() => {
      mapRef.current?.invalidateSize?.(false);
    }, 150);
    window.setTimeout(() => {
      mapRef.current?.invalidateSize?.(false);
    }, 500);

    mapRef.current.on('click', async (event: any) => {
      const { lat, lng } = event.latlng;
      const popup = L.popup()
        .setLatLng(event.latlng)
        .setContent('Hamtar GIS-detaljer...')
        .openOn(mapRef.current);
      try {
        const result = await spatialAudit.mutateAsync({ lat, lng });
        popup.setContent(`<div class="p-4 text-xs font-medium">${result}</div>`);
      } catch {
        popup.setContent('<div class="p-4 text-xs text-rose-500">Analys misslyckades.</div>');
      }
    });

    // Fånga ref-värdet inom effekten för att undvika react-hooks-varning
    // ("ref value will likely have changed by cleanup time"). Mappen är dock
    // stabil under komponentens livstid eftersom vi bara muterar dess innehåll.
    const pendingRetries = pendingBboxRetryRef.current;
    return () => {
      resizeObserver?.disconnect();
      pendingRetries.clear();
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
    };
  }, [refreshVisibleDynamicLayers]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- GIS-risk: uppladdad GeoJSON + fastighetspolygon + valfri buffert ---
  useEffect(() => {
    const map = mapRef.current;
    const L = (window as any).L;
    if (!map || !L) return;

    if (geoJsonLayerRef.current) {
      map.removeLayer(geoJsonLayerRef.current);
      geoJsonLayerRef.current = null;
    }
    if (bufferLayerRef.current) {
      map.removeLayer(bufferLayerRef.current);
      bufferLayerRef.current = null;
    }

    if (geoJsonData == null || !isRenderableGeoJson(geoJsonData)) return;

    const gj = L.geoJSON(geoJsonData, { style: PROPERTY_OVERLAY_STYLE }).addTo(map);
    geoJsonLayerRef.current = gj;

    try {
      const b = gj.getBounds?.();
      if (b?.isValid?.()) {
        map.fitBounds(b, { padding: [48, 48], maxZoom: 17 });
      }
    } catch {
      /* ignore invalid bounds */
    }

    const bufM = typeof bufferDistance === 'number' && bufferDistance > 0 ? bufferDistance : 0;
    if (bufM > 0) {
      try {
        const b = gj.getBounds?.();
        if (b?.isValid?.()) {
          const center = b.getCenter();
          const circle = L.circle(center, {
            radius: bufM,
            color: '#2563eb',
            weight: 1,
            opacity: 0.55,
            fillColor: '#3b82f6',
            fillOpacity: 0.06,
          }).addTo(map);
          bufferLayerRef.current = circle;
          const cb = circle.getBounds?.();
          if (cb?.isValid?.()) {
            map.fitBounds(cb, { padding: [56, 56], maxZoom: 17 });
          }
        }
      } catch {
        /* ignore */
      }
    }
  }, [geoJsonData, bufferDistance]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || markerCoordinates.length === 0) return;
    if (geoJsonData != null && isRenderableGeoJson(geoJsonData)) return;

    if (markerCoordinates.length === 1) {
      const coordinate = markerCoordinates[0];
      map.setView([coordinate.lat, coordinate.lng], 13);
      window.setTimeout(() => {
        refreshVisibleDynamicLayers();
      }, 0);
      return;
    }

    map.fitBounds(
      markerCoordinates.map((coordinate) => [coordinate.lat, coordinate.lng]),
      { padding: [48, 48], maxZoom: 13 },
    );
    window.setTimeout(() => {
      refreshVisibleDynamicLayers();
    }, 0);
  }, [geoJsonData, markerCoordinates, refreshVisibleDynamicLayers]);

  // --- Aktivera myndighetslager när användaren markerar en konflikt (GisRiskModule) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !highlightLayer) return;

    const resolved = HIGHLIGHT_LAYER_ALIASES[highlightLayer] ?? highlightLayer;
    const layer = layersRef.current[resolved];
    if (!layer) return;

    if (!map.hasLayer(layer)) {
      layer.addTo(map);
      setActiveOverlays((prev) => (prev.includes(resolved) ? prev : [...prev, resolved]));
      if (layerFetchConfig[resolved]) {
        void refreshDynamicBboxLayer(resolved);
      } else {
        setOverlayStatuses((prev) => ({ ...prev, [resolved]: 'loaded' }));
      }
    }
  }, [highlightLayer, layerFetchConfig, refreshDynamicBboxLayer]);

  // Skapa GeoJSON-lager för dataset-rader i katalogen (ett lager per datakälla).
  useEffect(() => {
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    const entries: MapLayerCatalogEntry[] = Array.isArray(mapLayerCatalog.data) ? mapLayerCatalog.data : [];
    for (const entry of entries) {
      if (entry.source === 'external') continue;
      const key = SERVER_TO_UI_LAYER_KEY[entry.key] ?? entry.key;
      if (layersRef.current[key]) continue;
      const bundle = getDatasetLeafletStyleBundle(
        entry.geometry,
        entry.datasetStyle as CatalogLayerStyleHint | undefined,
      );
      if (bundle.kind === 'point') {
        layersRef.current[key] = L.geoJSON(undefined, {
          pointToLayer: (_feature: unknown, latlng: unknown) => L.circleMarker(latlng, bundle.pointStyle),
        });
      } else if (bundle.kind === 'line') {
        layersRef.current[key] = L.geoJSON(undefined, { style: bundle.style });
      } else {
        layersRef.current[key] = L.geoJSON(undefined, { style: bundle.style });
      }
    }
  }, [mapLayerCatalog.data]);

  async function handleContextFetch(permit: Permit) {
    const coordinates = getPermitCoordinates(permit);
    if (!coordinates) return;
    setIsLoadingContext(true);
    try {
      const [audit, facts] = await Promise.all([
        spatialAudit.mutateAsync(coordinates),
        fetchMunicipalityContext(permit.municipality),
      ]);
      setSelectedContext({
        municipality: permit.municipality,
        audit,
        fact: facts.text,
        sources: facts.sources,
      });
    } catch {
      setMapNotice('Kunde inte hämta kontext.');
    } finally {
      setIsLoadingContext(false);
    }
  }

  // --- DATA SYNC ---
  useEffect(() => {
    if (!mapRef.current) return;
    const L = (window as any).L;
    if (!L) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    permits.forEach((p) => {
      const coordinates = getPermitCoordinates(p);
      if (!coordinates) return;
      const color = p.decision_type === DecisionType.BIFALL ? '#10b981' : '#ef4444';
      const icon = L.divIcon({
        html: `<div style="background:${color};width:12px;height:12px;border-radius:50%"></div>`,
        className: '',
      });
      const m = L.marker([coordinates.lat, coordinates.lng], { icon }).addTo(mapRef.current);
      m.on('click', () => {
        onSelectPermit?.(p);
        void handleContextFetch(p);
      });
      markersRef.current.push(m);
    });

    receivers.forEach((receiver) => {
      const coordinates = getReceiverCoordinates(receiver);
      if (!coordinates) return;
      const isSelected = receiver.id === selectedReceiverId;
      const icon = L.divIcon({
        html: `<div style="background:${isSelected ? '#1d4ed8' : '#0f172a'};border:2px solid ${isSelected ? '#93c5fd' : '#38bdf8'};width:14px;height:14px;border-radius:9999px;box-shadow:0 0 0 3px rgba(255,255,255,0.7)"></div>`,
        className: '',
      });
      const m = L.marker([coordinates.lat, coordinates.lng], { icon }).addTo(mapRef.current);
      m.on('click', () => {
        onSelectReceiver?.(receiver);
      });
      markersRef.current.push(m);
    });
  }, [onSelectPermit, onSelectReceiver, permits, receivers, selectedReceiverId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleOverlay(layerKey: string) {
    if (layerKey.startsWith('ogc_wms:')) {
      ensureOgcWmsLayer(layerKey);
    }
    if (!mapRef.current || !layersRef.current[layerKey]) return;
    const layer = layersRef.current[layerKey];
    if (mapRef.current.hasLayer(layer)) {
      mapRef.current.removeLayer(layer);
      // Avbryt eventuella pågående retries om användaren stänger lagret.
      pendingBboxRetryRef.current.delete(layerKey);
      setActiveOverlays((prev) => prev.filter((k) => k !== layerKey));
    } else {
      layer.addTo(mapRef.current);
      setActiveOverlays((prev) => [...prev, layerKey]);
      if (layerFetchConfig[layerKey]) {
        void refreshDynamicBboxLayer(layerKey);
      } else {
        setOverlayStatuses((prev) => ({ ...prev, [layerKey]: 'loaded' }));
      }
    }
  }

  return (
    <div
      className="w-full rounded-3xl border border-slate-200 bg-slate-100"
      style={{
        position: 'relative',
        width: '100%',
        height: '600px',
        minHeight: '600px',
        overflow: 'hidden',
      }}
    >
      <div ref={mapContainerRef} className="z-0" style={{ position: 'absolute', inset: 0, zIndex: 0 }} />

      <div
        className="space-y-3"
        style={{ position: 'absolute', left: '1.5rem', top: '1.5rem', zIndex: 1000 }}
      >
        <div className="w-60 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur-md">
          <p className="mb-3 px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Grundkarta
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => applyBaseLayer('osm')}
              className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase transition-colors ${
                baseLayer === 'osm'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              OSM
            </button>
            <button
              type="button"
              onClick={() => applyBaseLayer('topo')}
              className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase transition-colors ${
                baseLayer === 'topo'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              Topo
            </button>
            <button
              type="button"
              onClick={() => applyBaseLayer('orto')}
              className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase transition-colors ${
                baseLayer === 'orto'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              Ortofoto
            </button>
            {isOrsa && (
              <button
                type="button"
                onClick={() => applyBaseLayer('orsa_true_ortho')}
                className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase transition-colors ${
                  baseLayer === 'orsa_true_ortho'
                    ? 'border-indigo-900 bg-indigo-900 text-white'
                    : 'border-indigo-100 bg-white text-indigo-800'
                }`}
              >
                Orsa TrueOrtho
              </button>
            )}
            {showLocalBasemapOption && (
              <button
                type="button"
                title={localBasemapLabel}
                onClick={() => applyBaseLayer('local')}
                className={`max-w-[10rem] truncate rounded-lg border px-2 py-1 text-[10px] font-bold uppercase transition-colors ${
                  baseLayer === 'local'
                    ? 'border-emerald-800 bg-emerald-900 text-white'
                    : 'border-emerald-200 bg-white text-emerald-800'
                }`}
              >
                {localBasemapLabel}
              </button>
            )}
          </div>
        </div>

        <div className="w-60 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur-md max-h-[400px] overflow-y-auto custom-scrollbar">
          <p className="mb-3 px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Myndighetslager
          </p>
          <div className="space-y-1" data-testid="map-overlay-panel">
            {Object.entries(classifiedOverlays).map(([catKey, cat]) => {
              const activeCount = cat.items.filter((item) => activeOverlays.includes(item.key)).length;
              const isExpanded = expandedCategories[catKey];
              return (
                <div key={catKey} className="border-b border-slate-100 last:border-0 pb-1.5 last:pb-0">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedCategories((prev) => ({
                        ...prev,
                        [catKey]: !prev[catKey],
                      }))
                    }
                    className="flex w-full items-center justify-between py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-700 hover:text-indigo-600 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {catKey === 'hydrology' && <i className="fa-solid fa-droplet text-blue-500 w-3 text-center" />}
                      {catKey === 'nature' && <i className="fa-solid fa-leaf text-emerald-500 w-3 text-center" />}
                      {catKey === 'property' && <i className="fa-solid fa-building text-amber-500 w-3 text-center" />}
                      {catKey === 'external' && <i className="fa-solid fa-globe text-indigo-500 w-3 text-center" />}
                      <span className="truncate">{cat.label}</span>
                      {activeCount > 0 && (
                        <span className="ml-1 rounded-full bg-indigo-50 px-1 py-0.5 text-[8px] font-black text-indigo-600">
                          {activeCount}
                        </span>
                      )}
                    </span>
                    <i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'} text-[8px] text-slate-400`} />
                  </button>
                  {isExpanded && (
                    <div className="mt-1 space-y-1 pl-1">
                      {cat.items.length === 0 ? (
                        <p className="text-[9px] italic text-slate-400 py-1 pl-4">Inga tillgängliga lager</p>
                      ) : (
                        cat.items.map(({ key, label }) => (
                          <OverlayToggle
                            key={key}
                            active={activeOverlays.includes(key)}
                            onClick={() => toggleOverlay(key)}
                            label={label}
                            status={overlayStatuses[key]}
                            icon="fa-layer-group"
                            color="text-slate-600"
                            testId={`map-overlay-toggle-${key}`}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {(ogcFederated.isLoading ||
          federatedOverlayDescriptors.length > 0 ||
          ogcFederated.warnings.length > 0) && (
          <div className="w-60 rounded-3xl border border-indigo-100 bg-white/95 p-4 shadow-2xl backdrop-blur-md max-h-[280px] overflow-y-auto custom-scrollbar">
            <p className="mb-2 px-1 text-[10px] font-black uppercase tracking-widest text-indigo-500">
              WMS-katalog
            </p>
            <p className="mb-2 px-1 text-[9px] leading-snug text-slate-500">
              Underlager från LST GeoServer och VISS via GetCapabilities (rutbilder, ingen import).
            </p>
            {ogcFederated.isLoading && (
              <p className="px-1 text-[9px] font-semibold text-slate-400">Laddar katalog…</p>
            )}
            {ogcFederated.warnings.slice(0, 2).map((warning) => (
              <p key={warning} className="mb-2 px-1 text-[9px] font-semibold text-amber-800">
                {warning}
              </p>
            ))}
            <div className="space-y-1.5" data-testid="map-ogc-wms-panel">
              {federatedOverlayDescriptors.map(({ key, label }) => (
                <OverlayToggle
                  key={key}
                  active={activeOverlays.includes(key)}
                  onClick={() => toggleOverlay(key)}
                  label={label}
                  status={overlayStatuses[key] ?? (activeOverlays.includes(key) ? 'loaded' : undefined)}
                  icon="fa-globe"
                  color="text-indigo-600"
                  testId={`map-ogc-wms-toggle-${key}`}
                />
              ))}
              {!ogcFederated.isLoading && federatedOverlayDescriptors.length === 0 && (
                <p className="px-1 text-[9px] text-slate-400">
                  Inga WMS-lager tillgängliga (nätverk eller tjänst svarar inte).
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {mapNotice && (
        <div
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900 shadow-xl"
          style={{ position: 'absolute', left: '1.5rem', bottom: '1.5rem', zIndex: 1000, maxWidth: '24rem' }}
        >
          {mapNotice}
        </div>
      )}

      {selectedContext && (
        <div
          className="rounded-[2rem] bg-white/95 p-6 shadow-2xl animate-in slide-in-from-right"
          style={{ position: 'absolute', right: '1.5rem', top: '1.5rem', zIndex: 1000, width: '20rem' }}
        >
          <h3 className="text-sm font-black uppercase mb-4">{selectedContext.municipality}</h3>
          <p className="text-xs text-slate-600 mb-4">{selectedContext.audit}</p>
          <button
            onClick={() => setSelectedContext(null)}
            className="text-[10px] font-bold uppercase text-blue-600"
          >
            Stäng
          </button>
        </div>
      )}
    </div>
  );
};

const STATUS_DOT_CLASS: Record<LayerStatus, string> = {
  error: 'bg-rose-400',
  empty: 'bg-amber-400',
  loading: 'bg-sky-400 animate-pulse',
  loaded: 'bg-emerald-400',
  not_configured: 'bg-slate-300',
};

const STATUS_DOT_TITLE: Record<LayerStatus, string> = {
  error: 'Fel — lagret kunde inte laddas',
  empty: 'Inga features i aktuell vy',
  loading: 'Hämtar data…',
  loaded: 'Lagret laddat',
  not_configured: 'Lagret är inte konfigurerat',
};

const OverlayToggle: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  status?: LayerStatus;
  icon?: string;
  color?: string;
  testId?: string;
}> = ({ active, onClick, label, status, icon, color, testId }) => (
  <button
    onClick={onClick}
    data-testid={testId}
    className={`flex w-full items-center justify-between rounded-xl border p-2 transition-all ${active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
  >
    <span className="flex min-w-0 items-center gap-1.5">
      <i
        className={`fas ${icon ?? 'fa-layer-group'} text-[10px] ${active ? 'text-white' : (color ?? 'text-slate-500')}`}
        aria-hidden="true"
      />
      <span className="text-[10px] font-black uppercase truncate">{label}</span>
    </span>
    <span className="ml-2 flex shrink-0 items-center gap-1">
      {status && (
        <span
          title={STATUS_DOT_TITLE[status]}
          className={`h-2 w-2 rounded-full ${STATUS_DOT_CLASS[status]}`}
        />
      )}
      {active && <i className="fas fa-check-circle text-[10px]" />}
    </span>
  </button>
);

export default MapView;
