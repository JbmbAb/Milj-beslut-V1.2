import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../types';

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BankIDLogin from '../../components/BankIDLogin';

const user = userEvent.setup({ delay: null });

function mockBankIdFlow(options?: { collectStatus?: 'pending' | 'complete' }) {
  const collectStatus = options?.collectStatus || 'pending';
  let mockCompleted = false;

  return vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/api/csrf-token')) {
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          csrfToken: 'csrf-test-token',
        }),
      } as unknown as Response;
    }

    if (url.includes('/api/auth/bankid/status')) {
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          ok: true,
          mode: 'mock',
          canInitiate: true,
          message: 'BankID (test)',
        }),
      } as unknown as Response;
    }

    if (url.includes('/api/auth/bankid/init')) {
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          ok: true,
          orderRef: 'order-1',
          orderTime: new Date().toISOString(),
          qrPayload: 'bankid.test.qr',
          launchMode: 'mock',
          launchUrl: '/api/auth/bankid/mock/launch/order-1',
        }),
      } as unknown as Response;
    }

    if (url.includes('/api/auth/bankid/mock/complete')) {
      mockCompleted = true;
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          ok: true,
          mode: 'mock',
          order: {
            orderRef: 'order-1',
            status: 'complete',
          },
        }),
      } as unknown as Response;
    }

    if (url.includes('/api/auth/bankid/collect')) {
      if (collectStatus === 'complete' || mockCompleted) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: vi.fn().mockResolvedValue({
            ok: true,
            status: 'complete',
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            user: {
              id: 'user-1',
              displayName: 'Erik Andersson',
              bankidId: '198501011234',
            },
          }),
        } as unknown as Response;
      }

      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          ok: true,
          status: 'pending',
          hintCode: 'outstandingTransaction',
        }),
      } as unknown as Response;
    }

    if (url.includes('/api/auth/bankid/cancel')) {
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ ok: true, cancelled: true }),
      } as unknown as Response;
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });
}

describe('BankIDLogin', () => {
  let onLogin: (user: User) => void;

  beforeEach(() => {
    onLogin = vi.fn<(user: User) => void>();
    vi.restoreAllMocks();
    vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(window, 'setInterval').mockImplementation(() => 1 as any);
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/bankid/status')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () =>
            Promise.resolve({
              ok: true,
              mode: 'real',
              canInitiate: true,
              message: 'ok',
            }),
        } as unknown as Response;
      }
      if (url.includes('/api/csrf-token')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ csrfToken: 'csrf-test-token' }),
        } as unknown as Response;
      }
      throw new Error(`Unhandled fetch in BankIDLogin test: ${url}`);
    });
  });

  it('renders the welcome heading', () => {
    render(<BankIDLogin onLogin={onLogin} />);
    expect(screen.getByText('Välkommen.')).toBeInTheDocument();
  });

  it('shows "Öppna BankID" button', () => {
    render(<BankIDLogin onLogin={onLogin} />);
    expect(screen.getByRole('button', { name: /Öppna BankID/i })).toBeInTheDocument();
  });

  it('button is enabled when input is empty (QR-flöde)', async () => {
    render(<BankIDLogin onLogin={onLogin} />);
    expect(await screen.findByRole('button', { name: /Öppna BankID/i })).not.toBeDisabled();
  });

  it('button is enabled when 12 digits entered', async () => {
    render(<BankIDLogin onLogin={onLogin} />);
    await user.type(screen.getByPlaceholderText('198501011234'), '198501011234');
    expect(screen.getByRole('button', { name: /Öppna BankID/i })).not.toBeDisabled();
  });

  it('strips non-digit characters from input', async () => {
    render(<BankIDLogin onLogin={onLogin} />);
    const input = screen.getByPlaceholderText('198501011234');
    await user.type(input, '1985-01-01-1234');
    expect((input as HTMLInputElement).value).toBe('198501011234');
  });

  it('shows scan state after init and pending collect response', async () => {
    mockBankIdFlow({ collectStatus: 'pending' });
    render(<BankIDLogin onLogin={onLogin} />);

    await user.type(screen.getByPlaceholderText('198501011234'), '198501011234');
    await user.click(screen.getByRole('button', { name: /Öppna BankID/i }));

    expect(await screen.findByText(/Väntar på BankID/i)).toBeInTheDocument();
    expect(screen.getByText(/outstandingTransaction/i)).toBeInTheDocument();
  });

  it('calls onLogin when collect completes with a real session payload', async () => {
    mockBankIdFlow({ collectStatus: 'complete' });
    render(<BankIDLogin onLogin={onLogin} />);

    await user.type(screen.getByPlaceholderText('198501011234'), '198501011234');
    await user.click(screen.getByRole('button', { name: /Öppna BankID/i }));

    await waitFor(() =>
      expect(onLogin).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'user-1',
          name: 'Erik Andersson',
          personalNumber: '198501011234',
          isAuthenticated: true,
        }),
      ),
    );
  });

  it('adminOnly hides BankID UI and skips /api/auth/bankid/status', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    render(<BankIDLogin adminOnly onLogin={onLogin} />);
    expect(screen.queryByRole('button', { name: /Öppna BankID/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Logga in som administratör/i })).toBeInTheDocument();
    await waitFor(() => {
      const statusCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/auth/bankid/status'));
      expect(statusCalls.length).toBe(0);
    });
  });

  it('lets mock users complete BankID inline when the popup is blocked', async () => {
    mockBankIdFlow({ collectStatus: 'pending' });
    render(<BankIDLogin onLogin={onLogin} />);

    await user.type(screen.getByPlaceholderText('198501011234'), '197904077117');
    await user.click(screen.getByRole('button', { name: /Öppna BankID/i }));
    await user.click(await screen.findByRole('button', { name: /Godkänn mock-BankID här/i }));

    await waitFor(() =>
      expect(onLogin).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'user-1',
          isAuthenticated: true,
        }),
      ),
    );
  });
});
