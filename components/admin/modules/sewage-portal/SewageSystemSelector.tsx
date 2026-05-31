/**
 * Sewage System Selector
 * Allows users to choose between different private sewage system types
 * Corresponds to: WasteCodeSelector in PermitPortal
 */

import React from 'react';
import { CheckCircle, AlertCircle, Lock } from 'lucide-react';
import type { SewageSystemType, SewageSystemTypeId } from '../../../../types';
import './sewage-system-selector.css';

export interface SewageSystemSelectorProps {
  selectedSystem: SewageSystemTypeId | null;
  recommendedSystems: SewageSystemTypeId[];
  blockedSystems: SewageSystemTypeId[];
  protectionLevel: 'NORMAL' | 'HIGH';
  pe: number; // Person equivalents (1-200)
  onSelect: (systemId: SewageSystemTypeId) => void;
}

const SEWAGE_SYSTEMS: Record<SewageSystemTypeId, SewageSystemType> = {
  CLOSED_TANK: {
    id: 'CLOSED_TANK',
    name: 'Sluten tank',
    description: 'Enkel lagring av avlopp. Kräver tömning. Skalbar för 1-200 PE.',
    type: 'STORAGE',
    requiresSoilTest: false,
    maxProtectionLevel: 'HIGH',
    requiredDistance: {
      toWell: 30,
      toWaterCourse: 20,
      toPropertyLine: 2,
      toNeighborWell: 30,
    },
    costPerPE: 3500, // SEK per PE
    baseCost: 10000,
    lifespan: 30,
    maintenanceInterval: 12,
  },

  INFILTRATION: {
    id: 'INFILTRATION',
    name: 'Infiltrationssystem',
    description: 'Avlopp infiltreras direkt i marken. Kräver god jordkvalitet. 1-50 PE.',
    type: 'TREATMENT',
    requiresSoilTest: true,
    maxProtectionLevel: 'NORMAL',
    requiredDistance: {
      toWell: 50,
      toWaterCourse: 10,
      toPropertyLine: 4.5,
      toNeighborWell: 50,
    },
    typicalLoadingRate: 40, // kg/m²/år
    areaPerPE: 1.5, // m² per PE
    costPerPE: 2500,
    baseCost: 5000,
    lifespan: 20,
    maintenanceInterval: 24,
  },

  SOIL_BED: {
    id: 'SOIL_BED',
    name: 'Markbädd (rotozonsystem)',
    description: 'Växtbädd med högre rening. Ofta använd för 5-80 PE.',
    type: 'TREATMENT',
    requiresSoilTest: true,
    maxProtectionLevel: 'NORMAL',
    requiredDistance: {
      toWell: 50,
      toWaterCourse: 5,
      toPropertyLine: 4.5,
      toNeighborWell: 50,
    },
    typicalLoadingRate: 25,
    areaPerPE: 3, // m² per PE
    costPerPE: 4000,
    baseCost: 15000,
    lifespan: 30,
    maintenanceInterval: 12,
  },

  MINI_PLANT_BDTA: {
    id: 'MINI_PLANT_BDTA',
    name: 'Minireningsverk (BDTA)',
    description:
      'Biologisk behandling med kemfällning. Högt reningsvärde, passar höga skyddsnivåer. 1-200 PE.',
    type: 'TREATMENT',
    requiresSoilTest: false,
    maxProtectionLevel: 'HIGH',
    requiredDistance: {
      toWell: 15,
      toWaterCourse: 10,
      toPropertyLine: 4.5,
      toNeighborWell: 15,
    },
    costPerPE: 5000,
    baseCost: 50000,
    lifespan: 25,
    maintenanceInterval: 6,
  },

  MINI_PLANT_BDT: {
    id: 'MINI_PLANT_BDT',
    name: 'Minireningsverk (BDT)',
    description: 'Biologisk behandling utan kemfällning. 1-150 PE.',
    type: 'TREATMENT',
    requiresSoilTest: false,
    maxProtectionLevel: 'NORMAL',
    requiredDistance: {
      toWell: 20,
      toWaterCourse: 10,
      toPropertyLine: 4.5,
      toNeighborWell: 20,
    },
    costPerPE: 4500,
    baseCost: 40000,
    lifespan: 25,
    maintenanceInterval: 6,
  },

  PHOSPHORUS_TRAP: {
    id: 'PHOSPHORUS_TRAP',
    name: 'Fosforfälla',
    description: 'Polering av redan behandlat avlopp. Additiv till andra system. 1-200 PE.',
    type: 'POLISHING',
    requiresSoilTest: false,
    maxProtectionLevel: 'HIGH',
    requiredDistance: {
      toWell: 10,
      toWaterCourse: 10,
      toPropertyLine: 2,
      toNeighborWell: 10,
    },
    costPerPE: 1000,
    baseCost: 8000,
    lifespan: 20,
    maintenanceInterval: 12,
  },
};

