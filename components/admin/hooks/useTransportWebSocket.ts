/**
 * useTransportWebSocket – Subscribe to real-time transport updates
 * Connects to ws://server/transport/updates?token=...
 */

import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from './useWebSocket';

const ACCESS_TOKEN_KEY = 'miljobeslut_admin_bearer';

interface TransportUpdate {
  type: 'transport-update';
  bookingId: string;
  updates: {
    status: string;
    location?: { lat: number; lng: number };
    speedKmh?: number;
    lastUpdate: string;
  };
  timestamp: string;
}

interface InitialData {
  type: 'initial-data';
  bookings: Array<{
    id: string;
    status: string;
    updatedAt: string;
  }>;
  timestamp: string;
}

export const useTransportWebSocket = () => {
  const queryClient = useQueryClient();

  const token =
    typeof window !== 'undefined' ? String(window.localStorage.getItem(ACCESS_TOKEN_KEY) || '').trim() : '';

  const wsUrl = token
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/transport/updates?token=${encodeURIComponent(token)}`
    : '';

  const { isConnected } = useWebSocket(wsUrl, {
    onMessage: (data: TransportUpdate | InitialData) => {
      if (data.type === 'transport-update') {
        const update = data as TransportUpdate;
        // Update React Query cache with new transport status
        queryClient.setQueryData(
          ['transport-bookings'],
          (oldData: { bookings: InitialData['bookings'] } | undefined) => {
            if (!oldData) return oldData;
            return {
              ...oldData,
              bookings: oldData.bookings.map((booking) =>
                booking.id === update.bookingId
                  ? { ...booking, status: update.updates.status, updatedAt: update.updates.lastUpdate }
                  : booking,
              ),
            };
          },
        );
      }
    },
    onError: (error) => {
      console.error('[TransportWebSocket] Error:', error);
    },
    reconnect: true,
    maxReconnectAttempts: 5,
  });

  return { isConnected };
};
