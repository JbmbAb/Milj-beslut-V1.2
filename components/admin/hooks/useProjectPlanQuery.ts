import { useQuery } from '@tanstack/react-query';
import type { ProjectPlanSnapshot } from '../types/admin';

/**
 * useProjectPlanQuery – React Query hook för projektplan
 * Caching per projekt-ID
 */
export const useProjectPlanQuery = (projectId: string) => {
  return useQuery<ProjectPlanSnapshot>({
    queryKey: ['project-plan', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/plan`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch project plan: ${response.statusText}`);
      }

      const json = await response.json();
      return json.plan || null;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!projectId, // Only fetch if projectId is provided
  });
};
