import { useQuery } from '@tanstack/react-query';
import type { Project } from '../types/admin';

interface AdminProjectsResponse {
  projects: Project[];
  total: number;
  page: number;
  limit: number;
}

/**
 * useAdminProjectsQuery – React Query hook för admin-projekt
 * Automatisk caching, deduplicering och stale-while-revalidate
 */
export const useAdminProjectsQuery = (page = 1, pageSize = 10) => {
  return useQuery<AdminProjectsResponse>({
    queryKey: ['admin-projects', page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pageSize.toString(),
      });

      const response = await fetch(`/api/admin/projects?${params}`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.statusText}`);
      }

      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
