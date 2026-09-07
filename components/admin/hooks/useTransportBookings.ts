import { useState, useEffect, useCallback } from 'react';
import type { TransportBooking } from '../types/admin';

interface UseTransportBookingsResult {
  bookings: TransportBooking[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hämtar transport-bokningar från `/api/transport/bookings`
 * Förfiltrerar på status och sorterar efter datum
 */
export const useTransportBookings = (projectId?: string): UseTransportBookingsResult => {
  const [bookings, setBookings] = useState<TransportBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBookings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Hämta från API (utan project-filter för nu, då API kan behöva uppdateras)
      const response = await fetch('/api/transport/bookings', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        // Fallback om endpoint inte finns ännu
        if (response.status === 404) {
          console.warn('[useTransportBookings] Endpoint not found, using empty list');
          setBookings([]);
          return;
        }
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json();
      const allBookings = Array.isArray(json.bookings) ? json.bookings : json.data || [];

      // Filter by projectId if provided
      const filtered = projectId
        ? allBookings.filter((b: TransportBooking) => b.id.includes(projectId))
        : allBookings;

      // Sort by plannedPickupAt (descending)
      filtered.sort((a: TransportBooking, b: TransportBooking) => {
        const dateA = new Date(a.plannedPickupAt).getTime();
        const dateB = new Date(b.plannedPickupAt).getTime();
        return dateB - dateA;
      });

      setBookings(filtered);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Okänt fel vid hämtning av bokningar';
      setError(message);
      console.error('[useTransportBookings] Error:', message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
     
    fetchBookings();
  }, [fetchBookings]);

  return { bookings, loading, error, refetch: fetchBookings };
};
