/**
 * ProjectPlanGenerator – Form for AI-driven project plan generation
 * Users input project description, type, budget, etc.
 * Backend generates comprehensive plan using Gemini + geodata
 */

import React, { useState } from 'react';
import { Wand2, AlertCircle, CheckCircle } from 'lucide-react';
import { useProjectPlanGenerator } from '../../hooks/useProjectPlanGenerator';
import '../module-common.css';
import './project-plan-generator.css';

interface ProjectPlanGeneratorProps {
  projectId: string;
  propertyDesignation?: string;
  onPlanGenerated?: (plan: any) => void;
}

type ProjectType = 'ENV_PERMIT' | 'REMEDIATION' | 'INFRA' | 'ENERGY' | 'VA';

const ProjectPlanGenerator: React.FC<ProjectPlanGeneratorProps> = ({
  projectId,
  propertyDesignation,
  onPlanGenerated,
}) => {
  const [formData, setFormData] = useState({
    propertyId: propertyDesignation || '',
    projectType: 'REMEDIATION' as ProjectType,
    budget: 500000,
    timeframe: '6 months',
    description: '',
    latitude: undefined as number | undefined,
    longitude: undefined as number | undefined,
  });

  const { isGenerating, error, generatedPlan, generate } = useProjectPlanGenerator(projectId);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.currentTarget;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'number' ? Number(value) : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.propertyId || !formData.description.trim()) {
      alert('Fastighetsbeteckning och projektbeskrivning krävs');
      return;
    }

    const plan = await generate({
      propertyId: formData.propertyId,
      projectType: formData.projectType,
      budget: formData.budget,
      timeframe: formData.timeframe,
      description: formData.description,
      latitude: formData.latitude,
      longitude: formData.longitude,
    });

    if (plan && onPlanGenerated) {
      onPlanGenerated(plan);
    }
  };

  const projectTypeLabels: Record<ProjectType, string> = {
    ENV_PERMIT: '🏢 Miljötillstånd',
    REMEDIATION: '🔧 Sanering',
    INFRA: '🏗️ Infrastruktur',
    ENERGY: '⚡ Energi',
    VA: '💧 Vatten & Avlopp',
  };

  return (
    <div className="plan-generator-container">
      <div className="plan-generator-header">
        <Wand2 size={24} color="#005293" />
        <h2>Projektplansgenerator</h2>
        <p>AI-driven generation av komplett projektplan</p>
      </div>

      <form onSubmit={handleSubmit} className="plan-generator-form">
        {/* Fastighetsbeteckning */}
        <div className="form-group">
          <label htmlFor="propertyId">Fastighetsbeteckning *</label>
          <input
            id="propertyId"
            name="propertyId"
            type="text"
            placeholder="ex. Västra vägen 42, Stockholm"
            value={formData.propertyId}
            onChange={handleInputChange}
            required
            className="form-input"
          />
        </div>

        {/* Projekttyp */}
        <div className="form-group">
          <label htmlFor="projectType">Projekttyp *</label>
          <select
            id="projectType"
            name="projectType"
            value={formData.projectType}
            onChange={handleInputChange}
            className="form-select"
          >
            {Object.entries(projectTypeLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Budget */}
        <div className="form-group">
          <label htmlFor="budget">Budget (SEK) *</label>
          <input
            id="budget"
            name="budget"
            type="number"
            min="0"
            step="100000"
            value={formData.budget}
            onChange={handleInputChange}
            required
            className="form-input"
          />
        </div>

        {/* Tidsram */}
        <div className="form-group">
          <label htmlFor="timeframe">Tidsram *</label>
          <select
            id="timeframe"
            name="timeframe"
            value={formData.timeframe}
            onChange={handleInputChange}
            className="form-select"
          >
            <option value="3 months">3 månader</option>
            <option value="6 months">6 månader</option>
            <option value="1 year">1 år</option>
            <option value="2 years">2 år</option>
            <option value="3 years">3 år</option>
          </select>
        </div>

        {/* Projektbeskrivning */}
        <div className="form-group">
          <label htmlFor="description">Projektbeskrivning *</label>
          <textarea
            id="description"
            name="description"
            placeholder="Beskriv projektets mål, omfattning, miljöpåverkan och särskilda utmaningar..."
            value={formData.description}
            onChange={handleInputChange}
            required
            rows={6}
            className="form-textarea"
          />
          <small className="form-hint">Ju mer detaljerad beskrivning, desto bättre blir AI-analysen</small>
        </div>

        {/* Koordinater (optional) */}
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="latitude">Latitud (valfritt)</label>
            <input
              id="latitude"
              name="latitude"
              type="number"
              step="0.0001"
              placeholder="59.3293"
              value={formData.latitude ?? ''}
              onChange={handleInputChange}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="longitude">Longitud (valfritt)</label>
            <input
              id="longitude"
              name="longitude"
              type="number"
              step="0.0001"
              placeholder="18.0686"
              value={formData.longitude ?? ''}
              onChange={handleInputChange}
              className="form-input"
            />
          </div>
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
            <span>Projektplan genererad framgångsrikt! Ladda om för att se resultatet.</span>
          </div>
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
              <Wand2 size={18} />
              Generera Projektplan
            </>
          )}
        </button>
      </form>

      {/* Info box */}
      <div className="plan-generator-info">
        <h3>Vad kommer att genereras?</h3>
        <ul>
          <li>
            ✅ <strong>Projektfaser</strong> – 4-5 strukturerade faser med tidsplan och budget
          </li>
          <li>
            ✅ <strong>Riskanalys</strong> – Identifierade risker med sannolikhet och åtgärder
          </li>
          <li>
            ✅ <strong>Intressentanalys</strong> – Aktörer, inflytande och kommunikationsplan
          </li>
          <li>
            ✅ <strong>Budgetöversikt</strong> – Kostnadsfördelning per kategori och tidsperiod
          </li>
          <li>
            ✅ <strong>Provtagningsplan</strong> – Parametrar, frekvens och platser
          </li>
          <li>
            ✅ <strong>Organisationsstruktur</strong> – Roller, team och ansvar
          </li>
          <li>
            ✅ <strong>Geodata-analys</strong> – Miljöfaktorer från PostGIS och externa källor
          </li>
        </ul>
        <p className="plan-generator-note">
          Planen genereras av AI (Gemini) baserat på din beskrivning, fastighetsbeteckning och miljödata från
          Lantmäteriet, SGU och andra officiella källor.
        </p>
      </div>
    </div>
  );
};

export default ProjectPlanGenerator;
