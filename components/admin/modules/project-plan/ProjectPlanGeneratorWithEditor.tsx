/**
 * ProjectPlanGeneratorWithEditor
 * Full workflow: Generate → Edit → Save
 */

import React, { useState } from 'react';
import ProjectPlanGenerator from './ProjectPlanGenerator';
import ProjectPlanEditor from './ProjectPlanEditor';
import type { GeneratedPlan } from '../../hooks/useProjectPlanGenerator';
import type { EditablePlan } from './ProjectPlanEditor';

interface ProjectPlanGeneratorWithEditorProps {
  projectId: string;
  propertyDesignation?: string;
  onPlanSaved?: () => void;
}

type WorkflowStep = 'generator' | 'editor' | 'saved';

const ProjectPlanGeneratorWithEditor: React.FC<ProjectPlanGeneratorWithEditorProps> = ({
  projectId,
  propertyDesignation,
  onPlanSaved,
}) => {
  const [step, setStep] = useState<WorkflowStep>('generator');
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null);

  const handlePlanGenerated = (plan: GeneratedPlan) => {
    setGeneratedPlan(plan);
    setStep('editor');
  };

  const convertToEditablePlan = (plan: GeneratedPlan): EditablePlan => {
    return {
      phases: plan.phases.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        startDate: p.startDate,
        endDate: p.endDate,
        budget: p.budget,
        resources: p.resources,
      })),
      risks: plan.riskAnalysis.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        category: r.category,
        probability: r.probability,
        impact: r.impact,
        mitigation: r.mitigation,
        owner: r.owner,
      })),
      stakeholders: plan.stakeholderAnalysis.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        interestLevel: s.interestLevel,
        powerLevel: s.powerLevel,
        communicationStrategy: s.communicationStrategy,
      })),
    };
  };

  const handleEditorSave = async (editedPlan: EditablePlan) => {
    // Save edited plan to backend
    const response = await fetch(`/api/projects/${projectId}/plan`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: editedPlan,
        generatedAt: generatedPlan?.generatedAt,
        externalSourcesUsed: generatedPlan?.externalSourcesUsed || [],
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save plan');
    }

    setStep('saved');
    if (onPlanSaved) {
      onPlanSaved();
    }

    // Reset after 2 seconds
    setTimeout(() => {
      setStep('generator');
      setGeneratedPlan(null);
    }, 2000);
  };

  const handleEditorCancel = () => {
    setStep('generator');
    setGeneratedPlan(null);
  };

  if (step === 'generator') {
    return (
      <ProjectPlanGenerator
        projectId={projectId}
        propertyDesignation={propertyDesignation}
        onPlanGenerated={handlePlanGenerated}
      />
    );
  }

  if (step === 'editor' && generatedPlan) {
    const editablePlan = convertToEditablePlan(generatedPlan);
    return (
      <ProjectPlanEditor initialPlan={editablePlan} onSave={handleEditorSave} onCancel={handleEditorCancel} />
    );
  }

  if (step === 'saved') {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
        <h2 style={{ color: '#15803d', marginBottom: '0.5rem' }}>Plan sparad!</h2>
        <p style={{ color: '#6b7280' }}>Laddar om gränssnittet...</p>
      </div>
    );
  }

  return null;
};

export default ProjectPlanGeneratorWithEditor;
