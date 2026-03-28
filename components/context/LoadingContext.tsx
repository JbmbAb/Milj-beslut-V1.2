import React, { createContext, useContext, useState, ReactNode } from 'react';
import { LoadingSpinner } from '../ui/LoadingSpinner';

interface LoadingState {
  isLoading: boolean;
  message?: string;
}

interface LoadingContextType {
  loading: LoadingState;
  setLoading: (state: LoadingState) => void;
  startLoading: (message?: string) => void;
  stopLoading: () => void;
}

/**
 * Context for managing global loading state across the application
 * Provides a centralized way to show/hide loading states
 */
const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export const LoadingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState<LoadingState>({ isLoading: false });

  const startLoading = (message?: string) => {
    setLoading({ isLoading: true, message });
  };

  const stopLoading = () => {
    setLoading({ isLoading: false, message: undefined });
  };

  return (
    <LoadingContext.Provider value={{ loading, setLoading, startLoading, stopLoading }}>
      {children}
      {loading.isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <LoadingSpinner
            label={loading.message}
            size="lg"
            variant="dark"
          />
        </div>
      )}
    </LoadingContext.Provider>
  );
};

/**
 * Hook to use loading context
 * @throws Error if used outside of LoadingProvider
 */
export const useLoading = (): LoadingContextType => {
  const context = useContext(LoadingContext);
  if (!context) {
    throw new Error('useLoading must be used within LoadingProvider');
  }
  return context;
};

export default LoadingContext;
