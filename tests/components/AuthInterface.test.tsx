import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthInterface } from '../../components/project/AuthInterface';

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

function renderAuthInterface() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthInterface onComplete={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('AuthInterface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockReturnValue(window);
  });

  afterEach(() => vi.restoreAllMocks());

  it('hands the exact order launch URL to BankID and offers a manual fallback', async () => {
    authMocks.initiateBankId.mockResolvedValue({
      orderRef: 'order-1',
      autoStartToken: 'token-1',
      launchUrl: 'bankid:///?autostarttoken=token-1&redirect=null',
    });

    renderAuthInterface();
    fireEvent.click(screen.getByTestId('bankid-start'));

    await screen.findByTestId('bankid-pending');
    expect(window.open).toHaveBeenCalledWith('bankid:///?autostarttoken=token-1&redirect=null', '_self');

    fireEvent.click(screen.getByTestId('bankid-open-app'));
    await waitFor(() => {
      expect(window.open).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId('bankid-qr-not-supported')).toBeInTheDocument();
  });
});
