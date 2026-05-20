import React from 'react';
import { QueryClient, QueryClientProvider as TanstackQueryClientProvider } from '@tanstack/react-query';

/**
 * QueryClientProvider – Setup för React Query
 * Konfigurerad för admin-moduler med:
 * - 5 min stale time
 * - 10 min garbage collection time
 * - Retry-logik för failed requests
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minuter
      gcTime: 10 * 60 * 1000, // 10 minuter (före: cacheTime)
      retry: 1, // Retry failed requests once
      refetchOnWindowFocus: false, // Avoid excessive refetches
    },
    mutations: {
      retry: 1,
    },
  },
});

interface QueryClientProviderProps {
  children: React.ReactNode;
}

/**
 * AdminQueryClientProvider – Wrapper för React Query
 * Monteras på root-nivå av admin-gränssnittet
 */
const AdminQueryClientProvider: React.FC<QueryClientProviderProps> = ({ children }) => {
  return <TanstackQueryClientProvider client={queryClient}>{children}</TanstackQueryClientProvider>;
};

export default AdminQueryClientProvider;
