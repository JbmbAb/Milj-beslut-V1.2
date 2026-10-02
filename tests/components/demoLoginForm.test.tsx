import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoLoginForm, describeDemoLoginError, isDemoLoginEnabled } from '../../components/app/DemoLoginForm';

// Fully mocked: no network, no database.
const callApi = vi.fn();
vi.mock('../../services/coreApiClient', () => ({
  callApi: (...args: unknown[]) => callApi(...args),
}));

describe('DEMO M2a DemoLoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is gated on VITE_DEMO_LOGIN === "true" only', () => {
    vi.stubEnv('VITE_DEMO_LOGIN', '');
    expect(isDemoLoginEnabled()).toBe(false);
    vi.stubEnv('VITE_DEMO_LOGIN', '1');
    expect(isDemoLoginEnabled()).toBe(false);
    vi.stubEnv('VITE_DEMO_LOGIN', 'true');
    expect(isDemoLoginEnabled()).toBe(true);
  });

  it('renders empty (never prefilled) and posts exactly what was typed to the admin login route, never the dev shortcut', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const consoleSpies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
    callApi.mockResolvedValue({ ok: true, accessToken: 'a', refreshToken: 'r', user: { id: 'u1' } });

    render(<DemoLoginForm onSuccess={onSuccess} />);
    expect(screen.getByTestId('demo-login-username')).toHaveValue('');
    expect(screen.getByTestId('demo-login-password')).toHaveValue('');
    expect(screen.getByTestId('demo-login-password')).toHaveAttribute('type', 'password');

    await user.type(screen.getByTestId('demo-login-username'), '  typed-user ');
    await user.type(screen.getByTestId('demo-login-password'), 'typed-secret');
    await user.click(screen.getByTestId('demo-login-submit'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(callApi).toHaveBeenCalledWith('/api/admin/auth/login', {
      method: 'POST',
      body: { username: 'typed-user', password: 'typed-secret' },
      auth: false,
    });
    expect(onSuccess.mock.calls[0][1]).toBe('typed-user');
    // Credentials are never logged.
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('typed-secret');
      }
      spy.mockRestore();
    }
  });

  it('a failed login shows a clear Swedish error, clears the password and does not call onSuccess', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    callApi.mockRejectedValue(new Error('Invalid admin credentials'));

    render(<DemoLoginForm onSuccess={onSuccess} />);
    await user.type(screen.getByTestId('demo-login-username'), 'someone');
    await user.type(screen.getByTestId('demo-login-password'), 'wrong');
    await user.click(screen.getByTestId('demo-login-submit'));

    expect(await screen.findByTestId('demo-login-error')).toHaveTextContent(
      'Inloggningen misslyckades: fel användarnamn eller lösenord.',
    );
    expect(screen.getByTestId('demo-login-error')).not.toHaveTextContent('wrong');
    expect(screen.getByTestId('demo-login-password')).toHaveValue('');
    expect(screen.getByTestId('demo-login-submit')).not.toBeDisabled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('empty fields never reach the server', async () => {
    const user = userEvent.setup();
    render(<DemoLoginForm onSuccess={vi.fn()} />);
    await user.click(screen.getByTestId('demo-login-submit'));
    expect(await screen.findByTestId('demo-login-error')).toHaveTextContent('Ange både användarnamn och lösenord.');
    expect(callApi).not.toHaveBeenCalled();
  });

  it('maps server/network failures to distinct messages', () => {
    expect(describeDemoLoginError(new Error('Admin login is not configured (ADMIN_CONSOLE_PASSWORD missing).'))).toContain(
      'inte konfigurerad',
    );
    expect(describeDemoLoginError(new Error('HTTP 429'))).toContain('för många försök');
    expect(describeDemoLoginError(new Error('Failed to fetch'))).toContain('servern svarade inte');
    expect(describeDemoLoginError(new Error('something else'))).toBe('Inloggningen misslyckades.');
  });
});
