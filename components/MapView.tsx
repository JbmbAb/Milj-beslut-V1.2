
import React, { useEffect, useRef, useState } from 'react';
import { Permit, DecisionType, Receiver } from '../types';
import { performSpatialAudit, fetchMunicipalityContext } from '../services/geminiService';
import { load } from '@loaders.gl/core';
import { LASLoader } from '@loaders.gl/las';
import { PLYLoader } from '@loaders.gl/ply';

interface MapViewProps {
  permits?: Permit[];
  receivers?: Receiver[];
  onSelectPermit?: (permit: Permit) => void;
  onSelectReceiver?: (receiver: Receiver) => void;
  selectedReceiverId?: string;
  geoJsonData?: any;
  bufferDistance?: number;
  highlightLayer?: string;
}

const MapView: React.FC<MapViewProps> = ({ 
  permits = [], 
  receivers = [], 
  onSelectPermit, 
  onSelectReceiver,
  selectedReceiverId,
  geoJsonData,
  bufferDistance,
  highlightLayer
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const layersRef = useRef<Record<string, any>>({});
  const pointCloudLayerRef = useRef<any>(null);
  const geoJsonLayerRef = useRef<any>(null);
  const bufferLayerRef = useRef<any>(null);
  
  const [baseLayer, setBaseLayer] = useState<'osm' | 'topo'>('osm');
  const [activeOverlays, setActiveOverlays] = useState<string[]>([]);
  const [selectedContext, setSelectedContext] = useState<{ municipality: string, audit: string, fact: string, sources: any[] } | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [isUploadingPointCloud, setIsUploadingPointCloud] = useState(false);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const L = (window as any).L;
    mapRef.current = L.map(mapContainerRef.current, { zoomControl: false, maxZoom: 18 }).setView([59.3293, 18.0686], 10);
    L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);

    layersRef.current.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' });
    layersRef.current.topo = L.tileLayer.wms('https://api.lantmateriet.se/open/topowebb-ccby/v1/wms', { layers: 'topowebb', format: 'image/png', version: '1.3.0' });

    layersRef.current[baseLayer].addTo(mapRef.current);

    // Miljölager
    layersRef.current.raa_fornsok = L.tileLayer.wms('https://kulturarvsdata.se/geodata/raa/wms', { layers: 'fornlamningar', format: 'image/png', transparent: true, opacity: 0.7 });
    layersRef.current.nv_natura = L.tileLayer.wms('https://nvpub.naturvardsverket.se/geoservices/wms', { layers: 'Natura2000', format: 'image/png', transparent: true, opacity: 0.6 });
    layersRef.current.smhi_flood = L.tileLayer.wms('https://geoserver.smhi.se/geoserver/wms', { layers: 'oversvamning_100ar', format: 'image/png', transparent: true, opacity: 0.5 });
    layersRef.current.sgu_jordart = L.tileLayer.wms('https://resource.sgu.se/service/wms/130/jordarter-25-100', { layers: 'Jordarter_25_100', format: 'image/png', transparent: true, opacity: 0.5 });

    mapRef.current.on('click', async (e: any) => {
      const { lat, lng } = e.latlng;
      
      // Only trigger if we have active overlays that might have info
      if (activeOverlays.length > 0) {
        const L = (window as any).L;
        const popup = L.popup()
          .setLatLng(e.latlng)
          .setContent('<div class="p-4 flex flex-col items-center gap-2"><div class="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div><p class="text-[10px] font-black uppercase tracking-widest">Hämtar GIS-detaljer...</p></div>')
          .openOn(mapRef.current);

        try {
          const result = await performSpatialAudit(lat, lng);
          popup.setContent(`
            <div class="p-4 max-w-[250px] space-y-3">
              <div class="flex items-center gap-2 mb-1">
                <i class="fas fa-satellite text-blue-600 text-xs"></i>
                <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Spatial Analys</span>
              </div>
              <p class="text-xs text-slate-700 leading-relaxed font-medium">${result.text}</p>
              ${result.sources.length > 0 ? `
                <div class="pt-2 border-t border-slate-100">
                  <p class="text-[8px] font-black text-slate-400 uppercase mb-1">Källor</p>
                  <div class="flex flex-wrap gap-1">
                    ${result.sources.slice(0, 2).map((s: any) => s.web ? `
                      <a href="${s.web.uri}" target="_blank" class="text-[8px] text-blue-600 hover:underline truncate block max-w-full">
                        <i class="fas fa-link mr-1"></i> ${s.web.title}
                      </a>
                    ` : '').join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          `);
        } catch (err) {
          popup.setContent('<div class="p-4 text-xs font-bold text-rose-500">Kunde inte hämta information för denna plats.</div>');
        }
      }
    });

    return () => { if (mapRef.current) mapRef.current.remove(); };
  }, [activeOverlays]);

  useEffect(() => {
    if (highlightLayer && mapRef.current && layersRef.current[highlightLayer]) {
      const layer = layersRef.current[highlightLayer];
      if (!mapRef.current.hasLayer(layer)) {
        layer.addTo(mapRef.current);
        setActiveOverlays(prev => [...new Set([...prev, highlightLayer])]);
      }
      // Optional: flash the layer or zoom to it
    }
  }, [highlightLayer]);

  useEffect(() => {
    if (!mapRef.current) return;
    const L = (window as any).L;
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    if (geoJsonLayerRef.current) geoJsonLayerRef.current.remove();
    if (bufferLayerRef.current) bufferLayerRef.current.remove();

    if (geoJsonData && mapRef.current) {
      const L = (window as any).L;
      
      // Add GeoJSON Layer
      geoJsonLayerRef.current = L.geoJSON(geoJsonData, {
        style: {
          color: '#2563eb',
          weight: 3,
          fillOpacity: 0.2,
          fillColor: '#3b82f6'
        }
      }).addTo(mapRef.current);

      // Add Buffer Layer (Simulated for demo if turf is missing, but we'll use a simple circle if it's a point or just a larger polygon)
      // In a real app we'd use @turf/buffer
      if (bufferDistance) {
        bufferLayerRef.current = L.geoJSON(geoJsonData, {
          style: {
            color: '#ef4444',
            weight: 1,
            dashArray: '5, 5',
            fillOpacity: 0.1,
            fillColor: '#f87171'
          },
          filter: () => true // We could transform the geometry here if we had turf
        }).addTo(mapRef.current);
      }

      const bounds = geoJsonLayerRef.current.getBounds();
      if (bounds.isValid()) {
        mapRef.current.fitBounds(bounds, { padding: [50, 50] });
      }
    }

    permits.forEach(permit => {
      if (permit.lat && permit.lng) {
        const color = permit.decision_type === DecisionType.BIFALL ? '#10b981' : '#ef4444';
        const icon = L.divIcon({
          className: "custom-pin",
          html: `<div style="background: ${color}; width: 16px; height: 16px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 10px ${color}80"></div>`
        });

        const marker = L.marker([permit.lat, permit.lng], { icon })
          .addTo(mapRef.current)
          .bindPopup(`<div class="p-2 text-center"><b>${permit.property_id}</b><br/><small>${permit.municipality}</small></div>`);

        marker.on('click', () => onSelectPermit && handleContextFetch(permit));
        markersRef.current.push(marker);
      }
    });

    receivers.forEach(receiver => {
      const isSelected = receiver.id === selectedReceiverId;
      const icon = L.divIcon({
        className: "receiver-pin",
        html: `<div style="background: ${isSelected ? '#2563eb' : '#64748b'}; width: 24px; height: 24px; border: 3px solid white; border-radius: 8px; display: flex; items-center; justify-center; color: white; font-size: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.2)">
                <i class="fas fa-truck-ramp-box"></i>
               </div>`
      });

      const marker = L.marker([receiver.lat, receiver.lng], { icon })
        .addTo(mapRef.current)
        .bindPopup(`<div class="p-2 text-center"><b>${receiver.name}</b><br/><small>${receiver.type}</small></div>`);

      marker.on('click', () => onSelectReceiver && onSelectReceiver(receiver));
      markersRef.current.push(marker);
    });
  }, [permits, receivers, selectedReceiverId]);

  const handlePointCloudUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !mapRef.current) return;

    setIsUploadingPointCloud(true);
    const L = (window as any).L;

    try {
      const loader = file.name.endsWith('.ply') ? PLYLoader : LASLoader;
      const data = await load(file, loader);
      
      // Enkel koordinattransformation (Simulerad för demo, i produktion används proj4)
      // Vi antar att punktmolnet är i närheten av kartans centrum om ingen metadata finns
      const center = mapRef.current.getCenter();
      
      // Skapa en Canvas Layer för punktmolnet
      if (pointCloudLayerRef.current) mapRef.current.removeLayer(pointCloudLayerRef.current);

      const canvasLayer = L.canvasLayer().delegate({
        onDrawLayer: function(info: any) {
          const ctx = info.canvas.getContext('2d');
          ctx.clearRect(0, 0, info.canvas.width, info.canvas.height);
          
          const positions = data.attributes.POSITION.value;
          ctx.fillStyle = 'rgba(255, 255, 0, 0.8)';
          
          // Rita ett urval av punkter för prestanda (var 10:e punkt)
          for (let i = 0; i < positions.length; i += 30) {
            const x = positions[i];
            const y = positions[i+1];
            
            // Transformera lokala punktkoordinater till Lat/Lng och sen till Pixlar
            // Här simulerar vi en offset för visualisering
            const lat = center.lat + (y / 100000);
            const lng = center.lng + (x / 100000);
            
            const point = info.layer._map.latLngToContainerPoint([lat, lng]);
            ctx.beginPath();
            ctx.arc(point.x, point.y, 1, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      pointCloudLayerRef.current = canvasLayer;
      canvasLayer.addTo(mapRef.current);
      
      mapRef.current.setView(center, 16);
      alert(`Punktmoln laddat: ${data.attributes.POSITION.value.length / 3} punkter visualiseras.`);

    } catch (err) {
      console.error("LIDAR error:", err);
      alert("Kunde inte läsa punktmolnsfilen.");
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
        fetchMunicipalityContext(permit.municipality)
      ]);
      setSelectedContext({
        municipality: permit.municipality,
        audit: audit.text,
        fact: facts.text,
        sources: [...audit.sources, ...facts.sources]
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingContext(false);
    }
  };

  const toggleBaseLayer = (layer: 'osm' | 'topo') => {
    if (!mapRef.current) return;
    mapRef.current.removeLayer(layersRef.current.osm);
    mapRef.current.removeLayer(layersRef.current.topo);
    layersRef.current[layer].addTo(mapRef.current);
    setBaseLayer(layer);
  };

  const toggleOverlay = (layerKey: string) => {
    if (!mapRef.current) return;
    const layer = layersRef.current[layerKey];
    if (mapRef.current.hasLayer(layer)) {
      mapRef.current.removeLayer(layer);
      setActiveOverlays(prev => prev.filter(k => k !== layerKey));
    } else {
      layer.addTo(mapRef.current);
      setActiveOverlays(prev => [...prev, layerKey]);
    }
  };

  return (
    <div className="w-full h-full min-h-[600px] bg-slate-100 rounded-3xl relative overflow-hidden border border-slate-200">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" />
      
      {/* Control Panel */}
      <div className="absolute top-6 left-6 z-[1000] space-y-3">
        <div className="bg-white/95 backdrop-blur-md p-4 rounded-3xl shadow-2xl border border-slate-200 w-60">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-1">Integrerade Myndighetslager</p>
          <div className="space-y-1.5">
            <OverlayToggle active={activeOverlays.includes('raa_fornsok')} onClick={() => toggleOverlay('raa_fornsok')} label="RAÄ Fornlämningar" icon="fa-monument" color="text-amber-700" />
            <OverlayToggle active={activeOverlays.includes('nv_natura')} onClick={() => toggleOverlay('nv_natura')} label="Natura 2000 (NV)" icon="fa-leaf" color="text-emerald-600" />
            <OverlayToggle active={activeOverlays.includes('smhi_flood')} onClick={() => toggleOverlay('smhi_flood')} label="Översvämningsrisk (SMHI)" icon="fa-water" color="text-blue-500" />
            <OverlayToggle active={activeOverlays.includes('sgu_jordart')} onClick={() => toggleOverlay('sgu_jordart')} label="Jordartskarta (SGU)" icon="fa-mountain" color="text-orange-800" />
          </div>
        </div>

        {/* Punktmoln Upload */}
        <div className="bg-white/95 p-4 rounded-3xl shadow-2xl border border-slate-200 w-60">
          <label className="flex flex-col items-center justify-center p-2 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-all">
            <i className={`fas ${isUploadingPointCloud ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'} text-blue-600 mb-2`}></i>
            <span className="text-[10px] font-black uppercase text-slate-500">Importera Punktmoln</span>
            <input type="file" className="hidden" accept=".las,.laz,.ply" onChange={handlePointCloudUpload} />
          </label>
        </div>

        <div className="bg-white/95 p-3 rounded-2xl shadow-xl border border-slate-200 w-60 flex gap-2">
            <button onClick={() => toggleBaseLayer('osm')} className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${baseLayer === 'osm' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-400'}`}>OSM</button>
            <button onClick={() => toggleBaseLayer('topo')} className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${baseLayer === 'topo' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-400'}`}>Lantm.</button>
        </div>
      </div>

      {/* Municipality Context Panel */}
      {(selectedContext || isLoadingContext) && (
        <div className="absolute top-6 right-6 z-[1000] w-80 bg-white/95 backdrop-blur-md rounded-[2rem] shadow-2xl border border-slate-200 max-h-[80%] overflow-y-auto animate-in slide-in-from-right duration-300">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white/90 z-10">
             <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                <i className="fas fa-landmark text-blue-600"></i>
                {isLoadingContext ? 'Hämtar data...' : selectedContext?.municipality}
             </h3>
             <button onClick={() => setSelectedContext(null)} className="text-slate-400 hover:text-slate-600"><i className="fas fa-times"></i></button>
          </div>
          
          {isLoadingContext ? (
            <div className="p-12 text-center">
               <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kopplar upp mot AI Engine...</p>
            </div>
          ) : (
            <div className="p-6 space-y-6">
               <div className="space-y-2">
                  <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Rumslig Audit</h4>
                  <p className="text-xs text-slate-600 leading-relaxed italic">{selectedContext?.audit}</p>
               </div>
               <div className="space-y-2 pt-4 border-t border-slate-50">
                  <h4 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Kommunal Kontext</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">{selectedContext?.fact}</p>
               </div>
               {selectedContext?.sources && selectedContext.sources.length > 0 && (
                 <div className="pt-4 border-t border-slate-50">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-2">Grounding Källor</p>
                    <div className="flex flex-wrap gap-1.5">
                       {selectedContext.sources.slice(0, 4).map((s, i) => s.web && (
                         <a key={i} href={s.web.uri} target="_blank" className="px-2 py-1 bg-slate-100 text-[9px] rounded-md text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors truncate max-w-full">
                           <i className="fas fa-link mr-1"></i> {s.web.title}
                         </a>
                       ))}
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

const OverlayToggle: React.FC<{ active: boolean; onClick: () => void; label: string; icon: string; color: string }> = ({ active, onClick, label, icon, color }) => (
  <button onClick={onClick} className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all border ${active ? 'bg-slate-900 border-slate-900 text-white shadow-lg' : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'}`}>
    <div className="flex items-center gap-3 overflow-hidden">
      <i className={`fas ${icon} text-[12px] shrink-0 ${active ? 'text-white' : color}`}></i>
      <span className="text-[10px] font-black uppercase tracking-tight truncate">{label}</span>
    </div>
    {active && <i className="fas fa-check-circle text-[10px]"></i>}
  </button>
);

export default MapView;
