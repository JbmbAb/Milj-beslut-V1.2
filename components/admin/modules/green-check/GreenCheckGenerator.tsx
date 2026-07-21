/**
 * Green Check Generator
 * Simple interface for banks to input organization number and get ESG assessment
 */

import React, { useState } from 'react';
import { Wand2, Loader } from 'lucide-react';
import { useGreenCheckGenerator } from '../../hooks/useGreenCheckGenerator';
import { ErrorAlert, LoadingSpinner } from '../../shared';
import './green-check-generator.css';

export interface GreenCheckGeneratorProps {
  onAssessmentGenerated?: (assessment: any) => void;
}

const GreenCheckGenerator: React.FC<GreenCheckGeneratorProps> = ({ onAssessmentGenerated }) => {
  const [organizationNumber, setOrganizationNumber] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [investmentAmount, setInvestmentAmount] = useState('');
  const [sector, setSector] = useState('renewable_energy');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = useGreenCheckGenerator({
    onSuccess: (assessment) => {
      setError(null);
      onAssessmentGenerated?.(assessment);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleGenerate = () => {
    if (!organizationNumber.trim()) {
      setError('Organisationsnummer krävs');
      return;
    }
    if (!projectDescription.trim()) {
      setError('Projektbeskrivning krävs');
      return;
    }

    setError(null);
    mutate({
      organizationNumber: organizationNumber.trim(),
      organizationName: organizationName.trim(),
      projectDescription: projectDescription.trim(),
      investmentAmount: investmentAmount ? Number(investmentAmount) : undefined,
      sector,
      latitude: latitude ? Number(latitude) : undefined,
      longitude: longitude ? Number(longitude) : undefined,
    });
  };

  return (
    <div className="green-check-generator-container">
      {error && <ErrorAlert message={error} severity="error" onDismiss={() => setError(null)} />}

      <div className="green-check-generator-form">
        <h2 className="green-check-generator-title">🌿 Grönkoll för Banker</h2>
        <p className="green-check-generator-subtitle">
          Generera ESG-bedömning och regulatorisk riskanalys enligt EU-normer
        </p>

        {/* Organization Number - REQUIRED */}
        <div className="green-check-form-group">
          <label htmlFor="org-number">
            Organisationsnummer <span className="required">*</span>
          </label>
          <input
            id="org-number"
            type="text"
            placeholder="12345678-9012"
            value={organizationNumber}
            onChange={(e) => setOrganizationNumber(e.target.value)}
            disabled={isPending}
            className="green-check-input"
          />
          <small>Format: NNNNNNNN-NNNN</small>
        </div>

        {/* Organization Name - OPTIONAL */}
        <div className="green-check-form-group">
          <label htmlFor="org-name">Organisationsnamn</label>
          <input
            id="org-name"
            type="text"
            placeholder="t.ex. Solkraft AB"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            disabled={isPending}
            className="green-check-input"
          />
        </div>

        {/* Project Description - REQUIRED */}
        <div className="green-check-form-group">
          <label htmlFor="project-desc">
            Projektbeskrivning <span className="required">*</span>
          </label>
          <textarea
            id="project-desc"
            placeholder="Beskriv investeringsprojektet, aktiviteter och förväntade miljöeffekter..."
            value={projectDescription}
            onChange={(e) => setProjectDescription(e.target.value)}
            disabled={isPending}
            className="green-check-textarea"
            rows={6}
          />
        </div>

        {/* Sector */}
        <div className="green-check-form-group">
          <label htmlFor="sector">Sektor</label>
          <select
            id="sector"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            disabled={isPending}
            className="green-check-select"
          >
            <option value="renewable_energy">Förnybar energi</option>
            <option value="construction">Byggnad & möjliggörande aktiviteter</option>
            <option value="manufacturing">Tillverkning</option>
            <option value="transport">Transporter & logistik</option>
            <option value="water">Vatten & avloppshantering</option>
            <option value="circular_economy">Cirkulär ekonomi</option>
            <option value="agriculture">Jordbruk & skogsbruk</option>
            <option value="other">Annan</option>
          </select>
        </div>

        {/* Investment Amount - OPTIONAL */}
        <div className="green-check-form-group">
          <label htmlFor="investment">Investeringsbelopp (SEK)</label>
          <input
            id="investment"
            type="number"
            placeholder="t.ex. 5000000"
            value={investmentAmount}
            onChange={(e) => setInvestmentAmount(e.target.value)}
            disabled={isPending}
            className="green-check-input"
          />
        </div>

        {/* Coordinates - OPTIONAL */}
        <div className="green-check-form-row">
          <div className="green-check-form-group">
            <label htmlFor="lat">Latitud</label>
            <input
              id="lat"
              type="number"
              step="0.0001"
              placeholder="59.3293"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              disabled={isPending}
              className="green-check-input"
            />
          </div>
          <div className="green-check-form-group">
            <label htmlFor="lng">Longitud</label>
            <input
              id="lng"
              type="number"
              step="0.0001"
              placeholder="18.0686"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              disabled={isPending}
              className="green-check-input"
            />
          </div>
        </div>

        {/* Generate Button */}
        <button onClick={handleGenerate} disabled={isPending} className="green-check-btn-generate">
          {isPending ? (
            <>
              <Loader size={20} className="spinner" />
              Genererar bedömning...
            </>
          ) : (
            <>
              <Wand2 size={20} />
              Generera Grönkoll-bedömning
            </>
          )}
        </button>

        {isPending && (
          <LoadingSpinner message="AI analyserar projekt enligt EU-normer (Taxonomy, CSRD, Banking Directive)..." />
        )}
      </div>

      {/* Info box */}
      <div className="green-check-info-box">
        <h3>Vad bedöms?</h3>
        <ul>
          <li>
            <strong>ESG-klassificering</strong> – Environmental, Social, Governance-rating (AAA–D)
          </li>
          <li>
            <strong>EU Taxonomy</strong> – Hållbara aktiviteter enligt EU:s klassificering
          </li>
          <li>
            <strong>CSRD-rapportering</strong> – Krav på hållbarhetsrapportering från 2025
          </li>
          <li>
            <strong>Gröna finansieringsmöjligheter</strong> – Möjlighet för gröna lån/obligationer
          </li>
          <li>
            <strong>Regulatorisk risk</strong> – Compliance med EU Banking Directive & ECB-normer
          </li>
        </ul>
      </div>
    </div>
  );
};

export default GreenCheckGenerator;
