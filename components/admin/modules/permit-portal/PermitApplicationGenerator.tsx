/**
 * PermitApplicationGenerator – AI-driven permit application form
 * Input: Fastighetsbeteckning + SNI-kod → Output: Kompletta tillståndsansökningsförslag
 */

import React, { useState } from 'react';
import { Wand2, AlertCircle, CheckCircle, HelpCircle } from 'lucide-react';
import { usePermitApplicationGenerator } from '../../hooks/usePermitApplicationGenerator';
import './permit-application-generator.css';

interface PermitApplicationGeneratorProps {
  projectId: string;
  onApplicationGenerated?: (application: any) => void;
}

// SNI codes for waste management and environmental activities
const SNI_CODES = [
  { code: '38.21.10', description: 'Avfallssamling - farligt avfall' },
  { code: '38.21.20', description: 'Avfallssamling - icke-farligt avfall' },
  { code: '38.12.00', description: 'Behandling och deponering av icke-farligt avfall' },
  { code: '38.11.00', description: 'Behandling och deponering av farligt avfall' },
  { code: '41.00.11', description: 'Byggnation av vatten- och avloppssystem' },
  { code: '36.00.10', description: 'Vattensamling, rening och leverans' },
];

const PermitApplicationGenerator: React.FC<PermitApplicationGeneratorProps> = ({
  projectId,
  onApplicationGenerated,
}) => {
  const [formData, setFormData] = useState({
    propertyDesignation: '',
    sniCode: '' as string,
    sniDescription: '' as string,
    description: '',
    budget: undefined as number | undefined,
    latitude: undefined as number | undefined,
    longitude: undefined as number | undefined,
  });

  const { isGenerating, error, generatedApplication, generate } = usePermitApplicationGenerator(projectId);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.currentTarget;
    const newValue = type === 'number' ? (value ? Number(value) : undefined) : value;

    setFormData((prev) => ({
      ...prev,
      [name]: newValue,
    }));

    // Update sniDescription when sniCode changes
    if (name === 'sniCode') {
      const selected = SNI_CODES.find((item) => item.code === value);
      setFormData((prev) => ({
        ...prev,
        sniDescription: selected?.description || '',
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.propertyDesignation.trim()) {
      alert('Fastighetsbeteckning krävs');
      return;
    }

    if (!formData.sniCode) {
      alert('SNI-kod krävs');
      return;
    }

    if (!formData.description.trim()) {
      alert('Verksamhetsbeskrivning krävs');
      return;
    }

    const application = await generate({
      propertyDesignation: formData.propertyDesignation,
      sniCode: formData.sniCode,
      sniDescription: formData.sniDescription,
      description: formData.description,
      budget: formData.budget,
      latitude: formData.latitude,
      longitude: formData.longitude,
    });

    if (application && onApplicationGenerated) {
      onApplicationGenerated(application);
    }
  };

  return (
    <div className="permit-app-generator-container">
      <div className="permit-app-generator-header">
        <Wand2 size={24} color="#005293" />
        <h2>Tillståndsansöknings-Generator</h2>
        <p>AI-driven generering av kompletta miljötillståndsansökningar</p>
      </div>

      <form onSubmit={handleSubmit} className="permit-app-generator-form">
        {/* Fastighetsbeteckning */}
        <div className="form-group">
          <label htmlFor="propertyDesignation">
            Fastighetsbeteckning *
            <span className="form-hint-icon" title="Format: kommun:kommun-nummer:objekt-nummer">
              <HelpCircle size={16} />
            </span>
          </label>
          <input
            id="propertyDesignation"
            name="propertyDesignation"
            type="text"
            placeholder="ex. 0101:4:123"
            value={formData.propertyDesignation}
            onChange={handleInputChange}
            required
            className="form-input"
          />
        </div>

        {/* SNI-kod */}
        <div className="form-group">
          <label htmlFor="sniCode">
            SNI-kod *
            <span className="form-hint-icon" title="Standard för Näringsgrensindelning">
              <HelpCircle size={16} />
            </span>
          </label>
          <select
            id="sniCode"
            name="sniCode"
            value={formData.sniCode}
            onChange={handleInputChange}
            className="form-select"
            required
          >
            <option value="">Välj verksamhetskod</option>
            {SNI_CODES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} - {item.description}
              </option>
            ))}
          </select>
          {formData.sniDescription && (
            <p className="form-info">
              <strong>Verksamhetsbeskrivning:</strong> {formData.sniDescription}
            </p>
          )}
        </div>

        {/* Verksamhetsbeskrivning */}
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="description">Verksamhetsbeskrivning *</label>
          <textarea
            id="description"
            name="description"
            placeholder="Beskriv verksamhetens art, omfattning, miljöpåverkan och särskilda förhållanden..."
            value={formData.description}
            onChange={handleInputChange}
            required
            rows={6}
            className="form-textarea"
          />
          <small className="form-hint">
            Ju mer detaljerad beskrivning, desto bättre blir tillståndsansökan
          </small>
        </div>

        {/* Budget (optional) */}
        <div className="form-group">
          <label htmlFor="budget">Beräknad budget (SEK, valfritt)</label>
          <input
            id="budget"
            name="budget"
            type="number"
            min="0"
            step="10000"
            value={formData.budget ?? ''}
            onChange={handleInputChange}
            className="form-input"
            placeholder="ex. 500000"
          />
        </div>

        {/* Koordinater (optional) */}
        <div className="form-group">
          <label htmlFor="latitude">Latitud (valfritt)</label>
          <input
            id="latitude"
            name="latitude"
            type="number"
            step="0.0001"
            value={formData.latitude ?? ''}
            onChange={handleInputChange}
            className="form-input"
            placeholder="59.3293"
          />
        </div>

        <div className="form-group">
          <label htmlFor="longitude">Longitud (valfritt)</label>
          <input
            id="longitude"
            name="longitude"
            type="number"
            step="0.0001"
            value={formData.longitude ?? ''}
            onChange={handleInputChange}
            className="form-input"
            placeholder="18.0686"
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="form-error" style={{ gridColumn: '1 / -1' }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {/* Success message */}
        {generatedApplication && !isGenerating && (
          <div className="form-success" style={{ gridColumn: '1 / -1' }}>
            <CheckCircle size={18} />
            <span>Tillståndsansökan genererad framgångsrikt!</span>
          </div>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={isGenerating}
          className="form-button-submit"
          style={{ gridColumn: '1 / -1' }}
        >
          {isGenerating ? (
            <>
              <span className="spinner"></span>
              Genererar ansökan...
            </>
          ) : (
            <>
              <Wand2 size={18} />
              Generera Tillståndsansökan
            </>
          )}
        </button>
      </form>

      {/* Info box */}
      <div className="permit-app-generator-info">
        <h3>Vad kommer att genereras?</h3>
        <ul>
          <li>
            ✅ <strong>Ansökningssammanfattning</strong> – Verksamhetsbeskrivning och omfattning
          </li>
          <li>
            ✅ <strong>Miljörisker</strong> – Identifierade risker med åtgärdsförslag
          </li>
          <li>
            ✅ <strong>Intressentanalys</strong> – Miljödom, kommun, grannar, arbetsmiljöverket
          </li>
          <li>
            ✅ <strong>Dokumentkrav</strong> – Obligatoriska och frivilliga dokument per tillståndstyp
          </li>
          <li>
            ✅ <strong>Budgetestimering</strong> – Kostnader för tillståndsgivning, studier, övervakning
          </li>
          <li>
            ✅ <strong>Miljöpåverkansanalys</strong> – Luft, vatten, jord, buller, biodiversitet, klimat
          </li>
          <li>
            ✅ <strong>Provtagningsplan</strong> – Rekommenderade parametrar, frekvens och metoder
          </li>
          <li>
            ✅ <strong>Laboratorier</strong> – SWEDAC-ackrediterade laboratorier med specialisering
          </li>
          <li>
            ✅ <strong>Efterlevnadschecklista</strong> – Lagstiftningskrav och reglering
          </li>
          <li>
            ✅ <strong>Källspårning</strong> – Vilka kilder och AI-modeller som användes
          </li>
        </ul>
        <p className="permit-app-generator-note">
          Ansökan genereras av AI (Gemini) baserat på din beskrivning, SNI-kod, fastighetsbeteckning och
          miljödata från svenska myndigheter och register.
        </p>
      </div>
    </div>
  );
};

export default PermitApplicationGenerator;
