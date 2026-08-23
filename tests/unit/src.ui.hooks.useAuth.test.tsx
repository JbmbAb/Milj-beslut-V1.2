import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBankIdAuth, logout } from '../../src/ui/hooks/useAuth';

const authMocks = vi.hoisted(() => ({
  cancelBankId: vi.fn(),
  collectBankId: vi.fn(),
  initiateBankId: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../../src/ui/api-client/auth.client', () => ({
  cancelBankId: authMocks.cancelBankId,
  collectBankId: authMocks.collectBankId,
  initiateBankId: authMocks.initiateBankId,
  logout: authMocks.logout,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('src/ui/hooks/useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initiates auth and exposes pending state and order data', async () => {
    authMocks.initiateBankId.mockResolvedValue({
      orderRef: 'order-1',
      autoStartToken: 'token',
    });

    const { result } = renderHook(() => useBankIdAuth(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.initiate();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('pending');
    });

    expect(result.current.order).toEqual({
      orderRef: 'order-1',
      autoStartToken: 'token',
    });
    expect(result.current.error).toBeNull();
  }, 15000);

  it('handles failed polling responses', async () => {
    authMocks.initiateBankId.mockResolvedValue({
      orderRef: 'order-2',
      autoStartToken: 'token',
    });
    authMocks.collectBankId.mockResolvedValue({
      status: 'failed',
      hintCode: 'expiredTransaction',
    });
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(((fn: TimerHandler) => {
      void Promise.resolve().then(() => {
        if (typeof fn === 'function') {
          fn();
        }
      });
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setInterval);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval').mockImplementation(() => undefined);

    const { result } = renderHook(() => useBankIdAuth(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.initiate();
    });

    await waitFor(() => {
      expect(authMocks.collectBankId).toHaveBeenCalledWith('order-2');
      expect(result.current.status).toBe('failed');
      expect(result.current.error).toBe('expiredTransaction');
    });
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalled();
  }, 15000);

  it('handles init errors and cancel flows', async () => {
    authMocks.initiateBankId.mockRejectedValue(new Error('init failed'));
    authMocks.cancelBankId.mockResolvedValue(undefined);

    const { result } = renderHook(() => useBankIdAuth(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.initiate();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('failed');
    });
    expect(result.current.error).toBe('init failed');

    authMocks.initiateBankId.mockResolvedValueOnce({
      orderRef: 'order-3',
      autoStartToken: 'token',
    });

    await act(async () => {
      result.current.initiate();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('pending');
    });

    await act(async () => {
      result.current.cancel();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
  });

  it('calls onComplete with session data when BankID collect resolves complete', async () => {
    authMocks.initiateBankId.mockResolvedValue({
      orderRef: 'order-4',
      autoStartToken: 'token',
    });
    authMocks.collectBankId.mockResolvedValue({
      status: 'complete',
      accessToken: 'access-4',
      refreshToken: 'refresh-4',
      user: { id: 'user-4', role: 'ADMIN', organisationId: 'org-1' },
    });
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(((fn: TimerHandler) => {
      void Promise.resolve().then(() => {
        if (typeof fn === 'function') {
          fn();
        }
      });
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setInterval);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => undefined);
    const onComplete = vi.fn();

    const { result } = renderHook(() => useBankIdAuth(onComplete), { wrapper: createWrapper() });

    await act(async () => {
      result.current.initiate();
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        accessToken: 'access-4',
        refreshToken: 'refresh-4',
        user: { id: 'user-4', role: 'ADMIN', organisationId: 'org-1' },
      });
    });
    expect(result.current.status).toBe('complete');
    setIntervalSpy.mockRestore();
  }, 15000);

  it('fails with an explicit error when BankID collect completes without session data', async () => {
    authMocks.initiateBankId.mockResolvedValue({
      orderRef: 'order-5',
      autoStartToken: 'token',
    });
    authMocks.collectBankId.mockResolvedValue({ status: 'complete' });
    vi.spyOn(global, 'setInterval').mockImplementation(((fn: TimerHandler) => {
      void Promise.resolve().then(() => {
        if (typeof fn === 'function') {
          fn();
        }
      });
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setInterval);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => undefined);
    const onComplete = vi.fn();

    const { result } = renderHook(() => useBankIdAuth(onComplete), { wrapper: createWrapper() });

    await act(async () => {
      result.current.initiate();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('failed');
    });
    expect(result.current.error).toBe('BankID-svaret saknade sessionsdata.');
    expect(onComplete).not.toHaveBeenCalled();
  }, 15000);
});

describe('src/ui/hooks/useAuth logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to the auth.client logout with the given tokens (no localStorage access)', async () => {
    authMocks.logout.mockResolvedValue(undefined);

    await logout('access-token', 'refresh-token');

    expect(authMocks.logout).toHaveBeenCalledWith('access-token', 'refresh-token');
  });
});
