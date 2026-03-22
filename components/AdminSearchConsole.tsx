import React, { Suspense, lazy, useEffect, useState } from 'react';
import { StatusBanner } from './admin/SharedAdminComponents';

const AdminSessionConsole = lazy(() => import('./admin/AdminSessionConsole'));

const TOKEN_KEY = 'miljobeslut_admin_bearer';
const REFRESH_KEY = 'miljobeslut_admin_refresh';
const USER_KEY = 'miljobeslut_admin_user';

interface AdminSearchConsoleProps {
  panel?: 'search' | 'insight' | 'invitations';
}

const SessionFallback: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center bg-slate-50 font-sans">
    <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl text-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mx-auto" />
      <p className="mt-4 font-bold text-slate-800">Laddar adminkonsol...</p>
    </div>
  </div>
);

const AdminSearchConsole: React.FC<AdminSearchConsoleProps> = ({ panel = 'search' }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [organisationId, setOrganisationId] = useState('');
  const [authBootstrapping, setAuthBootstrapping] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    let cancelled = false;

    const bootstrapAuth = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY) || '';
      const storedRefreshToken = localStorage.getItem(REFRESH_KEY) || '';
      const storedUsername = localStorage.getItem(USER_KEY) || 'admin';

      setUsername(storedUsername);

      if (!storedToken && !storedRefreshToken) {
        if (!cancelled) {
          setToken('');
          setRefreshToken('');
          setAuthBootstrapping(false);
        }
        return;
      }

      if (!storedRefreshToken) {
        if (!cancelled) {
          setToken(storedToken);
          setRefreshToken('');
          setAuthBootstrapping(false);
        }
        return;
      }

      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: storedRefreshToken }),
        });
        const json = await response.json();
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || 'Sessionsfornyelse misslyckades');
        }
        if (cancelled) return;
        setToken(String(json.accessToken || ''));
        setRefreshToken(String(json.refreshToken || storedRefreshToken));
        if (json.user?.organisationId) setOrganisationId(json.user.organisationId);
        setError('');
      } catch {
        if (cancelled) return;
        setToken('');
        setRefreshToken('');
        setError('Adminsessionen hade gatt ut. Logga in igen.');
      } finally {
        if (!cancelled) setAuthBootstrapping(false);
      }
    };

    void bootstrapAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(TOKEN_KEY, token);
  }, [token]);

  useEffect(() => {
    localStorage.setItem(REFRESH_KEY, refreshToken);
  }, [refreshToken]);

  useEffect(() => {
    localStorage.setItem(USER_KEY, username);
  }, [username]);

  const login = async () => {
    const response = await fetch('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = await response.json();
    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || 'Inloggning misslyckades');
    }
    setToken(String(json.accessToken || ''));
    setRefreshToken(String(json.refreshToken || ''));
    if (json.user?.organisationId) setOrganisationId(json.user.organisationId);
    setPassword('');
  };

  const refresh = async () => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const json = await response.json();
    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || 'Sessionsfornyelse misslyckades');
    }
    setToken(String(json.accessToken || ''));
    setRefreshToken(String(json.refreshToken || refreshToken));
    if (json.user?.organisationId) setOrganisationId(json.user.organisationId);
  };

  const logout = () => {
    setToken('');
    setRefreshToken('');
    setOrganisationId('');
  };

  if (authBootstrapping) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 font-sans">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mx-auto" />
          <p className="mt-4 font-bold text-slate-800">Bootstrapping admin...</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 font-sans">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          <h2 className="text-2xl font-black text-slate-900">Admin Login</h2>
          <h3 className="mt-2 text-lg font-black text-slate-900">Admin inloggning och session</h3>
          <p className="mt-2 text-sm text-slate-500">
            Logga in for att hantera miljo-beslut.se plattformen.
          </p>
          <div className="mt-8 space-y-4">
            <input
              data-testid="admin-username-input"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:outline-none"
              placeholder="Username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <input
              data-testid="admin-password-input"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:outline-none"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !busy) {
                  setBusy('login');
                  setError('');
                  void login()
                    .then(() => setInfo('Admin inloggad.'))
                    .catch((loginError) =>
                      setError(loginError instanceof Error ? loginError.message : 'Inloggning misslyckades')
                    )
                    .finally(() => setBusy(''));
                }
              }}
            />
            <button
              data-testid="admin-login-button"
              className="w-full rounded-2xl bg-slate-900 py-3 text-sm font-black text-white transition-all hover:bg-black"
              onClick={() => {
                setBusy('login');
                setError('');
                void login()
                  .then(() => setInfo('Admin inloggad.'))
                  .catch((loginError) =>
                    setError(loginError instanceof Error ? loginError.message : 'Inloggning misslyckades')
                  )
                  .finally(() => setBusy(''));
              }}
              disabled={busy === 'login'}
            >
              {busy === 'login' ? 'Loggar in...' : 'Logga in'}
            </button>
          </div>
          <StatusBanner error={error} info={info} />
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<SessionFallback />}>
      <AdminSessionConsole
        panel={panel}
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        token={token}
        refreshToken={refreshToken}
        organisationId={organisationId}
        onLogin={login}
        onRefresh={refresh}
        onLogout={logout}
      />
    </Suspense>
  );
};

export default AdminSearchConsole;
