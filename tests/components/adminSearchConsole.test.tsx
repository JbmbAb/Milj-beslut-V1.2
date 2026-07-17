import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the lazy-loaded admin session console
vi.mock('../../components/admin/AdminSessionConsole', () => ({
  default: () => <div data-testid="admin-session-console">Admin Session Console</div>,
}));

import AdminSearchConsole from '../../components/AdminSearchConsole';

const user = userEvent.setup({ delay: null });

describe('AdminSearchConsole', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: vi.fn().mockResolvedValue({}) }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Login form ────────────────────────────────────────────────────────────

  it('renders Admin Login heading when no token stored', async () => {
    render(<AdminSearchConsole />);
    await screen.findByText('Admin Login');
    expect(screen.getByText('Admin Login')).toBeInTheDocument();
  });

  it('renders username and password inputs', async () => {
    render(<AdminSearchConsole />);
    await screen.findByTestId('admin-username-input');
    expect(screen.getByTestId('admin-username-input')).toBeInTheDocument();
    expect(screen.getByTestId('admin-password-input')).toBeInTheDocument();
  });

  it('has default username value of admin', async () => {
    render(<AdminSearchConsole />);
    const input = await screen.findByTestId('admin-username-input');
    expect((input as HTMLInputElement).value).toBe('admin');
  });

  it('renders the login button', async () => {
    render(<AdminSearchConsole />);
    await screen.findByTestId('admin-login-button');
    expect(screen.getByTestId('admin-login-button')).toBeInTheDocument();
  });

  it('shows descriptive subtitle text', async () => {
    render(<AdminSearchConsole />);
    await screen.findByText(/Logga in for att hantera/i);
    expect(screen.getByText(/Logga in for att hantera/i)).toBeInTheDocument();
  });

  it('can type in username field', async () => {
    render(<AdminSearchConsole />);
    const input = await screen.findByTestId('admin-username-input');
    await user.clear(input);
    await user.type(input, 'testuser');
    expect((input as HTMLInputElement).value).toBe('testuser');
  });

  it('can type in password field', async () => {
    render(<AdminSearchConsole />);
    const input = await screen.findByTestId('admin-password-input');
    await user.type(input, 'secret123');
    expect((input as HTMLInputElement).value).toBe('secret123');
  });

  it('shows error when login fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ csrfToken: 'csrf-123' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: vi.fn().mockResolvedValue({ error: 'Ogiltiga uppgifter' }),
        }),
    );
    render(<AdminSearchConsole />);
    const loginBtn = await screen.findByTestId('admin-login-button');
    await user.type(screen.getByTestId('admin-password-input'), 'wrong-password');
    await user.click(loginBtn);
    await waitFor(() => expect(screen.getByText(/Ogiltiga uppgifter/i)).toBeInTheDocument());
  });
});
