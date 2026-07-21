import React, { Suspense, lazy, useEffect, useState } from 'react';
import { StatusBanner } from './admin/SharedAdminComponents';
import { csrfFetch, getCsrfToken } from '../services/csrfClient';

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
  const [token, setToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [username, setUsername] = useState('admin');
  const [organisationId, setOrganisationId] = useState('');
  const [authBootstrapping, setAuthBootstrapping] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoggingIn(true);
    try {
      const csrfToken = await getCsrfToken(true);
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ username, password }),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Inloggningen misslyckades');
      }
      setToken(json.accessToken);
      setRefreshToken(json.refreshToken || '');
      if (json.user?.organisationId) {
        setOrganisationId(json.user.organisationId);
      }
    } catch (err: any) {
      setError(err.message || 'Ogiltiga uppgifter');
    } finally {
      setIsLoggingIn(false);
    }
  };

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
        const response = await csrfFetch('/api/auth/refresh', {
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
      } catch {
        if (cancelled) return;
        setToken('');
        setRefreshToken('');
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

  const refresh = async () => {
    const response = await csrfFetch('/api/auth/refresh', {
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
      <div className="flex h-screen items-center justify-center bg-slate-50 font-sans">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          <h2 className="text-2xl font-bold text-slate-800 text-center mb-2">Admin Login</h2>
          <p className="text-slate-500 text-sm text-center mb-6">Logga in for att hantera systemet</p>
          
          {error && (
            <div className="mb-4 rounded-xl bg-red-50 p-4 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Användarnamn</label>
              <input
                data-testid="admin-username-input"
                type="text"
                className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Lösenord</label>
              <input
                data-testid="admin-password-input"
                type="password"
                className="w-full rounded-xl border border-slate-300 px-4 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            
            <button
              data-testid="admin-login-button"
              type="submit"
              disabled={isLoggingIn}
              className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:bg-indigo-400"
            >
              {isLoggingIn ? 'Loggar in...' : 'Logga in'}
            </button>
          </form>
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
        token={token}
        refreshToken={refreshToken}
        organisationId={organisationId}
        onRefresh={refresh}
        onLogout={logout}
      />
    </Suspense>
  );
};

export default AdminSearchConsole;
