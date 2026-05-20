/**
 * Sewage Risk Panel
 * Visualizes environmental risks and soil conditions
 */

import React from 'react';
import { AlertTriangle, Droplets, Zap } from 'lucide-react';
import type { SewageGISAnalysis, SewageProtectionProfile } from '../../../../types';
import './sewage-risk-panel.css';

interface SewageRiskPanelProps {
  analysis: SewageGISAnalysis;
  protectionProfile: SewageProtectionProfile;
}

const SewageRiskPanel: React.FC<SewageRiskPanelProps> = ({ analysis, protectionProfile }) => {
  const getRiskColor = (score: number): string => {
    if (score < 30) return '#4CAF50'; // Green
    if (score < 60) return '#ff9800'; // Orange
    return '#f44336'; // Red
  };

  const getRiskLabel = (score: number): string => {
    if (score < 30) return 'Låg risk';
    if (score < 60) return 'Medel risk';
    return 'Hög risk';
  };

  const getInfiltrationCapacityColor = (capacity: string): string => {
    if (capacity === 'HIGH') return '#4CAF50';
    if (capacity === 'MEDIUM') return '#ff9800';
    return '#f44336';
  };

  return (
    <div className="sewage-risk-panel">
      <h2 className="sewage-risk-title">Miljörisk & Jordförhållanden</h2>

      {/* Risk Score Gauges */}
      <div className="sewage-risk-gauges">
        {/* Overall Risk Score */}
        <div className="sewage-gauge">
          <div
            className="sewage-gauge-circle"
            style={{
              background: `conic-gradient(${getRiskColor(analysis.overallRiskScore)} 0% ${analysis.overallRiskScore}%, #f0f0f0 ${analysis.overallRiskScore}% 100%)`,
            }}
          >
            <div className="sewage-gauge-inner">
              <span className="sewage-gauge-value">{analysis.overallRiskScore}</span>
              <span className="sewage-gauge-label">Risk-poäng</span>
            </div>
          </div>
          <p className="sewage-gauge-status" style={{ color: getRiskColor(analysis.overallRiskScore) }}>
            {getRiskLabel(analysis.overallRiskScore)}
          </p>
        </div>

        {/* Feasibility Score */}
        <div className="sewage-gauge">
          <div
            className="sewage-gauge-circle"
            style={{
              background: `conic-gradient(#0066cc 0% ${analysis.feasibilityScore}%, #f0f0f0 ${analysis.feasibilityScore}% 100%)`,
            }}
          >
            <div className="sewage-gauge-inner">
              <span className="sewage-gauge-value">{analysis.feasibilityScore}</span>
              <span className="sewage-gauge-label">Lämplighet</span>
            </div>
          </div>
          <p
            className="sewage-gauge-status"
            style={{ color: analysis.feasibilityScore > 60 ? '#4CAF50' : '#ff9800' }}
          >
            {analysis.feasibilityScore > 60 ? 'Lämplig' : 'Begränsad'}
          </p>
        </div>
      </div>

      {/* Soil Profile */}
      <div className="sewage-soil-profile">
        <h3>🏞️ Jordprofil</h3>

        <div className="sewage-soil-item">
          <label>Jordtyp:</label>
          <span className="sewage-soil-value">{protectionProfile.soilProfile.soilType}</span>
        </div>

        <div className="sewage-soil-item">
          <label>Infiltrationskapacitet:</label>
          <span
            className="sewage-soil-value sewage-capacity-badge"
            style={{
              background: getInfiltrationCapacityColor(protectionProfile.soilProfile.infiltrationCapacity),
            }}
          >
            {protectionProfile.soilProfile.infiltrationCapacity === 'HIGH'
              ? '✓ Högt'
              : protectionProfile.soilProfile.infiltrationCapacity === 'MEDIUM'
                ? '⚠ Medel'
                : '✗ Lågt'}
          </span>
        </div>

        <div className="sewage-soil-visual">
          <div className="sewage-soil-layer" style={{ height: '80px' }}>
            <span className="sewage-layer-label">Jord: {protectionProfile.soilProfile.soilType}</span>
            <span className="sewage-layer-depth">GVN: {protectionProfile.soilProfile.groundwaterLevel}m</span>
          </div>
          <div className="sewage-soil-layer sewage-water-table" style={{ height: '40px' }}>
            <Droplets size={16} />
            <span>Grundvatten</span>
          </div>
          <div
            className="sewage-soil-layer sewage-rock"
            style={{ height: `${Math.min(100, protectionProfile.soilProfile.depthToRock * 30)}px` }}
          >
            <span className="sewage-layer-label">
              Berg (djup: {protectionProfile.soilProfile.depthToRock}m)
            </span>
          </div>
        </div>

        <div className="sewage-soil-item">
          <label>Permeabilitet:</label>
          <span className="sewage-soil-value">{protectionProfile.soilProfile.permeability} mm/h</span>
        </div>
      </div>

      {/* Environmental Risks */}
      <div className="sewage-environmental-risks">
        <h3>⚠️ Miljörisker</h3>

        {/* Flood Risk */}
        <div className="sewage-risk-item">
          <div className="sewage-risk-header">
            <Zap size={18} color="#ff9800" />
            <span>Översvämningsrisk</span>
          </div>
          <p className="sewage-risk-description">
            Område klassificerat som {protectionProfile.floodRisk.toLowerCase()} översvämningsrisk
          </p>
          {protectionProfile.floodRisk === 'HIGH' && (
            <div className="sewage-risk-warning">
              ⚠️ Höga risker – systemet måste dimensioneras för att tåla översvämning
            </div>
          )}
        </div>

        {/* Protected Nature */}
        <div className="sewage-risk-item">
          <div className="sewage-risk-header">
            <AlertTriangle
              size={18}
              color={protectionProfile.protectedNatureNearby ? '#f44336' : '#4CAF50'}
            />
            <span>Skyddad natur</span>
          </div>
          <p className="sewage-risk-description">
            {protectionProfile.protectedNatureNearby
              ? `${analysis.protectedAreas[0]?.name || 'Naturvårdsområde'} ligger ${analysis.protectedAreas[0]?.distance || 0}m från fastigheten`
              : 'Ingen närliggande skyddad natur identifierad'}
          </p>
        </div>

        {/* Well Distance */}
        <div className="sewage-risk-item">
          <div className="sewage-risk-header">
            <Droplets size={18} color={protectionProfile.nearestWell.distance < 50 ? '#f44336' : '#4CAF50'} />
            <span>Brunnsavstånd</span>
          </div>
          <p className="sewage-risk-description">
            Närmaste brunn: {protectionProfile.nearestWell.distance}m
            {protectionProfile.nearestWell.owner === 'NEIGHBOR' && ' (Grannens brunn)'}
          </p>
          {protectionProfile.nearestWell.distance < 50 && (
            <div className="sewage-risk-warning">
              ⚠️ Avståndet är mindre än rekommenderat 50m – markbädd/infiltration kan vara begränsad
            </div>
          )}
        </div>
      </div>

      {/* Reasoning */}
      <div className="sewage-reasoning">
        <h3>📋 Analysbeslut</h3>
        {analysis.reasoning.map((reason, idx) => (
          <div key={idx} className="sewage-reasoning-item">
            <span className="sewage-reasoning-marker">→</span>
            <p>{reason}</p>
          </div>
        ))}
      </div>

      {/* Recommendations */}
      <div className="sewage-recommendations">
        <h3>💡 Rekommendationer</h3>
        {analysis.recommendedSystems.length > 0 && (
          <>
            <p>
              <strong>Lämpliga system:</strong>
            </p>
            <ul>
              {analysis.recommendedSystems.map((sys) => (
                <li key={sys}>✓ {sys}</li>
              ))}
            </ul>
          </>
        )}
        {analysis.blockedSystems.length > 0 && (
          <>
            <p>
              <strong>Blockerade system:</strong>
            </p>
            <ul>
              {analysis.blockedSystems.map((sys) => (
                <li key={sys} className="sewage-blocked-system">
                  ✗ {sys}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};

export default SewageRiskPanel;
