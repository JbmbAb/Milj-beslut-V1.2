/**
 * Sewage Requirement Checklist
 * Dynamically generated checklist of legal requirements based on system type and location
 */

import React, { useMemo, useState } from 'react';
import { CheckCircle, AlertCircle, Clock } from 'lucide-react';
import type { SewageSystemTypeId } from '../../../../types';
import { generateSewageRequirementChecklist } from '../../../../server/services/sewageRegulationsService';
import './sewage-requirements.css';

interface SewageRequirementChecklistProps {
  systemType: SewageSystemTypeId;
  protectionLevel: 'NORMAL' | 'HIGH';
  municipalityCode: string;
  distanceData?: {
    toWell?: number;
    toPropertyLine?: number;
    toWaterCourse?: number;
    toNeighborWell?: number;
  };
  onCompleted?: () => void;
}

const SewageRequirementChecklist: React.FC<SewageRequirementChecklistProps> = ({
  systemType,
  protectionLevel,
  municipalityCode,
  distanceData,
  onCompleted,
}) => {
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());

  const requirements = useMemo(() => {
    return generateSewageRequirementChecklist(systemType, protectionLevel, municipalityCode, distanceData);
  }, [systemType, protectionLevel, municipalityCode, distanceData]);

  const toggleRequirement = (id: string) => {
    const newCompleted = new Set(completedItems);
    if (newCompleted.has(id)) {
      newCompleted.delete(id);
    } else {
      newCompleted.add(id);
    }
    setCompletedItems(newCompleted);
  };

  const progressPercentage = Math.round((completedItems.size / requirements.length) * 100);
  const allCompleted = completedItems.size === requirements.length;

  const categorizedRequirements = {
    DISTANCE: requirements.filter((r) => r.category === 'DISTANCE'),
    SOIL: requirements.filter((r) => r.category === 'SOIL'),
    NEIGHBOR: requirements.filter((r) => r.category === 'NEIGHBOR'),
    DESIGN: requirements.filter((r) => r.category === 'DESIGN'),
    DOCUMENT: requirements.filter((r) => r.category === 'DOCUMENT'),
  };

  return (
    <div className="sewage-requirement-checklist">
      <div className="module-header">
        <h1 className="module-title">Juridiska krav & Checklista</h1>
        <p className="module-subtitle">
          {requirements.length} krav genererade baserat på {systemType},{' '}
          {protectionLevel === 'HIGH' ? 'högt skyddad' : 'normal'} skyddsnivå
        </p>
      </div>

      {/* Progress Bar */}
      <div className="sewage-checklist-progress">
        <div className="sewage-progress-fill" style={{ width: `${progressPercentage}%` }}>
          {progressPercentage}%
        </div>
        <p className="sewage-progress-text">
          {completedItems.size} av {requirements.length} krav färdigställda
        </p>
      </div>

      {/* Category Sections */}
      <div className="sewage-checklist-categories">
        {/* Distance Requirements */}
        {categorizedRequirements.DISTANCE.length > 0 && (
          <div className="sewage-requirement-category">
            <h3 className="sewage-category-title">📍 Avståndskrav</h3>
            <div className="sewage-requirement-items">
              {categorizedRequirements.DISTANCE.map((req) => (
                <div
                  key={req.id}
                  className={`sewage-requirement-item ${
                    completedItems.has(req.id) ? 'completed' : ''
                  } ${req.status === 'BLOCKED' ? 'blocked' : ''}`}
                  onClick={() => req.status !== 'BLOCKED' && toggleRequirement(req.id)}
                >
                  <div className="sewage-requirement-checkbox">
                    {completedItems.has(req.id) && <CheckCircle size={20} color="#4CAF50" />}
                    {!completedItems.has(req.id) && req.status === 'BLOCKED' && (
                      <AlertCircle size={20} color="#f44336" />
                    )}
                    {!completedItems.has(req.id) && req.status !== 'BLOCKED' && (
                      <div className="sewage-checkbox-empty" />
                    )}
                  </div>
                  <div className="sewage-requirement-content">
                    <p className="sewage-requirement-text">{req.requirement}</p>
                    <p className="sewage-requirement-reason">{req.reason}</p>
                    {req.blockingFactor && (
                      <p className="sewage-requirement-blocker">⚠️ {req.blockingFactor}</p>
                    )}
                    <p className="sewage-requirement-reference">
                      Referens: {req.relatedMunicipalCode || req.sourceTracing.source}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Soil Requirements */}
        {categorizedRequirements.SOIL.length > 0 && (
          <div className="sewage-requirement-category">
            <h3 className="sewage-category-title">🏞️ Markundersökning</h3>
            <div className="sewage-requirement-items">
              {categorizedRequirements.SOIL.map((req) => (
                <div
                  key={req.id}
                  className={`sewage-requirement-item ${completedItems.has(req.id) ? 'completed' : ''}`}
                  onClick={() => toggleRequirement(req.id)}
                >
                  <div className="sewage-requirement-checkbox">
                    {completedItems.has(req.id) && <CheckCircle size={20} color="#4CAF50" />}
                    {!completedItems.has(req.id) && <div className="sewage-checkbox-empty" />}
                  </div>
                  <div className="sewage-requirement-content">
                    <p className="sewage-requirement-text">{req.requirement}</p>
                    <p className="sewage-requirement-reason">{req.reason}</p>
                    <p className="sewage-requirement-reference">Havs- och vattenmyndigheten HVMFS 2016:17</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Neighbor Requirements */}
        {categorizedRequirements.NEIGHBOR.length > 0 && (
          <div className="sewage-requirement-category">
            <h3 className="sewage-category-title">👥 Grannskapsrätter</h3>
            <div className="sewage-requirement-items">
              {categorizedRequirements.NEIGHBOR.map((req) => (
                <div
                  key={req.id}
                  className={`sewage-requirement-item ${
                    completedItems.has(req.id) ? 'completed' : ''
                  } ${req.status === 'BLOCKED' ? 'blocked' : ''}`}
                  onClick={() => req.status !== 'BLOCKED' && toggleRequirement(req.id)}
                >
                  <div className="sewage-requirement-checkbox">
                    {completedItems.has(req.id) && <CheckCircle size={20} color="#4CAF50" />}
                    {!completedItems.has(req.id) && req.status === 'BLOCKED' && (
                      <AlertCircle size={20} color="#ff9800" />
                    )}
                    {!completedItems.has(req.id) && req.status !== 'BLOCKED' && (
                      <div className="sewage-checkbox-empty" />
                    )}
                  </div>
                  <div className="sewage-requirement-content">
                    <p className="sewage-requirement-text">{req.requirement}</p>
                    <p className="sewage-requirement-reason">{req.reason}</p>
                    {req.status === 'BLOCKED' && (
                      <p className="sewage-requirement-warning">
                        ⚠️ Obligatorisk – måste slutföras innan inskickning
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Design Requirements */}
        {categorizedRequirements.DESIGN.length > 0 && (
          <div className="sewage-requirement-category">
            <h3 className="sewage-category-title">🏗️ Konstruktionskrav</h3>
            <div className="sewage-requirement-items">
              {categorizedRequirements.DESIGN.map((req) => (
                <div
                  key={req.id}
                  className={`sewage-requirement-item ${completedItems.has(req.id) ? 'completed' : ''}`}
                  onClick={() => toggleRequirement(req.id)}
                >
                  <div className="sewage-requirement-checkbox">
                    {completedItems.has(req.id) && <CheckCircle size={20} color="#4CAF50" />}
                    {!completedItems.has(req.id) && <div className="sewage-checkbox-empty" />}
                  </div>
                  <div className="sewage-requirement-content">
                    <p className="sewage-requirement-text">{req.requirement}</p>
                    <p className="sewage-requirement-reason">{req.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="sewage-checklist-summary">
        {allCompleted ? (
          <div className="sewage-summary-success">
            <CheckCircle size={32} color="#4CAF50" />
            <p>✓ Alla krav uppfyllda! Du kan gå vidare till dokumentgenerering.</p>
            <button className="sewage-button sewage-button-primary" onClick={onCompleted}>
              Nästa: Generera dokument
            </button>
          </div>
        ) : (
          <div className="sewage-summary-pending">
            <Clock size={32} color="#ff9800" />
            <p>Slutför alla markerade krav innan ansökan kan skickas in.</p>
            <p className="sewage-summary-detail">Kvar: {requirements.length - completedItems.size} krav</p>
          </div>
        )}
      </div>

      {/* Legal Reference */}
      <div className="sewage-legal-reference">
        <h4>Juridiska referenser</h4>
        <ul>
          <li>Miljöbalken (1998:808), Kapitel 32</li>
          <li>Havs- och vattenmyndighetens allmänna råd (HVMFS 2016:17)</li>
          <li>Domstolsverket / MÖD praxis</li>
          <li>Länsstyrelsens regionala vägledning</li>
          <li>Dataportalens platsbundna underlag (brunnar, recipienter, skyddsområden)</li>
          <li>Vattendirektivet (2000/60/EG)</li>
        </ul>
      </div>
    </div>
  );
};

export default SewageRequirementChecklist;
