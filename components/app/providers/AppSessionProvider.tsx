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

function shouldForceReauthentication(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('http 401') ||
    message.includes('http 403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('session expired') ||
    message.includes('token')
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

  const loadBootstrap = useCallback(
    async (allowRefresh = true) => {
      try {
        const nextBootstrap = await requestBootstrap();
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
      } catch (error: unknown) {
        let resolvedError: unknown = error;
        if (allowRefresh && getToken()) {
          try {
            await refreshAccessSession();
            const nextBootstrap = await requestBootstrap();
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

        const stillHasSession = Boolean(getToken());
        hasAutoOpenedWorkspaceRef.current = false;
        setBootstrap(null);
        setSessionUser(null);
        setSessionState(stillHasSession ? 'error' : 'unauthenticated');
        setSessionError(
          resolvedError instanceof Error ? resolvedError.message : 'Kunde inte ladda appstart.',
        );
      }
    },
    [requestBootstrap],
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
