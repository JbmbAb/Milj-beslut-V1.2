/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppBootstrapResponse, User } from '../../../types';
import {
  callApi,
  clearSession,
  getActiveProjectId,
  getToken,
  refreshAccessSession,
  setActiveProjectId,
} from '../../../services/coreApiClient';

export type AppSessionState = 'loading' | 'unauthenticated' | 'ready' | 'error';

export function shouldForceReauthentication(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('http 401') ||
    message.includes('http 403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('session expired') ||
    message.includes('token expired') ||
    message.includes('invalid token') ||
    message.includes('invalid_refresh_token') ||
    message.includes('invalid-refresh-token') ||
    message.includes('invalid access token') ||
    message.includes('missing bearer token') ||
    message.includes('token has been revoked') ||
    message.includes('refresh token reuse')
  );
}

export type AppSessionContextValue = {
  sessionState: AppSessionState;
  sessionError: string;
  bootstrap: AppBootstrapResponse | null;
  sessionUser: User | null;
  setSessionUser: (user: User | null) => void;
  loadBootstrap: (allowRefresh?: boolean) => Promise<void>;
  retryBootstrap: () => Promise<void>;
  onLoginSuccess: (user: User) => void;
  clearSessionAndReset: () => void;
  hasAutoOpenedWorkspaceRef: React.MutableRefObject<boolean>;
};

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

export function AppSessionProvider({ children }: { children: ReactNode }) {
  const hasAutoOpenedWorkspaceRef = useRef(false);
  const bootstrapInFlightRef = useRef<Promise<void> | null>(null);
  const bootstrapEpochRef = useRef(0);
  const [sessionState, setSessionState] = useState<AppSessionState>(() =>
    getToken() ? 'loading' : 'unauthenticated',
  );
  const [bootstrap, setBootstrap] = useState<AppBootstrapResponse | null>(null);
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [sessionError, setSessionError] = useState('');

  const requestBootstrap = useCallback(async () => {
    const preferredProjectId = getActiveProjectId();
    const payload = await callApi<{ ok: boolean; bootstrap: AppBootstrapResponse }>('/api/app/bootstrap', {
      method: 'GET',
      query: preferredProjectId ? { activeProjectId: preferredProjectId } : undefined,
    });
    return payload.bootstrap;
  }, []);

  const applyBootstrapSuccess = useCallback((epoch: number, nextBootstrap: AppBootstrapResponse) => {
    if (epoch !== bootstrapEpochRef.current) return;
    setBootstrap(nextBootstrap);
    setSessionUser({
      id: nextBootstrap.user.id,
      name: nextBootstrap.user.displayName,
      personalNumber: nextBootstrap.user.bankidId,
      isAuthenticated: true,
    });
    setSessionState('ready');
    setSessionError('');
    setActiveProjectId(nextBootstrap.activeProjectId);
  }, []);

  const applyBootstrapFailure = useCallback((epoch: number, resolvedError: unknown) => {
    if (epoch !== bootstrapEpochRef.current) return;
    const stillHasSession = Boolean(getToken());
    hasAutoOpenedWorkspaceRef.current = false;
    setBootstrap(null);
    setSessionUser(null);
    setSessionState(stillHasSession ? 'error' : 'unauthenticated');
    setSessionError(
      resolvedError instanceof Error ? resolvedError.message : 'Kunde inte ladda appstart.',
    );
  }, []);

  const loadBootstrap = useCallback(
    async (allowRefresh = true) => {
      if (bootstrapInFlightRef.current) {
        return bootstrapInFlightRef.current;
      }

      const epoch = bootstrapEpochRef.current;

      const run = async () => {
        try {
          const nextBootstrap = await requestBootstrap();
          applyBootstrapSuccess(epoch, nextBootstrap);
        } catch (error: unknown) {
          let resolvedError: unknown = error;
          if (allowRefresh && getToken()) {
            try {
              await refreshAccessSession();
              const nextBootstrap = await requestBootstrap();
              applyBootstrapSuccess(epoch, nextBootstrap);
              return;
            } catch (refreshError: unknown) {
              resolvedError = refreshError;
              if (shouldForceReauthentication(refreshError)) {
                clearSession();
              }
            }
          } else if (shouldForceReauthentication(error)) {
            clearSession();
          }

          applyBootstrapFailure(epoch, resolvedError);
        }
      };

      const promise = run().finally(() => {
        if (bootstrapInFlightRef.current === promise) {
          bootstrapInFlightRef.current = null;
        }
      });
      bootstrapInFlightRef.current = promise;
      return promise;
    },
    [applyBootstrapFailure, applyBootstrapSuccess, requestBootstrap],
  );

  useEffect(() => {
    if (!getToken()) return;
    const timer = window.setTimeout(() => {
      void loadBootstrap();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadBootstrap]);

  const retryBootstrap = useCallback(async () => {
    setSessionState('loading');
    await loadBootstrap();
  }, [loadBootstrap]);

  const onLoginSuccess = useCallback(
    (user: User) => {
      bootstrapEpochRef.current += 1;
      setSessionUser(user);
      setSessionState('loading');
      void loadBootstrap();
    },
    [loadBootstrap],
  );

  const clearSessionAndReset = useCallback(() => {
    clearSession();
    setSessionError('');
    setSessionState('unauthenticated');
    hasAutoOpenedWorkspaceRef.current = false;
    setBootstrap(null);
    setSessionUser(null);
  }, []);

  const value = useMemo<AppSessionContextValue>(
    () => ({
      sessionState,
      sessionError,
      bootstrap,
      sessionUser,
      setSessionUser,
      loadBootstrap,
      retryBootstrap,
      onLoginSuccess,
      clearSessionAndReset,
      hasAutoOpenedWorkspaceRef,
    }),
    [
      sessionState,
      sessionError,
      bootstrap,
      sessionUser,
      loadBootstrap,
      retryBootstrap,
      onLoginSuccess,
      clearSessionAndReset,
    ],
  );

  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

export function useAppSession(): AppSessionContextValue {
  const ctx = useContext(AppSessionContext);
  if (!ctx) {
    throw new Error('useAppSession must be used within AppSessionProvider');
  }
  return ctx;
}
