/**
 * useCarbonWebSocket – Subscribe to real-time CO₂ updates
 * Connects to ws://server/projects/:projectId/carbon?token=...
 */

import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from './useWebSocket';

const ACCESS_TOKEN_KEY = 'miljobeslut_admin_bearer';

interface CarbonUpdate {
  type: 'carbon-update';
  projectId: string;
  result: {
    totalKgCo2e: number;
    quality: string;
    method: string;
  };
  riskMetrics: Array<{
    name: string;
    score: number;
    threshold: number;
    status: string;
  }>;
  timestamp: string;
}

export const useCarbonWebSocket = (projectId: string) => {
  const queryClient = useQueryClient();

  const token =
    typeof window !== 'undefined' ? String(window.localStorage.getItem(ACCESS_TOKEN_KEY) || '').trim() : '';

  const wsUrl =
    projectId && token
      ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/projects/${projectId}/carbon?token=${encodeURIComponent(token)}`
      : '';

  const { isConnected } = useWebSocket(wsUrl, {
    onMessage: (data: CarbonUpdate) => {
      if (data.type === 'carbon-update') {
        // Update React Query cache with new CO₂ data
        queryClient.setQueryData(['carbon-metrics', projectId], {
          carbonResult: data.result,
          riskMetrics: data.riskMetrics,
        });
      }
    },
    onError: (error) => {
      console.error('[CarbonWebSocket] Error:', error);
    },
    reconnect: true,
    maxReconnectAttempts: 5,
  });

  return { isConnected };
};
