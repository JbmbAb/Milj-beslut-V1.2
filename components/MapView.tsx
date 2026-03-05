import React, { useEffect, useRef, useState } from "react";
import { load } from "@loaders.gl/core";
import { LASLoader } from "@loaders.gl/las";
import { PLYLoader } from "@loaders.gl/ply";
import { DecisionType, Permit, Receiver } from "../types";
import { fetchMunicipalityContext, performSpatialAudit } from "../services/geminiService";

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

type MunicipalityContext = {
  municipality: string;
  audit: string;
  fact: string;
  sources: Array<{ web?: { uri: string; title?: string } }>;
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
  const pointCloudLayerRef = useRef<any>(null);
  const geoJsonLayerRef = useRef<any>(null);
  const bufferLayerRef = useRef<any>(null);
  const activeOverlaysRef = useRef<string[]>([]);

  const [baseLayer, setBaseLayer] = useState<"osm" | "topo">("osm");
  const [activeOverlays, setActiveOverlays] = useState<string[]>([]);
  const [selectedContext, setSelectedContext] = useState<MunicipalityContext | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [isUploadingPointCloud, setIsUploadingPointCloud] = useState(false);
  const [mapNotice, setMapNotice] = useState("");

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
    });

    layersRef.current[baseLayer].addTo(mapRef.current);

    layersRef.current.raa_fornsok = L.tileLayer.wms("https://kulturarvsdata.se/geodata/raa/wms", {
      layers: "fornlamningar",
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
    layersRef.current.smhi_flood = L.tileLayer.wms("https://geoserver.smhi.se/geoserver/wms", {
      layers: "oversvamning_100ar",
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

    mapRef.current.on("click", async (event: any) => {
      if (activeOverlaysRef.current.length === 0) return;
      const { lat, lng } = event.latlng;
      const popup = L.popup()
        .setLatLng(event.latlng)
        .setContent(
          '<div class="p-4 flex flex-col items-center gap-2"><div class="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div><p class="text-[10px] font-black uppercase tracking-widest">Hamtar GIS-detaljer...</p></div>'
        )
        .openOn(mapRef.current);

      try {
        const result = await performSpatialAudit(lat, lng);
        popup.setContent(`
          <div class="p-4 max-w-[250px] space-y-3">
            <div class="flex items-center gap-2 mb-1">
              <i class="fas fa-satellite text-blue-600 text-xs"></i>
              <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Spatial analys</span>
            </div>
            <p class="text-xs text-slate-700 leading-relaxed font-medium">${result.text}</p>
          </div>
        `);
      } catch {
        popup.setContent('<div class="p-4 text-xs font-bold text-rose-500">Kunde inte hamta information for platsen.</div>');
      }
    });

    return () => {
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
    };
  }, [baseLayer]);

  useEffect(() => {
    if (!highlightLayer || !mapRef.current || !layersRef.current[highlightLayer]) return;
    const layer = layersRef.current[highlightLayer];
    if (!mapRef.current.hasLayer(layer)) {
      layer.addTo(mapRef.current);
      setActiveOverlays((prev) => [...new Set([...prev, highlightLayer])]);
    }
  }, [highlightLayer]);

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
  }, [permits, receivers, selectedReceiverId, geoJsonData, bufferDistance, onSelectPermit, onSelectReceiver]);

  const handlePointCloudUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !mapRef.current) return;

    setIsUploadingPointCloud(true);
    setMapNotice("");
    const L = (window as any).L;

    try {
      if (!L?.canvasLayer) {
        setMapNotice("CanvasLayer-plugin saknas. Punktmoln kan inte visas i denna miljo.");
        return;
      }
      const loader = file.name.endsWith(".ply") ? PLYLoader : LASLoader;
      const data = await load(file, loader);
      const center = mapRef.current.getCenter();

      if (pointCloudLayerRef.current) mapRef.current.removeLayer(pointCloudLayerRef.current);
      const canvasLayer = L.canvasLayer().delegate({
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

  const handleContextFetch = async (permit: Permit) => {
    setIsLoadingContext(true);
    setSelectedContext(null);
    try {
      const [audit, facts] = await Promise.all([
        performSpatialAudit(permit.lat!, permit.lng!),
        fetchMunicipalityContext(permit.municipality),
      ]);
      setSelectedContext({
        municipality: permit.municipality,
        audit: audit.text,
        fact: facts.text,
        sources: [...audit.sources, ...facts.sources],
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

  const toggleBaseLayer = (layer: "osm" | "topo") => {
    if (!mapRef.current) return;
    mapRef.current.removeLayer(layersRef.current.osm);
    mapRef.current.removeLayer(layersRef.current.topo);
    layersRef.current[layer].addTo(mapRef.current);
    setBaseLayer(layer);
  };

  const toggleOverlay = (layerKey: string) => {
    if (!mapRef.current) return;
    const layer = layersRef.current[layerKey];
    if (!layer) return;
    if (mapRef.current.hasLayer(layer)) {
      mapRef.current.removeLayer(layer);
      setActiveOverlays((prev) => prev.filter((item) => item !== layerKey));
      return;
    }
    layer.addTo(mapRef.current);
    setActiveOverlays((prev) => [...prev, layerKey]);
  };

  return (
    <div className="relative h-full min-h-[600px] w-full overflow-hidden rounded-3xl border border-slate-200 bg-slate-100">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" />

      <div className="absolute left-6 top-6 z-[1000] space-y-3">
        <div className="w-60 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur-md">
          <p className="mb-3 px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Integrerade myndighetslager</p>
          <div className="space-y-1.5">
            <OverlayToggle
              active={activeOverlays.includes("raa_fornsok")}
              onClick={() => toggleOverlay("raa_fornsok")}
              label="RAA Fornlamningar"
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
              active={activeOverlays.includes("smhi_flood")}
              onClick={() => toggleOverlay("smhi_flood")}
              label="Oversvamningsrisk (SMHI)"
              icon="fa-water"
              color="text-blue-500"
            />
            <OverlayToggle
              active={activeOverlays.includes("sgu_jordart")}
              onClick={() => toggleOverlay("sgu_jordart")}
              label="Jordartskarta (SGU)"
              icon="fa-mountain"
              color="text-orange-800"
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

        <div className="flex w-60 gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl">
          <button
            type="button"
            onClick={() => toggleBaseLayer("osm")}
            className={`flex-1 rounded-lg py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
              baseLayer === "osm" ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-400"
            }`}
          >
            OSM
          </button>
          <button
            type="button"
            onClick={() => toggleBaseLayer("topo")}
            className={`flex-1 rounded-lg py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
              baseLayer === "topo" ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-400"
            }`}
          >
            Lantm.
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

