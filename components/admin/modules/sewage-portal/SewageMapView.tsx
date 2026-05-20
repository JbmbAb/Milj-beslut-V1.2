/**
 * Sewage Map View
 * Interactive map showing property boundaries, wells, water courses, and protected areas
 * Uses SVG canvas for visualization (would use Leaflet/Mapbox in production)
 */

import React from 'react';
import type { SewageGISAnalysis, SewageProtectionProfile } from '../../../../types';
import './sewage-map.css';

interface SewageMapViewProps {
  analysis: SewageGISAnalysis;
  protectionProfile: SewageProtectionProfile;
}

const SewageMapView: React.FC<SewageMapViewProps> = ({ analysis, protectionProfile }) => {
  const mapWidth = 800;
  const mapHeight = 600;

  // Normalize coordinates to map size
  const centerX = mapWidth / 2;
  const centerY = mapHeight / 2;
  const scale = 20; // pixels per meter (for visualization)

  // Helper to convert real-world coordinates to map coordinates
  const toMapCoords = (offsetX: number, offsetY: number) => ({
    x: centerX + offsetX * scale,
    y: centerY - offsetY * scale,
  });

  const propertyCorner1 = toMapCoords(-10, -10);
  const propertyCorner2 = toMapCoords(10, -10);
  const propertyCorner3 = toMapCoords(10, 10);
  const propertyCorner4 = toMapCoords(-10, 10);

  const wellCoords = toMapCoords(
    protectionProfile.nearestWell.coordinates.lng * 100,
    protectionProfile.nearestWell.coordinates.lat * 100,
  );

  const systemCoords = toMapCoords(5, 2);

  return (
    <div className="sewage-map-view">
      <div className="sewage-map-header">
        <h3>📍 Situationsöversikt</h3>
        <p className="sewage-map-subtitle">Fastighets läge, brunnar och skyddade områden</p>
      </div>

      <svg
        width={mapWidth}
        height={mapHeight}
        viewBox={`0 0 ${mapWidth} ${mapHeight}`}
        className="sewage-map-svg"
      >
        {/* Background */}
        <defs>
          <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#f0f0f0" strokeWidth="1" />
          </pattern>

          {/* Gradient for protected area */}
          <radialGradient id="protectedAreaGradient">
            <stop offset="0%" stopColor="#ffcccc" />
            <stop offset="100%" stopColor="#ffffff" />
          </radialGradient>
        </defs>

        {/* Grid background */}
        <rect width={mapWidth} height={mapHeight} fill="url(#grid)" />

        {/* Protected areas (if any) */}
        {protectionProfile.protectedNatureNearby && (
          <circle
            cx={centerX}
            cy={centerY}
            r={150}
            fill="url(#protectedAreaGradient)"
            stroke="#f44336"
            strokeWidth="2"
            strokeDasharray="5,5"
            opacity="0.6"
          />
        )}

        {/* Property boundary */}
        <polygon
          points={`${propertyCorner1.x},${propertyCorner1.y} ${propertyCorner2.x},${propertyCorner2.y} ${propertyCorner3.x},${propertyCorner3.y} ${propertyCorner4.x},${propertyCorner4.y}`}
          fill="#f5f5f5"
          stroke="#333"
          strokeWidth="3"
        />

        {/* Property label */}
        <text x={centerX} y={mapHeight - 30} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#333">
          Fastighet
        </text>

        {/* Water course (if nearby) */}
        {analysis.protectedAreas.length > 0 && (
          <>
            <path
              d={`M ${centerX - 100} ${mapHeight - 200} Q ${centerX} ${mapHeight - 150} ${centerX + 100} ${mapHeight - 100}`}
              fill="none"
              stroke="#0066cc"
              strokeWidth="4"
            />
            <text x={centerX + 120} y={mapHeight - 90} fontSize="11" fill="#0066cc">
              Vattendrag
            </text>
          </>
        )}

        {/* Nearest well */}
        <circle cx={wellCoords.x} cy={wellCoords.y} r="8" fill="none" stroke="#0066cc" strokeWidth="2" />
        <circle cx={wellCoords.x} cy={wellCoords.y} r="4" fill="#0066cc" />
        <text x={wellCoords.x + 15} y={wellCoords.y} fontSize="11" fill="#0066cc" fontWeight="bold">
          Brunn
        </text>

        {/* Distance line well to system */}
        <line
          x1={wellCoords.x}
          y1={wellCoords.y}
          x2={systemCoords.x}
          y2={systemCoords.y}
          stroke="#0066cc"
          strokeWidth="1"
          strokeDasharray="3,3"
        />
        <text
          x={(wellCoords.x + systemCoords.x) / 2}
          y={(wellCoords.y + systemCoords.y) / 2 - 10}
          fontSize="10"
          fill="#0066cc"
          fontWeight="bold"
        >
          {protectionProfile.nearestWell.distance}m
        </text>

        {/* Sewage system location */}
        <circle cx={systemCoords.x} cy={systemCoords.y} r="12" fill="none" stroke="#ff6600" strokeWidth="2" />
        <polygon
          points={`${systemCoords.x},${systemCoords.y - 8} ${systemCoords.x + 8},${systemCoords.y + 6} ${systemCoords.x - 8},${systemCoords.y + 6}`}
          fill="#ff6600"
        />
        <text x={systemCoords.x + 20} y={systemCoords.y} fontSize="11" fill="#ff6600" fontWeight="bold">
          Avlopp
        </text>

        {/* Property line distance indicator */}
        <line
          x1={propertyCorner2.x}
          y1={propertyCorner2.y}
          x2={propertyCorner2.x + 50}
          y2={propertyCorner2.y}
          stroke="#999"
          strokeWidth="1"
        />
        <text x={propertyCorner2.x + 55} y={propertyCorner2.y + 5} fontSize="10" fill="#999">
          {protectionProfile.distanceToPropertyLine}m
        </text>

        {/* North arrow */}
        <g transform={`translate(${mapWidth - 50}, 50)`}>
          <text x="0" y="0" fontSize="20" fontWeight="bold" fill="#333" textAnchor="middle">
            ↑ N
          </text>
        </g>

        {/* Scale bar */}
        <g transform={`translate(20, ${mapHeight - 40})`}>
          <line x1="0" y1="0" x2="100" y2="0" stroke="#333" strokeWidth="2" />
          <line x1="0" y1="-5" x2="0" y2="5" stroke="#333" strokeWidth="2" />
          <line x1="100" y1="-5" x2="100" y2="5" stroke="#333" strokeWidth="2" />
          <text x="50" y="15" fontSize="10" fill="#333" textAnchor="middle">
            100m
          </text>
        </g>
      </svg>

      {/* Legend */}
      <div className="sewage-map-legend">
        <div className="sewage-legend-item">
          <div className="sewage-legend-color" style={{ background: '#f5f5f5', border: '2px solid #333' }} />
          <span>Fastighetsgräns</span>
        </div>
        <div className="sewage-legend-item">
          <div className="sewage-legend-color" style={{ background: '#ff6600' }} />
          <span>Avloppsystemet</span>
        </div>
        <div className="sewage-legend-item">
          <div className="sewage-legend-color" style={{ background: '#0066cc' }} />
          <span>Brunn ({protectionProfile.nearestWell.distance}m)</span>
        </div>
        <div className="sewage-legend-item">
          <div className="sewage-legend-color" style={{ background: '#0066cc', height: '4px' }} />
          <span>Vattendrag</span>
        </div>
        {protectionProfile.protectedNatureNearby && (
          <div className="sewage-legend-item">
            <div
              className="sewage-legend-color"
              style={{ background: '#ffcccc', border: '2px dashed #f44336' }}
            />
            <span>Skyddad område</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="sewage-map-info">
        <p>
          <strong>Markbeteckning:</strong> {analysis.sguJordartData.soilType}
        </p>
        <p>
          <strong>Grundvattennivå:</strong> {analysis.sguJordartData.groundwaterLevel}m under mark
        </p>
        <p>
          <strong>Djup till berg:</strong> {analysis.sguJordartData.depthToRock}m
        </p>
        {protectionProfile.protectedNatureNearby && (
          <p>
            <strong>Skyddad område:</strong> {analysis.protectedAreas[0]?.name} (
            {analysis.protectedAreas[0]?.distance}m)
          </p>
        )}
      </div>
    </div>
  );
};

export default SewageMapView;
