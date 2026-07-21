import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBankIdAuth } from '../../src/ui/hooks/useAuth';

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

  it('handles init errors, cancel and logout flows', async () => {
    authMocks.initiateBankId.mockRejectedValue(new Error('init failed'));
    authMocks.cancelBankId.mockResolvedValue(undefined);
    authMocks.logout.mockResolvedValue(undefined);

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

    localStorage.setItem('miljobeslut_admin_bearer', 'to-remove');
    await act(async () => {
      await result.current.logout();
    });

    expect(authMocks.logout).toHaveBeenCalled();
    expect(localStorage.getItem('miljobeslut_admin_bearer')).toBeNull();
  });
});
