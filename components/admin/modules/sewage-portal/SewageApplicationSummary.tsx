/**
 * Sewage Application Summary
 * Final review before submission to municipality
 */

import React, { useState } from 'react';
import { CheckCircle, AlertCircle, FileText, Send } from 'lucide-react';
import type { SewageApplication, SewageProtectionProfile } from '../../../../types';
import './sewage-application-summary.css';

interface SewageApplicationSummaryProps {
  application: SewageApplication;
  protectionProfile: SewageProtectionProfile;
  municipalityCode: string;
  onSubmit: (referenceNumber: string) => void;
}

const SewageApplicationSummary: React.FC<SewageApplicationSummaryProps> = ({
  application,
  protectionProfile,
  municipalityCode,
  onSubmit,
}) => {
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!agreeTerms) {
      alert('Du måste acceptera villkoren för att skicka ansökan');
      return;
    }

    setIsSubmitting(true);
    try {
      // Submit application
      const response = await fetch(`/api/sewage/applications/${application.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application,
          protectionProfile,
          municipalityCode,
          projectId: application.projectId,
          situationPlanSVG: application.situationPlan?.url,
          crossSectionSVG: application.crossSection?.url,
        }),
      });

      if (response.ok) {
        const responseData = await response.json();
        const referenceNumber = responseData.referenceNumber || `AVLOPP-${Date.now()}`;
        localStorage.setItem('sewage-application-ref', referenceNumber);
        onSubmit(referenceNumber);
      } else {
        alert('Fel vid inskickning. Försök igen.');
      }
    } catch (error) {
      console.error('Submission error:', error);
      alert('Fel vid inskickning. Försök igen.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getSystemName = (): string => {
    const systemNames: Record<string, string> = {
      CLOSED_TANK: 'Sluten tank',
      INFILTRATION: 'Infiltrationssystem',
      SOIL_BED: 'Markbädd (rotozonsystem)',
      MINI_PLANT_BDTA: 'Minireningsverk (BDTA)',
      MINI_PLANT_BDT: 'Minireningsverk (BDT)',
      PHOSPHORUS_TRAP: 'Fosforfälla',
    };
    return systemNames[application.selectedSystemType] || application.selectedSystemType;
  };

  return (
    <div className="sewage-application-summary">
      <div className="module-header">
        <h1 className="module-title">Granskning Innan Inskickning</h1>
        <p className="module-subtitle">
          Verifiera att allt är korrekt innan du skickar ansökan till kommunen
        </p>
      </div>

      {/* Summary Sections */}
      <div className="sewage-summary-sections">
        {/* Property Information */}
        <div className="sewage-summary-card">
          <h3>📋 Fastighetsuppgifter</h3>
          <div className="sewage-summary-field">
            <span className="sewage-summary-label">Fastighetsbeteckning:</span>
            <span className="sewage-summary-value">{application.propertyDesignation}</span>
          </div>
          <div className="sewage-summary-field">
            <span className="sewage-summary-label">Person Equivalents (PE):</span>
            <span className="sewage-summary-value">{application.pe}</span>
          </div>
          <div className="sewage-summary-field">
            <span className="sewage-summary-label">Kommun:</span>
            <span className="sewage-summary-value">{municipalityCode}</span>
          </div>
        </div>

        {/* Environmental Status */}
        <div className="sewage-summary-card">
          <h3>🌍 Miljöstatus</h3>
          <div className="sewage-summary-field">
            <span className="sewage-summary-label">Skyddsnivå:</span>
            <span className={`sewage-summary-badge ${protectionProfile.protectionLevel.toLowerCase()}`}>
              {protectionProfile.protectionLevel === 'HIGH'
                ? '🔴 Högt skyddad område'
                : '🟢 Normal skyddsnivå'}
            </span>
          </div>
          <div className="sewage-summary-field">
            <span className="sewage-summary-label">Närmaste brunn:</span>
            <span className="sewage-summary-value">{protectionProfile.nearestWell.distance}m</span>
          </div>
          <div className="sewage-summary-field">
            <span className="sewage-summary-label">Avstånd till tomtgräns:</span>
            <span className="sewage-summary-value">{protectionProfile.distanceToPropertyLine}m</span>
          </div>
        </div>

        {/* Soil Information */}
        <div className="sewage-summary-card">
          <h3>🏞️ Jordförhållanden</h3>
          <div className="sewage-summary-field">
            <span className="sewage-summary-label">Jordtyp:</span>
            <span className="sewage-summary-value">{protectionProfile.soilProfile.soilType}</span>
          </div>
          <div className="sewage-summary-field">
            <span className="sewage-summary-label">Infiltrationskapacitet:</span>
            <span className="sewage-summary-value">{protectionProfile.soilProfile.infiltrationCapacity}</span>
          </div>
          <div className="sewage-summary-field">
            <span className="sewage-summary-label">Grundvattennivå:</span>
            <span className="sewage-summary-value">{protectionProfile.soilProfile.groundwaterLevel}m</span>
          </div>
        </div>

        {/* Selected System */}
        <div className="sewage-summary-card">
          <h3>🔧 Valt System</h3>
          <div className="sewage-summary-field">
            <span className="sewage-summary-label">Systemtyp:</span>
            <span className="sewage-summary-value">{getSystemName()}</span>
          </div>
          {application.soilTestCompleted && (
            <div className="sewage-summary-field">
              <span className="sewage-summary-label">LTAR (Markundersökning):</span>
              <span className="sewage-summary-value">{application.ltar} mm/h</span>
            </div>
          )}
        </div>

        {/* Completeness Checklist */}
        <div className="sewage-summary-card sewage-checklist-card">
          <h3>✓ Färdigställelse</h3>

          <div className="sewage-checklist-item">
            <CheckCircle size={18} color="#4CAF50" />
            <span>Skyddsnivå-bedömning</span>
          </div>

          <div className={`sewage-checklist-item ${application.soilTestCompleted ? 'completed' : 'pending'}`}>
            {application.soilTestCompleted ? (
              <CheckCircle size={18} color="#4CAF50" />
            ) : (
              <AlertCircle size={18} color="#ff9800" />
            )}
            <span>Markundersökning</span>
          </div>

          <div
            className={`sewage-checklist-item ${application.neighborConsentObtained || !application.neighborConsentRequired ? 'completed' : 'pending'}`}
          >
            {application.neighborConsentObtained || !application.neighborConsentRequired ? (
              <CheckCircle size={18} color="#4CAF50" />
            ) : (
              <AlertCircle size={18} color="#ff9800" />
            )}
            <span>Grannemedgivande</span>
          </div>

          <div className={`sewage-checklist-item ${application.situationPlan ? 'completed' : 'pending'}`}>
            {application.situationPlan ? (
              <CheckCircle size={18} color="#4CAF50" />
            ) : (
              <AlertCircle size={18} color="#ff9800" />
            )}
            <span>Dokumentation (Situationsplan)</span>
          </div>

          <div className={`sewage-checklist-item ${application.crossSection ? 'completed' : 'pending'}`}>
            {application.crossSection ? (
              <CheckCircle size={18} color="#4CAF50" />
            ) : (
              <AlertCircle size={18} color="#ff9800" />
            )}
            <span>Dokumentation (Tvärsektion)</span>
          </div>
        </div>

        {/* Legal Compliance */}
        <div className="sewage-summary-card sewage-legal-card">
          <h3>📜 Juridisk Överensstämmelse</h3>

          <div className="sewage-legal-item">
            <strong>Miljöbalken och FMH</strong>
            <p>✓ Ansökan utgår från miljöbalken och förordningen om miljöfarlig verksamhet och hälsoskydd</p>
          </div>

          <div className="sewage-legal-item">
            <strong>HVMFS 2016:17</strong>
            <p>✓ Systemval och platsbedömning är kopplade till HaV:s råd om små avloppsanordningar</p>
          </div>

          {protectionProfile.protectionLevel === 'HIGH' && (
            <div className="sewage-legal-item">
              <strong>Högt skyddad område</strong>
              <p>⚠️ Omfattas av strängare miljökrav – länstyrelsen kan behöva konsulteras</p>
            </div>
          )}

          <div className="sewage-legal-item">
            <strong>Vattendirektivet (2000/60/EG)</strong>
            <p>✓ Systemet minimerar påverkan på vattenmiljön</p>
          </div>
        </div>
      </div>

      {/* Terms & Conditions */}
      <div className="sewage-summary-terms">
        <label className="sewage-terms-checkbox">
          <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
          <span>
            Jag bekräftar att all information i denna ansökan är korrekt och fullständig. Jag är medveten om
             att felaktig eller vilseledande information kan få juridiska konsekvenser. Ansökan kommer att
             behandlas enligt miljöbalken, FMH och HVMFS 2016:17.
          </span>
        </label>
      </div>

      {/* Documents Preview */}
      <div className="sewage-summary-documents">
        <h3>📄 Bifogade Dokument</h3>
        <div className="sewage-documents-grid">
          <div className="sewage-document-item">
            <FileText size={32} color="#0066cc" />
            <p>Situationsplan (SVG/PDF)</p>
            <p className="sewage-document-status">
              {application.situationPlan ? '✓ Genererad' : '⏳ Väntande'}
            </p>
          </div>
          <div className="sewage-document-item">
            <FileText size={32} color="#0066cc" />
            <p>Tvärsektion (SVG/PDF)</p>
            <p className="sewage-document-status">
              {application.crossSection ? '✓ Genererad' : '⏳ Väntande'}
            </p>
          </div>
          <div className="sewage-document-item">
            <FileText size={32} color="#0066cc" />
            <p>Prestandadeklaration</p>
            <p className="sewage-document-status">
              {application.performanceDeclaration ? '✓ Länkad' : '⏳ Väntande'}
            </p>
          </div>
        </div>
      </div>

      {/* Submission Button */}
      <div className="sewage-summary-actions">
        <button
          className="sewage-button sewage-button-primary sewage-button-large"
          onClick={handleSubmit}
          disabled={!agreeTerms || isSubmitting}
        >
          {isSubmitting ? (
            <>
              <span className="sewage-spinner" />
              Skickar...
            </>
          ) : (
            <>
              <Send size={18} />
              Skicka Ansökan till Kommun
            </>
          )}
        </button>

        <p className="sewage-submission-info">
          ℹ️ Efter inskickning kommer kommunen att granska din ansökan och kontakta dig om kompletteringar
          behövs. Beräknad handläggningstid: {protectionProfile.timelineEstimateWeeks} veckor.
        </p>
      </div>

      {/* Legal References */}
      <div className="sewage-summary-references">
        <h4>Juridiska Referenser</h4>
        <ul>
          <li>
            <strong>Miljöbalken (1998:808)</strong>
          </li>
          <li>
            <strong>Förordningen (1998:899) om miljöfarlig verksamhet och hälsoskydd</strong>
          </li>
          <li>
            <strong>Havs- och vattenmyndighetens allmänna råd</strong> (HVMFS 2016:17): Små avloppsanordningar
          </li>
          <li>
            <strong>Domstolsverket / MÖD praxis</strong>: Praxis för plats- och teknikbedömning
          </li>
          <li>
            <strong>Länsstyrelsens vägledning</strong>: Regional tillämpning och skyddsnivå
          </li>
          <li>
            <strong>Dataportalen och geodata</strong>: Platsdata för brunnar, recipienter och skyddsområden
          </li>
        </ul>
      </div>
    </div>
  );
};

export default SewageApplicationSummary;
