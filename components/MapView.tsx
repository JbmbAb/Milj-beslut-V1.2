import React, { useCallback, useEffect, useRef, useState } from "react";
import { DecisionType, Permit, Receiver } from "../types";
import { fetchMunicipalityContext } from "../services/geminiService";

interface MapViewProps {
  permits?: Permit[];
  receivers?: Receiver[];
  onSelectPermit?: (permit: Permit) => void;
  onSelectReceiver?: (receiver: Receiver) => void;
  selectedReceiverId?: string;
  geoJsonData?: unknown;
  bufferDistance?: number;
  highlightLayer?: string;
  onLocationChange?: (lat: string, lng: string) => void;
}

type MunicipalityContext = {
  municipality: string;
  audit: string;
  fact: string;
  sources: Array<{ web?: { uri: string; title?: string } }>;
};

type DynamicBboxLayerKey =
  | "sgu_grundlager"
  | "sgu_jordskred_raviner"
  | "postgis_nvr"
  | "postgis_lakes"
  | "postgis_streams"
  | "postgis_property";

const DYNAMIC_BBOX_LAYER_CONFIG: Record<
  DynamicBboxLayerKey,
  { endpoint: string; emptyMessage: string; label: string }
> = {
  sgu_grundlager: {
    endpoint: "/api/layers/sgu/grundlager",
    emptyMessage: "SGU grundlager gav inga lokala traeffar i aktuell kartvy.",
    label: "SGU grundlager",
  },
  sgu_jordskred_raviner: {
    endpoint: "/api/layers/sgu/jordskred-raviner",
    emptyMessage: "SGU jordskred/raviner gav inga lokala traeffar i aktuell kartvy.",
    label: "SGU jordskred/raviner",
  },
  postgis_nvr: {
    endpoint: "/api/layers/nvr",
    emptyMessage: "Skyddad natur gav inga lokala traeffar i aktuell kartvy.",
    label: "Skyddad natur",
  },
  postgis_lakes: {
    endpoint: "/api/layers/hydro.lakes",
    emptyMessage: "Inga sjoar hittades i aktuell kartvy.",
    label: "Sjoar",
  },
  postgis_streams: {
    endpoint: "/api/layers/hydro.streams",
    emptyMessage: "Inga vattendrag hittades i aktuell kartvy.",
    label: "Vattendrag",
  },
  postgis_property: {
    endpoint: "/api/layers/property",
    emptyMessage: "Inga fastighetsgränser hittades i aktuell kartvy.",
    label: "Fastighetsgränser",
  },
};

function isDynamicBboxLayerKey(value: string): value is DynamicBboxLayerKey {
  return value in DYNAMIC_BBOX_LAYER_CONFIG;
}

async function loadPointCloudDependencies() {
  const [{ load }, { LASLoader }, { PLYLoader }] = await Promise.all([
    import("@loaders.gl/core"),
    import("@loaders.gl/las"),
    import("@loaders.gl/ply"),
  ]);

  return { load, LASLoader, PLYLoader };
}

function toBboxParam(map: any): string | null {
  const bounds = map?.getBounds?.();
  if (!bounds?.isValid?.()) return null;
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(",");
}

