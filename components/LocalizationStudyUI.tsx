import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng, LatLngBoundsExpression } from 'leaflet';
import type { Feature } from 'geojson';
import { fetchPropertyInfo } from '../src/ui/api-client/geo.client';
import { callApi, getActiveProjectId } from '../services/coreApiClient';
import {
  getSguGroundLayerStyle,
  POSTGIS_NVR_STYLE,
  POSTGIS_PROPERTY_STYLE,
  POSTGIS_LAKES_STYLE,
  POSTGIS_STREAMS_STYLE,
  TOPO10_BUILDINGS_STYLE,
  TOPO10_MARK_STYLE,
  TOPO10_VATTEN_STYLE,
  WATER_PROTECTION_STYLE,
} from './project/MapConfig';

type GeodataLayerKey =
  | 'soil'
  | 'wells'
  | 'lakes'
  | 'streams'
  | 'topoWater'
  | 'topoBuildings'
  | 'topoMark'
  | 'waterProtection'
  | 'protectedNature'
  | 'property';

type FeatureCollectionJson = {
  type: 'FeatureCollection';
  features: unknown[];
  meta?: {
    available?: boolean;
    warning?: string;
    source?: string;
  };
  error?: string;
};

const GEODATA_LAYERS: ReadonlyArray<{
  key: GeodataLayerKey;
  path: string;
  label: string;
  kind: 'polygon' | 'line' | 'points';
  /** Extra query string e.g. limit for wells */
  querySuffix?: string;
}> = [
  { key: 'soil', path: 'soil', label: 'Jord & berggrund (SGU)', kind: 'polygon' },
  { key: 'topoMark', path: 'topo-mark', label: 'Markanvändning (Topo 10)', kind: 'polygon' },
  { key: 'waterProtection', path: 'water-protection', label: 'Vattenskydd', kind: 'polygon' },
  { key: 'protectedNature', path: 'protected-nature', label: 'Skyddad natur (NVR)', kind: 'polygon' },
  { key: 'lakes', path: 'lakes', label: 'Sjöar', kind: 'polygon' },
  { key: 'topoWater', path: 'topo-water', label: 'Ytvatten (Topo 10)', kind: 'polygon' },
  { key: 'streams', path: 'streams', label: 'Vattendrag', kind: 'line' },
  { key: 'property', path: 'property', label: 'Fastighetsgränser', kind: 'line' },
  { key: 'topoBuildings', path: 'topo-buildings', label: 'Byggnader (Topo 10)', kind: 'polygon' },
  {
    key: 'wells',
    path: 'wells',
    label: 'Brunnar (SGU)',
    kind: 'points',
    querySuffix: '&limit=2000',
  },
];

const EMPTY_FC: FeatureCollectionJson = { type: 'FeatureCollection', features: [] };

const MapContainerAny = MapContainer as any;
const TileLayerAny = TileLayer as any;
const GeoJSONAny = GeoJSON as any;
const TooltipAny = Tooltip as any;

function bboxFromCenter(lat: number, lng: number, delta = 0.02): string {
  return [lng - delta, lat - delta, lng + delta, lat + delta].join(',');
}

function BboxSync({ onBbox }: { onBbox: (bbox: string) => void }) {
  const map = useMap();
  const emit = useCallback(() => {
    const b = map.getBounds();
    const w = b.getWest();
    const s = b.getSouth();
    const e = b.getEast();
    const n = b.getNorth();
    if (![w, s, e, n].every(Number.isFinite)) return;
    if (Math.abs(e - w) < 1e-6 || Math.abs(n - s) < 1e-6) return;
    onBbox(`${w},${s},${e},${n}`);
  }, [map, onBbox]);

  useMapEvents({ moveend: emit, zoomend: emit });
  useEffect(() => {
    emit();
  }, [emit]);
  return null;
}

function FitBoundsRequest({ target }: { target: { seq: number; bounds: LatLngBoundsExpression } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.fitBounds(target.bounds, { padding: [28, 28], maxZoom: 16 });
  }, [map, target]);
  return null;
}

function MapClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (event) => {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function wellPointToLayer(feature: Feature, latlng: LatLng) {
  void feature;
  return L.circleMarker(latlng, {
    radius: 6,
    color: '#c2410c',
    weight: 2,
    opacity: 1,
    fillColor: '#fb923c',
    fillOpacity: 0.92,
  });
}

function styleForGeodataLayer(key: GeodataLayerKey, feature: Feature) {
  switch (key) {
    case 'soil':
      return getSguGroundLayerStyle(feature);
    case 'lakes':
      return POSTGIS_LAKES_STYLE;
    case 'streams':
      return POSTGIS_STREAMS_STYLE;
    case 'topoWater':
      return TOPO10_VATTEN_STYLE;
    case 'topoBuildings':
      return TOPO10_BUILDINGS_STYLE;
    case 'topoMark':
      return TOPO10_MARK_STYLE;
    case 'waterProtection':
      return WATER_PROTECTION_STYLE;
    case 'protectedNature':
      return POSTGIS_NVR_STYLE;
    case 'property':
      return POSTGIS_PROPERTY_STYLE;
    default:
      return {};
  }
}

type SelectedAlternative = {
  id: string;
  label: string;
  lat: number;
  lng: number;
};

type LocalizationApiResult = {
  ok?: boolean;
  projectId: string;
  generatedAt: string;
  warnings?: string[];
  humanInTheLoop?: string;
  meta?: { strictMode?: boolean; warningCount?: number };
  siteAnalyses: Array<{
    site: {
      id: string;
      name?: string;
      lat: number;
      lng: number;
    };
    warnings?: string[];
    dataSources?: Array<{ source: string; status: string; detail?: string }>;
    sluObservationCount?: number;
    complianceAnalysis?: {
      permitProbability?: number;
      requiredActions?: string[];
      notes?: string[];
    };
  }>;
  summary?: {
    bestAlternativeId?: string;
    reasoning?: string;
  };
};

export const LocalizationStudyUI: React.FC = () => {
  const alternativeSeq = useRef(0);
  const [bbox, setBbox] = useState<string | null>(null);
  const [layerEnabled, setLayerEnabled] = useState<Record<GeodataLayerKey, boolean>>(() =>
    GEODATA_LAYERS.reduce(
      (acc, Lyr) => {
        acc[Lyr.key] = true;
        return acc;
      },
      {} as Record<GeodataLayerKey, boolean>,
    ),
  );
  const [geoByLayer, setGeoByLayer] = useState<Partial<Record<GeodataLayerKey, FeatureCollectionJson>>>({});
  const [layerDiagnostics, setLayerDiagnostics] = useState<
    Partial<
      Record<
        GeodataLayerKey,
        {
          featureCount: number;
          available: boolean;
          warning: string;
        }
      >
    >
  >({});
  const requestGen = useRef<Partial<Record<GeodataLayerKey, number>>>({});

  const [designation, setDesignation] = useState('');
  const [propertyStatus, setPropertyStatus] = useState<string>('');
  const [mapNotice, setMapNotice] = useState('');
  const [exportPdfLoading, setExportPdfLoading] = useState(false);
  const [reportState, setReportState] = useState<{
    loading: boolean;
    error: string;
    report: LocalizationApiResult | null;
  }>({ loading: false, error: '', report: null });
  const [fitTarget, setFitTarget] = useState<{ seq: number; bounds: LatLngBoundsExpression } | null>(null);
  const [selectedAlternatives, setSelectedAlternatives] = useState<SelectedAlternative[]>([]);

  useEffect(() => {
    if (!bbox) return;
    const ac = new AbortController();
    let anyError = false;

    const run = async () => {
      const nextDiagnostics: Partial<
        Record<GeodataLayerKey, { featureCount: number; available: boolean; warning: string }>
      > = {};

      for (const layer of GEODATA_LAYERS) {
        if (!layerEnabled[layer.key]) continue;
        const next = (requestGen.current[layer.key] ?? 0) + 1;
        requestGen.current[layer.key] = next;
        const url = `/api/geodata/${layer.path}?bbox=${encodeURIComponent(bbox)}${layer.querySuffix ?? ''}`;
        try {
          const response = await fetch(url, { credentials: 'same-origin', signal: ac.signal });
          const data = (await response.json()) as FeatureCollectionJson;
          if (requestGen.current[layer.key] !== next) continue;
          if (!response.ok) {
            anyError = true;
            setGeoByLayer((prev) => ({ ...prev, [layer.key]: EMPTY_FC }));
            nextDiagnostics[layer.key] = {
              featureCount: 0,
              available: false,
              warning: String(data?.error || `HTTP ${response.status}`),
            };
            continue;
          }
          if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) {
            const available = data.meta?.available !== false;
            const warning = String(data.meta?.warning || '').trim();
            setGeoByLayer((prev) => ({ ...prev, [layer.key]: data }));
            nextDiagnostics[layer.key] = {
              featureCount: data.features.length,
              available,
              warning,
            };
            if (!available) {
              anyError = true;
            }
          } else {
            anyError = true;
            setGeoByLayer((prev) => ({ ...prev, [layer.key]: EMPTY_FC }));
            nextDiagnostics[layer.key] = {
              featureCount: 0,
              available: false,
              warning: 'Svar saknar giltig FeatureCollection.',
            };
          }
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
          if (requestGen.current[layer.key] !== next) continue;
          anyError = true;
          setGeoByLayer((prev) => ({ ...prev, [layer.key]: EMPTY_FC }));
          nextDiagnostics[layer.key] = {
            featureCount: 0,
            available: false,
            warning: e instanceof Error ? e.message : 'Okänt fel vid lagerhämtning.',
          };
        }
      }

      setLayerDiagnostics((prev) => ({ ...prev, ...nextDiagnostics }));

      const unavailableLayers = GEODATA_LAYERS.filter(
        (layer) => nextDiagnostics[layer.key] && nextDiagnostics[layer.key]?.available === false,
      ).map((layer) => layer.label);

      if (unavailableLayers.length > 0) {
        setMapNotice(`Datakälla saknas för: ${unavailableLayers.join(', ')}.`);
      } else {
        setMapNotice(anyError ? 'Ett eller flera geodatalager kunde inte laddas.' : '');
      }
    };

    void run();
    return () => ac.abort();
  }, [bbox, layerEnabled]);

  const onFetchProperty = async () => {
    const d = designation.trim();
    if (!d) {
      setPropertyStatus('Ange fastighetsbeteckning.');
      return;
    }
    setPropertyStatus('Hämtar…');
    try {
      const info = await fetchPropertyInfo(d);
      setPropertyStatus(`${info.designation} — ${info.municipality || 'kommun okänd'}`);
      if (info.centroid) {
        const { lat, lng } = info.centroid;
        const bb = bboxFromCenter(lat, lng, 0.015);
        const [w, s, e, n] = bb.split(',').map(Number);
        if ([w, s, e, n].every(Number.isFinite)) {
          setFitTarget((prev) => ({
            seq: (prev?.seq ?? 0) + 1,
            bounds: [
              [s, w],
              [n, e],
            ],
          }));
        }
      }
    } catch (e) {
      setPropertyStatus(e instanceof Error ? e.message : 'Uppslag misslyckades.');
    }
  };

  const onGenerateLocalizationReport = async () => {
    const projectId = getActiveProjectId();
    if (!projectId) {
      setReportState({
        loading: false,
        error: 'Ingen aktiv projektkontext hittades. Välj projekt i adminflödet först.',
        report: null,
      });
      return;
    }

    if (selectedAlternatives.length === 0) {
      setReportState({
        loading: false,
        error: 'Välj minst ett alternativ på kartan innan du kör utredningen.',
        report: null,
      });
      return;
    }

    setReportState({ loading: true, error: '', report: null });
    try {
      const report = await callApi<LocalizationApiResult>('/api/localization/generate-report', {
        method: 'POST',
        body: {
          projectId,
          siteAlternatives: selectedAlternatives.map((site) => ({
            id: site.id,
            name: site.label,
            lat: site.lat,
            lng: site.lng,
          })),
        },
      });
      setReportState({ loading: false, error: '', report });
    } catch (error) {
      setReportState({
        loading: false,
        error: error instanceof Error ? error.message : 'Kunde inte köra lokaliseringsutredning.',
        report: null,
      });
    }
  };

  const onExportLocalizationPdf = async () => {
    const projectId = getActiveProjectId();
    if (!projectId || selectedAlternatives.length === 0) {
      setReportState((prev) => ({
        ...prev,
        error: 'Kör utredning med minst ett alternativ innan PDF-export.',
      }));
      return;
    }
    setExportPdfLoading(true);
    try {
      const blob = await callApi<Blob>('/api/localization/export-pdf', {
        method: 'POST',
        body: {
          projectId,
          siteAlternatives: selectedAlternatives.map((site) => ({
            id: site.id,
            name: site.label,
            lat: site.lat,
            lng: site.lng,
          })),
        },
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `lokaliseringsutredning-${projectId}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setReportState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'PDF-export misslyckades.',
      }));
    } finally {
      setExportPdfLoading(false);
    }
  };

  const onMapPickAlternative = (lat: number, lng: number) => {
    setSelectedAlternatives((prev) => {
      if (prev.length >= 8) {
        setMapNotice(
          'Max 8 alternativ kan jämföras samtidigt. Ta bort ett alternativ för att lägga till nytt.',
        );
        return prev;
      }
      const nextSeq = alternativeSeq.current + 1;
      alternativeSeq.current = nextSeq;
      const id = `ALT-${nextSeq}`;
      return [
        ...prev,
        {
          id,
          label: `Alternativ ${nextSeq}`,
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
        },
      ];
    });
  };

  const updateAlternativeLabel = (id: string, nextLabel: string) => {
    setSelectedAlternatives((prev) =>
      prev.map((item) => (item.id === id ? { ...item, label: nextLabel || item.label } : item)),
    );
  };

  const removeAlternative = (id: string) => {
    setSelectedAlternatives((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#111c2d] font-sans flex flex-col items-center py-12">
      <main className="w-full max-w-[1440px] px-8">
        <header className="mb-12 border-b border-[#cfdaf2] pb-8">
          <div className="flex justify-between items-end gap-8 flex-wrap">
            <div>
              <p className="text-[12px] font-bold tracking-[0.05em] uppercase text-[#565e74] mb-2">
                Myndighetsbeslut • Miljöbalken
              </p>
              <h1 className="text-5xl font-extrabold tracking-tight">Lokaliseringsutredning</h1>
              <p className="text-lg text-[#565e74] mt-4 max-w-2xl">
                Jämförande platser med GeoJSON från <code className="text-sm">/api/geodata/*</code> (samma
                PostGIS/Topo10-data som övriga kartlager) och färger i react-leaflet.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void onGenerateLocalizationReport()}
                disabled={reportState.loading}
                className="bg-[#131b2e] disabled:opacity-60 disabled:cursor-not-allowed text-[#ffffff] px-6 py-3 rounded text-sm font-bold shadow-lg hover:bg-[#0f172a] transition-all"
              >
                {reportState.loading ? 'Kör utredning…' : 'Kör lokaliseringsutredning'}
              </button>
              <button
                type="button"
                onClick={() => void onExportLocalizationPdf()}
                disabled={exportPdfLoading || reportState.loading || selectedAlternatives.length === 0}
                className="bg-white border border-[#131b2e] disabled:opacity-60 text-[#131b2e] px-6 py-3 rounded text-sm font-bold hover:bg-[#f1f5f9] transition-all"
              >
                {exportPdfLoading ? 'Exporterar PDF…' : 'Exportera PDF'}
              </button>
            </div>
          </div>
        </header>

        <section className="flex gap-8 mb-16 h-[600px]">
          <div className="flex-1 rounded-lg overflow-hidden bg-[#f0f3ff] relative shadow-[0_12px_32px_rgba(17,28,45,0.06)] border border-[#ffffff]/50 z-0">
            <MapContainerAny
              center={[59.3293, 18.0686]}
              zoom={12}
              className="h-full w-full"
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom
            >
              <TileLayerAny
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap"
              />
              <MapClickCapture onPick={onMapPickAlternative} />
              <BboxSync onBbox={setBbox} />
              <FitBoundsRequest target={fitTarget} />
              {GEODATA_LAYERS.map((layer) => {
                if (!layerEnabled[layer.key]) return null;
                const data = geoByLayer[layer.key];
                if (!data?.features?.length) return null;
                if (layer.kind === 'points') {
                  return <GeoJSONAny key={layer.key} data={data} pointToLayer={wellPointToLayer} />;
                }
                return (
                  <GeoJSONAny
                    key={layer.key}
                    data={data}
                    style={(feature: any) => (feature ? styleForGeodataLayer(layer.key, feature) : {})}
                  />
                );
              })}
              {selectedAlternatives.map((s) => (
                <CircleMarker
                  key={s.id}
                  center={[s.lat, s.lng] as any}
                  pathOptions={{ radius: 10, color: '#131b2e', fillOpacity: 0.9 }}
                >
                  <TooltipAny direction="top" permanent={false}>
                    {s.id}: {s.label}
                  </TooltipAny>
                </CircleMarker>
              ))}
            </MapContainerAny>
            {mapNotice ? (
              <div className="absolute bottom-3 left-3 right-3 z-[500] rounded bg-white/95 border border-[#cfdaf2] px-3 py-2 text-xs text-[#565e74]">
                {mapNotice}
              </div>
            ) : null}
          </div>
          <div className="w-full lg:w-80 flex flex-col gap-4">
            <div className="bg-[#ffffff] p-6 rounded-lg shadow-sm border border-[#cfdaf2]/50">
              <h3 className="font-bold text-lg mb-3">Fastighet</h3>
              <label className="block text-xs font-bold text-[#565e74] mb-1">Fastighetsbeteckning</label>
              <div className="flex gap-2">
                <input
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  className="flex-1 border border-[#cfdaf2] rounded px-3 py-2 text-sm"
                  placeholder="T.ex. NACKA SICKLA 1:1"
                />
                <button
                  type="button"
                  onClick={() => void onFetchProperty()}
                  className="bg-[#131b2e] text-white px-4 py-2 rounded text-sm font-bold shrink-0"
                >
                  Hämta
                </button>
              </div>
              {propertyStatus ? <p className="mt-2 text-xs text-[#565e74]">{propertyStatus}</p> : null}
            </div>
            <div className="bg-[#ffffff] p-6 rounded-lg shadow-sm border border-[#cfdaf2]/50 flex-1">
              <h3 className="font-bold text-lg mb-4">Geodata-lager</h3>
              <p className="text-xs text-[#565e74] mb-3">
                Vatten: blå toner (sjöar, vattendrag, Topo10-vatten). Brunnar: orange punkter.
              </p>
              <ul className="space-y-3 text-sm text-[#565e74] font-medium">
                {GEODATA_LAYERS.map((Lyr) => (
                  <li key={Lyr.key} className="flex items-center gap-3">
                    <label className="flex items-center gap-3 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={layerEnabled[Lyr.key]}
                        onChange={(e) =>
                          setLayerEnabled((prev) => ({ ...prev, [Lyr.key]: e.target.checked }))
                        }
                        className="w-4 h-4 accent-[#131b2e]"
                        aria-label={Lyr.label}
                      />
                      <span>{Lyr.label}</span>
                    </label>
                    {layerEnabled[Lyr.key] && layerDiagnostics[Lyr.key] ? (
                      <span
                        className={`text-[11px] px-2 py-1 rounded ${
                          layerDiagnostics[Lyr.key]?.available
                            ? 'bg-slate-100 text-slate-700'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {layerDiagnostics[Lyr.key]?.available
                          ? `${layerDiagnostics[Lyr.key]?.featureCount || 0} träffar`
                          : 'otillgängligt'}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {Object.entries(layerDiagnostics).some(([, status]) => Boolean(status?.warning)) ? (
                <div className="mt-3 border-t border-[#e2e8f0] pt-3 space-y-1">
                  {GEODATA_LAYERS.map((layer) => {
                    const warning = layerDiagnostics[layer.key]?.warning;
                    if (!warning) return null;
                    return (
                      <p key={`warn-${layer.key}`} className="text-[11px] text-amber-800">
                        {layer.label}: {warning}
                      </p>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div className="bg-[#ffffff] p-6 rounded-lg shadow-sm border border-[#cfdaf2]/50">
              <h3 className="font-bold text-lg mb-2">Valda alternativ</h3>
              <p className="text-xs text-[#565e74] mb-3">
                Klicka i kartan för att lägga till alternativa platser.
              </p>
              {selectedAlternatives.length === 0 ? (
                <p className="text-xs text-[#565e74]">Inga alternativ valda ännu.</p>
              ) : (
                <ul className="space-y-3">
                  {selectedAlternatives.map((alt) => (
                    <li key={alt.id} className="border border-[#dbe5fb] rounded p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-[#334155] mb-1">{alt.id}</p>
                          <input
                            value={alt.label}
                            onChange={(event) => updateAlternativeLabel(alt.id, event.target.value)}
                            className="w-full border border-[#cfdaf2] rounded px-2 py-1 text-sm"
                            aria-label={`Namn för ${alt.id}`}
                          />
                          <p className="text-xs text-[#565e74] mt-1">
                            {alt.lat.toFixed(6)}, {alt.lng.toFixed(6)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAlternative(alt.id)}
                          className="text-xs bg-rose-100 text-rose-800 px-2 py-1 rounded"
                        >
                          Ta bort
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {selectedAlternatives.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedAlternatives([])}
                  className="mt-3 text-xs bg-slate-100 text-slate-800 px-3 py-1 rounded"
                >
                  Rensa alla
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-6">Platsjämförelse</h2>
          {reportState.error ? (
            <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {reportState.error}
            </div>
          ) : null}
          {reportState.report?.humanInTheLoop ? (
            <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-bold">Human in the loop</p>
              <p>{reportState.report.humanInTheLoop}</p>
            </div>
          ) : null}
          {(reportState.report?.warnings?.length ?? 0) > 0 ? (
            <div className="mb-4 rounded border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
              <p className="font-bold mb-2">
                Datakällor / varningar ({reportState.report?.meta?.warningCount ?? reportState.report?.warnings?.length})
              </p>
              <ul className="list-disc pl-5 space-y-1">
                {reportState.report?.warnings?.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {reportState.report ? (
            <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <p className="font-bold">
                Bästa alternativ: {reportState.report.summary?.bestAlternativeId || 'okänt'}
              </p>
              <p>{reportState.report.summary?.reasoning || 'Ingen motivering tillgänglig.'}</p>
            </div>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {selectedAlternatives.map((alt) => {
              const analysis = reportState.report?.siteAnalyses.find((item) => item.site.id === alt.id);
              return (
                <div key={alt.id} className="bg-white border border-[#cfdaf2] rounded-lg p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#64748b]">{alt.id}</p>
                  <h3 className="font-bold text-lg text-[#0f172a]">{alt.label}</h3>
                  <p className="text-xs text-[#64748b] mt-1">
                    {alt.lat.toFixed(6)}, {alt.lng.toFixed(6)}
                  </p>
                  <p className="text-sm text-[#334155] mt-3">
                    Tillståndssannolikhet:{' '}
                    {typeof analysis?.complianceAnalysis?.permitProbability === 'number'
                      ? analysis.complianceAnalysis.permitProbability.toFixed(2)
                      : 'Ej beräknad ännu'}
                  </p>
                  {typeof analysis?.sluObservationCount === 'number' ? (
                    <p className="text-xs text-[#64748b] mt-1">
                      SLU-observationer: {analysis.sluObservationCount}
                    </p>
                  ) : null}
                  {(analysis?.warnings?.length ?? 0) > 0 ? (
                    <ul className="mt-2 text-xs text-amber-900 space-y-0.5">
                      {analysis?.warnings?.map((w) => (
                        <li key={`${alt.id}-${w}`}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
          {reportState.report ? (
            <div className="mt-4 rounded border border-[#cfdaf2] bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#565e74] mb-2">API-resultat</p>
              <ul className="space-y-1 text-sm text-[#334155]">
                {reportState.report.siteAnalyses.map((analysis) => (
                  <li key={analysis.site.id}>
                    {analysis.site.id} ({analysis.site.name || 'utan namn'}) · tillståndssannolikhet:{' '}
                    {typeof analysis.complianceAnalysis?.permitProbability === 'number'
                      ? analysis.complianceAnalysis.permitProbability.toFixed(2)
                      : 'okänd'}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-xs text-[#565e74]">
              Klicka i kartan för att skapa alternativ, ge dem namn i panelen och kör sedan
              lokaliseringsutredningen.
            </p>
          )}
        </section>
      </main>
    </div>
  );
};
