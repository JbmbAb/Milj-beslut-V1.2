/**
 * useLogisticsGenerator – Hook for AI-driven logistics planning
 */

import { useState } from 'react';

export interface LogisticsGeneratorInput {
  wasteType: string;
  estimatedTons: number;
  sourceAddress: string;
  destinationAddress: string;
  transportMode: string;
  tillståndsId?: string;
  contaminants?: string[];
}

export const useLogisticsGenerator = (projectId: string) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedPlan, setGeneratedPlan] = useState<any>(null);

  const generate = async (input: LogisticsGeneratorInput) => {
    if (!projectId) {
      setError('Project ID required');
      return null;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/logistics/generate`, {
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
