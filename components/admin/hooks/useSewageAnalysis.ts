/**
 * Sewage Analysis Hook
 * Manages GIS analysis for private sewage systems
 */

import { useMutation } from '@tanstack/react-query';
import { analyzeSewageProperty } from '../../../services/sewageApi';
import type { SewageGISAnalysis, SewageProtectionProfile } from '../../../types';

export interface UseSewageAnalysisOptions {
  onSuccess?: (data: { analysis: SewageGISAnalysis; protectionProfile: SewageProtectionProfile }) => void;
  onError?: (error: Error) => void;
}

export function useSewageAnalysis(options?: UseSewageAnalysisOptions) {
  return useMutation({
    mutationFn: analyzeSewageProperty,
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  });
}
