/**
 * LogisticsGenerator – AI-driven logistics plan form
 * Generates: Waybills, driving logs, depot assignments, CO2 tracking
 */

import React, { useState } from 'react';
import { Truck, AlertCircle, CheckCircle, FileDown } from 'lucide-react';
import { useLogisticsGenerator } from '../../hooks/useLogisticsGenerator';
import { downloadPdfFromJson } from '../../../../services/pdfExportClient';
import '../module-common.css';
import './logistics-generator.css';

interface LogisticsGeneratorProps {
  projectId: string;
  onPlanGenerated?: (plan: any) => void;
}

type WasteType = 'SOIL' | 'CONSTRUCTION' | 'INDUSTRIAL' | 'HAZARDOUS' | 'ORGANIC';
type TransportMode = 'TRUCK' | 'RAIL' | 'BARGE';

const LogisticsGenerator: React.FC<LogisticsGeneratorProps> = ({ projectId, onPlanGenerated }) => {
  const [formData, setFormData] = useState({
    wasteType: 'SOIL' as WasteType,
    estimatedTons: 50,
    sourceAddress: '',
    destinationAddress: '',
    transportMode: 'TRUCK' as TransportMode,
    tillståndsId: '',
    contaminants: [] as string[],
  });

  const [contaminantInput, setContaminantInput] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const { isGenerating, error, generatedPlan, generate } = useLogisticsGenerator(projectId);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = e.currentTarget;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'number' ? Number(value) : value,
    }));
  };

  const addContaminant = (contaminant: string) => {
    if (contaminant && !formData.contaminants.includes(contaminant)) {
      setFormData((prev) => ({
        ...prev,
        contaminants: [...prev.contaminants, contaminant],
      }));
      setContaminantInput('');
    }
  };

  const removeContaminant = (contaminant: string) => {
    setFormData((prev) => ({
      ...prev,
      contaminants: prev.contaminants.filter((c) => c !== contaminant),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.sourceAddress || !formData.destinationAddress) {
      alert('Källadress och destinationsadress krävs');
      return;
    }

    const plan = await generate({
      wasteType: formData.wasteType,
      estimatedTons: formData.estimatedTons,
      sourceAddress: formData.sourceAddress,
      destinationAddress: formData.destinationAddress,
      transportMode: formData.transportMode,
      tillståndsId: formData.tillståndsId,
      contaminants: formData.contaminants,
    });

    if (plan && onPlanGenerated) {
      onPlanGenerated(plan);
    }
  };

  const wasteTypeLabels: Record<WasteType, string> = {
    SOIL: '🌍 Jord',
    CONSTRUCTION: '🏗️ Byggavfall',
    INDUSTRIAL: '🏭 Industriellt',
    HAZARDOUS: '⚠️ Farligt',
    ORGANIC: '♻️ Organiskt',
  };

  const transportModeLabels: Record<TransportMode, string> = {
    TRUCK: '🚚 Lastbil',
    RAIL: '🚂 Järnväg',
    BARGE: '⛴️ Båt',
  };

  const commonContaminants = ['PCB', 'Mercury', 'PAH', 'Cadmium', 'Lead', 'Asbestos'];

  const handleExportPdf = async () => {
    if (!generatedPlan) return;
    setPdfError(null);
    setPdfBusy(true);
    try {
      await downloadPdfFromJson({
        title: 'Logistikplan',
        subtitle: `Projekt ${projectId}`,
        json: generatedPlan,
        fallbackFilename: 'logistikplan.pdf',
      });
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'PDF-export misslyckades.');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="logistics-generator-container">
      <div className="logistics-generator-header">
        <Truck size={24} color="#005293" />
        <h2>Logistik & Avfallsplan Generator</h2>
        <p>AI-driven generering av vågkort, körjournal och deponi-tilldelning</p>
      </div>

      <form onSubmit={handleSubmit} className="logistics-generator-form">
        {/* Avfallstyp */}
        <div className="form-group">
          <label htmlFor="wasteType">Avfallstyp *</label>
          <select
            id="wasteType"
            name="wasteType"
            value={formData.wasteType}
            onChange={handleInputChange}
            className="form-select"
          >
            {Object.entries(wasteTypeLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Mängd */}
        <div className="form-group">
          <label htmlFor="estimatedTons">Beräknad mängd (ton) *</label>
          <input
            id="estimatedTons"
            name="estimatedTons"
            type="number"
            min="0.1"
            step="0.1"
            value={formData.estimatedTons}
            onChange={handleInputChange}
            required
            className="form-input"
          />
        </div>

        {/* Källadress */}
        <div className="form-group">
          <label htmlFor="sourceAddress">Källadress *</label>
          <input
            id="sourceAddress"
            name="sourceAddress"
            type="text"
            placeholder="ex. Västra vägen 42, Stockholm"
            value={formData.sourceAddress}
            onChange={handleInputChange}
            required
            className="form-input"
          />
        </div>

        {/* Destinationsadress */}
        <div className="form-group">
          <label htmlFor="destinationAddress">Destinationsadress *</label>
          <input
            id="destinationAddress"
            name="destinationAddress"
            type="text"
            placeholder="ex. Deponi, Gävle"
            value={formData.destinationAddress}
            onChange={handleInputChange}
            required
            className="form-input"
          />
        </div>

        {/* Transportslag */}
        <div className="form-group">
          <label htmlFor="transportMode">Transportslag *</label>
          <select
            id="transportMode"
            name="transportMode"
            value={formData.transportMode}
            onChange={handleInputChange}
            className="form-select"
          >
            {Object.entries(transportModeLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Tillstånds-ID */}
        <div className="form-group">
          <label htmlFor="tillståndsId">Tillstånds-ID (valfritt)</label>
          <input
            id="tillståndsId"
            name="tillståndsId"
            type="text"
            placeholder="ex. NV-2024-001"
            value={formData.tillståndsId}
            onChange={handleInputChange}
            className="form-input"
          />
        </div>

        {/* Kontaminanter */}
        <div className="form-group">
          <label>Förorenade ämnen</label>
          <div className="contaminants-input">
            <input
              type="text"
              placeholder="Typ namn (ex. PCB)"
              value={contaminantInput}
              onChange={(e) => setContaminantInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addContaminant(contaminantInput);
                }
              }}
              className="form-input"
            />
            <button type="button" onClick={() => addContaminant(contaminantInput)} className="btn-add-small">
              Lägg till
            </button>
          </div>

          {/* Vanliga val */}
          <div className="contaminants-quick">
            {commonContaminants.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => addContaminant(c)}
                className={`contaminant-tag ${formData.contaminants.includes(c) ? 'selected' : ''}`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Valda */}
          {formData.contaminants.length > 0 && (
            <div className="contaminants-selected">
              {formData.contaminants.map((c) => (
                <span key={c} className="contaminant-chip">
                  {c}
                  <button type="button" onClick={() => removeContaminant(c)}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="form-error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {/* Success message */}
        {generatedPlan && !isGenerating && (
          <div className="form-success">
            <CheckCircle size={18} />
            <span>Logistikplan genererad! Ladda om för att se resultatet.</span>
          </div>
        )}

        {pdfError && (
          <div className="form-error">
            <AlertCircle size={18} />
            <span>{pdfError}</span>
          </div>
        )}

        {generatedPlan && !isGenerating && (
          <button
            type="button"
            className="form-button-pdf"
            onClick={() => void handleExportPdf()}
            disabled={pdfBusy}
          >
            <FileDown size={18} />
            {pdfBusy ? 'Förbereder PDF…' : 'Exportera PDF'}
          </button>
        )}

        {/* Submit button */}
        <button type="submit" disabled={isGenerating} className="form-button-submit">
          {isGenerating ? (
            <>
              <span className="spinner"></span>
              Genererar plan...
            </>
          ) : (
            <>
              <Truck size={18} />
              Generera Logistikplan
            </>
          )}
        </button>
      </form>

      {/* Info box */}
      <div className="logistics-generator-info">
        <h3>Vad kommer att genereras?</h3>
        <ul>
          <li>
            ✅ <strong>Digitala vågkort</strong> – EWC-koder, mängd, kontaminanter, mottagare
          </li>
          <li>
            ✅ <strong>Körjournal</strong> – Planerad rutt, bränsle, CO2-utsläpp
          </li>
          <li>
            ✅ <strong>Deponier</strong> – Rekommenderade mottagare, fyllnadsgrad, tillåtna ämnen,
            tillståndsid
          </li>
          <li>
            ✅ <strong>CO₂-beräkning</strong> – Transport + lagring + behandling
          </li>
          <li>
            ✅ <strong>Integrations-förslag</strong> – Trafikverket, Avfallsregistret, Lantmäteriet
          </li>
        </ul>
        <p className="logistics-generator-note">
          Planen genereras av AI (Gemini) baserad på dina specifikationer, tillgängliga deponier och miljödata
          från officiella källor.
        </p>
      </div>
    </div>
  );
};

export default LogisticsGenerator;
