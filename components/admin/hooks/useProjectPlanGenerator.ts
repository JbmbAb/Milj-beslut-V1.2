/**
 * useProjectPlanGenerator – Hook for AI-driven project plan generation
 * Calls backend service to generate plans using Gemini + Prisma + PostGIS
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface ProjectPlanGeneratorInput {
  propertyId: string;
  projectType: 'ENV_PERMIT' | 'REMEDIATION' | 'INFRA' | 'ENERGY' | 'VA';
  budget: number;
  timeframe: string;
  description: string;
  latitude?: number;
  longitude?: number;
}

export interface GeneratedPlan {
  id: string;
  projectId: string;
  generatedAt: string;
  phases: any[];
  riskAnalysis: any[];
  stakeholderAnalysis: any[];
  budget: any;
  samplingPlan: any[];
  organizationStructure: any;
  geodataFindings: any;
  externalSourcesUsed: string[];
}

export const useProjectPlanGenerator = (projectId: string) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null);
  const queryClient = useQueryClient();

  const generate = async (input: ProjectPlanGeneratorInput) => {
    if (!projectId) {
      setError('Project ID required');
      return null;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/plan/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to generate plan: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.ok && data.plan) {
        setGeneratedPlan(data.plan);

        // Invalidate project plan cache to refetch
        await queryClient.invalidateQueries({
          queryKey: ['project-plan', projectId],
        });

        return data.plan;
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  return {
    isGenerating,
    error,
    generatedPlan,
    generate,
  };
};
