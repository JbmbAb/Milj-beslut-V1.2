import { useQuery } from '@tanstack/react-query';
import type { CarbonResult, RiskMetric } from '../types/admin';

interface CarbonMetricsResponse {
  result: CarbonResult | null;
  riskMetrics: RiskMetric[];
}

/**
 * useCarbonMetricsQuery – React Query hook för CO₂-metriker
 * Beräknas on-demand för varje projekt
 */
export const useCarbonMetricsQuery = (projectId: string) => {
  return useQuery<CarbonMetricsResponse>({
    queryKey: ['carbon-metrics', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/carbon/calculate`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          carbonInput: {
            transportMode: 'TRUCK',
            materialType: 'SOIL',
            tons: 0,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch carbon metrics: ${response.statusText}`);
      }

      const json = await response.json();
      const result = json.result || null;

      return {
        result,
        riskMetrics: Array.isArray(json.riskMetrics) ? (json.riskMetrics as RiskMetric[]) : [],
      };
    },
    staleTime: 10 * 60 * 1000, // 10 minutes (longer since it's computed)
    enabled: !!projectId,
  });
};
