/**
 * Green Check Generator with Editor Workflow
 * Orchestrates: Generate → Edit → Save
 */

import React, { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import GreenCheckGenerator from './GreenCheckGenerator';
import GreenCheckEditor from './GreenCheckEditor';
import type { GeneratedGreenCheck } from '../../../../server/services/greenCheckGeneratorService';
import './green-check-generator-with-editor.css';

export interface GreenCheckGeneratorWithEditorProps {
  onAssessmentSaved?: (assessment: GeneratedGreenCheck) => void;
}

type WorkflowStep = 'input' | 'editing' | 'success';

const GreenCheckGeneratorWithEditor: React.FC<GreenCheckGeneratorWithEditorProps> = ({
  onAssessmentSaved,
}) => {
  const [step, setStep] = useState<WorkflowStep>('input');
  const [assessment, setAssessment] = useState<GeneratedGreenCheck | null>(null);

  const handleAssessmentGenerated = (generated: GeneratedGreenCheck) => {
    setAssessment(generated);
    setStep('editing');
  };

  const handleSave = (updated: GeneratedGreenCheck) => {
    setAssessment(updated);
    setStep('success');
    onAssessmentSaved?.(updated);

    // Auto-reset after 3 seconds
    setTimeout(() => {
      setStep('input');
      setAssessment(null);
    }, 3000);
  };

  const handleCancel = () => {
    setStep('input');
    setAssessment(null);
  };

  return (
    <div className="green-check-generator-with-editor">
      {step === 'input' && <GreenCheckGenerator onAssessmentGenerated={handleAssessmentGenerated} />}

      {step === 'editing' && assessment && (
        <GreenCheckEditor assessment={assessment} onSave={handleSave} onCancel={handleCancel} />
      )}

      {step === 'success' && (
        <div className="green-check-success-state">
          <div className="green-check-success-icon">
            <CheckCircle size={64} color="#10b981" />
          </div>
          <h2>✓ Grönkoll-bedömning sparad</h2>
          <p className="success-message">
            ESG-bedömningen och EU-compliance-analysen har sparats till databasen och är redo för
            rapportering.
          </p>
          <div className="green-check-success-details">
            <div className="detail-item">
              <strong>Organisationsnummer:</strong> {assessment?.organizationNumber}
            </div>
            <div className="detail-item">
              <strong>ESG-rating:</strong> {assessment?.esgRating.rating}
            </div>
            <div className="detail-item">
              <strong>EU Taxonomy Alignment:</strong> {assessment?.euTaxonomyCompliance.alignmentPercentage}%
            </div>
            <div className="detail-item">
              <strong>Regulatory Risk:</strong> {assessment?.regulatoryRiskAssessment.overallRiskScore}/100
            </div>
          </div>
          <p className="loading-message">Återställer formulär...</p>
        </div>
      )}
    </div>
  );
};

export default GreenCheckGeneratorWithEditor;
