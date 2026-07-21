/**
 * usePermitApplicationGenerator – Hook for AI-driven permit application generation
 */

import { useState } from 'react';

export interface PermitApplicationGeneratorInput {
  propertyDesignation: string;
  sniCode: string;
  sniDescription?: string;
  description: string;
  budget?: number;
  latitude?: number;
  longitude?: number;
}

export const usePermitApplicationGenerator = (projectId: string) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedApplication, setGeneratedApplication] = useState<any>(null);

  const generate = async (input: PermitApplicationGeneratorInput) => {
    if (!projectId) {
      setError('Project ID required');
      return null;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/permit/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to generate application: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.ok && data.application) {
        setGeneratedApplication(data.application);
        return data.application;
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
    generatedApplication,
    generate,
  };
};
