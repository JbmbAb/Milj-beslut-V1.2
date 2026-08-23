import React, { useState } from 'react';
import { useAppSession } from './providers/AppSessionProvider';
import { useAppWorkspace } from './providers/AppWorkspaceProvider';
import { setSession, callApi, getToken, getRefreshToken, setActiveProjectId } from '../../services/coreApiClient';
import { MimerProductShell } from './MimerProductShell';
import { AuthInterface } from '../project/AuthInterface';
import { logout as bankIdLogout, type BankIdLoginResult } from '../../src/ui/hooks/useAuth';

interface BankIdStatusResponse {
  ok: boolean;
  mode: 'mock' | 'test' | 'production';
  canInitiate: boolean;
  message: string;
  allowDevLogin: boolean;
}

export const AppShell: React.FC = () => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authConfig, setAuthConfig] = useState<BankIdStatusResponse | null>(null);
  const [authConfigError, setAuthConfigError] = useState('');

  // PRODUCT-AUTH-USER-LOGIN-UX-01 Phase B: which login surfaces to even RENDER is decided by
  // the server (BankID readiness, ALLOW_DEV_LOGIN), never guessed client-side from NODE_ENV --
  // a build running in a browser has no reliable view of the server's env at all.
  React.useEffect(() => {
    let cancelled = false;
    callApi<BankIdStatusResponse>('/api/auth/bankid/status', { method: 'GET', auth: false })
      .then((status) => {
        if (!cancelled) setAuthConfig(status);
      })
      .catch((err) => {
        if (!cancelled) setAuthConfigError(err instanceof Error ? err.message : 'Kunde inte läsa in inloggningskonfiguration.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = window.localStorage.getItem('miljobeslut_admin_bearer');
      if (token === 'dummy-token') {
        window.localStorage.removeItem('miljobeslut_admin_bearer');
        window.localStorage.removeItem('miljobeslut_admin_refresh');
        window.localStorage.removeItem('miljobeslut_admin_project');
        window.location.reload();
      }
    }
  }, []);

  const {
    sessionState,
    sessionError,
    bootstrap,
    sessionUser,
    retryBootstrap,
    onLoginSuccess,
    clearSessionAndReset,
    loadBootstrap,
  } = useAppSession();

  const { activeProjectLabel } = useAppWorkspace();

  if (sessionState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-indigo-500" />
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
            Laddar verifierad session
          </p>
        </div>
      </div>
    );
  }

  if (sessionState === 'unauthenticated') {
    const handleDevLogin = async () => {
      setIsLoggingIn(true);
      try {
        const payload = await callApi<{
          ok: boolean;
          accessToken: string;
          refreshToken: string;
          user: { id: string };
        }>('/api/admin/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: 'dev' },
          auth: false,
        });
        if (payload.ok) {
          // PRODUCT-AUTH-USER-LOGIN-UX-01: no hardcoded activeProjectId here -- the server's
          // own bootstrap (via onLoginSuccess -> loadBootstrap) resolves whichever project is
          // actually valid for this user, same as the real BankID path below.
          setSession({ accessToken: payload.accessToken, refreshToken: payload.refreshToken });
          onLoginSuccess({
            id: payload.user.id,
            name: 'Admin Developer',
            personalNumber: '198001011234',
            isAuthenticated: true,
          });
        } else {
          setIsLoggingIn(false);
        }
      } catch (err) {
        console.error('Login failed', err);
        setIsLoggingIn(false);
      }
    };

    const handleBankIdComplete = (result: BankIdLoginResult) => {
      setSession({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      onLoginSuccess({
        id: result.user.id,
        name: result.user.displayName || 'Verifierad användare',
        personalNumber: result.user.bankidId || '',
        isAuthenticated: true,
      });
    };

    const bankIdReady = Boolean(authConfig?.canInitiate);
    const devLoginAllowed = Boolean(authConfig?.allowDevLogin);
    const stillResolvingAuthConfig = !authConfig && !authConfigError;

    return (
      <div
        data-testid="app-login"
        className="min-h-screen flex flex-col items-center justify-center gap-6 bg-slate-950 text-white p-6"
      >
        {stillResolvingAuthConfig ? (
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-white/10 border-t-indigo-500" />
        ) : bankIdReady ? (
          <AuthInterface onComplete={handleBankIdComplete} />
        ) : (
          <div data-testid="bankid-unavailable" className="text-center max-w-md">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              BankID är inte tillgängligt
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {authConfig?.message || authConfigError || 'Inloggning kan inte startas just nu.'}
            </p>
          </div>
        )}

        {devLoginAllowed ? (
          <div className="text-center">
            {isLoggingIn ? (
              <div className="mt-2">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-white/10 border-t-indigo-500" />
                <p className="mt-2 text-xs text-slate-400">Loggar in via backenden...</p>
              </div>
            ) : (
              <button
                type="button"
                data-testid="dev-login"
                onClick={handleDevLogin}
                className="mt-2 p-2 bg-slate-800 hover:bg-slate-700 transition-colors font-bold text-xs px-4 rounded-lg border border-slate-700 text-slate-300"
              >
                Dev-inloggning (endast utveckling)
              </button>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  if (sessionState === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="w-full max-w-lg rounded-[2rem] border border-rose-400/20 bg-white/5 p-8 text-white">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-rose-300">
            Session kunde inte verifieras
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight">Startflodet ar inte redo</h1>
          <p className="mt-4 text-sm text-slate-300">{sessionError || 'Okant fel vid bootstrap.'}</p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => {
                void retryBootstrap();
              }}
              className="rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-900"
            >
              Forsok igen
            </button>
            <button
              type="button"
              onClick={clearSessionAndReset}
              className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black text-slate-200"
            >
              Logga in pa nytt
            </button>
          </div>
        </div>
      </div>
    );
  }

  // PRODUCT-UI-LEGACY-ISOLATION-01: the normal product UI is MimerProductShell,
  // unconditionally -- there is no runtime path back to the legacy dashboard/workspace
  // shell (TechnicalDashboardHub, AppContentRouter, AppSidebar) from here any more, so no
  // env value can resurrect it. Legacy-scoped modules (sewage, mass notification, logistics,
  // generators, project manager) are out of the frozen LU+admin-console product scope.
  const handleLogout = async () => {
    try {
      await bankIdLogout(getToken() || undefined, getRefreshToken() || undefined);
    } catch (err) {
      console.error('Logout request failed', err);
    } finally {
      clearSessionAndReset();
    }
  };

  return (
    <MimerProductShell
      userName={sessionUser?.name || bootstrap?.user.displayName || 'Verifierad användare'}
      organisationName={bootstrap?.organisation.name}
      activeProjectLabel={activeProjectLabel}
      projects={bootstrap?.projects}
      activeProjectId={bootstrap?.activeProjectId ?? null}
      onSelectProject={(projectId) => {
        setActiveProjectId(projectId);
        void loadBootstrap();
      }}
      onLogout={() => void handleLogout()}
    />
  );
};
