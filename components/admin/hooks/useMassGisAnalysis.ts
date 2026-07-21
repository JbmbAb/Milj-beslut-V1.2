import { useMutation } from '@tanstack/react-query';
import { analyzeMassSite } from '../../../services/massApi';
import type { MassGisAnalysisResponse } from '../../../types';

export interface UseMassGisAnalysisOptions {
  onSuccess?: (data: MassGisAnalysisResponse) => void;
  onError?: (error: Error) => void;
}

export function useMassGisAnalysis(options?: UseMassGisAnalysisOptions) {
  return useMutation({
    mutationFn: analyzeMassSite,
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  });
}
