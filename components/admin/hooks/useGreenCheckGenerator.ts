/**
 * Green Check Generator Hook
 * Manages AI-driven ESG/regulatory assessment generation for banks
 */

import { useMutation } from '@tanstack/react-query';
import type { GeneratedGreenCheck } from '../../../src/types/generators';

export interface UseGreenCheckGeneratorOptions {
  onSuccess?: (assessment: GeneratedGreenCheck) => void;
  onError?: (error: Error) => void;
}

export function useGreenCheckGenerator(options?: UseGreenCheckGeneratorOptions) {
  return useMutation({
    mutationFn: async (params: {
      organizationNumber: string;
      organizationName?: string;
      projectDescription: string;
      investmentAmount?: number;
      sector?: string;
      latitude?: number;
      longitude?: number;
    }) => {
      const response = await fetch('/api/green-check/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate green check assessment');
      }

      const data = await response.json();
      return data.assessment as GeneratedGreenCheck;
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  });
}
