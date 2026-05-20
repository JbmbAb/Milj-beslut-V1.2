/**
 * Sewage Analysis Hook
 * Manages GIS analysis for private sewage systems
 */

import { useMutation } from '@tanstack/react-query';
import type { SewageGISAnalysis, SewageProtectionProfile } from '../../../types';

export interface UseSewageAnalysisOptions {
  onSuccess?: (data: { analysis: SewageGISAnalysis; protectionProfile: SewageProtectionProfile }) => void;
  onError?: (error: Error) => void;
}

export function useSewageAnalysis(options?: UseSewageAnalysisOptions) {
  return useMutation({
    mutationFn: async (params: {
      propertyDesignation: string;
      municipalityCode: string;
      latitude: number;
      longitude: number;
      pe: number; // Person equivalents (1-200)
    }) => {
      const response = await fetch('/api/sewage/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to analyze property');
      }

      const data = await response.json();
      return {
        analysis: data.analysis as SewageGISAnalysis,
        protectionProfile: data.protectionProfile as SewageProtectionProfile,
      };
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  });
}
