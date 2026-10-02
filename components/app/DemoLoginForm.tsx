import React, { useState } from 'react';
import { callApi } from '../../services/coreApiClient';

/**
 * DEMO M2a (LU product demonstrator, local only).
 *
 * A plain username/password form for the local demo user. It is rendered ONLY when the client
 * build has the explicit demo flag VITE_DEMO_LOGIN=true (default: off, so a normal build never
 * shows it). It posts exactly what the user typed to the same server route the demo CLI uses
 * (POST /api/admin/auth/login) -- it never prefills, never hardcodes a username or password, never
 * uses the password:'dev' shortcut, and never logs the credentials or the server response.
 */
export function isDemoLoginEnabled(): boolean {
  try {
    return import.meta.env?.VITE_DEMO_LOGIN === 'true';
  } catch {
    return false;
  }
}

export type DemoLoginSuccess = {
  ok: boolean;
  accessToken: string;
  refreshToken: string;
  user: { id: string };
};

/** Maps a failed login to a clear Swedish message; never echoes what the user typed. */
export function describeDemoLoginError(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (/invalid admin credentials|HTTP 401/i.test(message)) {
    return 'Inloggningen misslyckades: fel användarnamn eller lösenord.';
  }
  if (/not configured|HTTP 503/i.test(message)) {
    return 'Inloggningen misslyckades: inloggning är inte konfigurerad på servern.';
  }
  if (/HTTP 429|too many/i.test(message)) {
    return 'Inloggningen misslyckades: för många försök. Vänta en minut och försök igen.';
  }
  if (/failed to fetch|network/i.test(message)) {
    return 'Inloggningen misslyckades: servern svarade inte.';
  }
  return 'Inloggningen misslyckades.';
}

export const DemoLoginForm: React.FC<{
  onSuccess: (payload: DemoLoginSuccess, username: string) => void;
}> = ({ onSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      setError('Ange både användarnamn och lösenord.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const payload = await callApi<DemoLoginSuccess>('/api/admin/auth/login', {
        method: 'POST',
        body: { username: trimmedUsername, password },
        auth: false,
      });
      if (!payload?.ok || !payload.accessToken) {
        throw new Error('LOGIN_REJECTED');
      }
      setPassword('');
      onSuccess(payload, trimmedUsername);
    } catch (err) {
      setPassword('');
      setError(describeDemoLoginError(err));
      setSubmitting(false);
    }
  };

  return (
    <form
      data-testid="demo-login-form"
      onSubmit={(e) => void submit(e)}
      className="w-full max-w-sm rounded-2xl border border-slate-700 bg-white/5 p-6 space-y-4"
      autoComplete="on"
    >
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">Inloggning för lokal demo</p>
        <p className="mt-1 text-xs text-slate-400">Logga in med demoanvändarens användarnamn och lösenord.</p>
      </div>
      <label className="block text-xs text-slate-300">
        Användarnamn
        <input
          data-testid="demo-login-username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
        />
      </label>
      <label className="block text-xs text-slate-300">
        Lösenord
        <input
          data-testid="demo-login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
        />
      </label>
      {error ? (
        <p data-testid="demo-login-error" role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        data-testid="demo-login-submit"
        disabled={submitting}
        className="w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
      >
        {submitting ? 'Loggar in…' : 'Logga in'}
      </button>
    </form>
  );
};

export default DemoLoginForm;
