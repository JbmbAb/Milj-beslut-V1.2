import React, { useEffect, useRef, useState } from 'react';
import { designTokens } from '@miljobeslut/mps-identity';
import type { Permit } from '../types';

interface CesiumMapViewProps {
  permits?: Permit[];
  geoJsonData?: any;
  bufferDistance?: number;
  onLocationChange?: (lat: string, lng: string) => void;
}

const colors = designTokens.colors;

export const CesiumMapView: React.FC<CesiumMapViewProps> = ({
  permits = [],
  geoJsonData,
  bufferDistance,
  onLocationChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [cesiumLoaded, setCesiumLoaded] = useState(false);

  // Load CesiumJS dynamically from CDN to avoid huge bundle size issues during development,
  // falling back to local static import if configured.
  useEffect(() => {
    if (window.hasOwnProperty('Cesium')) {
      setCesiumLoaded(true);
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cesium.com/downloads/cesiumjs/releases/1.115/Build/Cesium/Widgets/widgets.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://cesium.com/downloads/cesiumjs/releases/1.115/Build/Cesium/Cesium.js';
    script.onload = () => {
      setCesiumLoaded(true);
    };
    document.body.appendChild(script);

    return () => {
      link.remove();
      script.remove();
    };
  }, []);

  useEffect(() => {
    if (!cesiumLoaded || !containerRef.current || viewerRef.current) return;

    const Cesium = (window as any).Cesium;
    if (!Cesium) return;

    // Optional ION Access Token
    const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN || '';
    if (ionToken) {
      Cesium.Ion.defaultAccessToken = ionToken;
    }

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrainProvider: Cesium.createWorldTerrain?.() || undefined,
      animation: false,
      timeline: false,
      baseLayerPicker: true,
      fullscreenButton: false,
      geocoder: false,
      homeButton: true,
      infoBox: true,
      sceneModePicker: true,
      navigationHelpButton: false,
    });

    viewerRef.current = viewer;
    setLoading(false);

    // Click handler for location query
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: any) => {
      const cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
      if (cartesian && onLocationChange) {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const lat = Cesium.Math.toDegrees(cartographic.latitude).toFixed(6);
        const lng = Cesium.Math.toDegrees(cartographic.longitude).toFixed(6);
        onLocationChange(lat, lng);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Initial positioning over Sweden
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(18.0686, 59.3293, 1500000.0),
    });

    return () => {
      handler.destroy();
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [cesiumLoaded, onLocationChange]);

  // Handle GeoJSON Boundaries / Property limits & Buildings
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !cesiumLoaded || !geoJsonData) return;

    const Cesium = (window as any).Cesium;

    viewer.dataSources.removeAll();

    Cesium.GeoJsonDataSource.load(geoJsonData, {
      stroke: Cesium.Color.fromCssColorString(colors.coreTurquoise.hex || '#06B6D4'),
      fill: Cesium.Color.fromCssColorString(colors.coreTurquoise.hex || '#06B6D4').withAlpha(0.15),
      strokeWidth: 3,
    })
      .then((dataSource: any) => {
        viewer.dataSources.add(dataSource);

        // Extrude buildings if they exist in the GeoJSON payload
        const entities = dataSource.entities.values;
        let boundsBox: any[] = [];

        for (let i = 0; i < entities.length; i++) {
          const entity = entities[i];
          const height = entity.properties?.hojd?.getValue() || entity.properties?.height?.getValue() || 6.0;
          
          if (entity.polygon) {
            entity.polygon.material = Cesium.Color.fromCssColorString('#CBD5E1').withAlpha(0.85);
            entity.polygon.outline = true;
            entity.polygon.outlineColor = Cesium.Color.DARKGRAY;
            entity.polygon.extrudedHeight = height;
          }
        }

        viewer.zoomTo(dataSource);
      })
      .catch((err: any) => {
        console.error('Cesium GeoJSON load error:', err);
      });
  }, [geoJsonData, cesiumLoaded]);

  // Handle Permits visualization (bifall/avslag pins in 3D)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !cesiumLoaded || !permits.length) return;

    const Cesium = (window as any).Cesium;

    permits.forEach((permit) => {
      if (!permit.lat || !permit.lng) return;
      const isApproved = permit.decision_type === 'BIFALL' || permit.decision_type === 'APPROVED';
      const color = isApproved ? Cesium.Color.GREEN : Cesium.Color.RED;

      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(permit.lng, permit.lat, 10.0),
        point: {
          pixelSize: 12,
          color: color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        label: {
          text: permit.property_id || 'Fastighet',
          font: '10px sans-serif',
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          pixelOffset: new Cesium.Cartesian2(15, 0),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
      });
    });
  }, [permits, cesiumLoaded]);

  return (
    <div className="relative w-full h-full min-h-[600px] rounded-3xl overflow-hidden bg-slate-950 border border-slate-800">
      {loading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md text-white">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-cyan-500" />
          <p className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-cyan-400">
            Initierar Cesium 3D-karta...
          </p>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full absolute inset-0" />
    </div>
  );
};

export default CesiumMapView;
