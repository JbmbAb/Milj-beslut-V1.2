import React, { useEffect, useRef } from 'react';

interface MapComponentProps {
    propertyId: string;
    center: [number, number]; // [lat, lng]
    zoom?: number;
}

const MapComponent: React.FC<MapComponentProps> = ({ propertyId, center, zoom = 13 }) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);

    useEffect(() => {
        if (!mapContainerRef.current) return;
        
        const L = (window as any).L;
        if (!L) {
            console.error("Leaflet (L) missing from window. Ensure scripts are loaded in root.tsx");
            return;
        }

        if (!mapRef.current) {
            mapRef.current = L.map(mapContainerRef.current).setView(center, zoom);
            
            // Lantmäteriet Topo som grundkarta (via OSM fallback om nyckel saknas)
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(mapRef.current);

            // Lägg till fastighetsmarkör
            L.marker(center).addTo(mapRef.current)
                .bindPopup(`<b>Fastighet:</b> ${propertyId}`)
                .openPopup();
        } else {
            mapRef.current.setView(center, zoom);
        }

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [center, propertyId, zoom]);

    return (
        <div 
            ref={mapContainerRef} 
            className="w-full h-full rounded-2xl border border-slate-200 shadow-inner"
            style={{ minHeight: '400px' }}
        />
    );
};

export default MapComponent;
