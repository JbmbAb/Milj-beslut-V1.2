import { useState, useEffect, useCallback } from 'react';
import type { CarbonResult, RiskMetric } from '../types/admin';

interface UseCarbonMetricsResult {
  carbonResult: CarbonResult | null;
  riskMetrics: RiskMetric[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hämtar CO₂-metriker och risk-scoring från `/api/projects/:projectId/carbon/calculate`
 * Beräknar miljöpåverkan för projektet
 */
export const useCarbonMetrics = (projectId: string): UseCarbonMetricsResult => {
  const [carbonResult, setCarbonResult] = useState<CarbonResult | null>(null);
  const [riskMetrics, setRiskMetrics] = useState<RiskMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/projects/${projectId}/carbon/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          carbonInput: {
            transportMode: 'TRUCK',
            materialType: 'SOIL',
            tons: 0, // Will be calculated from actual data
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json();
      const result = json.result || null;
      setCarbonResult(result);
      setRiskMetrics(Array.isArray(json.riskMetrics) ? (json.riskMetrics as RiskMetric[]) : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Okänt fel vid hämtning av CO₂-data';
      setError(message);
      console.error('[useCarbonMetrics] Error:', message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
     
    fetchMetrics();
  }, [fetchMetrics]);

  return { carbonResult, riskMetrics, loading, error, refetch: fetchMetrics };
};