async function fetchSpatialAuditText(lat: number, lng: number): Promise<string> {
  const response = await fetch("/api/spatial-audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return String(payload?.text || "Ingen spatial analys tillganglig.");
}

function getSguGroundLayerStyle(feature: any) {
  const label = String(feature?.properties?.layer_label || "").toLowerCase();
  if (label.includes("berg")) {
    return {
      color: "#475569",
      weight: 1,
      opacity: 0.85,
      fillColor: "#94a3b8",
      fillOpacity: 0.18,
    };
  }

  return {
    color: "#92400e",
    weight: 1,
    opacity: 0.85,
    fillColor: "#f59e0b",
    fillOpacity: 0.16,
  };
}

function getSguLandslideStyle(feature: any) {
  const label = String(feature?.properties?.feature_label || "").toLowerCase();
  if (label.includes("skredvag")) {
    return { color: "#dc2626", weight: 3, opacity: 0.95 };
  }
  if (label.includes("skredarr")) {
    return { color: "#b91c1c", weight: 3, opacity: 0.95, dashArray: "6,4" };
  }
  if (label.includes("ravin")) {
    return { color: "#a16207", weight: 2, opacity: 0.9 };
  }
  return { color: "#7c3aed", weight: 2, opacity: 0.85 };
}

const MapView: React.FC<MapViewProps> = ({
  permits = [],
  receivers = [],
  onSelectPermit,
  onSelectReceiver,
  selectedReceiverId,
  geoJsonData,
  bufferDistance,
  highlightLayer,
  onLocationChange,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const layersRef = useRef<Record<string, any>>({});
  const pointCloudLayerRef = useRef<any>(null);
  const geoJsonLayerRef = useRef<any>(null);
  const bufferLayerRef = useRef<any>(null);
  const activeOverlaysRef = useRef<string[]>([]);
  const dynamicLayerRequestRef = useRef<Record<string, number>>({});
  const onLocationChangeRef = useRef(onLocationChange);

  useEffect(() => {
    onLocationChangeRef.current = onLocationChange;
  }, [onLocationChange]);

  const [baseLayer, setBaseLayer] = useState<"osm" | "topo" | "orto">("osm");
  const [activeOverlays, setActiveOverlays] = useState<string[]>([]);
  const [selectedContext, setSelectedContext] = useState<MunicipalityContext | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [isUploadingPointCloud, setIsUploadingPointCloud] = useState(false);
  const [mapNotice, setMapNotice] = useState("");

  const refreshDynamicBboxLayer = useCallback(async (layerKey: DynamicBboxLayerKey) => {
    const map = mapRef.current;
    const layer = layersRef.current[layerKey];
    const config = DYNAMIC_BBOX_LAYER_CONFIG[layerKey];
    if (!map || !layer || !config) return;

    const bbox = toBboxParam(map);
    if (!bbox) return;

    const requestId = (dynamicLayerRequestRef.current[layerKey] || 0) + 1;
    dynamicLayerRequestRef.current[layerKey] = requestId;

    try {
      const response = await fetch(`${config.endpoint}?bbox=${encodeURIComponent(bbox)}`);
      const data = await response.json();
      if (dynamicLayerRequestRef.current[layerKey] !== requestId) return;

      if (!response.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }

      layer.clearLayers();
      if (Array.isArray(data?.features) && data.features.length > 0) {
        layer.addData(data);
      }
      layer.__meta = data?.meta || null;
      setMapNotice(
        typeof data?.meta?.warning === "string" && data.meta.warning.trim()
          ? data.meta.warning
          : Array.isArray(data?.features) && data.features.length === 0
            ? config.emptyMessage
            : ""
      );
    } catch (error) {
      if (dynamicLayerRequestRef.current[layerKey] !== requestId) return;
      console.error(`Kunde inte ladda ${layerKey}:`, error);
      setMapNotice(`Kunde inte ladda ${config.label}.`);
    }
  }, []);

  useEffect(() => {
    activeOverlaysRef.current = activeOverlays;
  }, [activeOverlays]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const L = (window as any).L;
    if (!L) {
      setMapNotice("Leaflet saknas i runtime. Kartan kan inte initieras.");
      return;
    }

    mapRef.current = L.map(mapContainerRef.current, { zoomControl: false, maxZoom: 18 }).setView([59.3293, 18.0686], 10);
    L.control.zoom({ position: "bottomright" }).addTo(mapRef.current);

    layersRef.current.osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
    });
    layersRef.current.topo = L.tileLayer.wms("https://api.lantmateriet.se/open/topowebb-ccby/v1/wms", {
      layers: "topowebb",
      format: "image/png",
      version: "1.3.0",
      attribution: "&copy; Lantmateriet",
    });
    layersRef.current.orto = L.tileLayer.wms("https://api.lantmateriet.se/open/ortofoto-ccby/v1/wms", {
      layers: "Ortofoto_0.5,Ortofoto_0.4,Ortofoto_0.25,Ortofoto_0.16",
      format: "image/png",
      version: "1.3.0",
      attribution: "&copy; Lantmateriet",
    });

    layersRef.current.osm.addTo(mapRef.current);

    layersRef.current.raa_fornsok = L.tileLayer.wms("https://pub.raa.se/visning/lamningar_v1/wms", {
      layers: "fornlamning",
      format: "image/png",
      transparent: true,
      opacity: 0.7,
    });
    layersRef.current.nv_natura = L.tileLayer.wms("https://nvpub.naturvardsverket.se/geoservices/wms", {
      layers: "Natura2000",
      format: "image/png",
      transparent: true,
      opacity: 0.6,
    });
    layersRef.current.nv_reservat = L.tileLayer.wms("https://nvpub.naturvardsverket.se/geoservices/wms", {
      layers: "Naturreservat",
      format: "image/png",
      transparent: true,
      opacity: 0.6,
    });
    layersRef.current.smhi_flood = L.tileLayer.wms("https://inspire.msb.se/geoserver/oversvamning/wms", {
      layers: "NZ_Oversvamning_100",
      format: "image/png",
      transparent: true,
      opacity: 0.5,
    });
    layersRef.current.sgu_jordart = L.tileLayer.wms("https://resource.sgu.se/service/wms/130/jordarter-25-100", {
      layers: "Jordarter_25_100",
      format: "image/png",
      transparent: true,
      opacity: 0.5,
    });
    layersRef.current.sgu_grundlager = L.geoJSON(undefined, {
      style: getSguGroundLayerStyle,
      onEachFeature: (feature: any, layer: any) => {
        const properties = feature?.properties || {};
        layer.bindPopup(
          `<div class="p-2 text-xs"><b>${properties.layer_label || "Okant grundlager"}</b><br/><small>Skala: ${properties.source_scale || "1:1 000 000"}<br/>Typ: oversiktlig SGU-screening</small></div>`
        );
      },
    });
    layersRef.current.sgu_jordskred_raviner = L.geoJSON(undefined, {
      style: getSguLandslideStyle,
      onEachFeature: (feature: any, layer: any) => {
        const properties = feature?.properties || {};
        layer.bindPopup(
          `<div class="p-2 text-xs"><b>${properties.feature_label || "SGU-indikator"}</b><br/><small>Kalla: SGU jordskred-raviner<br/>Tolka alltid tillsammans med manuell geoteknisk granskning.</small></div>`
        );
      },
    });
    layersRef.current.trafik_vag = L.tileLayer.wms("https://api.trafikinfo.trafikverket.se/v2/geoserver/wms", {
      layers: "nvdb:NVDB_Vaglinje",
      format: "image/png",
      transparent: true,
      opacity: 0.8,
    });
    layersRef.current.lm_fastighet = L.tileLayer.wms("https://api.lantmateriet.se/open/fastighetsindelning-ccby/v1/wms", {
      layers: "fastighetsytor,fastighetsgranser,fastighetsbeteckning",
      format: "image/png",
      transparent: true,
      version: "1.3.0",
      opacity: 0.8,
      attribution: "&copy; Lantmateriet",
    });

    // NMD & Skogliga grunddata (Naturvårdsverket & Skogsstyrelsen)
    layersRef.current.nv_nmd_bas = L.tileLayer.wms("https://geodata.naturvardsverket.se/inspire/lc-nmd/ows", {
      layers: "LC.LandCoverRaster.Bas_2.0",
      format: "image/png",
      transparent: true,
      opacity: 0.6,
      attribution: "&copy; Naturvårdsverket NMD",
    });

    layersRef.current.nv_nmd_produktivitet = L.tileLayer.wms("https://geodata.naturvardsverket.se/inspire/lc-nmd/ows", {
      layers: "LC.LandCoverRaster.Produktivitet.2018",
      format: "image/png",
      transparent: true,
      opacity: 0.5,
      attribution: "&copy; Naturvårdsverket",
    });

    layersRef.current.skogs_nyckelbiotoper = L.tileLayer.wms("https://geodpags.skogsstyrelsen.se/arcgis/services/Geodataportal/GeodataportalVisaNyckelbiotoper/MapServer/WmsServer", {
      layers: "Nyckelbiotoper",
      format: "image/png",
      transparent: true,
      opacity: 0.7,
      attribution: "&copy; Skogsstyrelsen",
    });

    layersRef.current.skogs_avverkning = L.tileLayer.wms("https://geodpags.skogsstyrelsen.se/arcgis/services/Geodataportal/GeodataportalVisaAvverkningsanmalan/MapServer/WmsServer", {
      layers: "Avverkningsanmalan",
      format: "image/png",
      transparent: true,
      opacity: 0.6,
      attribution: "&copy; Skogsstyrelsen",
    });

    layersRef.current.skogs_markfuktighet = L.tileLayer.wms("https://geodata.skogsstyrelsen.se/arcgis/services/Publikt/Markfuktighet_DTW/ImageServer/WMSServer", {
      layers: "Markfuktighet_DTW",
      format: "image/png",
      transparent: true,
      opacity: 0.5,
      attribution: "&copy; Skogsstyrelsen",
    });

    layersRef.current.postgis_nvr = L.geoJSON(undefined, {
      style: {
        color: "#ff7800",
        weight: 2,
        opacity: 0.7,
        fillColor: "#ff7800",
        fillOpacity: 0.2,
      },
      onEachFeature: (feature: any, layer: any) => {
        if (feature.properties) {
          const { name, protection_type } = feature.properties;
          layer.bindPopup(`<b>${name || "Namnlost omrade"}</b><br>Typ: ${protection_type || "Okand"}<br><small>Kalla: Lokal PostGIS</small>`);
        }
      },
    });

    layersRef.current.postgis_lakes = L.geoJSON(undefined, {
      style: {
        color: "#3b82f6",
        weight: 1,
        opacity: 0.8,
        fillColor: "#60a5fa",
        fillOpacity: 0.5,
      },
      onEachFeature: (feature: any, layer: any) => {
        if (feature.properties) {
          const { namn, kategori } = feature.properties;
          layer.bindPopup(`<b>${namn || "Namnlos sjo"}</b><br>Kategori: ${kategori || "Okand"}<br><small>Kalla: Lokal PostGIS (LM Hydro)</small>`);
        }
      },
    });

    layersRef.current.postgis_property = L.geoJSON(undefined, {
      style: {
        color: "#dc2626",
        weight: 2,
        opacity: 0.8,
        fillColor: "#f87171",
        fillOpacity: 0.1,
      },
      onEachFeature: (feature: any, layer: any) => {
        if (feature.properties) {
          const { designation } = feature.properties;
          layer.bindPopup(`<b>${designation || "Okänd fastighet"}</b><br><small>Källa: Lokal PostGIS (Lantmäteriet)</small>`);
        }
      },
    });

    layersRef.current.postgis_streams = L.geoJSON(undefined, {
      style: {
        color: "#60a5fa",
        weight: 2,
        opacity: 0.7,
      },
      onEachFeature: (feature: any, layer: any) => {
        if (feature.properties) {
          const { namn, kategori } = feature.properties;
          layer.bindPopup(`<b>${namn || "Namnlost vattendrag"}</b><br>Kategori: ${kategori || "Okand"}<br><small>Kalla: Lokal PostGIS (LM Hydro)</small>`);
        }
      },
    });

    const refreshVisibleDynamicLayers = () => {
      for (const layerKey of Object.keys(DYNAMIC_BBOX_LAYER_CONFIG)) {
        if (activeOverlaysRef.current.includes(layerKey)) {
          void refreshDynamicBboxLayer(layerKey as DynamicBboxLayerKey);
        }
      }
    };

    mapRef.current.on("moveend", refreshVisibleDynamicLayers);

    mapRef.current.on("click", async (event: any) => {
      const { lat, lng } = event.latlng;
      if (onLocationChangeRef.current) {
        onLocationChangeRef.current(lat.toFixed(6), lng.toFixed(6));
        return;
      }

      if (activeOverlaysRef.current.length === 0) return;
      const popup = L.popup()
        .setLatLng(event.latlng)
        .setContent(
          '<div class="p-4 flex flex-col items-center gap-2"><div class="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div><p class="text-[10px] font-black uppercase tracking-widest">Hamtar GIS-detaljer...</p></div>'
        )
        .openOn(mapRef.current);

      try {
        const result = await fetchSpatialAuditText(lat, lng);
        popup.setContent(`
          <div class="p-4 max-w-[250px] space-y-3">
            <div class="flex items-center gap-2 mb-1">
              <i class="fas fa-satellite text-blue-600 text-xs"></i>
              <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Spatial analys</span>
            </div>
            <p class="text-xs text-slate-700 leading-relaxed font-medium">${result}</p>
          </div>
        `);
      } catch {
        popup.setContent('<div class="p-4 text-xs font-bold text-rose-500">Kunde inte hamta information for platsen.</div>');
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.off("moveend", refreshVisibleDynamicLayers);
        mapRef.current.remove();
      }
      mapRef.current = null;
    };
  }, [refreshDynamicBboxLayer]);

  useEffect(() => {
    if (!highlightLayer || !mapRef.current || !layersRef.current[highlightLayer]) return;
    const layer = layersRef.current[highlightLayer];
    if (!mapRef.current.hasLayer(layer)) {
      layer.addTo(mapRef.current);
      setActiveOverlays((prev) => [...new Set([...prev, highlightLayer])]);
    }
    if (isDynamicBboxLayerKey(highlightLayer)) {
      void refreshDynamicBboxLayer(highlightLayer);
    }
  }, [highlightLayer, refreshDynamicBboxLayer]);

  useEffect(() => {
    if (!mapRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (geoJsonLayerRef.current) geoJsonLayerRef.current.remove();
    if (bufferLayerRef.current) bufferLayerRef.current.remove();

    if (geoJsonData && typeof geoJsonData === "object") {
      try {
        const features = (geoJsonData as any).features || [];
        const firstFeature = features[0];
        const isPoint = firstFeature?.geometry?.type === "Point";

        if (isPoint && onLocationChange) {
          const coords = firstFeature.geometry.coordinates;
          const latLng = [coords[1], coords[0]] as [number, number];

          const icon = L.divIcon({
            className: "target-pin",
            html: `<div style="background:#2563eb;width:24px;height:24px;border:3px solid white;border-radius:50%;box-shadow:0 4px 10px rgba(0,0,0,0.3);cursor:move;"></div>`,
          });

          const targetMarker = L.marker(latLng, { icon, draggable: true }).addTo(mapRef.current);
          targetMarker.bindPopup('<div class="p-2 text-xs font-bold text-center">Dra markören eller klicka på kartan för att flytta positionen</div>').openPopup();

          targetMarker.on("dragend", (e: any) => {
            const newLatLng = e.target.getLatLng();
            onLocationChange(newLatLng.lat.toFixed(6), newLatLng.lng.toFixed(6));
          });

          markersRef.current.push(targetMarker);

          if (bufferDistance) {
            bufferLayerRef.current = L.circle(latLng, {
              radius: bufferDistance,
              color: "#ef4444",
              weight: 1.5,
              dashArray: "5,5",
              fillOpacity: 0.1,
              fillColor: "#f87171"
            }).addTo(mapRef.current);
          }

          mapRef.current.setView(latLng, 15);
        } else {
          geoJsonLayerRef.current = L.geoJSON(geoJsonData, {
            style: { color: "#2563eb", weight: 3, fillOpacity: 0.2, fillColor: "#3b82f6" },
          }).addTo(mapRef.current);

          if (bufferDistance) {
            bufferLayerRef.current = L.geoJSON(geoJsonData, {
              style: { color: "#ef4444", weight: 1, dashArray: "5,5", fillOpacity: 0.1, fillColor: "#f87171" },
            }).addTo(mapRef.current);
          }

          const bounds = geoJsonLayerRef.current.getBounds();
          if (bounds?.isValid?.()) mapRef.current.fitBounds(bounds, { padding: [50, 50] });
        }
      } catch {
        setMapNotice("GeoJSON kunde inte renderas pa kartan.");
      }
    }

    permits.forEach((permit) => {
      if (!permit.lat || !permit.lng) return;
      const color = permit.decision_type === DecisionType.BIFALL ? "#10b981" : "#ef4444";
      const icon = L.divIcon({
        className: "custom-pin",
        html: `<div style="background:${color};width:16px;height:16px;border:2px solid white;border-radius:50%;box-shadow:0 0 10px ${color}80"></div>`,
      });
      const marker = L.marker([permit.lat, permit.lng], { icon })
        .addTo(mapRef.current)
        .bindPopup(`<div class="p-2 text-center"><b>${permit.property_id}</b><br/><small>${permit.municipality}</small></div>`);

      marker.on("click", () => {
        if (onSelectPermit) onSelectPermit(permit);
        void handleContextFetch(permit);
      });
      markersRef.current.push(marker);
    });

    receivers.forEach((receiver) => {
      const isSelected = receiver.id === selectedReceiverId;
      const icon = L.divIcon({
        className: "receiver-pin",
        html: `<div style="background:${isSelected ? "#2563eb" : "#64748b"};width:24px;height:24px;border:3px solid white;border-radius:8px;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;box-shadow:0 4px 10px rgba(0,0,0,0.2)"><i class="fas fa-truck-ramp-box"></i></div>`,
      });
      const marker = L.marker([receiver.lat, receiver.lng], { icon })
        .addTo(mapRef.current)
        .bindPopup(`<div class="p-2 text-center"><b>${receiver.name}</b><br/><small>${receiver.type}</small></div>`);
      marker.on("click", () => onSelectReceiver && onSelectReceiver(receiver));
      markersRef.current.push(marker);
    });
  }, [permits, receivers, selectedReceiverId, geoJsonData, bufferDistance, onSelectPermit, onSelectReceiver, onLocationChange]);

  const handlePointCloudUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !mapRef.current) return;

    setIsUploadingPointCloud(true);
    setMapNotice("");
    const L = (window as any).L;

    try {
      const { load, LASLoader, PLYLoader } = await loadPointCloudDependencies();
      let canvasLayer = (L as any).canvasLayer?.();
      
      if (!canvasLayer) {
        console.warn("L.canvasLayer saknas, använder inbyggd shim.");
        // Enkel shim för miljöer utan plugin
        canvasLayer = L.layerGroup();
        (canvasLayer as any).isShim = true;
      }

      const loader = file.name.endsWith(".ply") ? PLYLoader : LASLoader;
      const data = await load(file, loader);
      const center = mapRef.current.getCenter();

      if (pointCloudLayerRef.current) mapRef.current.removeLayer(pointCloudLayerRef.current);

      if ((canvasLayer as any).isShim) {
        // Fallback: Rendera som cirklar (begränsat antal för prestanda)
        const positions = data.attributes.POSITION.value;
        const step = Math.max(3, Math.floor(positions.length / 3000) * 3);
        for (let i = 0; i < Math.min(positions.length, 3000 * 3); i += step) {
          const lat = center.lat + positions[i+1] / 100000;
          const lng = center.lng + positions[i] / 100000;
          L.circleMarker([lat, lng], { radius: 1, color: "yellow", fillOpacity: 0.8 }).addTo(canvasLayer);
        }
      } else {
        canvasLayer.delegate({
          onDrawLayer(info: any) {
            const ctx = info.canvas.getContext("2d");
            ctx.clearRect(0, 0, info.canvas.width, info.canvas.height);
            const positions = data.attributes.POSITION.value;
            ctx.fillStyle = "rgba(255,255,0,0.8)";
            for (let index = 0; index < positions.length; index += 30) {
              const x = positions[index];
              const y = positions[index + 1];
              const lat = center.lat + y / 100000;
              const lng = center.lng + x / 100000;
              const point = info.layer._map.latLngToContainerPoint([lat, lng]);
              ctx.beginPath();
              ctx.arc(point.x, point.y, 1, 0, Math.PI * 2);
              ctx.fill();
            }
          },
        });
      }

      pointCloudLayerRef.current = canvasLayer;
      canvasLayer.addTo(mapRef.current);
      mapRef.current.setView(center, 16);
      const pointCount = Math.floor((data.attributes.POSITION.value.length || 0) / 3);
      setMapNotice(`Punktmoln laddat: ${pointCount} punkter visualiseras.`);
    } catch {
      setMapNotice("Kunde inte lasa punktmolnsfilen.");
    } finally {
      setIsUploadingPointCloud(false);
    }
  };

  async function handleContextFetch(permit: Permit) {
    setIsLoadingContext(true);
    setSelectedContext(null);
    try {
      const [audit, facts] = await Promise.all([
        fetchSpatialAuditText(permit.lat!, permit.lng!),
        fetchMunicipalityContext(permit.municipality),
      ]);
      setSelectedContext({
        municipality: permit.municipality,
        audit,
        fact: facts.text,
        sources: facts.sources,
      });
    } catch {
      setSelectedContext({
        municipality: permit.municipality,
        audit: "Kunde inte hamta spatial audit just nu.",
        fact: "Kommunal kontext kunde inte laddas. Forsok igen senare.",
        sources: [],
      });
    } finally {
      setIsLoadingContext(false);
    }
  };

  const toggleBaseLayer = (layer: "osm" | "topo" | "orto") => {
    if (!mapRef.current) return;
    mapRef.current.removeLayer(layersRef.current.osm);
    mapRef.current.removeLayer(layersRef.current.topo);
    if (layersRef.current.orto) mapRef.current.removeLayer(layersRef.current.orto);
    layersRef.current[layer].addTo(mapRef.current);
    setBaseLayer(layer);
  };

  const toggleOverlay = (layerKey: string) => {
    if (!mapRef.current) return;
    if (layerKey === "lm_marktacke") {
      setMapNotice("Marktacke kraver lokal GeoServer pa localhost:8080.");
      return;
    }
    const layer = layersRef.current[layerKey];
    if (!layer) return;
    if (mapRef.current.hasLayer(layer)) {
      mapRef.current.removeLayer(layer);
      setActiveOverlays((prev) => prev.filter((item) => item !== layerKey));
      return;
    }
    layer.addTo(mapRef.current);
    setActiveOverlays((prev) => [...prev, layerKey]);
    if (isDynamicBboxLayerKey(layerKey)) {
      void refreshDynamicBboxLayer(layerKey);
    }
  };

  return (
    <div className="relative h-full min-h-[600px] w-full rounded-3xl border border-slate-200 bg-slate-100">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" />

      <div className="absolute left-6 top-6 z-[1000] space-y-3">
        <div className="w-60 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur-md">
          <p className="mb-3 px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Integrerade myndighetslager</p>
          <div className="space-y-1.5">
            <OverlayToggle
              active={activeOverlays.includes("raa_fornsok")}
              onClick={() => toggleOverlay("raa_fornsok")}
              label="RAA lamningar"
              icon="fa-monument"
              color="text-amber-700"
            />
            <OverlayToggle
              active={activeOverlays.includes("nv_natura")}
              onClick={() => toggleOverlay("nv_natura")}
              label="Natura 2000 (NV)"
              icon="fa-leaf"
              color="text-emerald-600"
            />
            <OverlayToggle
              active={activeOverlays.includes("nv_reservat")}
              onClick={() => toggleOverlay("nv_reservat")}
              label="Naturreservat (NV)"
              icon="fa-tree"
              color="text-emerald-800"
            />
            <OverlayToggle
              active={activeOverlays.includes("smhi_flood")}
              onClick={() => toggleOverlay("smhi_flood")}
              label="Oversvamningsrisk (MSB)"
              icon="fa-water"
              color="text-blue-500"
            />
            <OverlayToggle
              active={activeOverlays.includes("sgu_jordart")}
              onClick={() => toggleOverlay("sgu_jordart")}
              label="SGU jordart WMS"
              icon="fa-mountain"
              color="text-orange-800"
            />
            <OverlayToggle
              active={activeOverlays.includes("sgu_grundlager")}
              onClick={() => toggleOverlay("sgu_grundlager")}
              label="SGU grundlager (PostGIS)"
              icon="fa-layer-group"
              color="text-slate-700"
            />
            <OverlayToggle
              active={activeOverlays.includes("sgu_jordskred_raviner")}
              onClick={() => toggleOverlay("sgu_jordskred_raviner")}
              label="SGU jordskred/raviner"
              icon="fa-triangle-exclamation"
              color="text-rose-700"
            />
            <OverlayToggle
              active={activeOverlays.includes("trafik_vag")}
              onClick={() => toggleOverlay("trafik_vag")}
              label="Vägnät (Trafikverket)"
              icon="fa-road"
              color="text-slate-600"
            />
            <OverlayToggle
              active={activeOverlays.includes("postgis_nvr")}
              onClick={() => toggleOverlay("postgis_nvr")}
              label="NVR (PostGIS DB)"
              icon="fa-shield-halved"
              color="text-orange-500"
            />
            <OverlayToggle
              active={activeOverlays.includes("postgis_lakes")}
              onClick={() => toggleOverlay("postgis_lakes")}
              label="Sjöar (PostGIS DB)"
              icon="fa-water"
              color="text-blue-500"
            />
            <OverlayToggle
              active={activeOverlays.includes("postgis_streams")}
              onClick={() => toggleOverlay("postgis_streams")}
              label="Vattendrag (PostGIS DB)"
              icon="fa-water"
              color="text-sky-500"
            />
            <OverlayToggle
              active={activeOverlays.includes("postgis_property")}
              onClick={() => toggleOverlay("postgis_property")}
              label="Fastighetsgränser (PostGIS)"
              icon="fa-vector-square"
              color="text-red-500"
            />
            <OverlayToggle
              active={activeOverlays.includes("lm_fastighet")}
              onClick={() => toggleOverlay("lm_fastighet")}
              label="Lantm. Fastighetskarta"
              icon="fa-map-location-dot"
              color="text-blue-700"
            />
            <OverlayToggle
              active={activeOverlays.includes("nv_nmd_bas")}
              onClick={() => toggleOverlay("nv_nmd_bas")}
              label="NMD Bas (NV)"
              icon="fa-map"
              color="text-emerald-700"
            />
            <OverlayToggle
              active={activeOverlays.includes("nv_nmd_produktivitet")}
              onClick={() => toggleOverlay("nv_nmd_produktivitet")}
              label="Produktivitet (NMD)"
              icon="fa-arrow-up-right-dots"
              color="text-green-600"
            />
            <OverlayToggle
              active={activeOverlays.includes("skogs_nyckelbiotoper")}
              onClick={() => toggleOverlay("skogs_nyckelbiotoper")}
              label="Nyckelbiotoper (SKS)"
              icon="fa-star"
              color="text-amber-500"
            />
            <OverlayToggle
              active={activeOverlays.includes("skogs_avverkning")}
              onClick={() => toggleOverlay("skogs_avverkning")}
              label="Avverkningsanmälan"
              icon="fa-scissors"
              color="text-rose-400"
            />
            <OverlayToggle
              active={activeOverlays.includes("skogs_markfuktighet")}
              onClick={() => toggleOverlay("skogs_markfuktighet")}
              label="Markfuktighet (DTW)"
              icon="fa-droplet"
              color="text-blue-600"
            />
          </div>
        </div>

        <div className="w-60 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-2xl">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-2 transition-all hover:bg-slate-50">
            <i className={`fas ${isUploadingPointCloud ? "fa-spinner fa-spin" : "fa-cloud-arrow-up"} mb-2 text-blue-600`} />
            <span className="text-[10px] font-black uppercase text-slate-500">Importera punktmoln</span>
            <input type="file" className="hidden" accept=".las,.laz,.ply" onChange={handlePointCloudUpload} />
          </label>
          {mapNotice && <p className="mt-2 text-[10px] font-semibold text-slate-600">{mapNotice}</p>}
        </div>

        <div className="flex w-64 gap-1.5 rounded-2xl border border-slate-200 bg-white/95 p-2.5 shadow-xl">
          <button
            type="button"
            onClick={() => toggleBaseLayer("topo")}
            className={`flex-1 rounded-lg py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
              baseLayer === "topo" ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-400"
            }`}
          >
            Topo
          </button>
          <button
            type="button"
            onClick={() => toggleBaseLayer("orto")}
            className={`flex-1 rounded-lg py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
              baseLayer === "orto" ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-400"
            }`}
          >
            Orto
          </button>
          <button
            type="button"
            onClick={() => toggleBaseLayer("osm")}
            className={`flex-1 rounded-lg py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
              baseLayer === "osm" ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-400"
            }`}
          >
            OSM
          </button>
        </div>
      </div>

      {(selectedContext || isLoadingContext) && (
        <div className="custom-scrollbar absolute right-6 top-6 z-[1000] max-h-[80%] w-80 animate-in overflow-y-auto rounded-[2rem] border border-slate-200 bg-white/95 shadow-2xl backdrop-blur-md slide-in-from-right duration-300">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/90 p-6">
            <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-900">
              <i className="fas fa-landmark text-blue-600" />
              {isLoadingContext ? "Hamtar data..." : selectedContext?.municipality}
            </h3>
            <button type="button" onClick={() => setSelectedContext(null)} className="text-slate-400 hover:text-slate-600">
              <i className="fas fa-times" />
            </button>
          </div>

          {isLoadingContext ? (
            <div className="p-12 text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Kopplar upp mot AI-engine...</p>
            </div>
          ) : (
            <div className="space-y-6 p-6">
              <div className="space-y-2">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-600">Rumslig audit</h4>
                <p className="text-xs italic leading-relaxed text-slate-600">{selectedContext?.audit}</p>
              </div>
              <div className="space-y-2 border-t border-slate-50 pt-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Kommunal kontext</h4>
                <p className="text-xs leading-relaxed text-slate-600">{selectedContext?.fact}</p>
              </div>
              {selectedContext?.sources && selectedContext.sources.length > 0 && (
                <div className="border-t border-slate-50 pt-4">
                  <p className="mb-2 text-[9px] font-black uppercase text-slate-400">Grounding kallor</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedContext.sources.slice(0, 4).map(
                      (source, index) =>
                        source.web && (
                          <a
                            key={`${source.web.uri}-${index}`}
                            href={source.web.uri}
                            target="_blank"
                            rel="noreferrer"
                            className="max-w-full truncate rounded-md bg-slate-100 px-2 py-1 text-[9px] text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
                          >
                            <i className="fas fa-link mr-1" /> {source.web.title || "Kalla"}
                          </a>
                        )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const OverlayToggle: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
  color: string;
}> = ({ active, onClick, label, icon, color }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center justify-between rounded-xl border p-2.5 transition-all ${
      active ? "border-slate-900 bg-slate-900 text-white shadow-lg" : "border-slate-100 bg-white text-slate-600 hover:bg-slate-50"
    }`}
  >
    <div className="flex items-center gap-3 overflow-hidden">
      <i className={`fas ${icon} shrink-0 text-[12px] ${active ? "text-white" : color}`} />
      <span className="truncate text-[10px] font-black uppercase tracking-tight">{label}</span>
    </div>
    {active && <i className="fas fa-check-circle text-[10px]" />}
  </button>
);

export default MapView;


