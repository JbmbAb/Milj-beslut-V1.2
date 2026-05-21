import React from 'react';
import type { MassGISAnalysis, MassSiteProfile } from '../../../../types';
import './mass-map.css';

interface MassMapViewProps {
  analysis: MassGISAnalysis;
  siteProfile: MassSiteProfile;
}

const zoneColors: Record<string, string> = {
  MELLANLAGRING: '#6366f1',
  DEPONI: '#059669',
  TRANSIT: '#475569',
};

const MassMapView: React.FC<MassMapViewProps> = ({ analysis, siteProfile }) => {
  const mapWidth = 820;
  const mapHeight = 420;
  const centerX = mapWidth / 2;
  const centerY = mapHeight / 2;
  const scale = 2.2;

  const toMap = (offsetM: number, lateral = 0) => ({
    x: centerX + lateral * scale,
    y: centerY - offsetM * scale,
  });

  const propertySize = 90;
  const propertyX = centerX - propertySize / 2;
  const propertyY = centerY - propertySize / 2;

  return (
    <div className="mass-map-view">
      <div className="mass-map-header">
        <h3>Situationsöversikt — masslogistik</h3>
        <p className="mass-map-subtitle">
          {analysis.propertyDesignation}
          {analysis.municipalityName ? ` · ${analysis.municipalityName}` : ''}
          {analysis.markCover ? ` · ${analysis.markCover.description}` : ''}
        </p>
      </div>

      <svg width={mapWidth} height={mapHeight} viewBox={`0 0 ${mapWidth} ${mapHeight}`} className="mass-map-svg">
        <defs>
          <pattern id="mass-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8f0" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={mapWidth} height={mapHeight} fill="url(#mass-grid)" />

        <rect
          x={propertyX}
          y={propertyY}
          width={propertySize}
          height={propertySize}
          fill="#dbeafe"
          stroke="#2563eb"
          strokeWidth="2"
          rx="4"
        />
        <text x={centerX} y={centerY + 4} textAnchor="middle" fontSize="11" fill="#1e3a8a" fontWeight="700">
          Fastighet
        </text>

        {siteProfile.recommendedZones.map((zone) => {
          const point = toMap(zone.offsetM, zone.operationType === 'DEPONI' ? -18 : zone.operationType === 'MELLANLAGRING' ? 18 : 0);
          const color = zoneColors[zone.operationType] ?? '#64748b';
          return (
            <g key={zone.id}>
              <circle cx={point.x} cy={point.y} r="16" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="2" />
              <text x={point.x} y={point.y + 28} textAnchor="middle" fontSize="10" fill="#334155" fontWeight="600">
                {zone.label}
              </text>
            </g>
          );
        })}

        <text x={16} y={24} fontSize="11" fill="#64748b">
          Risk {analysis.overallRiskScore}/100 · {analysis.logisticsSuitability}
        </text>
      </svg>

      <div className="mass-map-legend">
        {siteProfile.recommendedZones.map((zone) => (
          <div key={zone.id} className="mass-map-legend-item">
            <span
              className="mass-map-legend-swatch"
              style={{ backgroundColor: zoneColors[zone.operationType] ?? '#64748b' }}
            />
            {zone.label}
          </div>
        ))}
      </div>
    </div>
  );
};

export default MassMapView;