// Helper function to calculate cost based on PE
function calculateCost(system: SewageSystemType, pe: number): number {
  if (system.costPerPE && system.baseCost !== undefined) {
    return system.baseCost + system.costPerPE * pe;
  }
  return 0;
}

const SewageSystemSelector: React.FC<SewageSystemSelectorProps> = ({
  selectedSystem,
  recommendedSystems,
  blockedSystems,
  protectionLevel,
  pe,
  onSelect,
}) => {
  return (
    <div className="sewage-system-selector">
      <div className="sewage-system-header">
        <h2>Välj avloppsystem</h2>
        <p className="subtitle">
          För {pe} PE baserat på jordförhållanden och skyddsnivå (
          {protectionLevel === 'HIGH' ? 'Hög' : 'Normal'})
        </p>
      </div>

      <div className="sewage-system-grid">
        {Object.values(SEWAGE_SYSTEMS).map((system) => {
          const isRecommended = recommendedSystems.includes(system.id);
          const isBlocked = blockedSystems.includes(system.id);
          const isSelected = selectedSystem === system.id;
          const canBeSelected = !isBlocked;

          return (
            <div
              key={system.id}
              className={`sewage-system-card ${isSelected ? 'selected' : ''} ${
                isRecommended ? 'recommended' : ''
              } ${isBlocked ? 'blocked' : ''}`}
              onClick={() => canBeSelected && onSelect(system.id)}
              role="button"
              tabIndex={canBeSelected ? 0 : -1}
            >
              {/* Header with status */}
              <div className="sewage-system-card-header">
                <h3>{system.name}</h3>
                <div className="sewage-system-status">
                  {isBlocked && (
                    <div className="status-badge blocked">
                      <Lock size={16} />
                      <span>Blockerad</span>
                    </div>
                  )}
                  {isRecommended && !isBlocked && (
                    <div className="status-badge recommended">
                      <CheckCircle size={16} />
                      <span>Rekommenderad</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              <p className="sewage-system-description">{system.description}</p>

              {/* Key metrics - calculated based on PE */}
              <div className="sewage-system-metrics">
                <div className="metric">
                  <span className="label">Kostnad ({pe} PE)</span>
                  <span className="value">
                    {calculateCost(system, pe) > 0
                      ? `${(calculateCost(system, pe) / 1000).toFixed(0)} kkr`
                      : 'Variabel'}
                  </span>
                </div>
                <div className="metric">
                  <span className="label">Skyddsnivå</span>
                  <span className="value">{system.maxProtectionLevel === 'HIGH' ? 'Hög ✓' : 'Normal'}</span>
                </div>
                <div className="metric">
                  <span className="label">Underhål</span>
                  <span className="value">{system.maintenanceInterval} mån</span>
                </div>
              </div>

              {/* Distance requirements */}
              <div className="sewage-system-distances">
                <h4>Avståndskrav:</h4>
                <ul>
                  <li>Till brunn: {system.requiredDistance.toWell}m</li>
                  <li>Till vattendrag: {system.requiredDistance.toWaterCourse}m</li>
                  <li>Till tomtgräns: {system.requiredDistance.toPropertyLine}m</li>
                </ul>
              </div>

              {/* Soil test requirement */}
              {system.requiresSoilTest && (
                <div className="sewage-system-note">
                  <AlertCircle size={14} />
                  Kräver perkolationsprov (markundersökning)
                </div>
              )}

              {/* Block reason (if blocked) */}
              {isBlocked && (
                <div className="sewage-system-block-reason">
                  <strong>Orsak:</strong>
                  {protectionLevel === 'HIGH' &&
                    system.maxProtectionLevel === 'NORMAL' &&
                    ' Inte tillåtet i högt skyddat område'}
                  {blockedSystems.includes(system.id) && ' Jordförhållandena passar inte'}
                </div>
              )}

              {/* Area requirement (for treatment systems) */}
              {system.areaPerPE && (
                <div className="sewage-system-area">
                  <strong>Beräknad yta för {pe} PE:</strong> ~{(system.areaPerPE * pe).toFixed(0)} m²
                </div>
              )}

              {/* Selection indicator */}
              {isSelected && <div className="selection-checkmark">✓</div>}
            </div>
          );
        })}
      </div>

      {/* Protection level notice */}
      <div className={`sewage-protection-notice ${protectionLevel.toLowerCase()}`}>
        {protectionLevel === 'HIGH' ? (
          <>
            <AlertCircle size={18} />
            <div>
              <strong>Högt skyddad område</strong>
              <p>Fastigheten ligger i ett område med höga miljökrav. Endast vissa system är tillåtna.</p>
            </div>
          </>
        ) : (
          <>
            <CheckCircle size={18} />
            <div>
              <strong>Normal skyddsnivå</strong>
              <p>De flesta system är möjliga. Markundersökning avgör slutliga valet.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SewageSystemSelector;
