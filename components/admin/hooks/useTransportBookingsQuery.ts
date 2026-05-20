import { useQuery } from '@tanstack/react-query';
import type { TransportBooking } from '../types/admin';

interface TransportBookingsResponse {
  bookings: TransportBooking[];
  total: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  hasMore?: boolean;
}

/**
 * useTransportBookingsQuery – React Query hook för transport-bokningar
 * Stödjer pagination med page och limit
 * Caching med 5 min stale time
 */
export const useTransportBookingsQuery = (page = 1, limit = 10, projectId?: string) => {
  return useQuery<TransportBookingsResponse>({
    queryKey: ['transport-bookings', page, limit, projectId],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });

      const response = await fetch(`/api/transport/bookings?${params}`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { bookings: [], total: 0 };
        }
        throw new Error(`Failed to fetch bookings: ${response.statusText}`);
      }

      const json = await response.json();
      const allBookings = Array.isArray(json.bookings) ? json.bookings : json.data || [];

      const filtered = projectId
        ? allBookings.filter((b: TransportBooking) => b.id.includes(projectId))
        : allBookings;

      filtered.sort((a: TransportBooking, b: TransportBooking) => {
        const dateA = new Date(a.plannedPickupAt).getTime();
        const dateB = new Date(b.plannedPickupAt).getTime();
        return dateB - dateA;
      });

      return {
        bookings: filtered,
        total: json.total || filtered.length,
        page: json.page || page,
        limit: json.limit || limit,
        totalPages: json.totalPages,
        hasMore: json.hasMore,
      };
    },
    staleTime: 5 * 60 * 1000,
    enabled: true,
  });
};
