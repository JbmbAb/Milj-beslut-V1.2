/**
 * PermitApplicationGeneratorWithEditor
 * Full workflow: Generate → Edit → Save
 */

import React, { useState } from 'react';
import PermitApplicationGenerator from './PermitApplicationGenerator';
import PermitApplicationEditor from './PermitApplicationEditor';
import type { GeneratedPermitApplication } from '~/server/services/permitApplicationGeneratorService';

import type { EditablePermitApplication } from './PermitApplicationEditor';

interface PermitApplicationGeneratorWithEditorProps {
  projectId: string;
  onApplicationSaved?: () => void;
}

type WorkflowStep = 'generator' | 'editor' | 'saved';

const PermitApplicationGeneratorWithEditor: React.FC<PermitApplicationGeneratorWithEditorProps> = ({
  projectId,
  onApplicationSaved,
}) => {
  const [step, setStep] = useState<WorkflowStep>('generator');
  const [generatedApplication, setGeneratedApplication] = useState<GeneratedPermitApplication | null>(null);

  const handleApplicationGenerated = (application: GeneratedPermitApplication) => {
    setGeneratedApplication(application);
    setStep('editor');
  };

  const convertToEditableApplication = (app: GeneratedPermitApplication): EditablePermitApplication => {
    return {
      applicationSummary: {
        title: app.applicationSummary.title,
        operationType: app.applicationSummary.operationType,
        location: app.applicationSummary.location,
        duration: app.applicationSummary.duration,
        expectedEnvironmentalLoad: app.applicationSummary.expectedEnvironmentalLoad,
        mainActivities: app.applicationSummary.mainActivities,
      },
      risks: app.riskAnalysis.map((r) => ({
        id: r.id,
        category: r.category,
        riskName: r.riskName,
        description: r.description,
        severity: r.severity,
        mitigationMeasures: r.mitigationMeasures,
      })),
      stakeholders: app.stakeholderAnalysis.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        interestLevel: s.interestLevel,
        powerLevel: s.powerLevel,
        communicationNeeded: s.communicationNeeded,
      })),
      requiredDocuments: app.requiredDocuments.map((d) => ({
        id: d.id,
        documentType: d.documentType,
        description: d.description,
        mandatory: d.mandatory,
        template: d.template,
        relatedRisk: d.relatedRisk,
      })),
      budgetEstimate: {
        estimatedCost: app.budgetEstimate.estimatedCost,
        permittingFees: app.budgetEstimate.categories.permittingFees,
        environmentalStudies: app.budgetEstimate.categories.environmentalStudies,
        monitoring: app.budgetEstimate.categories.monitoring,
        contingency: app.budgetEstimate.categories.contingency,
        other: app.budgetEstimate.categories.other,
      },
    };
  };

  const handleEditorSave = async (editedApplication: EditablePermitApplication) => {
    // Save edited application to backend
    const response = await fetch(`/api/projects/${projectId}/permit`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        application: editedApplication,
        generatedAt: generatedApplication?.generatedAt,
        sourceTracking: generatedApplication?.sourceTracking || [],
        externalSourcesUsed: generatedApplication?.externalSourcesUsed || [],
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save application');
    }

    setStep('saved');
    if (onApplicationSaved) {
      onApplicationSaved();
    }

    // Reset after 2 seconds
    setTimeout(() => {
      setStep('generator');
      setGeneratedApplication(null);
    }, 2000);
  };

  const handleEditorCancel = () => {
    setStep('generator');
    setGeneratedApplication(null);
  };

  if (step === 'generator') {
    return (
      <PermitApplicationGenerator projectId={projectId} onApplicationGenerated={handleApplicationGenerated} />
    );
  }

  if (step === 'editor' && generatedApplication) {
    const editableApplication = convertToEditableApplication(generatedApplication);
    return (
      <PermitApplicationEditor
        initialApplication={editableApplication}
        onSave={handleEditorSave}
        onCancel={handleEditorCancel}
      />
    );
  }

  if (step === 'saved') {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
        <h2 style={{ color: '#15803d', marginBottom: '0.5rem' }}>Ansökan sparad!</h2>
        <p style={{ color: '#6b7280' }}>Laddar om gränssnittet...</p>
      </div>
    );
  }

  return null;
};

export default PermitApplicationGeneratorWithEditor;
