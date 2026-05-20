import { useState, useEffect, useCallback } from 'react';
import type { ProjectPlanSnapshot } from '../types/admin';

interface UseProjectPlanResult {
  plan: ProjectPlanSnapshot | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hämtar projektplan från `/api/projects/:projectId/plan`
 * Innehåller faser, milstolpar och resurser
 */
export const useProjectPlan = (projectId: string): UseProjectPlanResult => {
  const [plan, setPlan] = useState<ProjectPlanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlan = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      setPlan(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/projects/${projectId}/plan`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json();
      setPlan(json.plan || null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Okänt fel vid hämtning av projektplan';
      setError(message);
      console.error('[useProjectPlan] Error:', message);
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  return { plan, loading, error, refetch: fetchPlan };
};
