import { useState, useEffect, useCallback } from 'react';
import type { Project } from '../types/admin';

export interface UseAdminProjectsResult {
  projects: Project[];
  loading: boolean;
  error: string | null;
  totalItems: number;
  refetch: () => Promise<void>;
}

/**
 * Hämtar admin-projekt från `/api/admin/projects`
 * Stödjer pagination med query-parametrar
 * Använder real data från Prisma
 */
export const useAdminProjects = (page = 1, pageSize = 10): UseAdminProjectsResult => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalItems, setTotalItems] = useState(0);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: pageSize.toString(),
      });

      const response = await fetch(`/api/admin/projects?${queryParams}`, {
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
      setProjects(json.projects || []);
      setTotalItems(json.total || 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Okänt fel vid hämtning av projekt';
      setError(message);
      console.error('[useAdminProjects] Error:', message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
     
    fetchProjects();
  }, [fetchProjects]);

  return { projects, loading, error, totalItems, refetch: fetchProjects };
};
