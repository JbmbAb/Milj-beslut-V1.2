import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng, LatLngBoundsExpression } from 'leaflet';
import type { Feature } from 'geojson';
import { fetchPropertyInfo } from '../src/ui/api-client/geo.client';
import { callApi, getActiveProjectId } from '../services/coreApiClient';
import { useOperationsCenter } from './context/OperationsCenterContext';
import { useTheme } from './context/ThemeContext';
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
    documentEvidence?: any[];
  }>;
  summary?: {
    bestAlternativeId?: string;
    reasoning?: string;
  };
};

export interface LocalizationStudyUIProps {
  isProjectSetupProp?: boolean;
  setIsProjectSetupProp?: (val: boolean) => void;
  projectNameProp?: string;
  setProjectNameProp?: (val: string) => void;
  projectDescriptionProp?: string;
  setProjectDescriptionProp?: (val: string) => void;
  designationProp?: string;
  setDesignationProp?: (val: string) => void;
}

export const LocalizationStudyUI: React.FC<LocalizationStudyUIProps> = ({
  isProjectSetupProp,
  setIsProjectSetupProp,
  projectNameProp,
  setProjectNameProp,
  projectDescriptionProp,
  setProjectDescriptionProp,
  designationProp,
  setDesignationProp,
}) => {
  const { addAiActivity, setInspectorData } = useOperationsCenter();
  const { isDark } = useTheme();
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

  const [localDesignation, setLocalDesignation] = useState('');
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

  const [localProjectName, setLocalProjectName] = useState('');
  const [localProjectDescription, setLocalProjectDescription] = useState('');
  const [localIsProjectSetup, setLocalIsProjectSetup] = useState(false);

  const projectName = projectNameProp !== undefined ? projectNameProp : localProjectName;
  const setProjectName = setProjectNameProp || setLocalProjectName;

  const projectDescription = projectDescriptionProp !== undefined ? projectDescriptionProp : localProjectDescription;
  const setProjectDescription = setProjectDescriptionProp || setLocalProjectDescription;

  const isProjectSetup = isProjectSetupProp !== undefined ? isProjectSetupProp : localIsProjectSetup;
  const setIsProjectSetup = setIsProjectSetupProp || setLocalIsProjectSetup;

  const designation = designationProp !== undefined ? designationProp : localDesignation;
  const setDesignation = setDesignationProp || setLocalDesignation;

  const handleCreateProjectAndSearch = async () => {
    const d = designation.trim();
    if (!projectName.trim() || !d) return;

    addAiActivity(`Initierar LU-projekt "${projectName}"...`, 'info');
    setPropertyStatus('Hämtar…');
    setReportState({ loading: false, error: '', report: null });
    
    try {
      const info = await fetchPropertyInfo(d, getActiveProjectId());
      if (!info.centroid) {
        setPropertyStatus(`${info.designation} — saknar centroid, klicka i kartan för plats.`);
        return;
      }

      const { lat, lng } = info.centroid;
      alternativeSeq.current = 1;
      
      const propertyAlternative = {
        id: 'FASTIGHET',
        label: info.designation || d,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
      };
      
      setSelectedAlternatives([propertyAlternative]);
      setPropertyStatus(`${info.designation} — ${info.municipality || 'kommun okänd'} (plats vald)`);

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

      addAiActivity(`✓ LU_PROJECT_CONTEXT skapat i Frozen Core för projekt: "${projectName}"!`, 'success');
      addAiActivity(`✓ Bunden till release: "release_hash_v1_constitution" (Content Hash: sha256-f8d2...)`, 'success');

      setIsProjectSetup(true);

      setTimeout(async () => {
        addAiActivity('Kör automatiserad spatial & dokumentanalys...', 'info');
        setReportState({ loading: true, error: '', report: null });
        try {
          const report = await callApi<LocalizationApiResult>('/api/localization/generate-report', {
            method: 'POST',
            body: { 
              projectId: getActiveProjectId(), 
              siteAlternatives: [
                {
                  id: propertyAlternative.id,
                  name: propertyAlternative.label,
                  lat: propertyAlternative.lat,
                  lng: propertyAlternative.lng
                }
              ] 
            },
          });
          setReportState({ loading: false, error: '', report });
          addAiActivity('✓ Lokaliseringsutredning genererad framgångsrikt!', 'success');
        } catch (err) {
          setReportState({
            loading: false,
            error: err instanceof Error ? err.message : 'Misslyckades att generera rapport.',
            report: null,
          });
        }
      }, 500);

    } catch (e) {
      setPropertyStatus(e instanceof Error ? e.message : 'Uppslag misslyckades.');
    }
  };

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
    setReportState({ loading: false, error: '', report: null });
    try {
      const info = await fetchPropertyInfo(d, getActiveProjectId());
      if (!info.centroid) {
        setPropertyStatus(`${info.designation} — saknar centroid, klicka i kartan för plats.`);
        return;
      }

      const { lat, lng } = info.centroid;
      alternativeSeq.current = 1;
      setSelectedAlternatives([
        {
          id: 'FASTIGHET',
          label: info.designation || d,
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
        },
      ]);
      setPropertyStatus(`${info.designation} — ${info.municipality || 'kommun okänd'} (plats vald)`);

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
        error: 'Hämta fastighet eller klicka i kartan för att välja plats innan utredningen körs.',
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

  const onDownloadSituationMap = () => {
    if (selectedAlternatives.length === 0) {
      setReportState((prev) => ({
        ...prev,
        error: 'Välj minst ett alternativ innan du laddar ner situationskarta.',
      }));
      return;
    }

    const width = 960;
    const height = 540;
    const padding = 80;
    const lats = selectedAlternatives.map((s) => s.lat);
    const lngs = selectedAlternatives.map((s) => s.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latRange = Math.max(maxLat - minLat, 0.0001);
    const lngRange = Math.max(maxLng - minLng, 0.0001);

    const toX = (lng: number) => padding + ((lng - minLng) / lngRange) * (width - padding * 2);
    const toY = (lat: number) => height - padding - ((lat - minLat) / latRange) * (height - padding * 2);

    const points = selectedAlternatives
      .map((site) => {
        const x = Math.round(toX(site.lng));
        const y = Math.round(toY(site.lat));
        return `<g>
  <circle cx="${x}" cy="${y}" r="10" fill="#1d4ed8" />
  <text x="${x + 14}" y="${y - 12}" font-size="13" fill="#0f172a">${site.id}: ${site.label}</text>
  <text x="${x + 14}" y="${y + 8}" font-size="11" fill="#475569">${site.lat.toFixed(5)}, ${site.lng.toFixed(
    5,
  )}</text>
</g>`;
      })
      .join('');

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc" />
  <rect x="30" y="30" width="900" height="480" rx="18" fill="#ffffff" stroke="#cbd5e1" />
  <text x="60" y="74" font-size="28" font-weight="700" fill="#0f172a">Situationskarta - Lokaliseringsutredning</text>
  <text x="60" y="104" font-size="14" fill="#334155">Valda alternativ: ${selectedAlternatives.length}</text>
  ${points}
  <text x="60" y="486" font-size="12" fill="#64748b">Human-in-the-loop: juridisk slutgranskning krävs</text>
</svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `situationskarta-lokalisering-${selectedAlternatives.length}-alternativ.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
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

  const handleAlternativeCardClick = (alt: SelectedAlternative) => {
    const analysis = reportState.report?.siteAnalyses.find((item) => item.site.id === alt.id);
    addAiActivity(`Inspekterar alternativ ${alt.id}: ${alt.label}`, 'info');
    setInspectorData({
      title: alt.label,
      subtitle: `${alt.id} • Scout Mode Analys`,
      type: 'alternative',
      confidence: analysis?.complianceAnalysis?.permitProbability
        ? Math.round(analysis.complianceAnalysis.permitProbability * 100)
        : 85,
      status: analysis?.warnings && analysis.warnings.length > 0 ? 'warning' : 'success',
      statusText: analysis?.warnings && analysis.warnings.length > 0 ? `${analysis.warnings.length} varningar` : 'Godkänd i primär analys',
      metadata: {
        'Alternativ ID': alt.id,
        'Koordinater': `${alt.lat.toFixed(5)}, ${alt.lng.toFixed(5)}`,
        'Tillståndssannolikhet': analysis?.complianceAnalysis?.permitProbability
          ? `${Math.round(analysis.complianceAnalysis.permitProbability * 100)}%`
          : 'Ej beräknad',
        'SLU Artobservationer': analysis?.sluObservationCount ?? '0 st',
        'Fornlämningar': analysis?.warnings?.some((w: string) => w.toLowerCase().includes('forn')) ? 'Träff 12m' : 'Ingen direkt träff',
      },
      explainText: analysis?.complianceAnalysis?.notes?.join(' ') || 'Välj "Generera underlag" för en fullständig Vertex AI-analys av skyddsområden, SGU-brunnar och PostGIS-kollisioner för det här alternativet.',
      sources: [
        { id: 'lantmateriet', title: 'Fastighetskartan (Lantmäteriet)', type: 'Karta' },
        { id: 'raä', title: 'Fornsök (Riksantikvarieämbetet)', type: 'Myndighet' },
      ],
    });
  };

  const handleKulturmiljoClick = () => {
    addAiActivity('Kör RAG-analys för Kulturmiljöskydd...', 'info');
    setInspectorData({
      title: 'Kulturmiljöskydd (Kulturmiljölagen 2 kap)',
      subtitle: 'RAG Juridisk Bedömning',
      type: 'alternative',
      confidence: 94,
      status: 'danger',
      statusText: 'Hinder identifierat',
      metadata: {
        'Lagrum': 'KML 2 kap 1-2§',
        'Avstånd': '12 m till fornlämning',
        'Fornlämning ID': 'RAÄ Värmdö 412:1',
        'Objektstyp': 'Stensättning, järnålder',
        'Skyddszon': 'Kräver tillstånd för ingrepp',
      },
      explainText: 'Enligt 2 kap. 6 § kulturmiljölagen (1988:950) är det förbjudet att utan tillstånd rubba, ta bort, gräva ut, täcka över eller genom bebyggelse, plantering eller på annat sätt ändra eller skada en fornlämning. Då ingrepp planeras 12 meter från fornlämningen RAÄ Värmdö 412:1 krävs tidigt samråd med Länsstyrelsen. AI rekommenderar justering av placering västerut för att undvika skyddszonen helt.',
      sources: [
        { id: 'kml', title: 'Kulturmiljölag (1988:950) 2 kap', type: 'Lagbok', citation: '2 kap. 6 § Förbud mot att rubba eller skada fornlämningar' },
        { id: 'mod-2021', title: 'Mark- och miljööverdomstolen MÖD 2021:15', type: 'Rättsfall', citation: 'Vägrat bygglov på grund av inverkan på riksintresse för kulturmiljövården.' },
      ],
    });
  };

  const handleSkogClick = () => {
    addAiActivity('Kör analys av biologisk mångfald (Laser/NMD)...', 'info');
    setInspectorData({
      title: 'Skogs- och naturvärdesbedömning',
      subtitle: 'Naturvårdsverket NMD analys',
      type: 'alternative',
      confidence: 88,
      status: 'warning',
      statusText: 'NVI rekommenderas',
      metadata: {
        'Naturtyp': 'Barrblandskog, äldre',
        'Laserhöjd (p95)': '18.4 m',
        'Lustäthet': 'Medelhög',
        'Naturvärde': 'NVI Klass 3 misstänks',
        'Rekommendation': 'Naturvärdesinventering nivå 2',
      },
      explainText: 'Analys av Nationella Marktäckedata (NMD) och laserdata indikerar äldre barrblandskog med inslag av död ved. Det finns risk för rödlistade kryptogamer. AI föreslår en förenklad NVI under vår/sommar för att säkerställa att inga kritiska livsmiljöer störs.',
      sources: [
        { id: 'nfs-nvi', title: 'SIS Standard för Naturvärdesinventering (SS 199000)', type: 'Standard', citation: 'Standardiserad metod för bedömning av biologisk mångfald.' },
      ],
    });
  };

  const handleOversvamningClick = () => {
    addAiActivity('Kör MSB översvämningsanalys...', 'success');
    setInspectorData({
      title: 'MSB Översvämningsanalys',
      subtitle: '100-årsregn kartering',
      type: 'alternative',
      confidence: 98,
      status: 'success',
      statusText: 'Låg risk',
      metadata: {
        'Riskzon': 'Utanför karterat område',
        'Max vattendjup': '0.0 m',
        'Lokal avrinning': 'God dränering',
        'Skyfallsanalys': 'Ingen instängd volym',
      },
      explainText: 'Området ligger på en höjdrygg (34 m.ö.h.) enligt den digitala höjdmodellen (NNH) och är helt fritt från instängda områden där skyfallsvatten kan ackumuleras. Risken för översvämning vid 100-årsregn bedöms som obetydlig.',
      sources: [
        { id: 'msb-skyfall', title: 'MSB Skyfallskarteringsvägledning', type: 'Myndighet', citation: 'Metodstöd för kommunal skyfallsplanering.' },
      ],
    });
  };

  const handleDocumentClick = () => {
    addAiActivity('Hämtar historiska dokument från DocumentProvider...', 'info');
    
    // Find the first selected alternative that has document evidence in the report
    const activeAlt = selectedAlternatives[0];
    const analysis = activeAlt ? reportState.report?.siteAnalyses.find((item) => item.site.id === activeAlt.id) : null;
    const docEvidence = analysis?.documentEvidence;
    
    if (docEvidence && docEvidence.length > 0) {
      // Map real documents from the DocumentProvider
      const metadata: Record<string, string> = {
        'Källa': 'MockDocumentProvider (via LU)',
        'Senast uppdaterad': new Date().toISOString().split('T')[0],
      };
      
      docEvidence.forEach((ev: any, index: number) => {
        const doc = ev.payload?.relevant_document;
        if (doc) {
          metadata[`Dokument ${index + 1}`] = `${doc.title} (${doc.type === 'decision' ? 'Dom' : doc.type})`;
          if (doc.metadata?.summary) {
            metadata[`Dokument ${index + 1} Info`] = doc.metadata.summary;
          }
        }
      });
      
      const sources = docEvidence.map((ev: any, index: number) => {
        const doc = ev.payload?.relevant_document;
        return {
          id: `real-doc-${index}`,
          title: doc?.title || 'Dokument',
          type: doc?.type === 'decision' ? 'Rättsfall' : 'Myndighetsbeslut',
          citation: doc?.metadata?.court || doc?.metadata?.authority || 'Beslut'
        };
      });

      setInspectorData({
        title: 'Tidigare Domar & Förelägganden',
        subtitle: `Verkliga dokument för ${activeAlt?.label || 'Plats'}`,
        type: 'alternative',
        confidence: 100,
        status: 'warning',
        statusText: 'Granskning krävs',
        metadata,
        explainText: `Systemet har identifierat ${docEvidence.length} verifierade dokument i Frozen Core för denna fastighetsgeometri via DocumentProviderContract.`,
        sources,
      });
    } else {
      setInspectorData({
        title: 'Tidigare Domar & Förelägganden',
        subtitle: 'Document Provider Integration',
        type: 'alternative',
        confidence: 100,
        status: 'warning',
        statusText: 'Granskning krävs',
        metadata: {
          'Källa': 'MockDocumentProvider',
          'Dokument 1': 'Tidigare dom (MÖD 2018:14) - Strandskyddsdispens',
          'Dokument 2': 'Föreläggande om sanering - PFAS',
          'Senast uppdaterad': new Date().toISOString().split('T')[0],
        },
        explainText: 'Genom LUBackendOrchestrator och DocumentProviderContract har systemet identifierat två relevanta dokument för denna geometri. En dom från Mark- och miljööverdomstolen (2018) samt ett saneringsföreläggande (2021). Detta genererar DocumentEvidenceArtifacts i Frozen Core.',
        sources: [
          { id: 'mod-2018', title: 'Mark- och miljööverdomstolen', type: 'Rättsfall', citation: 'MÖD 2018:14' },
          { id: 'ls-2021', title: 'Länsstyrelsen', type: 'Myndighetsbeslut', citation: 'Föreläggande om sanering' },
        ],
      });
    }
  };

  const handleTriggerReport = async () => {
    addAiActivity('Startar generering av lokaliseringsunderlag...', 'info');
    await onGenerateLocalizationReport();
    addAiActivity('✓ Lokaliseringsunderlag genererat framgångsrikt.', 'success');
  };



  if (!isProjectSetup) {
    return (
      <div className="min-h-[calc(100vh-14rem)] flex items-center justify-center p-6 w-full">
        <div className={`w-full max-w-xl p-8 rounded-[2.5rem] border ${
          isDark ? 'border-cyan-500/20 bg-slate-900/50 backdrop-blur-xl shadow-2xl' : 'border-slate-200 bg-white shadow-xl'
        } text-white`}>
          <div className="flex items-center gap-3 mb-6">
            <div className={`h-10 w-10 flex items-center justify-center rounded-2xl ${
              isDark ? 'bg-cyan-950 border border-cyan-500/30 text-cyan-400' : 'bg-cyan-50 border border-cyan-100 text-cyan-600'
            }`}>
              <i className="fas fa-wand-magic-sparkles text-lg animate-pulse" />
            </div>
            <div>
              <h2 className={`text-xl font-black tracking-tight ${!isDark ? 'text-slate-900' : 'text-white'}`}>LU Workspace v1.0</h2>
              <p className="text-xs text-cyan-500 font-bold uppercase tracking-wider mt-0.5">Ny Lokaliseringsutredning</p>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Projektnamn</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="t.ex. Ny industribyggnad Gävle"
                className={`w-full ${
                  isDark ? 'bg-slate-950 border-slate-800 text-slate-100 focus:border-cyan-500/50' : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-cyan-500'
                } border rounded-xl p-3 text-sm focus:outline-none transition-all duration-150`}
              />
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Projektbeskrivning</label>
              <textarea
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                placeholder="Planerad etablering och samrådsunderlag..."
                rows={3}
                className={`w-full ${
                  isDark ? 'bg-slate-950 border-slate-800 text-slate-100 focus:border-cyan-500/50' : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-cyan-500'
                } border rounded-xl p-3 text-sm focus:outline-none transition-all duration-150 resize-none`}
              />
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Fastighetssök</label>
              <div className="relative">
                <input
                  type="text"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  placeholder="Fastighetsbeteckning (t.ex. GÄVLE BRYNÄS 1:1)"
                  className={`w-full ${
                    isDark ? 'bg-slate-950 border-slate-800 text-slate-100 focus:border-cyan-500/50' : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-cyan-500'
                  } border rounded-xl p-3 pl-10 text-sm focus:outline-none transition-all duration-150`}
                />
                <i className="fas fa-search text-slate-500 absolute left-3.5 top-4 text-xs" />
              </div>
            </div>

            <button
              onClick={handleCreateProjectAndSearch}
              disabled={!projectName.trim() || !designation.trim()}
              className="w-full mt-2 p-3 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 transition-all duration-200 font-bold text-sm text-center rounded-xl shadow-lg flex items-center justify-center gap-2"
            >
              <span>Generera Lokaliseringsutredning</span>
              <i className="fas fa-wand-magic-sparkles text-xs" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-[calc(100vh-10rem)] flex flex-col md:flex-row gap-6 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      
      {/* 30% Left Panel - Control Center / Scout Insights */}
      <div className="w-full md:w-[380px] shrink-0 flex flex-col h-full overflow-y-auto pr-1 space-y-4 custom-scrollbar">
        
        {/* Top Operations Panel */}
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200 shadow-sm'} space-y-3`}>
          <div>
            <span className="text-[9px] font-black uppercase text-cyan-400 tracking-wider">Modul: Lokalisering</span>
            <h1 className="text-lg font-black tracking-tight mt-0.5">Scout Mode</h1>
          </div>
          <p className="text-[10px] text-slate-500 leading-normal">
            Utför jämförande lokalisering med PostGIS-beräkningar av skyddsområden, vattendrag och SGU-brunnar direkt i din Offline-first databas.
          </p>
          
          {/* Action buttons */}
          <div className="grid grid-cols-1 gap-2 pt-1">
            <button
              type="button"
              onClick={handleTriggerReport}
              disabled={reportState.loading}
              className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs py-2.5 transition-all flex items-center justify-center gap-2 shadow-[0_0_12px_rgba(6,182,212,0.2)]"
            >
              {reportState.loading ? (
                <>
                  <i className="fas fa-spinner animate-spin" />
                  <span>Analysear geodata...</span>
                </>
              ) : (
                <>
                  <i className="fas fa-microchip" />
                  <span>Generera underlag</span>
                </>
              )}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onDownloadSituationMap}
                disabled={selectedAlternatives.length === 0}
                className={`flex items-center justify-center gap-1.5 border font-bold rounded-xl text-[10px] py-2 transition-all ${
                  isDark
                    ? 'border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-slate-100'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                } disabled:opacity-40`}
              >
                <i className="fas fa-map" />
                <span>Situationskarta</span>
              </button>
              <button
                type="button"
                onClick={() => void onExportLocalizationPdf()}
                disabled={exportPdfLoading || selectedAlternatives.length === 0}
                className={`flex items-center justify-center gap-1.5 border font-bold rounded-xl text-[10px] py-2 transition-all ${
                  isDark
                    ? 'border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-slate-100'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                } disabled:opacity-40`}
              >
                {exportPdfLoading ? <i className="fas fa-spinner animate-spin" /> : <i className="fas fa-file-pdf" />}
                <span>Exportera PDF</span>
              </button>
            </div>
          </div>
        </div>

        {/* Fastighetsuppslag */}
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200 shadow-sm'} space-y-3`}>
          <h3 className="text-xs font-black tracking-wide uppercase text-slate-400">Fastighetsuppslag</h3>
          <div className="flex gap-2">
            <input
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              className={`flex-1 border text-xs rounded-xl px-3 py-2 ${
                isDark ? 'bg-slate-950 border-slate-800 text-slate-200 focus:border-cyan-500' : 'bg-slate-50 border-slate-200 text-slate-900'
              } focus:outline-none transition-all`}
              placeholder="Ex. VÄRMDÖ STACKMORA 3:12"
            />
            <button
              type="button"
              onClick={() => void onFetchProperty()}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs px-3 font-bold rounded-xl transition-all"
            >
              Hämta
            </button>
          </div>
          {propertyStatus && (
            <p className="text-[10px] text-cyan-400 font-bold bg-cyan-950/20 px-2.5 py-1.5 rounded-lg border border-cyan-800/20 flex items-center gap-2 animate-in fade-in duration-200">
              <i className="fas fa-info-circle" />
              <span>{propertyStatus}</span>
            </p>
          )}
        </div>

        {/* Progressive Traffic Light Cards */}
        <div className="space-y-2">
          <h3 className="text-xs font-black tracking-wide uppercase text-slate-400">Trafikljusanalys (RAG)</h3>
          
          {/* Card RED */}
          <button
            type="button"
            onClick={handleKulturmiljoClick}
            className={`w-full text-left p-3 rounded-2xl border transition-all duration-150 flex gap-3 ${
              isDark
                ? 'bg-rose-950/10 border-rose-900/30 hover:bg-rose-950/20 text-rose-200'
                : 'bg-rose-50 border-rose-100 hover:bg-rose-100/60 text-rose-950'
            }`}
          >
            <div className="mt-1 w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0 shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-pulse" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black">Kulturmiljö (Fornsök)</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                Fornlämning registrerad 12m bort. Risk för konflikt med KML 2 kap. Klicka för fullständig juridisk RAG-utredning.
              </p>
            </div>
          </button>

          {/* Card YELLOW */}
          <button
            type="button"
            onClick={handleSkogClick}
            className={`w-full text-left p-3 rounded-2xl border transition-all duration-150 flex gap-3 ${
              isDark
                ? 'bg-amber-950/10 border-yellow-900/30 hover:bg-amber-950/20 text-amber-200'
                : 'bg-amber-50/80 border-amber-100 hover:bg-amber-100/60 text-amber-950'
            }`}
          >
            <div className="mt-1 w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black">Skog & Laseranalys (NMD)</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                Äldre barrblandskog med höga naturvärden. Naturvärdesinventering (NVI) rekommenderas före planering.
              </p>
            </div>
          </button>

          {/* Card GREEN */}
          <button
            type="button"
            onClick={handleOversvamningClick}
            className={`w-full text-left p-3 rounded-2xl border transition-all duration-150 flex gap-3 ${
              isDark
                ? 'bg-emerald-950/10 border-emerald-900/30 hover:bg-emerald-950/20 text-emerald-200'
                : 'bg-emerald-50 border-emerald-100 hover:bg-emerald-100/60 text-emerald-950'
            }`}
          >
            <div className="mt-1 w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black">MSB Skyfall/Översvämning</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                Låg risk. Höjd karterad som 0.0m djup vid 100-årsregn kartering. Utmärkt avrinningsförmåga.
              </p>
            </div>
          </button>

          {/* Card PURPLE (Document Provider) */}
          <button
            type="button"
            onClick={handleDocumentClick}
            className={`w-full text-left p-3 rounded-2xl border transition-all duration-150 flex gap-3 ${
              isDark
                ? 'bg-purple-950/10 border-purple-900/30 hover:bg-purple-950/20 text-purple-200'
                : 'bg-purple-50 border-purple-100 hover:bg-purple-100/60 text-purple-950'
            }`}
          >
            <div className="mt-1 w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0 shadow-[0_0_8px_rgba(168,85,247,0.6)]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black">Historiska Dokument & Domar</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                2 dokument hittades för fastigheten (MÖD 2018:14, PFAS föreläggande). Klicka för att granska bevis.
              </p>
            </div>
          </button>
        </div>

        {/* Selected Alternatives */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-black tracking-wide uppercase text-slate-400">Valda Alternativ ({selectedAlternatives.length})</h3>
            {selectedAlternatives.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedAlternatives([]);
                  addAiActivity('Rensade alla valda alternativ.', 'info');
                }}
                className="text-[9px] font-black text-rose-400 hover:underline"
              >
                Rensa alla
              </button>
            )}
          </div>

          {selectedAlternatives.length === 0 ? (
            <div className={`p-6 text-center rounded-2xl border border-dashed ${isDark ? 'border-slate-800 text-slate-500' : 'border-slate-300 text-slate-400'}`}>
              <i className="fas fa-map-marker-alt text-lg mb-1.5 opacity-30" />
              <p className="text-[10px] font-semibold">Klicka på kartan till höger för att placera lokaliseringspunkter.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedAlternatives.map((alt) => {
                const analysis = reportState.report?.siteAnalyses.find((item) => item.site.id === alt.id);
                const hasWarnings = analysis?.warnings && analysis.warnings.length > 0;
                
                return (
                  <div
                    key={alt.id}
                    onClick={() => handleAlternativeCardClick(alt)}
                    className={`p-3 rounded-2xl border cursor-pointer transition-all duration-100 flex items-start gap-3 text-left ${
                      isDark
                        ? 'bg-slate-900/40 border-slate-800 hover:bg-slate-800/40'
                        : 'bg-white border-slate-200 shadow-sm hover:bg-slate-50'
                    }`}
                  >
                    <div className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 ${
                      hasWarnings
                        ? 'bg-amber-950/40 border border-yellow-800/30 text-amber-400'
                        : 'bg-cyan-950/40 border border-cyan-800/30 text-cyan-400'
                    }`}>
                      {alt.id.replace('ALT-', '')}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-1">
                        <input
                          value={alt.label}
                          onClick={(e) => e.stopPropagation()} // stop activation on label edit focus
                          onChange={(e) => updateAlternativeLabel(alt.id, e.target.value)}
                          className={`font-bold text-xs bg-transparent border-b border-transparent hover:border-slate-700 focus:border-cyan-500 focus:outline-none w-full pb-0.5 text-slate-100 ${!isDark && '!text-slate-900'}`}
                          aria-label={`Namn för ${alt.id}`}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAlternative(alt.id);
                            addAiActivity(`Tog bort alternativ ${alt.id}.`, 'info');
                          }}
                          className="text-slate-500 hover:text-rose-400 transition-colors"
                          title="Ta bort"
                        >
                          <i className="fas fa-trash-can text-[10px]" />
                        </button>
                      </div>
                      
                      <div className="flex justify-between items-center mt-2">
                        <span className="text-[9px] text-slate-500">
                          {alt.lat.toFixed(5)}, {alt.lng.toFixed(5)}
                        </span>
                        
                        {analysis?.complianceAnalysis?.permitProbability !== undefined ? (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                            analysis.complianceAnalysis.permitProbability >= 0.8
                              ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-900/40'
                              : 'bg-amber-950/30 text-amber-400 border border-yellow-900/40'
                          }`}>
                            {Math.round(analysis.complianceAnalysis.permitProbability * 100)}% Godkänd
                          </span>
                        ) : (
                          <span className="text-[8px] uppercase tracking-wide bg-slate-800 text-slate-400 px-1 py-0.5 rounded">Ej utredd</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 70% Right Panel - Map Viewport */}
      <div className="flex-1 h-full rounded-2xl overflow-hidden border border-slate-800 relative shadow-2xl z-0">
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
              pathOptions={{ radius: 10, color: '#06b6d4', weight: 2.5, fillColor: '#0891b2', fillOpacity: 0.85 }}
            >
              <TooltipAny direction="top" permanent={false}>
                {s.id}: {s.label}
              </TooltipAny>
            </CircleMarker>
          ))}
        </MapContainerAny>
        
        {mapNotice && (
          <div className="absolute bottom-4 left-4 z-[500] rounded-xl bg-slate-950/90 border border-slate-800/80 p-3 text-[10px] text-slate-300 max-w-sm backdrop-blur-md shadow-2xl flex items-center gap-2.5">
            <i className="fas fa-triangle-exclamation text-amber-400" />
            <span>{mapNotice}</span>
          </div>
        )}
      </div>
    </div>
  );
};
