import { useQuery } from '@tanstack/react-query';
import { fetchPropertyInfo } from '../api-client/geo.client';

export function usePropertyInfo(designation: string, projectId?: string) {
  return useQuery({
    queryKey: ['property', designation, projectId],
    queryFn: () => fetchPropertyInfo(designation, projectId),
    enabled: !!designation && designation.length >= 3,
    staleTime: 1000 * 60 * 30, // 30 minutes
  });
}
